"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

export const processInboundEmail = internalAction({
  args: {
    fromEmail: v.string(),
    subject: v.string(),
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

    if (supported.length === 0) return { processed: 0 };

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
  },
});
