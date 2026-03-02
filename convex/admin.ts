import { mutation } from "./_generated/server";

export const ensureDefaultAdmin = mutation({
  args: {},
  handler: async () => {
    const email = (process.env.ADMIN_EMAIL ?? "lucy@oldoakhorses.com").trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD;

    if (!password) {
      throw new Error("ADMIN_PASSWORD not set");
    }

    return { ok: true as const, email };
  }
});
