"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";

export const login = action({
  args: { email: v.string(), password: v.string() },
  handler: async (_ctx, args) => {
    const email = process.env.ADMIN_EMAIL || "lucy@oldoakhorses.com";
    const password = process.env.ADMIN_PASSWORD;
    const attemptedEmail = args.email.trim().toLowerCase();
    const expectedEmail = email.trim().toLowerCase();

    console.log("Login attempt:", attemptedEmail);
    console.log("Expected email:", expectedEmail);
    console.log("Password set:", !!password);
    console.log("Email match:", attemptedEmail === expectedEmail);
    console.log("Password match:", args.password === password);

    if (!password) {
      return { success: false as const, error: "ADMIN_PASSWORD env var not set" };
    }

    if (attemptedEmail === expectedEmail && args.password === password) {
      return { success: true as const };
    }

    return { success: false as const, error: "invalid" };
  },
});
