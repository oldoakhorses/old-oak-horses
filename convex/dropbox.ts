import { v } from "convex/values";
import { internalAction, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/**
 * Temporary test mutation — schedules Dropbox upload for a given bill.
 * Remove after verifying Dropbox integration works.
 */
export const testDropboxUpload = mutation({
  args: { billId: v.id("bills") },
  handler: async (ctx, args) => {
    console.log("[Dropbox-Test] Scheduling upload for bill:", args.billId);
    await ctx.scheduler.runAfter(0, internal.dropbox.uploadInvoiceToDropbox, {
      billId: args.billId
    });
    return { scheduled: true };
  }
});

/**
 * Dropbox integration for syncing invoices and record attachments.
 *
 * Folder structure:
 *   /Old Oak Group/<Year>/<Month>/invoices/<filename>.pdf
 *   /Old Oak Group/<Year>/<Month>/records/<filename>.pdf
 *
 * Month names match user's existing folder names (January, February, etc.)
 */

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const ROOT_FOLDER = "/Old Oak Group";

/* ---------- helpers ---------- */

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Build the Dropbox folder path from a date.
 * e.g. dateMs from 2026-03-17 → "/Old Oak Group/2026/March"
 */
function buildFolderPath(dateMs: number): string {
  const d = new Date(dateMs);
  const year = d.getFullYear();
  const month = MONTH_NAMES[d.getMonth()];
  return `${ROOT_FOLDER}/${year}/${month}`;
}

/**
 * Build a structured file name for an invoice.
 * Format: <category>-<provider>-<invoice-date>.pdf
 * e.g.  "farrier-john-smith-2026-03-17.pdf"
 */
function buildInvoiceFileName(
  categoryName: string,
  providerName: string | undefined,
  dateMs: number,
  originalFileName: string
): string {
  const d = new Date(dateMs);
  const dateStr = d.toISOString().slice(0, 10);
  const cat = slugify(categoryName);
  const provider = providerName ? slugify(providerName) : "unknown";
  const ext = getExtension(originalFileName);
  return `${cat}-${provider}-${dateStr}${ext}`;
}

/**
 * Build a structured file name for a record attachment.
 * Format: <record-type>-<horse-name>-<date>.pdf
 * e.g. "farrier-luna-2026-03-17.pdf"
 */
function buildRecordFileName(
  recordType: string,
  horseName: string | undefined,
  dateMs: number,
  originalFileName: string
): string {
  const d = new Date(dateMs);
  const dateStr = d.toISOString().slice(0, 10);
  const type = slugify(recordType);
  const horse = horseName ? slugify(horseName) : "unknown";
  const ext = getExtension(originalFileName);
  return `${type}-${horse}-${dateStr}${ext}`;
}

function getExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  if (idx === -1) return ".pdf";
  return fileName.slice(idx);
}

/* ---------- Dropbox API helpers ---------- */

/**
 * Get a fresh access token using the refresh token.
 * Dropbox short-lived tokens expire after ~4 hours,
 * so we always refresh before uploading.
 */
async function getAccessToken(): Promise<string | null> {
  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;
  const appKey = process.env.DROPBOX_APP_KEY;
  const appSecret = process.env.DROPBOX_APP_SECRET;

  if (!refreshToken || !appKey || !appSecret) {
    console.error("Dropbox credentials not set (DROPBOX_REFRESH_TOKEN, DROPBOX_APP_KEY, DROPBOX_APP_SECRET)");
    return null;
  }

  const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: appKey,
      client_secret: appSecret,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("Dropbox token refresh failed:", res.status, errText);
    return null;
  }

  const data = await res.json();
  return data.access_token;
}

async function dropboxUploadFile(
  accessToken: string,
  dropboxPath: string,
  fileBytes: ArrayBuffer
): Promise<{ path_display: string; id: string } | null> {
  const res = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Dropbox-API-Arg": JSON.stringify({
        path: dropboxPath,
        mode: "add",
        autorename: true,
        mute: false
      }),
      "Content-Type": "application/octet-stream"
    },
    body: fileBytes
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("Dropbox upload failed:", res.status, errText);
    return null;
  }

  return await res.json();
}

/* ---------- Internal action: upload invoice PDF to Dropbox ---------- */

export const uploadInvoiceToDropbox = internalAction({
  args: {
    billId: v.id("bills")
  },
  handler: async (ctx, args): Promise<{ dropboxPath: string | null }> => {
    try {
      console.log("[Dropbox] Starting invoice upload for bill:", args.billId);

      const accessToken = await getAccessToken();
      if (!accessToken) {
        console.error("[Dropbox] Failed to get access token");
        return { dropboxPath: null };
      }
      console.log("[Dropbox] Got access token");

      const bill = await ctx.runQuery(internal.dropboxHelpers.getBillForDropbox, {
        billId: args.billId
      });
      if (!bill) {
        console.error("[Dropbox] Bill not found:", args.billId);
        return { dropboxPath: null };
      }
      console.log("[Dropbox] Bill found:", bill.fileName, "fileId:", bill.fileId);

      // Get the file bytes from Convex storage
      // Use getUrl + fetch since storage IDs from queries are plain strings
      const storageUrl = await ctx.storage.getUrl(bill.fileId as Id<"_storage">);
      if (!storageUrl) {
        console.error("[Dropbox] No storage URL for fileId:", bill.fileId);
        return { dropboxPath: null };
      }
      console.log("[Dropbox] Got storage URL");

      const fileRes = await fetch(storageUrl);
      if (!fileRes.ok) {
        console.error("[Dropbox] Failed to fetch file from storage:", fileRes.status);
        return { dropboxPath: null };
      }
      const bytes = await fileRes.arrayBuffer();
      console.log("[Dropbox] Got file bytes:", bytes.byteLength);

      // Determine the invoice date — use extracted date if available, else uploadedAt
      const extractedData = bill.extractedData as Record<string, unknown> | undefined;
      let invoiceDateMs = bill.uploadedAt;
      if (extractedData?.invoice_date || extractedData?.date) {
        const dateStr = String(extractedData.invoice_date ?? extractedData.date);
        const parsed = Date.parse(dateStr);
        if (!isNaN(parsed)) invoiceDateMs = parsed;
      }

      const folder = buildFolderPath(invoiceDateMs);
      const fileName = buildInvoiceFileName(
        bill.categoryName ?? "uncategorized",
        bill.providerName,
        invoiceDateMs,
        bill.fileName
      );
      const fullPath = `${folder}/${fileName}`;
      console.log("[Dropbox] Uploading to path:", fullPath);

      const result = await dropboxUploadFile(accessToken, fullPath, bytes);
      if (result) {
        console.log("[Dropbox] Invoice uploaded successfully:", result.path_display);
        await ctx.runMutation(internal.dropboxHelpers.saveBillDropboxPath, {
          billId: args.billId,
          dropboxPath: result.path_display
        });
        return { dropboxPath: result.path_display };
      }

      console.error("[Dropbox] Upload returned null result");
      return { dropboxPath: null };
    } catch (err) {
      console.error("[Dropbox] Invoice upload error:", String(err));
      return { dropboxPath: null };
    }
  }
});

/* ---------- Internal action: upload record attachment to Dropbox ---------- */

export const uploadRecordAttachmentToDropbox = internalAction({
  args: {
    recordId: v.id("horseRecords"),
    storageId: v.string()
  },
  handler: async (ctx, args): Promise<{ dropboxPath: string | null }> => {
    const accessToken = await getAccessToken();
    if (!accessToken) {
      return { dropboxPath: null };
    }

    const record = await ctx.runQuery(internal.dropboxHelpers.getRecordForDropbox, {
      recordId: args.recordId
    });
    if (!record) {
      console.error("Record not found for Dropbox upload:", args.recordId);
      return { dropboxPath: null };
    }

    // Get file bytes from Convex storage via URL
    const storageUrl = await ctx.storage.getUrl(args.storageId as Id<"_storage">);
    if (!storageUrl) {
      console.error("No storage URL for attachment:", args.storageId);
      return { dropboxPath: null };
    }
    const fileRes = await fetch(storageUrl);
    if (!fileRes.ok) {
      console.error("Failed to fetch attachment from storage:", fileRes.status);
      return { dropboxPath: null };
    }
    const bytes = await fileRes.arrayBuffer();

    const folder = buildFolderPath(record.date);
    const fileName = buildRecordFileName(
      record.type,
      record.horseName,
      record.date,
      record.attachmentName ?? "attachment.pdf"
    );
    const fullPath = `${folder}/${fileName}`;

    const result = await dropboxUploadFile(accessToken, fullPath, bytes);
    if (result) {
      console.log("Record attachment uploaded to Dropbox:", result.path_display);
      await ctx.runMutation(internal.dropboxHelpers.saveRecordDropboxPath, {
        recordId: args.recordId,
        dropboxPath: result.path_display
      });
      return { dropboxPath: result.path_display };
    }

    return { dropboxPath: null };
  }
});
