"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

export default function UploadPage() {
  const categories: any[] = useQuery(api.categories.getAllCategories) ?? [];
  const generateUploadUrl = useMutation(api.bills.generateUploadUrl);
  const createBillRecord = useMutation(api.bills.createBillRecord);
  const triggerBillParsing = useMutation(api.bills.triggerBillParsing);

  const [categoryId, setCategoryId] = useState<string>("");
  const [providerId, setProviderId] = useState<string>("");
  const [billingPeriod, setBillingPeriod] = useState<string>(new Date().toISOString().slice(0, 7));
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string>("Idle");

  const providers: any[] =
    useQuery(
      api.providers.getProvidersByCategory,
      categoryId ? { categoryId: categoryId as never } : "skip"
    ) ?? [];

  useEffect(() => {
    if (!categoryId) {
      setProviderId("");
      return;
    }
    if (providerId && !providers.some((provider: any) => provider._id === providerId)) {
      setProviderId("");
    }
  }, [categoryId, providerId, providers]);

  const canSubmit = useMemo(
    () => !!file && !!categoryId && !!providerId && !!billingPeriod,
    [file, categoryId, providerId, billingPeriod]
  );

  const onSubmit = async () => {
    if (!canSubmit || !file) return;

    setStatus("Uploading PDF to Convex storage...");
    const uploadUrl = await generateUploadUrl();
    const uploadResult = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: file
    });

    if (!uploadResult.ok) {
      setStatus("Upload failed.");
      return;
    }

    const { storageId } = (await uploadResult.json()) as { storageId: string };
    setStatus("Creating bill record...");

    const categoryName = categories.find((category: any) => category._id === categoryId)?.name;
    const providerName = providers.find((provider: any) => provider._id === providerId)?.name;
    if (!categoryName || !providerName) {
      setStatus("Category/provider lookup failed.");
      return;
    }

    const fileName = formatBillFileName(categoryName, providerName, new Date());
    const billId = await createBillRecord({
      categoryId: categoryId as never,
      providerId: providerId as never,
      fileId: storageId as never,
      fileName,
      billingPeriod
    });

    setStatus("Bill created. Sending to Claude parser...");
    await triggerBillParsing({ billId });
    setStatus("Parse job queued. Status updates live on Dashboard.");
    setFile(null);
  };

  return (
    <section className="panel">
      <h1>Upload Bill PDF</h1>
      <p>
        <small>Select Category, then Provider, then upload a bill PDF.</small>
      </p>
      <div className="grid">
        <div>
          <label htmlFor="category">Category</label>
          <select id="category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Select a category</option>
            {categories.map((category: any) => (
              <option key={category._id} value={category._id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="provider">Provider</label>
          <select
            id="provider"
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
            disabled={!categoryId}
          >
            <option value="">Select a provider</option>
            {providers.map((provider: any) => (
              <option key={provider._id} value={provider._id}>
                {provider.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="period">Billing Period (YYYY-MM)</label>
          <input id="period" value={billingPeriod} onChange={(e) => setBillingPeriod(e.target.value)} placeholder="2026-02" />
        </div>
        <div>
          <label htmlFor="pdf">PDF File</label>
          <input id="pdf" type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
      </div>
      <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12 }}>
        <button type="button" onClick={onSubmit} disabled={!canSubmit}>
          Upload Bill
        </button>
        <small>{status}</small>
      </div>
    </section>
  );
}

function formatBillFileName(categoryName: string, providerName: string, uploadedAt: Date, batchIndex?: number) {
  const isoDate = uploadedAt.toISOString().slice(0, 10);
  const base = `${categoryName} - ${providerName} - ${isoDate}`;
  if (typeof batchIndex === "number") {
    return `${base}-${String(batchIndex).padStart(2, "0")}`;
  }
  return base;
}
