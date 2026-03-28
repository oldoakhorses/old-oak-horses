import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    role: v.optional(v.union(v.literal("admin"), v.literal("investor")))
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),

  categories: defineTable({
    name: v.string(),
    slug: v.string(),
    description: v.optional(v.string())
  })
    .index("by_name", ["name"])
    .index("by_slug", ["slug"]),

  providers: defineTable({
    categoryId: v.id("categories"),
    subcategorySlug: v.optional(v.string()),
    name: v.string(),
    slug: v.optional(v.string()),
    fullName: v.optional(v.string()),
    contactName: v.optional(v.string()),
    primaryContactName: v.optional(v.string()),
    primaryContactPhone: v.optional(v.string()),
    address: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    website: v.optional(v.string()),
    accountNumber: v.optional(v.string()),
    location: v.optional(
      v.union(
        v.literal("wellington"),
        v.literal("thermal"),
        v.literal("ocala"),
        v.literal("la"),
        v.literal("eu"),
        v.literal("can")
      )
    ),
    extractionPrompt: v.string(),
    expectedFields: v.array(v.string()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number())
  })
    .index("by_name", ["name"])
    .index("by_slug", ["slug"])
    .index("by_category", ["categoryId"])
    .index("by_category_name", ["categoryId", "name"])
    .index("by_category_subcategory", ["categoryId", "subcategorySlug"])
    .index("by_category_subcategory_name", ["categoryId", "subcategorySlug", "name"]),

  bills: defineTable({
    providerId: v.optional(v.id("providers")),
    categoryId: v.id("categories"),
    fileId: v.id("_storage"),
    fileName: v.string(),
    status: v.union(
      v.literal("uploading"),
      v.literal("parsing"),
      v.literal("pending"),
      v.literal("done"),
      v.literal("error")
    ),
    billingPeriod: v.string(),
    uploadedAt: v.number(),
    extractedData: v.optional(v.any()),
    errorMessage: v.optional(v.string()),
    customProviderName: v.optional(v.string()),
    originalPdfUrl: v.optional(v.string()),
    travelSubcategory: v.optional(v.string()),
    housingSubcategory: v.optional(v.string()),
    horseTransportSubcategory: v.optional(v.string()),
    marketingSubcategory: v.optional(v.string()),
    adminSubcategory: v.optional(v.string()),
    duesSubcategory: v.optional(v.string()),
    salariesSubcategory: v.optional(v.string()),
    originalCurrency: v.optional(v.string()),
    originalTotal: v.optional(v.number()),
    exchangeRate: v.optional(v.number()),
    isApproved: v.optional(v.boolean()),
    approvedAt: v.optional(v.number()),
    isSplit: v.optional(v.boolean()),
    assignedPeople: v.optional(
      v.array(
        v.object({
          personId: v.id("people"),
          amount: v.number()
        })
      )
    ),
    horseSplitType: v.optional(v.union(v.literal("single"), v.literal("split"))),
    assignedHorses: v.optional(
      v.array(
        v.object({
          horseId: v.id("horses"),
          horseName: v.string(),
          amount: v.number()
        })
      )
    ),
    horseAssignments: v.optional(
      v.array(
        v.object({
          lineItemIndex: v.number(),
          horseId: v.optional(v.id("horses")),
          horseName: v.optional(v.string())
        })
      )
    ),
    splitLineItems: v.optional(
      v.array(
        v.object({
          lineItemIndex: v.number(),
          splits: v.array(
            v.object({
              horseId: v.id("horses"),
              horseName: v.string(),
              amount: v.number()
            })
          )
        })
      )
    ),
    personAssignments: v.optional(
      v.array(
        v.object({
          lineItemIndex: v.number(),
          personId: v.optional(v.id("people")),
          personName: v.optional(v.string()),
          role: v.optional(v.union(v.literal("rider"), v.literal("groom"), v.literal("freelance"), v.literal("trainer")))
        })
      )
    ),
    splitPersonLineItems: v.optional(
      v.array(
        v.object({
          lineItemIndex: v.number(),
          splits: v.array(
            v.object({
              personId: v.id("people"),
              personName: v.string(),
              role: v.union(v.literal("rider"), v.literal("groom"), v.literal("freelance"), v.literal("trainer")),
              amount: v.number()
            })
          )
        })
      )
    ),
    linkedBills: v.optional(
      v.array(
        v.object({
          targetBillId: v.id("bills"),
          targetCategory: v.string(),
          amount: v.number(),
          itemCount: v.number()
        })
      )
    ),
    linkedFromBillId: v.optional(v.id("bills"))
    ,
    hasUnmatchedHorses: v.optional(v.boolean()),
    unmatchedHorseNames: v.optional(v.array(v.string())),
    extractedProviderContact: v.optional(
      v.object({
        providerName: v.optional(v.string()),
        contactName: v.optional(v.string()),
        address: v.optional(v.string()),
        phone: v.optional(v.string()),
        email: v.optional(v.string()),
        website: v.optional(v.string()),
        accountNumber: v.optional(v.string())
      })
    )
  })
    .index("by_uploadedAt", ["uploadedAt"])
    .index("by_provider", ["providerId"])
    .index("by_category", ["categoryId"]),

  horses: defineTable({
    name: v.string(),
    yearOfBirth: v.optional(v.number()),
    sex: v.optional(v.union(v.literal("gelding"), v.literal("mare"), v.literal("stallion"))),
    usefNumber: v.optional(v.string()),
    feiNumber: v.optional(v.string()),
    owner: v.optional(v.string()),
    prizeMoney: v.optional(v.number()),
    status: v.union(v.literal("active"), v.literal("inactive"), v.literal("past")),
    isSold: v.optional(v.boolean()),
    soldDate: v.optional(v.number()),
    createdAt: v.number()
  })
    .index("by_name", ["name"])
    .index("by_status", ["status"])
    .index("by_status_name", ["status", "name"]),

  contacts: defineTable({
    name: v.string(),
    role: v.optional(v.string()),
    providerId: v.optional(v.id("providers")),
    providerName: v.optional(v.string()),
    category: v.string(),
    company: v.optional(v.string()),
    location: v.optional(
      v.union(
        v.literal("wellington"),
        v.literal("thermal"),
        v.literal("ocala"),
        v.literal("la"),
        v.literal("eu"),
        v.literal("can")
      )
    ),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAt: v.number()
  })
    .index("by_name", ["name"])
    .index("by_category", ["category"])
    .index("by_location", ["location"]),

  scheduleEvents: defineTable({
    type: v.string(),
    horseId: v.id("horses"),
    date: v.string(),
    providerId: v.optional(v.id("contacts")),
    providerName: v.optional(v.string()),
    note: v.optional(v.string()),
    createdAt: v.number()
  })
    .index("by_date", ["date"])
    .index("by_horse", ["horseId"])
    .index("by_type", ["type"]),

  people: defineTable({
    name: v.string(),
    role: v.union(v.literal("rider"), v.literal("groom"), v.literal("freelance"), v.literal("trainer")),
    isActive: v.boolean(),
    createdAt: v.number()
  })
    .index("by_role", ["role"])
    .index("by_active", ["isActive"]),

  horseAliases: defineTable({
    alias: v.string(),
    horseName: v.string(),
    horseId: v.id("horses"),
    createdAt: v.number(),
    updatedAt: v.optional(v.number())
  }).index("by_alias", ["alias"]),

  personAliases: defineTable({
    alias: v.string(),
    personName: v.string(),
    personId: v.id("people"),
    createdAt: v.number(),
    updatedAt: v.optional(v.number())
  }).index("by_alias", ["alias"]),

  customSubcategories: defineTable({
    categoryId: v.id("categories"),
    name: v.string(),
    slug: v.string(),
    color: v.optional(v.string()),
    createdAt: v.number()
  })
    .index("by_category", ["categoryId"])
    .index("by_category_slug", ["categoryId", "slug"]),

  feedPlans: defineTable({
    horseId: v.id("horses"),
    sections: v.object({
      hay: v.object({
        am: v.array(v.object({ product: v.string(), amount: v.number(), unit: v.string() })),
        lunch: v.array(v.object({ product: v.string(), amount: v.number(), unit: v.string() })),
        pm: v.array(v.object({ product: v.string(), amount: v.number(), unit: v.string() })),
        notes: v.optional(v.string()),
      }),
      grain: v.object({
        am: v.array(v.object({ product: v.string(), amount: v.number(), unit: v.string() })),
        lunch: v.array(v.object({ product: v.string(), amount: v.number(), unit: v.string() })),
        pm: v.array(v.object({ product: v.string(), amount: v.number(), unit: v.string() })),
        notes: v.optional(v.string()),
      }),
      supplements: v.object({
        am: v.array(v.object({ product: v.string(), amount: v.number(), unit: v.string() })),
        lunch: v.array(v.object({ product: v.string(), amount: v.number(), unit: v.string() })),
        pm: v.array(v.object({ product: v.string(), amount: v.number(), unit: v.string() })),
        notes: v.optional(v.string()),
      }),
      meds: v.object({
        am: v.array(v.object({ product: v.string(), amount: v.number(), unit: v.string() })),
        lunch: v.array(v.object({ product: v.string(), amount: v.number(), unit: v.string() })),
        pm: v.array(v.object({ product: v.string(), amount: v.number(), unit: v.string() })),
        notes: v.optional(v.string()),
      }),
    }),
    updatedAt: v.number(),
  }).index("by_horse", ["horseId"]),

  feedPlanHistory: defineTable({
    horseId: v.id("horses"),
    feedPlanId: v.id("feedPlans"),
    changeDescription: v.string(),
    previousSections: v.optional(v.any()),
    changedAt: v.number(),
  }).index("by_horse", ["horseId"]),
});
