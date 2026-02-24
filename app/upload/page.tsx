"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import styles from "./upload.module.css";

type UploadState = "idle" | "uploading" | "done";
type FileStage = "queued" | "uploading" | "parsing" | "done" | "error";

type LocalUploadFile = {
  id: string;
  file: File;
};

type TrackedStatus = {
  stage: FileStage;
  billId?: Id<"bills">;
  error?: string;
};

type BillStatusRowProps = {
  fileName: string;
  fileId: string;
  status: TrackedStatus;
  onRetry: (fileId: string) => void;
  onStageChange: (fileId: string, stage: FileStage, error?: string) => void;
};

const CATEGORY_DISPLAY_ORDER = [
  "Veterinary",
  "Feed & Bedding",
  "Stabling",
  "Farrier",
  "Therapeutic Care",
  "Travel",
  "Salaries",
  "Housing",
  "Riding & Training",
  "Commissions",
  "Horse Purchases",
  "Supplies",
  "Marketing",
  "Dues & Registrations",
  "Admin",
  "Horse Transport",
  "Show Expenses"
] as const;

export default function UploadPage() {
  const router = useRouter();
  const categoriesQuery = useQuery(api.categories.getAllCategories);
  const categoriesLoading = categoriesQuery === undefined;
  const categories = categoriesQuery ?? [];
  const [selectedCategory, setSelectedCategory] = useState<Id<"categories"> | "">("");
  const [selectedProvider, setSelectedProvider] = useState<Id<"providers"> | "">("");
  const [files, setFiles] = useState<LocalUploadFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<UploadState>("idle");
  const [fileStatuses, setFileStatuses] = useState<Record<string, TrackedStatus>>({});
  const [uploadError, setUploadError] = useState("");

  const inputRef = useRef<HTMLInputElement>(null);
  const uploadAndParseBill = useAction((api as any).uploads.uploadAndParseBill);
  const seedCategories = useMutation(api.seed.seedCategories);

  const providersQuery = useQuery(api.providers.getProvidersByCategory, selectedCategory ? { categoryId: selectedCategory } : "skip");
  const providersLoading = Boolean(selectedCategory) && providersQuery === undefined;
  const providers = providersQuery ?? [];

  const orderedCategories = useMemo(() => {
    if (categories.length === 0) return categories;
    const rank = new Map<string, number>(CATEGORY_DISPLAY_ORDER.map((name, idx) => [name, idx]));
    return [...categories].sort((a, b) => {
      const aRank = rank.get(a.name);
      const bRank = rank.get(b.name);
      if (aRank !== undefined && bRank !== undefined) return aRank - bRank;
      if (aRank !== undefined) return -1;
      if (bRank !== undefined) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [categories]);

  const selectedCategoryDoc = categories.find((category) => category._id === selectedCategory);
  const selectedProviderDoc = providers.find((provider) => provider._id === selectedProvider);

  const providerPlaceholder = providersLoading
    ? "Loading providers..."
    : !selectedCategory
    ? "Select a category first"
    : providers.length === 0
    ? "No providers for this category"
    : "Select a provider";

  const canUpload = Boolean(selectedCategory && selectedProvider && files.length > 0 && uploadStatus !== "uploading");

  const providerHref = useMemo(() => {
    if (!selectedCategoryDoc || !selectedProviderDoc) return "/dashboard";
    return `/${selectedCategoryDoc.slug}/${slugify(selectedProviderDoc.name)}`;
  }, [selectedCategoryDoc, selectedProviderDoc]);

  const allComplete = useMemo(() => {
    if (files.length === 0) return false;
    return files.every((localFile) => {
      const status = fileStatuses[localFile.id];
      return status?.stage === "done" || status?.stage === "error";
    });
  }, [fileStatuses, files]);

  const hasErrors = useMemo(() => {
    return files.some((localFile) => fileStatuses[localFile.id]?.stage === "error");
  }, [fileStatuses, files]);

  const handleStageChange = useCallback((fileId: string, stage: FileStage, error?: string) => {
    setFileStatuses((prev) => {
      const existing = prev[fileId];
      if (existing?.stage === stage && existing?.error === error) {
        return prev;
      }
      return {
        ...prev,
        [fileId]: {
          ...existing,
          stage,
          error
        }
      };
    });
  }, []);

  useEffect(() => {
    if (allComplete) {
      setUploadStatus("done");
    }
  }, [allComplete]);

  useEffect(() => {
    if (categoriesLoading) return;
    if (categories.length > 0) return;
    void seedCategories().catch(() => {
      // No-op here; the page will remain usable and user can retry later.
    });
  }, [categories.length, categoriesLoading, seedCategories]);

  useEffect(() => {
    if (!allComplete || hasErrors || files.length !== 1) return;
    const onlyFile = files[0];
    const status = fileStatuses[onlyFile.id];
    if (!status?.billId || !selectedCategoryDoc || !selectedProviderDoc) return;
    router.push(`/${selectedCategoryDoc.slug}/${slugify(selectedProviderDoc.name)}/${status.billId}`);
  }, [allComplete, files, fileStatuses, hasErrors, router, selectedCategoryDoc, selectedProviderDoc]);

  function onCategoryChange(value: string) {
    setSelectedCategory((value || "") as Id<"categories"> | "");
    setSelectedProvider("");
  }

  function onProviderChange(value: string) {
    setSelectedProvider((value || "") as Id<"providers"> | "");
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    const dropped = Array.from(event.dataTransfer.files).filter(isPdfFile);
    pushFiles(dropped);
  }

  function handleFileSelect(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files || []).filter(isPdfFile);
    pushFiles(selected);
    event.target.value = "";
  }

  function pushFiles(newFiles: File[]) {
    if (newFiles.length === 0) return;
    setFiles((prev) => [
      ...prev,
      ...newFiles.map((file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
        file
      }))
    ]);
  }

  function removeFile(fileId: string) {
    setFiles((prev) => prev.filter((file) => file.id !== fileId));
    setFileStatuses((prev) => {
      const next = { ...prev };
      delete next[fileId];
      return next;
    });
  }

  async function runUploadForFile(fileId: string) {
    if (!selectedCategory || !selectedProvider) return;

    const fileRecord = files.find((file) => file.id === fileId);
    if (!fileRecord) return;

    setFileStatuses((prev) => ({ ...prev, [fileId]: { stage: "uploading" } }));
    try {
      const base64Pdf = await fileToBase64(fileRecord.file);
      const result = await uploadAndParseBill({
        categoryId: selectedCategory,
        providerId: selectedProvider,
        base64Pdf
      });

      setFileStatuses((prev) => ({
        ...prev,
        [fileId]: { stage: "parsing", billId: result.billId }
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed";
      setFileStatuses((prev) => ({ ...prev, [fileId]: { stage: "error", error: message } }));
    }
  }

  async function onUploadClick() {
    if (!canUpload) return;
    setUploadError("");
    setUploadStatus("uploading");

    for (const localFile of files) {
      const current = fileStatuses[localFile.id];
      if (current?.stage === "done" || current?.stage === "parsing" || current?.stage === "uploading") continue;
      await runUploadForFile(localFile.id);
    }
  }

  return (
    <div className={styles.page}>
      <nav className={styles.nav}>
        <div className={styles.crumbs}>
          <Link href="/dashboard" className={styles.brand}>
            Old Oak Horses
          </Link>
          <span className={styles.divider}>/</span>
          <Link href="/dashboard" className={styles.crumbLink}>
            Dashboard
          </Link>
          <span className={styles.divider}>/</span>
          <span className={styles.current}>Upload</span>
        </div>
      </nav>

      <main className={styles.main}>
        <header className={styles.header}>
          <h1 className={styles.title}>Upload Invoice</h1>
          <p className={styles.subtitle}>Select a category and provider, then upload your PDF</p>
        </header>

        <section className={styles.card}>
          <label className={styles.field}>
            <span className={styles.label}>Category *</span>
            <span className={styles.selectWrap}>
              <select value={selectedCategory} onChange={(event) => onCategoryChange(event.target.value)} className={styles.select}>
                <option value="">{categoriesLoading ? "Loading categories..." : "Select a category"}</option>
                {orderedCategories.map((category) => (
                  <option key={category._id} value={category._id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </span>
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Provider *</span>
            <span className={styles.selectWrap}>
              <select
                value={selectedProvider}
                onChange={(event) => onProviderChange(event.target.value)}
                className={styles.select}
                disabled={!selectedCategory || providers.length === 0 || providersLoading}
              >
                <option value="">{providerPlaceholder}</option>
                {providers.map((provider) => (
                  <option key={provider._id} value={provider._id}>
                    {provider.name}
                  </option>
                ))}
              </select>
            </span>
          </label>

          <div className={styles.dividerFull} />

          <div
            className={isDragging ? styles.dropZoneActive : styles.dropZone}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
          >
            <input ref={inputRef} type="file" accept=".pdf,application/pdf" multiple hidden onChange={handleFileSelect} />
            <div className={styles.dropIcon}>↑</div>
            <p className={styles.dropTitle}>Drop PDF files here or click to browse</p>
            <p className={styles.dropSubtitle}>Accepts multiple PDF files</p>
          </div>

          {files.length > 0 ? (
            <div className={styles.fileList}>
              <div className={styles.fileHeader}>Selected Files ({files.length})</div>
              {files.map((localFile) => (
                <div key={localFile.id} className={styles.fileRow}>
                  <div className={styles.fileIcon}>PDF</div>
                  <div className={styles.fileMeta}>
                    <div className={styles.fileName}>{localFile.file.name}</div>
                    <div className={styles.fileSize}>{formatKb(localFile.file.size)} KB</div>
                  </div>
                  <button type="button" className={styles.removeButton} onClick={() => removeFile(localFile.id)} aria-label="Remove file">
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {selectedCategoryDoc && selectedProviderDoc ? (
            <div className={styles.namingPreview}>
              Files will be saved as: <span>{selectedCategoryDoc.name}</span> - <span>{selectedProviderDoc.name}</span> - YYYY-MM-DD
            </div>
          ) : null}

          {uploadStatus === "idle" ? (
            <button type="button" className={canUpload ? styles.uploadButton : styles.uploadButtonDisabled} onClick={onUploadClick} disabled={!canUpload}>
              ⬆ {files.length > 1 ? `Upload ${files.length} Invoices` : "Upload Invoice"}
            </button>
          ) : (
            <div className={styles.progressSection}>
              {files.map((localFile) => (
                <BillStatusRow
                  key={localFile.id}
                  fileId={localFile.id}
                  fileName={localFile.file.name}
                  status={fileStatuses[localFile.id] ?? { stage: "queued" }}
                  onRetry={runUploadForFile}
                  onStageChange={handleStageChange}
                />
              ))}
              {uploadError ? <p className={styles.errorMessage}>{uploadError}</p> : null}
              {allComplete && !hasErrors ? (
                <Link href={providerHref} className={styles.viewInvoicesButton}>
                  View All Invoices
                </Link>
              ) : null}
              {allComplete && hasErrors ? (
                <button type="button" className={styles.retryAllButton} onClick={onUploadClick}>
                  Retry Failed Files
                </button>
              ) : null}
            </div>
          )}
        </section>

        <div className={styles.backRow}>
          <Link href="/dashboard" className={styles.backLink}>
            ← Back to Dashboard
          </Link>
        </div>

        <footer className={styles.footer}>OLD OAK HORSES · UPLOAD</footer>
      </main>
    </div>
  );
}

function BillStatusRow({ fileName, fileId, status, onRetry, onStageChange }: BillStatusRowProps) {
  const bill = useQuery(api.bills.getBillById, status.billId ? { billId: status.billId } : "skip");
  const liveStage = status.stage === "parsing" && bill?.status ? (bill.status as FileStage) : status.stage;
  const errorMessage = liveStage === "error" ? bill?.errorMessage ?? status.error ?? "Failed to parse file." : undefined;

  useEffect(() => {
    onStageChange(fileId, liveStage, errorMessage);
  }, [errorMessage, fileId, liveStage, onStageChange]);

  return (
    <div className={styles.progressRow}>
      <span className={styles.progressFile}>{fileName}</span>
      <span className={styles.progressState}>
        {liveStage === "queued" ? "Queued..." : null}
        {liveStage === "uploading" ? "Uploading..." : null}
        {liveStage === "parsing" ? "Parsing..." : null}
        {liveStage === "done" ? "Done ✓" : null}
        {liveStage === "error" ? "Error ✗" : null}
      </span>
      {liveStage === "error" ? (
        <button type="button" className={styles.retryButton} onClick={() => onRetry(fileId)}>
          Retry
        </button>
      ) : null}
      {errorMessage ? <p className={styles.rowError}>{errorMessage}</p> : null}
    </div>
  );
}

function isPdfFile(file: File) {
  if (file.type === "application/pdf") return true;
  return file.name.toLowerCase().endsWith(".pdf");
}

function formatKb(bytes: number) {
  return (bytes / 1024).toLocaleString("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
}

function fileToBase64(file: File) {
  return file.arrayBuffer().then((buffer) => arrayBufferToBase64(buffer));
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
