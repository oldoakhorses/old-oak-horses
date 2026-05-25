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
    const htmlBody = body.HtmlBody ?? "";
    const textBody = body.TextBody ?? "";

    const attachments: Array<{
      name: string;
      contentType: string;
      contentBase64: string;
    }> = [];

    if (Array.isArray(body.Attachments)) {
      for (const att of body.Attachments) {
        if (att.Content && att.ContentType && att.Name) {
          attachments.push({
            name: att.Name,
            contentType: att.ContentType,
            contentBase64: att.Content,
          });
        }
      }
    }

    await ctx.scheduler.runAfter(0, internal.emailInbound.processInboundEmail, {
      fromEmail,
      subject,
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
