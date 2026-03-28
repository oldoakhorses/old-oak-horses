"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import NavBar from "@/components/NavBar";
import styles from "./pending.module.css";

export default function PendingInvoicePage() {
  const params = useParams<{ storageId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const extractedProvider = searchParams.get("provider") || "Unknown";

  const categories = useQuery(api.categories.getAllCategories) ?? [];
  const [categoryId, setCategoryId] = useState<Id<"categories"> | "">("");
  const providers = useQuery(api.providers.getProvidersByCategory, categoryId ? { categoryId } : "skip") ?? [];
  const [providerId, setProviderId] = useState<Id<"providers"> | "">("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const parseUploadedInvoice = useAction((api as any).uploads.parseUploadedInvoice);

  const canSave = useMemo(() => Boolean(categoryId && providerId) && !saving, [categoryId, providerId, saving]);

  async function onSaveAndParse() {
    if (!categoryId || !providerId) return;
    setSaving(true);
    setError("");
    try {
      const result = await parseUploadedInvoice({
        fileStorageId: params.storageId as Id<"_storage">,
        categoryId,
        providerId
      });
      router.push(result.redirectPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save and re-parse");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "invoices", href: "/invoices" },
          { label: "pending", current: true }
        ]}
      />

      <main className="page-main">
        <div className={styles.providerBannerUnknown}>
          <div className={styles.bannerTitle}>⚠ provider not recognized</div>
          <div className={styles.bannerSub}>Extracted: "{extractedProvider}"</div>

          <div className={styles.fieldRow}>
            <label className={styles.label}>CATEGORY</label>
            <select className={styles.input} value={categoryId} onChange={(e) => setCategoryId(e.target.value as Id<"categories"> | "")}>
              <option value="">select category...</option>
              {categories.map((category) => (
                <option key={category._id} value={category._id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.fieldRow}>
            <label className={styles.label}>PROVIDER</label>
            <select
              className={styles.input}
              value={providerId}
              onChange={(e) => setProviderId(e.target.value as Id<"providers"> | "")}
              disabled={!categoryId}
            >
              <option value="">select provider...</option>
              {providers.map((provider) => (
                <option key={provider._id} value={provider._id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </div>

          {error ? <div className={styles.error}>{error}</div> : null}

          <div className={styles.actions}>
            <button className={styles.cancelBtn} type="button" onClick={() => router.push("/invoices")}>
              cancel
            </button>
            <button className={styles.saveBtn} type="button" disabled={!canSave} onClick={() => void onSaveAndParse()}>
              {saving ? "re-parsing..." : "save & re-parse"}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
