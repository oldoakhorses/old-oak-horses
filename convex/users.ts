import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

async function hashPasscode(passcode: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(passcode);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    return users.map((u) => ({
      _id: u._id,
      name: u.name,
      email: u.email,
      role: u.role,
      isActive: u.isActive !== false,
      createdAt: u.createdAt,
    }));
  },
});

export const createUser = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    passcode: v.string(),
    role: v.optional(v.union(v.literal("admin"), v.literal("owner"), v.literal("team"), v.literal("investor"))),
    ownerId: v.optional(v.id("owners")),
  },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (!email || !args.passcode.trim()) {
      throw new Error("Email and passcode are required");
    }

    const existing = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();
    if (existing) {
      throw new Error("A user with this email already exists");
    }

    const passcodeHash = await hashPasscode(args.passcode);
    return await ctx.db.insert("users", {
      name: args.name.trim(),
      email,
      passcodeHash,
      role: args.role,
      ownerId: args.ownerId,
      isActive: true,
      createdAt: Date.now(),
    });
  },
});

export const updateUser = mutation({
  args: {
    userId: v.id("users"),
    name: v.optional(v.string()),
    role: v.optional(v.union(v.literal("admin"), v.literal("owner"), v.literal("team"), v.literal("investor"))),
    isActive: v.optional(v.boolean()),
    ownerId: v.optional(v.id("owners")),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");

    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) patch.name = args.name.trim();
    if (args.role !== undefined) patch.role = args.role;
    if (args.isActive !== undefined) patch.isActive = args.isActive;
    if (args.ownerId !== undefined) patch.ownerId = args.ownerId;

    await ctx.db.patch(args.userId, patch);
    return args.userId;
  },
});

export const resetPasscode = mutation({
  args: {
    userId: v.id("users"),
    newPasscode: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");
    if (!args.newPasscode.trim()) throw new Error("Passcode is required");

    const passcodeHash = await hashPasscode(args.newPasscode);
    await ctx.db.patch(args.userId, { passcodeHash });

    // Invalidate all existing sessions for this user
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    for (const session of sessions) {
      await ctx.db.delete(session._id);
    }

    return args.userId;
  },
});

export const deleteUser = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    for (const session of sessions) {
      await ctx.db.delete(session._id);
    }
    await ctx.db.delete(args.userId);
  },
});

export const getProfile = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return null;
    return {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      profilePhotoUrl: user.profilePhotoId
        ? await ctx.storage.getUrl(user.profilePhotoId)
        : null,
    };
  },
});

export const updateProfile = mutation({
  args: {
    userId: v.id("users"),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");

    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) patch.name = args.name.trim();

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.userId, patch);
    }
    return args.userId;
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const setProfilePhoto = mutation({
  args: {
    userId: v.id("users"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");

    if (user.profilePhotoId) {
      await ctx.storage.delete(user.profilePhotoId);
    }

    await ctx.db.patch(args.userId, { profilePhotoId: args.storageId });
    return args.userId;
  },
});

export const removeProfilePhoto = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");

    if (user.profilePhotoId) {
      await ctx.storage.delete(user.profilePhotoId);
      await ctx.db.patch(args.userId, { profilePhotoId: undefined });
    }
    return args.userId;
  },
});
