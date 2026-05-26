import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

http.route({
  path: "/postmark-inbound",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    const fromEmail = body.FromFull?.Email ?? body.From ?? "unknown";
    const subject = body.Subject ?? "(no subject)";
    let htmlBody = body.HtmlBody ?? "";
    let textBody = body.TextBody ?? "";

    const attachments: Array<{
      name: string;
      contentType: string;
      contentBase64: string;
      contentLength?: number;
      isInline: boolean;
    }> = [];

    const droppedAttachments: Array<{
      name?: string;
      contentType?: string;
      contentLength?: number;
      hasContent: boolean;
      hasContentType: boolean;
      hasName: boolean;
      hasContentID: boolean;
      reason: string;
    }> = [];

    if (Array.isArray(body.Attachments)) {
      for (const att of body.Attachments) {
        const hasContent = typeof att.Content === "string" && att.Content.length > 0;
        const hasContentType = typeof att.ContentType === "string" && att.ContentType.length > 0;
        const hasName = typeof att.Name === "string" && att.Name.length > 0;
        if (hasContent && hasContentType && hasName) {
          attachments.push({
            name: att.Name,
            contentType: att.ContentType,
            contentBase64: att.Content,
            contentLength: typeof att.ContentLength === "number" && att.ContentLength > 0
              ? att.ContentLength
              : undefined,
            isInline: Boolean(att.ContentID),
          });
        } else {
          // Diagnostic: log dropped attachments. The most common cause is a
          // missing `Content` field — Postmark omits attachment content in
          // some forwarded-email paths, especially CID-embedded inline
          // attachments. Knowing this lets us decide whether to fetch the
          // attachment separately via the Postmark API.
          droppedAttachments.push({
            name: typeof att.Name === "string" ? att.Name : undefined,
            contentType: typeof att.ContentType === "string" ? att.ContentType : undefined,
            contentLength: typeof att.ContentLength === "number" ? att.ContentLength : undefined,
            hasContent,
            hasContentType,
            hasName,
            hasContentID: Boolean(att.ContentID),
            reason: !hasContent
              ? "missing Content (base64 body) — Postmark did not include attachment bytes"
              : !hasContentType
                ? "missing ContentType"
                : "missing Name",
          });
        }
      }
    }

    // Gmail-forwarded emails: the body is just the forwarding wrapper.
    // Check StrippedTextReply / stripped body for forwarded content,
    // and also look for the original HTML in the full body after the
    // "---------- Forwarded message" marker.
    const isForwarded = /^(Fwd|Fw):/i.test(subject) ||
      textBody.includes("---------- Forwarded message") ||
      htmlBody.includes("---------- Forwarded message");

    // Log payload shape for debugging
    console.log("[postmark-inbound]", JSON.stringify({
      from: fromEmail,
      subject,
      htmlBodyLen: htmlBody.length,
      textBodyLen: textBody.length,
      rawAttachmentCount: Array.isArray(body.Attachments) ? body.Attachments.length : 0,
      keptAttachmentCount: attachments.length,
      droppedAttachmentCount: droppedAttachments.length,
      attachmentTypes: attachments.map(a => `${a.contentType} (${a.name}, inline=${a.isInline})`),
      droppedAttachments,
      isForwarded,
    }));

    await ctx.scheduler.runAfter(0, internal.emailInbound.processInboundEmail, {
      fromEmail,
      subject: subject.replace(/^(Fwd|Fw):\s*/i, ""),
      htmlBody,
      textBody,
      attachments,
    });

    return new Response(
      JSON.stringify({ ok: true, queued: attachments.length || 1 }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }),
});

export default http;
