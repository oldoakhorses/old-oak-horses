"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { simpleParser } from "mailparser";

type Attachment = {
  name: string;
  contentType: string;
  contentBase64: string;
  contentLength?: number;
  isInline?: boolean;
};

async function extractFromEml(emlBase64: string): Promise<{
  attachments: Attachment[];
  htmlBody: string;
  textBody: string;
  subject: string;
}> {
  const buffer = Buffer.from(emlBase64, "base64");
  const parsed = await simpleParser(buffer);
  const attachments: Attachment[] = [];

  if (parsed.attachments) {
    for (const att of parsed.attachments) {
      attachments.push({
        name: att.filename || "attachment",
        contentType: att.contentType,
        contentBase64: att.content.toString("base64"),
        contentLength: att.size,
        isInline: att.contentDisposition === "inline",
      });
    }
  }

  return {
    attachments,
    htmlBody: parsed.html || "",
    textBody: parsed.text || "",
    subject: parsed.subject || "",
  };
}

export const processInboundEmail = internalAction({
  args: {
    fromEmail: v.string(),
    subject: v.string(),
    htmlBody: v.optional(v.string()),
    textBody: v.optional(v.string()),
    attachments: v.array(
      v.object({
        name: v.string(),
        contentType: v.string(),
        contentBase64: v.string(),
        contentLength: v.optional(v.number()),
        isInline: v.optional(v.boolean()),
      })
    ),
  },
  handler: async (ctx, args) => {
    console.log("[processInboundEmail]", JSON.stringify({
      from: args.fromEmail,
      subject: args.subject,
      htmlBodyLen: args.htmlBody?.length ?? 0,
      textBodyLen: args.textBody?.length ?? 0,
      attachments: args.attachments.map(a => ({
        name: a.name,
        type: a.contentType,
        size: a.contentLength || Math.ceil(a.contentBase64.length * 3 / 4),
        inline: a.isInline,
      })),
    }));

    let allAttachments = [...args.attachments];
    let htmlBody = args.htmlBody || "";
    let textBody = args.textBody || "";

    const emlAttachments = args.attachments.filter(
      (a) => a.contentType === "message/rfc822" || a.name.toLowerCase().endsWith(".eml")
    );

    if (emlAttachments.length > 0) {
      console.log("[processInboundEmail] Found .eml attachments, extracting inner content");
      for (const eml of emlAttachments) {
        try {
          const extracted = await extractFromEml(eml.contentBase64);
          console.log("[processInboundEmail] Extracted from .eml:", {
            innerAttachments: extracted.attachments.map(a => `${a.contentType} (${a.name})`),
            innerHtmlLen: extracted.htmlBody.length,
            innerTextLen: extracted.textBody.length,
          });
          allAttachments = allAttachments.filter(a => a !== eml);
          allAttachments.push(...extracted.attachments);
          if (extracted.htmlBody && extracted.htmlBody.length > htmlBody.length) {
            htmlBody = extracted.htmlBody;
          }
          if (extracted.textBody && extracted.textBody.length > textBody.length) {
            textBody = extracted.textBody;
          }
        } catch (err) {
          console.error("[processInboundEmail] Failed to parse .eml:", err);
        }
      }
    }

    const pdfAttachments = allAttachments.filter(
      (a) =>
        !a.isInline &&
        a.contentType === "application/pdf" &&
        (a.contentLength || Math.ceil(a.contentBase64.length * 3 / 4)) > 5000
    );

    const imageAttachments = allAttachments.filter(
      (a) =>
        !a.isInline &&
        a.contentType.startsWith("image/") &&
        (a.contentLength || Math.ceil(a.contentBase64.length * 3 / 4)) > 10000
    );

    console.log("[processInboundEmail] filters:", {
      pdfCount: pdfAttachments.length,
      imageCount: imageAttachments.length,
      pdfNames: pdfAttachments.map(a => a.name),
      imageNames: imageAttachments.map(a => a.name),
    });

    let processed = 0;

    for (const attachment of pdfAttachments) {
      const bytes = Buffer.from(attachment.contentBase64, "base64");
      const blob = new Blob([bytes], { type: attachment.contentType });

      const uploadUrl = await ctx.runMutation(internal.bills.internalGenerateUploadUrl, {});
      const uploadResp = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": attachment.contentType },
        body: blob,
      });

      if (!uploadResp.ok) continue;

      const { storageId } = (await uploadResp.json()) as { storageId: string };
      const now = Date.now();
      const dateStr = new Date(now).toISOString().slice(0, 10);
      const ext = (attachment.name.match(/\.[^.]+$/) ?? [""])[0].toLowerCase();
      const cleanName = attachment.name.replace(/\.[^.]+$/, "");
      const fileName = `Email - ${cleanName} - ${dateStr}${ext}`;

      const billId = await ctx.runMutation(internal.bills.createParsingBill, {
        fileId: storageId as any,
        fileName,
        billingPeriod: dateStr.slice(0, 7),
        uploadedAt: now,
      });

      await ctx.runMutation(internal.bills.patchBillSource, {
        billId: billId as any,
        source: "email",
        createdBy: args.fromEmail,
      });

      await ctx.scheduler.runAfter(0, internal.billParsing.parseBillPdf, {
        billId: billId as any,
      });

      processed += 1;
    }

    if (processed > 0) return { processed };

    if (imageAttachments.length > 0) {
      for (const attachment of imageAttachments) {
        const bytes = Buffer.from(attachment.contentBase64, "base64");
        const blob = new Blob([bytes], { type: attachment.contentType });

        const uploadUrl = await ctx.runMutation(internal.bills.internalGenerateUploadUrl, {});
        const uploadResp = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": attachment.contentType },
          body: blob,
        });

        if (!uploadResp.ok) continue;

        const { storageId } = (await uploadResp.json()) as { storageId: string };

        const now = Date.now();
        const dateStr = new Date(now).toISOString().slice(0, 10);
        const ext = (attachment.name.match(/\.[^.]+$/) ?? [""])[0].toLowerCase();
        const cleanName = attachment.name.replace(/\.[^.]+$/, "");
        const fileName = `Email - ${cleanName} - ${dateStr}${ext}`;

        const billId = await ctx.runMutation(internal.bills.createParsingBill, {
          fileId: storageId as any,
          fileName,
          billingPeriod: dateStr.slice(0, 7),
          uploadedAt: now,
        });

        await ctx.runMutation(internal.bills.patchBillSource, {
          billId: billId as any,
          source: "email",
          createdBy: args.fromEmail,
        });

        await ctx.scheduler.runAfter(0, internal.billParsing.parseBillPdf, {
          billId: billId as any,
        });

        processed += 1;
      }

      if (processed > 0) return { processed };
    }

    const bodyContent = htmlBody || textBody || "";
    if (!bodyContent.trim()) return { processed: 0 };

    const now = Date.now();
    const dateStr = new Date(now).toISOString().slice(0, 10);
    const subjectClean = args.subject.replace(/[^a-zA-Z0-9 &\-_.]/g, "").trim().slice(0, 80) || "Email Receipt";
    const fileName = `Email - ${subjectClean} - ${dateStr}.html`;

    const htmlBytes = Buffer.from(bodyContent, "utf-8");
    const htmlBlob = new Blob([htmlBytes], { type: "text/html" });

    const uploadUrl = await ctx.runMutation(internal.bills.internalGenerateUploadUrl, {});
    const uploadResp = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": "text/html" },
      body: htmlBlob,
    });

    if (!uploadResp.ok) return { processed: 0 };

    const { storageId } = (await uploadResp.json()) as { storageId: string };

    const billId = await ctx.runMutation(internal.bills.createParsingBill, {
      fileId: storageId as any,
      fileName,
      billingPeriod: dateStr.slice(0, 7),
      uploadedAt: now,
    });

    await ctx.runMutation(internal.bills.patchBillSource, {
      billId: billId as any,
      source: "email",
      createdBy: args.fromEmail,
    });

    await ctx.scheduler.runAfter(0, internal.billParsing.parseEmailBody, {
      billId: billId as any,
      htmlBody: htmlBody,
      textBody: textBody,
      subject: args.subject,
      fromEmail: args.fromEmail,
    });

    return { processed: 1 };
  },
});
