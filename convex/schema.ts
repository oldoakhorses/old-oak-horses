import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    passcodeHash: v.optional(v.string()),
    role: v.optional(v.union(v.literal("admin"), v.literal("owner"), v.literal("team"), v.literal("investor"))),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    profilePhotoId: v.optional(v.id("_storage")),
    ownerId: v.optional(v.id("owners")),
    // Deprecated: old auth fields kept for backwards compat
    image: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),

  sessions: defineTable({
    userId: v.id("users"),
    token: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_user", ["userId"]),

  categories: defineTable({
    name: v.string(),
    slug: v.string(),
    description: v.optional(v.string())
  })
    .index("by_name", ["name"])
    .index("by_slug", ["slug"]),

  bills: defineTable({
    contactId: v.optional(v.id("contacts")),
    categoryId: v.optional(v.id("categories")),
    /** Denormalized list of category slugs found across line items */
    lineItemCategories: v.optional(v.array(v.string())),
    fileId: v.optional(v.id("_storage")),
    fileName: v.string(),
    notes: v.optional(v.string()),
    assignType: v.optional(v.union(v.literal("horse"), v.literal("person"), v.literal("business"))),
    assignMode: v.optional(v.union(v.literal("line"), v.literal("whole"))),
    splitMode: v.optional(v.union(v.literal("even"), v.literal("custom"))),
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
    invoiceName: v.optional(v.string()),
    /** Free-form details/description shown under the invoice name on the
     *  preview screen and as small subtext on the invoices list. */
    invoiceDetails: v.optional(v.string()),
    originalPdfUrl: v.optional(v.string()),
    travelSubcategory: v.optional(v.string()),
    housingSubcategory: v.optional(v.string()),
    horseTransportSubcategory: v.optional(v.string()),
    marketingSubcategory: v.optional(v.string()),
    adminSubcategory: v.optional(v.string()),
    duesSubcategory: v.optional(v.string()),
    groomingSubcategory: v.optional(v.string()),
    originalCurrency: v.optional(v.string()),
    originalTotal: v.optional(v.number()),
    exchangeRate: v.optional(v.number()),
    discount: v.optional(v.number()),
    isApproved: v.optional(v.boolean()),
    approvedAt: v.optional(v.number()),
    isSplit: v.optional(v.boolean()),
    assignedPeople: v.optional(
      v.array(
        v.object({
          personId: v.id("people"),
          // Denormalized name so we can render the bill without an
          // extra join. Optional to keep existing rows valid; new rows
          // (e.g. from createBillFromTransaction in ccReconcile) write it.
          personName: v.optional(v.string()),
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
          amount: v.number(),
          direct: v.optional(v.number()),
          shared: v.optional(v.number())
        })
      )
    ),
    /** Whole-invoice horse-group reference. Set when the user picked a
     *  group on the whole invoice (the assignedHorses entries above are
     *  the snapshot of that group's horses at save time). */
    assignedViaGroupId: v.optional(v.id("horseGroups")),
    assignedViaGroupName: v.optional(v.string()),
    /**
     * Whole-invoice business assignments — analogous to assignedHorses/
     * assignedPeople. Each entry pins a slice of the invoice total to a
     * specific owner (= business entity). Used for admin/overhead spend
     * that should land on a particular LLC's books rather than be marked
     * "business general".
     */
    assignedBusinesses: v.optional(
      v.array(
        v.object({
          ownerId: v.id("owners"),
          ownerName: v.string(),
          amount: v.number(),
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
          /** Which kind of split this was:
           *    "all"     — split evenly across every active horse in the
           *                system (or every direct-assigned horse on this
           *                bill, whichever the save flow resolved).
           *    "invoice" — split evenly across only horses that were
           *                directly assigned somewhere else on this bill.
           *  Optional for backwards-compat with existing rows: missing
           *  splitType resolves to "invoice" on load (the more common case),
           *  with fallback to "all" if the split's horse set is broader
           *  than the bill's direct-assigned horse set. */
          splitType: v.optional(v.union(v.literal("all"), v.literal("invoice"))),
          /** Source group reference. When the split was triggered by a
           *  horse-group pick, we stamp the groupId here so the picker can
           *  re-show the group tag on the next load. Snapshot of the
           *  group's name is kept too so the UI can still render a useful
           *  tag if the group has since been deleted. */
          viaGroupId: v.optional(v.id("horseGroups")),
          viaGroupName: v.optional(v.string()),
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
          role: v.optional(v.union(v.literal("rider"), v.literal("groom"), v.literal("freelance"), v.literal("trainer"), v.literal("admin")))
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
              role: v.union(v.literal("rider"), v.literal("groom"), v.literal("freelance"), v.literal("trainer"), v.literal("admin")),
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
    /**
     * Whole-invoice reimbursement marker. Pure label — does NOT drive
     * any cost-per breakdown or change the assignment math. Two pickers:
     * `personId` is who fronted the cost out-of-pocket; `ownerId` is the
     * business that's reimbursing them.
     *
     * `resolvedAt` is the timestamp the user manually marked it paid;
     * absent means still outstanding. `resolvedBy` records the email of
     * the user who marked it paid for audit purposes.
     */
    reimbursement: v.optional(
      v.object({
        ownerId: v.id("owners"),
        ownerName: v.string(),
        // Canonical payer fields — who fronted the cost. The payer can
        // be either a person OR a business (e.g. one LLC reimbursing
        // another). Discriminated by `payerType`; `payerId` holds the
        // raw id string so it can point at either table.
        payerType: v.optional(v.union(v.literal("person"), v.literal("business"))),
        payerId: v.optional(v.string()),
        payerName: v.optional(v.string()),
        // Legacy fields from the initial single-person implementation.
        // Kept optional for backwards compat; new writes use the payer*
        // fields above. Read code prefers payerType if present.
        personId: v.optional(v.id("people")),
        personName: v.optional(v.string()),
        // Optional subset of the invoice's tagged horses that this
        // reimbursement actually covers. When omitted (or empty), the
        // reimbursement applies to every horse tagged on the invoice —
        // the common case. Use this when only a subset of the horses
        // were paid out-of-pocket while the rest were paid directly.
        horseIds: v.optional(v.array(v.id("horses"))),
        resolvedAt: v.optional(v.number()),
        resolvedBy: v.optional(v.string()),
      })
    ),
    /**
     * Per-line-item reimbursement markers — same shape as `reimbursement`
     * but scoped to specific line items. Lets a single invoice mix
     * normal-expense lines with reimbursement lines (and even reimburse
     * different payers on different lines).
     */
    reimbursementLineItems: v.optional(
      v.array(
        v.object({
          lineItemIndex: v.number(),
          ownerId: v.id("owners"),
          ownerName: v.string(),
          payerType: v.optional(v.union(v.literal("person"), v.literal("business"))),
          payerId: v.optional(v.string()),
          payerName: v.optional(v.string()),
          personId: v.optional(v.id("people")),
          personName: v.optional(v.string()),
          /** Optional subset of the line's tagged horses that this
           *  reimbursement covers. Empty/omitted = applies to every
           *  horse tagged on the line. */
          horseIds: v.optional(v.array(v.id("horses"))),
          resolvedAt: v.optional(v.number()),
          resolvedBy: v.optional(v.string()),
        })
      )
    ),
    linkedFromBillId: v.optional(v.id("bills"))
    ,
    hasUnmatchedHorses: v.optional(v.boolean()),
    unmatchedHorseNames: v.optional(v.array(v.string())),
    extractedVendorContact: v.optional(
      v.object({
        vendorName: v.optional(v.string()),
        contactName: v.optional(v.string()),
        address: v.optional(v.string()),
        phone: v.optional(v.string()),
        email: v.optional(v.string()),
        website: v.optional(v.string()),
        accountNumber: v.optional(v.string())
      })
    ),
    // Deprecated: kept for backwards compatibility with existing data until migration runs
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
    ),
    dropboxPath: v.optional(v.string()),
    /** CC transaction that generated this bill (for non-invoice charges) */
    ccTransactionId: v.optional(v.id("ccTransactions")),
    /** How this bill was created */
    source: v.optional(v.union(v.literal("upload"), v.literal("cc_transaction"), v.literal("email"))),
    createdBy: v.optional(v.string()),
  })
    .index("by_uploadedAt", ["uploadedAt"])
    .index("by_contact", ["contactId"])
    .index("by_category", ["categoryId"])
    .index("by_ccTransaction", ["ccTransactionId"]),

  /**
   * Learned overrides for parsed bills, keyed by normalized vendor name
   * (e.g. parser extracted "Deel Inc." → key "deel"). When a user approves
   * a bill, we upsert a row here capturing whatever they overrode
   * (invoiceName, contactId, categoryId, assignment shape). The next time
   * a bill is parsed from the same vendor, applyBillRule pre-populates
   * those same fields onto the new bill — but only if the field is still
   * empty, so a user's manual edits are never overwritten.
   */
  billRules: defineTable({
    /** Normalized lookup key — lowercased, business suffixes stripped. */
    vendorKey: v.string(),
    /** Last-seen display version of the vendor name, for debugging/UI. */
    vendorDisplay: v.optional(v.string()),
    invoiceName: v.optional(v.string()),
    contactId: v.optional(v.id("contacts")),
    contactName: v.optional(v.string()),
    categoryId: v.optional(v.id("categories")),
    categorySlug: v.optional(v.string()),
    assignType: v.optional(v.union(v.literal("horse"), v.literal("person"))),
    assignedHorses: v.optional(
      v.array(
        v.object({
          horseId: v.id("horses"),
          horseName: v.string(),
          amount: v.number()
        })
      )
    ),
    assignedPeople: v.optional(
      v.array(
        v.object({
          personId: v.id("people"),
          personName: v.optional(v.string()),
          amount: v.number()
        })
      )
    ),
    /** Reinforcement counter — bumped on every approval. */
    count: v.number(),
    lastSeen: v.number(),
    createdAt: v.number()
  }).index("by_vendorKey", ["vendorKey"]),

  /**
   * Multi-org partitioning. Every horse belongs to exactly one org; each
   * user can be a member of many. Activated by an "active org" stored in
   * the user's session — when set, all horse/bill/record/med/document
   * queries filter to that org. Owner/admin roles see all orgs.
   */
  organizations: defineTable({
    name: v.string(),
    slug: v.string(),
    isActive: v.optional(v.boolean()),
    createdAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_name", ["name"]),

  /** Join table: which users can see which orgs. */
  userOrganizations: defineTable({
    userId: v.id("users"),
    organizationId: v.id("organizations"),
    /** Per-org role (optional) — falls back to the user's global role. */
    role: v.optional(v.union(v.literal("admin"), v.literal("member"))),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_org", ["organizationId"])
    .index("by_user_org", ["userId", "organizationId"]),

  horses: defineTable({
    /** Owning organization. Optional until backfill completes. */
    organizationId: v.optional(v.id("organizations")),
    name: v.string(),
    barnName: v.optional(v.string()),
    yearOfBirth: v.optional(v.number()),
    sex: v.optional(v.union(v.literal("gelding"), v.literal("mare"), v.literal("stallion"))),
    usefNumber: v.optional(v.string()),
    feiNumber: v.optional(v.string()),
    microchip: v.optional(v.string()),
    owner: v.optional(v.string()),
    prizeMoney: v.optional(v.number()),
    ownerId: v.optional(v.id("owners")),
    status: v.union(v.literal("active"), v.literal("inactive"), v.literal("past")),
    isSold: v.optional(v.boolean()),
    soldDate: v.optional(v.number()),
    /** Timestamp when horse became inactive/past. Used to determine if
     *  a horse was active at the time a bill was uploaded. */
    inactiveSince: v.optional(v.number()),
    transferredAt: v.optional(v.number()),
    createdAt: v.number()
  })
    .index("by_name", ["name"])
    .index("by_status", ["status"])
    .index("by_status_name", ["status", "name"])
    .index("by_organization", ["organizationId"]),

  /**
   * Named groups of horses used as a shortcut when assigning invoices /
   * line items. Picking a group on an invoice expands to "split evenly
   * across every horse in the group" — saves the user from multi-
   * selecting the same six horses on every farrier bill, for example.
   * Groups are scoped per owner (and optionally per organization).
   */
  horseGroups: defineTable({
    ownerId: v.optional(v.id("owners")),
    organizationId: v.optional(v.id("organizations")),
    name: v.string(),
    horseIds: v.array(v.id("horses")),
    isActive: v.optional(v.boolean()),
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_organization", ["organizationId"]),

  contacts: defineTable({
    name: v.string(),
    slug: v.optional(v.string()),
    companyName: v.optional(v.string()),
    category: v.optional(v.string()),
    /**
     * Optional per-contact custom extraction prompt for the bill parser.
     * When set, it's appended to the base category prompt so tricky invoice
     * layouts (e.g. multi-patient veterinary invoices) parse correctly.
     */
    extractionPrompt: v.optional(v.string()),
    /**
     * Expected fields on the parsed JSON, used only for validation / warning
     * logs. Empty array means "no per-contact expectations".
     */
    expectedFields: v.optional(v.array(v.string())),
    address: v.optional(v.string()),
    location: v.optional(
      v.union(
        v.literal("wellington"),
        v.literal("thermal"),
        v.literal("ocala"),
        v.literal("la"),
        v.literal("eu"),
        v.literal("can"),
        v.literal("ca"),
        v.literal("us"),
        v.literal("ky")
      )
    ),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    website: v.optional(v.string()),
    accountNumber: v.optional(v.string()),
    notes: v.optional(v.string()),
    /** "active" (default) or "invoice_only" — controls which tab the contact appears in */
    contactStatus: v.optional(v.union(v.literal("active"), v.literal("invoice_only"))),
    createdAt: v.number(),
    updatedAt: v.optional(v.number())
  })
    .index("by_name", ["name"])
    .index("by_slug", ["slug"])
    .index("by_category", ["category"])
    .index("by_location", ["location"]),

  scheduleEvents: defineTable({
    type: v.string(),
    horseId: v.id("horses"),
    date: v.string(),
    contactId: v.optional(v.id("contacts")),
    contactName: v.optional(v.string()),
    // Deprecated: kept for backwards compat until migration runs
    providerId: v.optional(v.id("contacts")),
    providerName: v.optional(v.string()),
    note: v.optional(v.string()),
    createdAt: v.number()
  })
    .index("by_date", ["date"])
    .index("by_horse", ["horseId"])
    .index("by_type", ["type"]),

  horseRecords: defineTable({
    horseId: v.id("horses"),
    title: v.optional(v.string()),
    createdBy: v.optional(v.string()),
    type: v.union(
      v.literal("veterinary"),
      v.literal("medication"),
      v.literal("farrier"),
      v.literal("bodywork"),
      v.literal("other")
    ),
    customType: v.optional(v.string()),
    date: v.number(),
    nextVisitDate: v.optional(v.number()),
    contactName: v.optional(v.string()),
    contactId: v.optional(v.id("contacts")),
    // Deprecated: kept for backwards compat until migration runs
    providerName: v.optional(v.string()),
    visitType: v.optional(v.union(
      v.literal("vaccination"),
      v.literal("treatment"),
      v.literal("medication"),
      v.literal("joint_injections"),
      v.literal("exams_diagnostics"),
      v.literal("vaccinations"),
      v.literal("shockwave"),
      v.literal("sedation"),
      v.literal("fees"),
      v.literal("lab_work"),
      v.literal("blood_test"),
      v.literal("exam"),
      v.literal("imaging"),
      v.literal("other")
    )),
    visitTypes: v.optional(v.array(v.string())),
    vetOtherDescription: v.optional(v.string()),
    vaccineName: v.optional(v.string()),
    treatmentDescription: v.optional(v.string()),
    serviceType: v.optional(v.string()),
    medications: v.optional(v.array(v.string())),
    medicationRepeatValue: v.optional(v.number()),
    medicationRepeatUnit: v.optional(v.union(v.literal("days"), v.literal("weeks"), v.literal("months"))),
    isUpcoming: v.optional(v.boolean()),
    linkedRecordId: v.optional(v.id("horseRecords")),
    notes: v.optional(v.string()),
    /** Legacy single-attachment fields. Preserved for read-back; new
     *  writes should populate `attachments` instead. */
    attachmentStorageId: v.optional(v.string()),
    attachmentName: v.optional(v.string()),
    /** Multi-attachment list. Each entry pairs a storage id with the
     *  original file name (and optionally a mime type for icon picking).
     *  Empty/undefined means no attachments. */
    attachments: v.optional(
      v.array(
        v.object({
          storageId: v.string(),
          name: v.string(),
          mimeType: v.optional(v.string()),
        })
      )
    ),
    billId: v.optional(v.id("bills")),
    dropboxPath: v.optional(v.string())
  })
    .index("by_horse", ["horseId"])
    .index("by_type", ["type"])
    .index("by_horse_and_type", ["horseId", "type"])
    .index("by_bill", ["billId"]),

  documents: defineTable({
    name: v.string(),
    tag: v.union(
      v.literal("coggins"),
      v.literal("health_certificate"),
      v.literal("horse_agreement"),
      v.literal("insurance"),
      v.literal("registration"),
      v.literal("contract"),
      v.literal("id"),
      v.literal("tax"),
      v.literal("other")
    ),
    horseId: v.optional(v.id("horses")),
    personId: v.optional(v.id("people")),
    fileStorageId: v.id("_storage"),
    fileName: v.string(),
    fileType: v.optional(v.string()),
    fileSize: v.optional(v.number()),
    uploadedAt: v.number(),
    documentDate: v.optional(v.number()),
    notes: v.optional(v.string())
  })
    .index("by_horse", ["horseId"])
    .index("by_person", ["personId"])
    .index("by_tag", ["tag"]),

  people: defineTable({
    name: v.string(),
    role: v.union(v.literal("rider"), v.literal("groom"), v.literal("freelance"), v.literal("trainer"), v.literal("admin")),
    isActive: v.boolean(),
    createdAt: v.number()
  })
    .index("by_role", ["role"])
    .index("by_active", ["isActive"]),

  /**
   * Many-to-many join: a horse can be co-owned by multiple owners, an
   * owner can own multiple horses. sharePct is 0-100; if absent, expenses
   * are split equally among all current co-owners of the horse.
   * The legacy horses.ownerId field is kept as a denormalized "primary
   * owner" pointer but horseOwnerships is the source of truth.
   */
  horseOwnerships: defineTable({
    horseId: v.id("horses"),
    ownerId: v.id("owners"),
    sharePct: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_horse", ["horseId"])
    .index("by_owner", ["ownerId"])
    .index("by_horse_owner", ["horseId", "ownerId"]),

  /**
   * Per-horse access grants for team-role users. Admins and owner-role
   * users see all horses by default; team users see only horses they
   * appear in this table for.
   */
  horseAccess: defineTable({
    horseId: v.id("horses"),
    userId: v.id("users"),
    grantedBy: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_horse", ["horseId"])
    .index("by_user", ["userId"])
    .index("by_horse_user", ["horseId", "userId"]),

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

  contactAliases: defineTable({
    alias: v.string(),
    contactName: v.string(),
    contactId: v.id("contacts"),
    createdAt: v.number(),
    updatedAt: v.optional(v.number())
  }).index("by_alias", ["alias"]),

  vetSubcategories: defineTable({
    slug: v.string(),
    label: v.string(),
    color: v.optional(v.string()),
    isDefault: v.boolean()
  }).index("by_slug", ["slug"]),

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

  owners: defineTable({
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(v.string()),
    notes: v.optional(v.string()),
    usefNumber: v.optional(v.string()),
    feiNumber: v.optional(v.string()),
    contactPerson: v.optional(v.string()),
    ein: v.optional(v.string()),
    vat: v.optional(v.string()),
    isActive: v.boolean(),
    createdAt: v.number(),
  }).index("by_name", ["name"]),

  ownerInvoices: defineTable({
    ownerId: v.id("owners"),
    title: v.optional(v.string()),
    billingPeriod: v.string(), // "2026-03"
    status: v.union(v.literal("draft"), v.literal("finalized"), v.literal("sent"), v.literal("paid")),
    totalAmount: v.number(),
    approvedAmount: v.number(),
    lineItemCount: v.number(),
    approvedLineItemCount: v.number(),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    finalizedAt: v.optional(v.number()),
  })
    .index("by_owner", ["ownerId"])
    .index("by_period", ["billingPeriod"])
    .index("by_owner_period", ["ownerId", "billingPeriod"]),

  ownerInvoiceLineItems: defineTable({
    ownerInvoiceId: v.id("ownerInvoices"),
    sourceBillId: v.id("bills"),
    horseId: v.optional(v.id("horses")),
    horseName: v.optional(v.string()),
    description: v.string(),
    category: v.optional(v.string()),
    subcategory: v.optional(v.string()),
    amount: v.number(),
    sourceLineItemIndex: v.optional(v.number()),
    isApproved: v.boolean(),
    approvedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_owner_invoice", ["ownerInvoiceId"])
    .index("by_source_bill", ["sourceBillId"]),

  ccStatements: defineTable({
    fileName: v.string(),
    /** Optional user-edited display name; falls back to fileName when absent. */
    displayName: v.optional(v.string()),
    accountLast4: v.optional(v.string()),
    uploadedAt: v.number(),
    transactionCount: v.number(),
    matchedCount: v.number(),
    unmatchedCount: v.number(),
    totalDebits: v.number(),
    totalCredits: v.number(),
    status: v.union(
      v.literal("uploaded"),
      v.literal("matching"),
      v.literal("review"),
      v.literal("approved"),
    ),
  }),

  ccTransactions: defineTable({
    statementId: v.id("ccStatements"),
    postingDate: v.string(),
    description: v.string(),
    amount: v.number(),
    type: v.string(),
    balance: v.optional(v.number()),

    // Matching
    matchedBillId: v.optional(v.id("bills")),
    matchedBillName: v.optional(v.string()),
    matchConfidence: v.optional(v.union(v.literal("exact"), v.literal("high"), v.literal("medium"), v.literal("low"), v.literal("none"))),

    // Assignment (step 2)
    assignType: v.optional(v.union(v.literal("horse"), v.literal("person"), v.literal("business"), v.literal("personal"), v.literal("ignore"))),
    assignedHorses: v.optional(v.array(v.object({
      horseId: v.id("horses"),
      horseName: v.string(),
      amount: v.number(),
    }))),
    assignedPeople: v.optional(v.array(v.object({
      personId: v.id("people"),
      personName: v.string(),
      role: v.optional(v.string()),
      amount: v.number(),
    }))),
    category: v.optional(v.string()),
    subcategory: v.optional(v.string()),

    // Approval
    isApproved: v.boolean(),
    approvedAt: v.optional(v.number()),
    /** Bill auto-created when this txn was approved without a matched invoice */
    generatedBillId: v.optional(v.id("bills")),
  })
    .index("by_statement", ["statementId"])
    .index("by_matched_bill", ["matchedBillId"]),

  /**
   * Records the (bill, transaction) pairs the user explicitly dismissed
   * from the "looks like an existing CC charge" suggestion banner.
   * findMatchingTransactionsForBill filters dismissed pairs out so they
   * don't keep reappearing. Idempotent — duplicate inserts are guarded
   * by the by_bill_txn index lookup before write.
   */
  dismissedCcMatches: defineTable({
    billId: v.id("bills"),
    transactionId: v.id("ccTransactions"),
    dismissedAt: v.number(),
  })
    .index("by_bill", ["billId"])
    .index("by_bill_txn", ["billId", "transactionId"]),

  ccTransactionRules: defineTable({
    /** Normalized keywords extracted from the transaction description */
    descriptionKeywords: v.array(v.string()),
    /** Original description that created the rule (for display) */
    originalDescription: v.string(),
    /** Assignment details to auto-suggest */
    assignType: v.union(v.literal("horse"), v.literal("person"), v.literal("business"), v.literal("personal"), v.literal("ignore")),
    assignedHorses: v.optional(v.array(v.object({
      horseId: v.id("horses"),
      horseName: v.string(),
    }))),
    assignedPeople: v.optional(v.array(v.object({
      personId: v.id("people"),
      personName: v.string(),
      role: v.optional(v.string()),
    }))),
    category: v.optional(v.string()),
    subcategory: v.optional(v.string()),
    /** How many times this rule has been applied */
    timesApplied: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }),

  feedPlanHistory: defineTable({
    horseId: v.id("horses"),
    feedPlanId: v.id("feedPlans"),
    changeDescription: v.string(),
    previousSections: v.optional(v.any()),
    changedAt: v.number(),
  }).index("by_horse", ["horseId"]),

  incomeEntries: defineTable({
    horseId: v.id("horses"),
    billId: v.optional(v.id("bills")),
    type: v.union(v.literal("prize_money"), v.literal("other")),
    amount: v.number(),
    description: v.string(),
    className: v.optional(v.string()),
    placing: v.optional(v.string()),
    showName: v.optional(v.string()),
    date: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_horse", ["horseId"])
    .index("by_bill", ["billId"]),

  calendarEvents: defineTable({
    title: v.string(),
    date: v.string(),
    time: v.optional(v.string()),
    allDay: v.optional(v.boolean()),
    createdBy: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_date", ["date"]),

  todos: defineTable({
    text: v.string(),
    completed: v.boolean(),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
    sortOrder: v.number(),
  })
    .index("by_sort", ["sortOrder"]),
});
