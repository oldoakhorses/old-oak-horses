import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const getUpcomingEvents = query({
  args: {},
  handler: async (ctx) => {
    const today = new Date().toISOString().slice(0, 10);

    const events = await ctx.db
      .query("scheduleEvents")
      .withIndex("by_date")
      .filter((q) => q.gte(q.field("date"), today))
      .collect();

    const horses = await Promise.all(events.map(async (event) => [event.horseId, await ctx.db.get(event.horseId)] as const));
    const horseById = new Map(horses.map(([horseId, horse]) => [horseId, horse]));
    const contactIds = [...new Set(events.map((event) => event.providerId).filter((id) => id !== undefined))];
    const contacts = await Promise.all(contactIds.map(async (contactId) => [contactId, await ctx.db.get(contactId)] as const));
    const contactById = new Map(contacts);

    return events
      .map((event) => ({
        ...event,
        horseName: horseById.get(event.horseId)?.name ?? "Unknown horse",
        providerName: event.providerName ?? (event.providerId ? (contactById.get(event.providerId)?.name ?? undefined) : undefined)
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
});

export const getPastEvents = query({
  args: {
    limit: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    const today = new Date().toISOString().slice(0, 10);
    const limit = args.limit ?? 25;

    const events = await ctx.db
      .query("scheduleEvents")
      .withIndex("by_date")
      .filter((q) => q.lt(q.field("date"), today))
      .collect();

    const horses = await Promise.all(events.map(async (event) => [event.horseId, await ctx.db.get(event.horseId)] as const));
    const horseById = new Map(horses.map(([horseId, horse]) => [horseId, horse]));
    const contactIds = [...new Set(events.map((event) => event.providerId).filter((id) => id !== undefined))];
    const contacts = await Promise.all(contactIds.map(async (contactId) => [contactId, await ctx.db.get(contactId)] as const));
    const contactById = new Map(contacts);

    return events
      .map((event) => ({
        ...event,
        horseName: horseById.get(event.horseId)?.name ?? "Unknown horse",
        providerName: event.providerName ?? (event.providerId ? (contactById.get(event.providerId)?.name ?? undefined) : undefined)
      }))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, limit);
  }
});

export const getEventsByHorse = query({
  args: { horseId: v.id("horses") },
  handler: async (ctx, args) => {
    const events = await ctx.db
      .query("scheduleEvents")
      .withIndex("by_horse", (q) => q.eq("horseId", args.horseId))
      .collect();

    return events.sort((a, b) => a.date.localeCompare(b.date));
  }
});

export const createEvent = mutation({
  args: {
    type: v.string(),
    horseId: v.id("horses"),
    date: v.string(),
    providerId: v.optional(v.id("contacts")),
    providerName: v.optional(v.string()),
    note: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("scheduleEvents", {
      type: args.type.trim(),
      horseId: args.horseId,
      date: args.date,
      providerId: args.providerId,
      providerName: args.providerName?.trim() || undefined,
      note: args.note?.trim() || undefined,
      createdAt: Date.now()
    });
  }
});

export const updateEvent = mutation({
  args: {
    id: v.id("scheduleEvents"),
    type: v.optional(v.string()),
    horseId: v.optional(v.id("horses")),
    date: v.optional(v.string()),
    providerId: v.optional(v.id("contacts")),
    providerName: v.optional(v.string()),
    note: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.id);
    if (!event) {
      throw new Error("Event not found");
    }

    await ctx.db.patch(args.id, {
      type: args.type?.trim(),
      horseId: args.horseId,
      date: args.date,
      providerId: args.providerId,
      providerName: args.providerName?.trim() || undefined,
      note: args.note?.trim() || undefined
    });

    return args.id;
  }
});

export const deleteEvent = mutation({
  args: { id: v.id("scheduleEvents") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return args.id;
  }
});
