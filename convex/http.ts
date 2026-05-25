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

    if (Array.isArray(body.Attachments)) {
      for (const att of body.Attachments) {
        if (att.Content && att.ContentType && att.Name) {
          attachments.push({
            name: att.Name,
            contentType: att.ContentType,
            contentBase64: att.Content,
            contentLength: typeof att.ContentLength === "number" && att.ContentLength > 0
              ? att.ContentLength
              : undefined,
            isInline: Boolean(att.ContentID),
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
      attachmentCount: attachments.length,
      attachmentTypes: attachments.map(a => `${a.contentType} (${a.name}, inline=${a.isInline})`),
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
