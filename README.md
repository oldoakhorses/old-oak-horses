# HorseBilz (Next.js + Convex + Clerk + Claude)

Scaffolded app with:

- Next.js App Router frontend
- Convex backend (schema + queries/mutations/actions)
- Clerk authentication integrated with Convex
- PDF storage in Convex Storage
- Claude parsing flow in a Convex action
- Live dashboard bill status updates via `useQuery`

## Schema

- `providers`:
  - `name: string`
  - `extractionPrompt: string`
- `bills`:
  - `providerId: Id<"providers">`
  - `fileId: Id<"_storage">`
  - `status: "uploading" | "parsing" | "done" | "error"`
  - `billingPeriod: string`
  - `uploadedAt: number`
  - `extractedData?: { ... }`
- `lineItems`:
  - `billId: Id<"bills">`
  - `label: string`
  - `amount: number`
  - `category?: string`

## Parsing flow

1. User uploads PDF from `/upload`.
2. Client requests upload URL from `bills.generateUploadUrl`.
3. PDF uploads to Convex storage (`storageId`).
4. Client calls `bills.createAndParseBill` with `providerId`, `fileId`, and `billingPeriod`.
5. Mutation inserts bill (`status: "parsing"`) and schedules `bills.parseBillPdf` action.
6. Action reads PDF from storage and calls Claude model `claude-sonnet-4-6`.
7. Action stores parsed JSON in `bills.extractedData`, inserts `lineItems`, sets `status: "done"`.
8. Dashboard subscribes to `bills.listAll` and updates live.

## Setup

1. Install deps:

```bash
npm install
```

2. Create local env file:

```bash
cp .env.example .env.local
```

3. Fill required env vars in `.env.local`:

- `NEXT_PUBLIC_CONVEX_URL`
- `CONVEX_DEPLOYMENT`
- `ANTHROPIC_API_KEY`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `CLERK_JWT_ISSUER_DOMAIN`

4. Start Convex backend/codegen:

```bash
npx convex dev
```

5. Start Next app:

```bash
npm run dev
```
