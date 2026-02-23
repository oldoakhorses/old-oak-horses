import { convexAuth } from "@convex-dev/auth/server";
import { Email } from "@convex-dev/auth/providers/Email";
import { Password } from "@convex-dev/auth/providers/Password";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
        const email = String(params.email ?? "").trim().toLowerCase();
        return { email, role: "investor" as const };
      },
      reset: Email({
        id: "password-reset",
        maxAge: 60 * 15,
        async sendVerificationRequest({ identifier, token }) {
          const apiKey = process.env.RESEND_API_KEY;
          if (!apiKey) {
            throw new Error("Missing RESEND_API_KEY environment variable");
          }

          const from = process.env.AUTH_EMAIL_FROM ?? "Old Oak Horses <no-reply@oldoakhorses.com>";
          const response = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              from,
              to: identifier,
              subject: "Reset your Old Oak Horses password",
              text: `Your Old Oak Horses password reset code is: ${token}\n\nThis code expires in 15 minutes.`
            })
          });

          if (!response.ok) {
            const body = await response.text();
            throw new Error(`Failed to send reset email: ${body}`);
          }
        }
      })
    })
  ]
});
