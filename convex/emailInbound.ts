"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

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
      })
    ),
  },
  handler: async (ctx, args) => {
    const supported = args.attachments.filter(
      (a) =>
        a.contentType === "application/pdf" ||
        a.contentType.startsWith("image/")
    );

    if (supported.length > 0) {
      let processed = 0;

      for (const attachment of supported) {
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
        const cleanName = attachment.name.replace(/\.[^.]+$/, "");
        const fileName = `Email - ${cleanName} - ${dateStr}`;

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

      return { processed };
    }

    const bodyContent = args.htmlBody || args.textBody || "";
    if (!bodyContent.trim()) return { processed: 0 };

    const now = Date.now();
    const dateStr = new Date(now).toISOString().slice(0, 10);
    const subjectClean = args.subject.replace(/[^a-zA-Z0-9 &\-_.]/g, "").trim().slice(0, 80) || "Email Receipt";
    const fileName = `Email - ${subjectClean} - ${dateStr}`;

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
      htmlBody: args.htmlBody || "",
      textBody: args.textBody || "",
      subject: args.subject,
      fromEmail: args.fromEmail,
    });

    return { processed: 1 };
  },
});
