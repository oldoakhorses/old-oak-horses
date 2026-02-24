import { createAccount, modifyAccountCredentials } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation } from "./_generated/server";

export const seedUser = mutation({
  args: {
    email: v.string(),
    password: v.string(),
    role: v.union(v.literal("admin"), v.literal("investor"))
  },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    const password = args.password;
    const role = args.role;

    if (!email.includes("@")) {
      throw new Error("Invalid email");
    }
    if (password.length < 8) {
      throw new Error("Password must be at least 8 characters");
    }

    const existingAdmins = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("role"), "admin"))
      .take(1);

    // Bootstrap mode: if no admin exists yet, allow seeding without auth.
    if (existingAdmins.length > 0) {
      const identity = await ctx.auth.getUserIdentity();
      const adminEmail = process.env.INVITE_ADMIN_EMAIL?.toLowerCase();
      if (!adminEmail) {
        throw new Error("Missing INVITE_ADMIN_EMAIL environment variable");
      }
      if (!identity?.email || identity.email.toLowerCase() !== adminEmail) {
        throw new Error("Unauthorized: only invite admin can seed users");
      }
    }

    const alreadyExists = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();
    if (alreadyExists) {
      await ctx.db.patch(alreadyExists._id, { role });
      await modifyAccountCredentials(ctx as any, {
        provider: "password",
        account: { id: email, secret: password }
      });
      return { ok: true as const, userId: alreadyExists._id, email, created: false as const };
    }

    const created = await createAccount(ctx as any, {
      provider: "password",
      account: { id: email, secret: password },
      profile: { email, role },
      shouldLinkViaEmail: false,
      shouldLinkViaPhone: false
    });

    return { ok: true as const, userId: created.user._id, email, role, created: true as const };
  }
});

export const purgeUserByEmail = mutation({
  args: {
    email: v.string()
  },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();

    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();

    const accounts = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) => q.eq("provider", "password").eq("providerAccountId", email))
      .collect();

    for (const account of accounts) {
      await ctx.db.delete(account._id);
    }

    if (user) {
      await ctx.db.delete(user._id);
    }

    return {
      ok: true as const,
      email,
      deletedUser: !!user,
      deletedAccounts: accounts.length
    };
  }
});
