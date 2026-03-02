"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";

export const login = action({
  args: { email: v.string(), password: v.string() },
  handler: async (_ctx, args) => {
    const email = process.env.ADMIN_EMAIL || "lucy@oldoakhorses.com";
    const password = process.env.ADMIN_PASSWORD;

    if (!password) {
      return { success: false as const, error: "ADMIN_PASSWORD not set" };
    }

    if (args.email === email && args.password === password) {
      return { success: true as const };
    }

    return { success: false as const, error: "invalid" };
  },
});
