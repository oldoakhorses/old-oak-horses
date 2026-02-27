"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import NavBar from "@/components/NavBar";
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
  redirectPath?: string;
  listPath?: string;
};

const TRAVEL_SUBCATEGORIES = [
  { name: "Flights", slug: "flights" },
  { name: "Trains", slug: "trains" },
  { name: "Rental Car", slug: "rental-car" },
  { name: "Gas", slug: "gas" },
  { name: "Meals", slug: "meals" },
  { name: "Hotels", slug: "hotels" }
] as const;

const HOUSING_SUBCATEGORIES = [
  { name: "Rider Housing", slug: "rider-housing" },
  { name: "Groom Housing", slug: "groom-housing" }
] as const;
const MARKETING_SUBCATEGORIES = [
  { name: "VIP Tickets", slug: "vip-tickets" },
  { name: "Photography", slug: "photography" },
  { name: "Social Media", slug: "social-media" }
] as const;
const ADMIN_SUBCATEGORIES = [
  { name: "Legal", slug: "legal" },
  { name: "Visas", slug: "visas" },
  { name: "Accounting", slug: "accounting" },
  { name: "Payroll", slug: "payroll" },
  { name: "Contractors", slug: "contractors" }
] as const;
const DUES_SUBCATEGORIES = [
  { name: "Horse Registrations", slug: "horse-registrations" },
  { name: "Rider Registrations", slug: "rider-registrations" },
  { name: "Memberships", slug: "memberships" }
] as const;
const HORSE_TRANSPORT_SUBCATEGORIES = [
  { name: "Ground Transport", slug: "ground-transport" },
  { name: "Air Transport", slug: "air-transport" }
] as const;
const OTHER_OPTION_VALUE = "__other__";

const CATEGORY_DISPLAY_ORDER = [
  "Veterinary",
  "Feed & Bedding",
  "Stabling",
  "Farrier",
  "Bodywork",
  "Therapeutic Care",
  "Travel",
  "Housing",
  "Riding & Training",
  "Commissions",
  "Horse Purchases",
  "Supplies",
  "Marketing",
  "Dues & Registrations",
  "Admin",
  "Horse Transport",
  "Show Expenses",
] as const;

export default function UploadPage() {
  const router = useRouter();
  const categoriesQuery = useQuery(api.categories.getAllCategories);
  const categories = categoriesQuery ?? [];

  const [selectedCategory, setSelectedCategory] = useState<Id<"categories"> | "">("");
  const [selectedProvider, setSelectedProvider] = useState<Id<"providers"> | "">("");
  const [selectedTravelSubcategory, setSelectedTravelSubcategory] = useState<string>("");
  const [selectedHousingSubcategory, setSelectedHousingSubcategory] = useState<string>("");
  const [selectedMarketingSubcategory, setSelectedMarketingSubcategory] = useState<string>("");
  const [selectedAdminSubcategory, setSelectedAdminSubcategory] = useState<string>("");
  const [selectedDuesSubcategory, setSelectedDuesSubcategory] = useState<string>("");
  const [selectedHorseTransportSubcategory, setSelectedHorseTransportSubcategory] = useState<string>("");
  const [usingOtherOption, setUsingOtherOption] = useState(false);
  const [otherName, setOtherName] = useState("");
  const [saveAsNew, setSaveAsNew] = useState(false);
  const [files, setFiles] = useState<LocalUploadFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<UploadState>("idle");
  const [fileStatuses, setFileStatuses] = useState<Record<string, TrackedStatus>>({});
  const hasRedirectedRef = useRef(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const uploadAndParseBill = useAction((api as any).uploads.uploadAndParseBill);
  const seedCategories = useMutation(api.seed.seedCategories);
  const selectedCategoryDoc = categories.find((category) => category._id === selectedCategory);

  const providersQuery = useQuery(api.providers.getProvidersByCategory, selectedCategory ? { categoryId: selectedCategory } : "skip");
  const providers = providersQuery ?? [];
  const customSubcategoriesQuery = useQuery(
    api.customSubcategories.getByCategory,
    selectedCategory &&
    (selectedCategoryDoc?.slug === "travel" ||
      selectedCategoryDoc?.slug === "housing" ||
      selectedCategoryDoc?.slug === "marketing" ||
      selectedCategoryDoc?.slug === "admin")
      ? { categoryId: selectedCategory }
      : "skip"
  );
  const customSubcategories = customSubcategoriesQuery ?? [];

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

  const isTravelCategory = selectedCategoryDoc?.slug === "travel";
  const isHousingCategory = selectedCategoryDoc?.slug === "housing";
  const isMarketingCategory = selectedCategoryDoc?.slug === "marketing";
  const isAdminCategory = selectedCategoryDoc?.slug === "admin";
  const isDuesCategory = selectedCategoryDoc?.slug === "dues-registrations";
  const isHorseTransportCategory = selectedCategoryDoc?.slug === "horse-transport";
  const isPeopleSubcategoryCategory = isTravelCategory || isHousingCategory;
  const isSubcategoryOnlyCategory = isPeopleSubcategoryCategory || isMarketingCategory;
  const selectedTravelOption = TRAVEL_SUBCATEGORIES.find((row) => row.slug === selectedTravelSubcategory);
  const selectedHousingOption = HOUSING_SUBCATEGORIES.find((row) => row.slug === selectedHousingSubcategory);
  const mergedTravelOptions = useMemo(
    () => [
      ...TRAVEL_SUBCATEGORIES,
      ...customSubcategories.map((row) => ({ name: row.name, slug: row.slug }))
    ],
    [customSubcategories]
  );
  const mergedHousingOptions = useMemo(
    () => [
      ...HOUSING_SUBCATEGORIES,
      ...customSubcategories.map((row) => ({ name: row.name, slug: row.slug }))
    ],
    [customSubcategories]
  );
  const mergedMarketingOptions = useMemo(
    () => [
      ...MARKETING_SUBCATEGORIES,
      ...customSubcategories.map((row) => ({ name: row.name, slug: row.slug }))
    ],
    [customSubcategories]
  );
  const mergedAdminOptions = useMemo(
    () => [
      ...ADMIN_SUBCATEGORIES,
      ...customSubcategories.map((row) => ({ name: row.name, slug: row.slug }))
    ],
    [customSubcategories]
  );
  const mergedDuesOptions = useMemo(
    () => [
      ...DUES_SUBCATEGORIES,
      ...customSubcategories.map((row) => ({ name: row.name, slug: row.slug }))
    ],
    [customSubcategories]
  );
  const horseTransportProvidersQuery = useQuery(
    api.providers.getProvidersByCategoryAndSubcategory,
    selectedCategory && isHorseTransportCategory && selectedHorseTransportSubcategory
      ? { categoryId: selectedCategory, subcategorySlug: selectedHorseTransportSubcategory }
      : "skip"
  );
  const horseTransportProviders = horseTransportProvidersQuery ?? [];
  const adminProvidersQuery = useQuery(
    api.providers.getProvidersByCategoryAndSubcategory,
    selectedCategory && isAdminCategory && selectedAdminSubcategory
      ? { categoryId: selectedCategory, subcategorySlug: selectedAdminSubcategory }
      : "skip"
  );
  const adminProviders = adminProvidersQuery ?? [];
  const duesProvidersQuery = useQuery(
    api.providers.getProvidersByCategoryAndSubcategory,
    selectedCategory && isDuesCategory && selectedDuesSubcategory
      ? { categoryId: selectedCategory, subcategorySlug: selectedDuesSubcategory }
      : "skip"
  );
  const duesProviders = duesProvidersQuery ?? [];
  const providerOptions = isHorseTransportCategory ? horseTransportProviders : isAdminCategory ? adminProviders : isDuesCategory ? duesProviders : providers;
  const selectedProviderDoc = providerOptions.find((provider) => provider._id === selectedProvider);

  const duplicateNameExists = useMemo(() => {
    const value = otherName.trim().toLowerCase();
    if (!value) return false;
    if (isPeopleSubcategoryCategory) {
      const source = isTravelCategory ? mergedTravelOptions : mergedHousingOptions;
      return source.some((row) => row.name.trim().toLowerCase() === value);
    }
    if (isMarketingCategory) {
      return mergedMarketingOptions.some((row) => row.name.trim().toLowerCase() === value);
    }
    return providerOptions.some((provider) => provider.name.trim().toLowerCase() === value);
  }, [isHousingCategory, isMarketingCategory, isPeopleSubcategoryCategory, isTravelCategory, mergedHousingOptions, mergedMarketingOptions, mergedTravelOptions, otherName, providerOptions]);

  const otherNameValid = otherName.trim().length >= 2;

  const providerPlaceholder = !selectedCategory
    ? "select a category first"
      : isPeopleSubcategoryCategory
        ? "select a subcategory"
      : isMarketingCategory
        ? "select a subcategory"
      : isAdminCategory && !selectedAdminSubcategory
        ? "select a subcategory first"
      : isDuesCategory && !selectedDuesSubcategory
        ? "select a subcategory first"
      : isHorseTransportCategory && !selectedHorseTransportSubcategory
        ? "select a subcategory first"
      : (isHorseTransportCategory
          ? horseTransportProvidersQuery === undefined
          : isAdminCategory
            ? adminProvidersQuery === undefined
            : isDuesCategory
              ? duesProvidersQuery === undefined
            : providersQuery === undefined)
        ? "loading providers..."
        : providerOptions.length === 0
          ? "no providers for this category"
          : "select a provider";

  const canUpload = Boolean(
    selectedCategory &&
      files.length > 0 &&
      uploadStatus !== "uploading" &&
      (usingOtherOption
        ? otherNameValid && (!saveAsNew || !duplicateNameExists) && (!isHorseTransportCategory || Boolean(selectedHorseTransportSubcategory))
        : isPeopleSubcategoryCategory
          ? Boolean(isTravelCategory ? selectedTravelSubcategory : selectedHousingSubcategory)
          : isMarketingCategory
            ? Boolean(selectedMarketingSubcategory)
          : isAdminCategory
            ? Boolean(selectedAdminSubcategory && selectedProvider)
          : isDuesCategory
            ? Boolean(selectedDuesSubcategory && selectedProvider)
          : isHorseTransportCategory
            ? Boolean(selectedHorseTransportSubcategory && selectedProvider)
            : Boolean(selectedProvider))
  );

  const providerHref = useMemo(() => {
    if (!selectedCategoryDoc) return "/dashboard";
    if (usingOtherOption && otherNameValid) {
      const slug = slugify(otherName);
      if (selectedCategoryDoc.slug === "travel") return `/travel/${slug}`;
      if (selectedCategoryDoc.slug === "housing") return `/housing/${slug}`;
      if (selectedCategoryDoc.slug === "marketing") return `/marketing/${slug}`;
      if (selectedCategoryDoc.slug === "admin") return `/admin/${selectedAdminSubcategory || "payroll"}/${slug}`;
      if (selectedCategoryDoc.slug === "dues-registrations") return `/dues-registrations/${selectedDuesSubcategory || "memberships"}/${slug}`;
      if (selectedCategoryDoc.slug === "stabling") return `/stabling/${slug}`;
      return `/${selectedCategoryDoc.slug}`;
    }
    if (selectedCategoryDoc.slug === "marketing") {
      const subSlug = selectedMarketingSubcategory || "other";
      return `/marketing/${subSlug}`;
    }
    if (selectedCategoryDoc.slug === "admin") {
      const subSlug = selectedAdminSubcategory || "payroll";
      return `/admin/${subSlug}/${selectedProviderDoc?.slug ?? slugify(selectedProviderDoc?.name ?? "other")}`;
    }
    if (selectedCategoryDoc.slug === "dues-registrations") {
      const subSlug = selectedDuesSubcategory || "memberships";
      return `/dues-registrations/${subSlug}/${selectedProviderDoc?.slug ?? slugify(selectedProviderDoc?.name ?? "other")}`;
    }
    if (!selectedProviderDoc) return "/dashboard";
    if (selectedCategoryDoc.slug === "travel") {
      const subSlug = selectedTravelOption?.slug ?? selectedProviderDoc.slug ?? slugify(selectedProviderDoc.name);
      return `/travel/${subSlug}`;
    }
    if (selectedCategoryDoc.slug === "housing") {
      const subSlug = selectedHousingOption?.slug ?? selectedProviderDoc.slug ?? slugify(selectedProviderDoc.name);
      return `/housing/${subSlug}`;
    }
    if (selectedCategoryDoc.slug === "horse-transport") {
      const subSlug = selectedHorseTransportSubcategory || "ground-transport";
      return `/horse-transport/${subSlug}/${selectedProviderDoc.slug ?? slugify(selectedProviderDoc.name)}`;
    }
    return `/${selectedCategoryDoc.slug}/${selectedProviderDoc.slug ?? slugify(selectedProviderDoc.name)}`;
  }, [otherName, otherNameValid, selectedAdminSubcategory, selectedCategoryDoc, selectedDuesSubcategory, selectedHorseTransportSubcategory, selectedHousingOption?.slug, selectedMarketingSubcategory, selectedProviderDoc, selectedTravelOption?.slug, usingOtherOption]);

  const allComplete = useMemo(() => {
    if (files.length === 0) return false;
    return files.every((localFile) => {
      const status = fileStatuses[localFile.id];
      return status?.stage === "done" || status?.stage === "error";
    });
  }, [fileStatuses, files]);

  const hasErrors = useMemo(() => files.some((localFile) => fileStatuses[localFile.id]?.stage === "error"), [fileStatuses, files]);
  const completedListPath = useMemo(() => {
    for (const file of files) {
      const status = fileStatuses[file.id];
      if (status?.listPath) return status.listPath;
    }
    return providerHref;
  }, [fileStatuses, files, providerHref]);

  const handleStageChange = useCallback((fileId: string, stage: FileStage, error?: string) => {
    setFileStatuses((prev) => ({
      ...prev,
      [fileId]: {
        ...prev[fileId],
        stage,
        error,
      },
    }));
  }, []);

  useEffect(() => {
    if (allComplete) setUploadStatus("done");
  }, [allComplete]);

  useEffect(() => {
    if (categoriesQuery !== undefined && categories.length === 0) {
      void seedCategories().catch(() => undefined);
    }
  }, [categories.length, categoriesQuery, seedCategories]);

  useEffect(() => {
    if (!allComplete || hasErrors || hasRedirectedRef.current) return;
    if (files.length === 1) {
      const status = fileStatuses[files[0].id];
      if (!status?.redirectPath) return;
      hasRedirectedRef.current = true;
      router.push(status.redirectPath);
      return;
    }

    hasRedirectedRef.current = true;
    router.push(completedListPath);
  }, [allComplete, completedListPath, fileStatuses, files, hasErrors, router]);

  function onCategoryChange(value: string) {
    setSelectedCategory((value || "") as Id<"categories"> | "");
    setSelectedProvider("");
    setSelectedTravelSubcategory("");
    setSelectedHousingSubcategory("");
    setSelectedMarketingSubcategory("");
    setSelectedAdminSubcategory("");
    setSelectedDuesSubcategory("");
    setSelectedHorseTransportSubcategory("");
    setUsingOtherOption(false);
    setOtherName("");
    setSaveAsNew(false);
  }

  function onProviderChange(value: string) {
    if (value === OTHER_OPTION_VALUE) {
      setUsingOtherOption(true);
      setSelectedProvider("");
      return;
    }
    setUsingOtherOption(false);
    setOtherName("");
    setSaveAsNew(false);
    setSelectedProvider((value || "") as Id<"providers"> | "");
  }

  function onHorseTransportSubcategoryChange(value: string) {
    setSelectedHorseTransportSubcategory(value);
    setSelectedProvider("");
    setUsingOtherOption(false);
    setOtherName("");
    setSaveAsNew(false);
  }

  function onMarketingSubcategoryChange(value: string) {
    if (value === OTHER_OPTION_VALUE) {
      setUsingOtherOption(true);
      setSelectedMarketingSubcategory("");
      return;
    }
    setUsingOtherOption(false);
    setOtherName("");
    setSaveAsNew(false);
    setSelectedMarketingSubcategory(value);
  }

  function onAdminSubcategoryChange(value: string) {
    if (value === OTHER_OPTION_VALUE) {
      setUsingOtherOption(true);
      setSelectedAdminSubcategory("");
      return;
    }
    setUsingOtherOption(false);
    setOtherName("");
    setSaveAsNew(false);
    setSelectedAdminSubcategory(value);
    setSelectedProvider("");
  }

  function onDuesSubcategoryChange(value: string) {
    if (value === OTHER_OPTION_VALUE) {
      setUsingOtherOption(true);
      setSelectedDuesSubcategory("");
      return;
    }
    setUsingOtherOption(false);
    setOtherName("");
    setSaveAsNew(false);
    setSelectedDuesSubcategory(value);
    setSelectedProvider("");
  }

  function onTravelSubcategoryChange(value: string) {
    if (value === OTHER_OPTION_VALUE) {
      setUsingOtherOption(true);
      setSelectedTravelSubcategory("");
      setSelectedProvider("");
      return;
    }
    setUsingOtherOption(false);
    setOtherName("");
    setSaveAsNew(false);
    setSelectedTravelSubcategory(value);
    const provider = providers.find((row) => (row.slug ?? slugify(row.name)) === value);
    setSelectedProvider(provider?._id ?? "");
  }

  function onHousingSubcategoryChange(value: string) {
    if (value === OTHER_OPTION_VALUE) {
      setUsingOtherOption(true);
      setSelectedHousingSubcategory("");
      setSelectedProvider("");
      return;
    }
    setUsingOtherOption(false);
    setOtherName("");
    setSaveAsNew(false);
    setSelectedHousingSubcategory(value);
    const provider = providers.find((row) => (row.slug ?? slugify(row.name)) === value);
    setSelectedProvider(provider?._id ?? "");
  }

  function resetOtherMode() {
    setUsingOtherOption(false);
    setOtherName("");
    setSaveAsNew(false);
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
        file,
      })),
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
    if (!selectedCategory) return;
    if (!usingOtherOption && !isPeopleSubcategoryCategory && !isHorseTransportCategory && !isMarketingCategory && !selectedProvider) return;
    if (!usingOtherOption && isPeopleSubcategoryCategory && !(isTravelCategory ? selectedTravelSubcategory : selectedHousingSubcategory)) return;
    if (!usingOtherOption && isMarketingCategory && !selectedMarketingSubcategory) return;
    if (!usingOtherOption && isAdminCategory && (!selectedAdminSubcategory || !selectedProvider)) return;
    if (!usingOtherOption && isDuesCategory && (!selectedDuesSubcategory || !selectedProvider)) return;
    if (!usingOtherOption && isHorseTransportCategory && (!selectedHorseTransportSubcategory || !selectedProvider)) return;
    if (usingOtherOption && isHorseTransportCategory && !selectedHorseTransportSubcategory) return;
    if (usingOtherOption && isMarketingCategory && !otherNameValid) return;
    if (usingOtherOption && !otherNameValid) return;

    const fileRecord = files.find((file) => file.id === fileId);
    if (!fileRecord) return;

    setFileStatuses((prev) => ({ ...prev, [fileId]: { stage: "uploading" } }));
    try {
      const base64Pdf = await fileToBase64(fileRecord.file);
      const result = await uploadAndParseBill({
        categoryId: selectedCategory,
        providerId: usingOtherOption || isMarketingCategory ? undefined : selectedProvider,
        customProviderName: usingOtherOption && !isMarketingCategory ? otherName.trim() : undefined,
        saveAsNew: usingOtherOption ? saveAsNew : undefined,
        travelSubcategory: selectedTravelSubcategory || undefined,
        housingSubcategory: selectedHousingSubcategory || undefined,
        horseTransportSubcategory: selectedHorseTransportSubcategory || undefined,
        marketingSubcategory: usingOtherOption && isMarketingCategory ? slugify(otherName.trim()) : selectedMarketingSubcategory || undefined,
        adminSubcategory: selectedAdminSubcategory || undefined,
        duesSubcategory: selectedDuesSubcategory || undefined,
        salariesSubcategory: undefined,
        base64Pdf,
      });

      setFileStatuses((prev) => ({
        ...prev,
        [fileId]: { stage: "parsing", billId: result.billId, redirectPath: result.redirectPath, listPath: result.listPath },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "upload failed";
      setFileStatuses((prev) => ({ ...prev, [fileId]: { stage: "error", error: message } }));
    }
  }

  async function onUploadClick() {
    if (!canUpload) return;
    setUploadStatus("uploading");
    hasRedirectedRef.current = false;

    for (const localFile of files) {
      const current = fileStatuses[localFile.id];
      if (current?.stage === "done" || current?.stage === "parsing" || current?.stage === "uploading") continue;
      await runUploadForFile(localFile.id);
    }
  }

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "dashboard", href: "/dashboard" },
          { label: "upload", current: true },
        ]}
      />

      <main className="page-main">
        <Link href="/dashboard" className="ui-back-link">
          ← cd /dashboard
        </Link>

        <header className={styles.header}>
          <div className="ui-label">// upload</div>
          <h1 className={styles.title}>Upload Invoice</h1>
          <p className={styles.subtitle}>select a category and provider, then upload your PDF</p>
        </header>

        <section className={styles.card}>
          <label className={styles.field}>
            <span className={styles.label}>CATEGORY *</span>
            <select value={selectedCategory} onChange={(event) => onCategoryChange(event.target.value)} className={styles.select}>
              <option value="">{categoriesQuery === undefined ? "loading categories..." : "select a category"}</option>
              {orderedCategories.map((category) => (
                <option key={category._id} value={category._id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>

          {isHorseTransportCategory ? (
            <label className={styles.field}>
              <span className={styles.label}>SUBCATEGORY *</span>
              <select
                value={selectedHorseTransportSubcategory}
                onChange={(event) => onHorseTransportSubcategoryChange(event.target.value)}
                className={styles.select}
                disabled={!selectedCategory}
              >
                <option value="">{!selectedCategory ? "select a category first" : "select a subcategory"}</option>
                {HORSE_TRANSPORT_SUBCATEGORIES.map((option) => (
                  <option key={option.slug} value={option.slug}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {isAdminCategory ? (
            <label className={styles.field}>
              <span className={styles.label}>SUBCATEGORY *</span>
              <select
                value={selectedAdminSubcategory}
                onChange={(event) => onAdminSubcategoryChange(event.target.value)}
                className={styles.select}
                disabled={!selectedCategory}
              >
                <option value="">{!selectedCategory ? "select a category first" : "select a subcategory"}</option>
                {mergedAdminOptions.map((option) => (
                  <option key={option.slug} value={option.slug}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {isDuesCategory ? (
            <label className={styles.field}>
              <span className={styles.label}>SUBCATEGORY *</span>
              <select
                value={selectedDuesSubcategory}
                onChange={(event) => onDuesSubcategoryChange(event.target.value)}
                className={styles.select}
                disabled={!selectedCategory}
              >
                <option value="">{!selectedCategory ? "select a category first" : "select a subcategory"}</option>
                {mergedDuesOptions.map((option) => (
                  <option key={option.slug} value={option.slug}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className={styles.field}>
            <span className={styles.label}>{isSubcategoryOnlyCategory ? "SUBCATEGORY *" : "PROVIDER *"}</span>
            {usingOtherOption ? (
              <>
                <div className={styles.otherHeader}>
                  <span className={styles.label}>{isSubcategoryOnlyCategory ? "SUBCATEGORY NAME *" : "PROVIDER NAME *"}</span>
                  <button type="button" className={styles.backToList} onClick={resetOtherMode}>
                    ← back to list
                  </button>
                </div>
                <input
                  value={otherName}
                  onChange={(event) => setOtherName(event.target.value)}
                  placeholder={isSubcategoryOnlyCategory ? "enter subcategory name..." : "enter provider name..."}
                  className={styles.select}
                />
                <label className={styles.checkboxRow}>
                  <input type="checkbox" checked={saveAsNew} onChange={(event) => setSaveAsNew(event.target.checked)} />
                  <span>
                    Save as a new {isSubcategoryOnlyCategory ? "subcategory" : "provider"} for {selectedCategoryDoc?.name ?? "this category"}
                  </span>
                </label>
                {saveAsNew && duplicateNameExists ? (
                  <div className={styles.inlineError}>this {isSubcategoryOnlyCategory ? "subcategory" : "provider"} already exists — select it from the list</div>
                ) : null}
              </>
            ) : isTravelCategory ? (
              <select
                value={selectedTravelSubcategory}
                onChange={(event) => onTravelSubcategoryChange(event.target.value)}
                className={styles.select}
                disabled={!selectedCategory}
              >
                <option value="">{providerPlaceholder}</option>
                {mergedTravelOptions.map((option) => {
                  return (
                    <option key={option.slug} value={option.slug}>
                      {option.name}
                    </option>
                  );
                })}
                <option disabled>──────────────</option>
                <option value={OTHER_OPTION_VALUE}>+ Other...</option>
              </select>
            ) : isHousingCategory ? (
              <select
                value={selectedHousingSubcategory}
                onChange={(event) => onHousingSubcategoryChange(event.target.value)}
                className={styles.select}
                disabled={!selectedCategory}
              >
                <option value="">{providerPlaceholder}</option>
                {mergedHousingOptions.map((option) => {
                  return (
                    <option key={option.slug} value={option.slug}>
                      {option.name}
                    </option>
                  );
                })}
                <option disabled>──────────────</option>
                <option value={OTHER_OPTION_VALUE}>+ Other...</option>
              </select>
            ) : isMarketingCategory ? (
              <select
                value={selectedMarketingSubcategory}
                onChange={(event) => onMarketingSubcategoryChange(event.target.value)}
                className={styles.select}
                disabled={!selectedCategory}
              >
                <option value="">{providerPlaceholder}</option>
                {mergedMarketingOptions.map((option) => (
                  <option key={option.slug} value={option.slug}>
                    {option.name}
                  </option>
                ))}
                <option disabled>──────────────</option>
                <option value={OTHER_OPTION_VALUE}>+ Other...</option>
              </select>
            ) : (
              <select
                value={selectedProvider}
                onChange={(event) => onProviderChange(event.target.value)}
                className={styles.select}
                disabled={
                  !selectedCategory ||
                  (isHorseTransportCategory && !selectedHorseTransportSubcategory) ||
                  (isAdminCategory && !selectedAdminSubcategory) ||
                  (isDuesCategory && !selectedDuesSubcategory)
                }
              >
                <option value="">{providerPlaceholder}</option>
                {providerOptions.map((provider) => (
                  <option key={provider._id} value={provider._id}>
                    {provider.name}
                  </option>
                ))}
                <option disabled>──────────────</option>
                <option value={OTHER_OPTION_VALUE}>+ Other...</option>
              </select>
            )}
          </label>

          <div className={styles.divider} />

          <div
            className={isDragging ? styles.dropActive : styles.drop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
          >
            <div className={styles.dropIcon}>⇪</div>
            <p className={styles.dropTitle}>drop PDF files here or click to browse</p>
            <p className={styles.dropSub}>accepts multiple PDF files</p>
            <input ref={inputRef} type="file" multiple accept=".pdf" className={styles.hiddenInput} onChange={handleFileSelect} />
          </div>

          {files.length > 0 ? (
            <section className={styles.filesWrap}>
              <div className={styles.label}>SELECTED FILES ({files.length})</div>
              {files.map((localFile, index) => (
                <div key={localFile.id} className={styles.fileRow}>
                  <div className={styles.fileIcon}>PDF</div>
                  <div className={styles.fileMeta}>
                    <div className={styles.fileName}>{localFile.file.name}</div>
                    <div className={styles.fileSize}>{Math.max(1, Math.round(localFile.file.size / 1024)).toLocaleString()} KB</div>
                  </div>
                  <button type="button" className={styles.remove} onClick={() => removeFile(localFile.id)} aria-label={`remove file ${index + 1}`}>
                    ×
                  </button>
                </div>
              ))}
            </section>
          ) : null}

          {selectedCategoryDoc &&
          (selectedProviderDoc ||
            usingOtherOption ||
            selectedTravelSubcategory ||
            selectedHousingSubcategory ||
            selectedMarketingSubcategory ||
            selectedAdminSubcategory ||
            selectedDuesSubcategory ||
            selectedHorseTransportSubcategory) ? (
            <div className={styles.namingPreview}>
              files will be saved as: <span>{selectedCategoryDoc.name}</span> -{" "}
              <span>
                {selectedProviderDoc?.name ??
                  (usingOtherOption
                    ? otherName || "Other"
                    : isTravelCategory
                      ? mergedTravelOptions.find((row) => row.slug === selectedTravelSubcategory)?.name ?? "Travel"
                      : isHousingCategory
                        ? mergedHousingOptions.find((row) => row.slug === selectedHousingSubcategory)?.name ?? "Housing"
                        : isMarketingCategory
                          ? mergedMarketingOptions.find((row) => row.slug === selectedMarketingSubcategory)?.name ?? "Marketing"
                        : isAdminCategory
                          ? mergedAdminOptions.find((row) => row.slug === selectedAdminSubcategory)?.name ?? "Admin"
                        : isDuesCategory
                          ? mergedDuesOptions.find((row) => row.slug === selectedDuesSubcategory)?.name ?? "Dues"
                        : "Other")}
              </span>{" "}
              - YYYY-MM-DD
            </div>
          ) : null}

          {uploadStatus !== "uploading" ? (
            <button type="button" className={canUpload ? "ui-button-filled" : styles.uploadDisabled} onClick={onUploadClick} disabled={!canUpload}>
              {files.length > 1 ? `upload ${files.length} invoices` : "upload invoice"}
            </button>
          ) : (
            <section className={styles.progressList}>
              {files.map((localFile) => (
                <BillStatusRow
                  key={localFile.id}
                  fileName={localFile.file.name}
                  fileId={localFile.id}
                  status={fileStatuses[localFile.id] ?? { stage: "queued" }}
                  onRetry={runUploadForFile}
                  onStageChange={handleStageChange}
                />
              ))}

              {allComplete && !hasErrors ? (
                <Link href={completedListPath} className="ui-button-filled">
                  view all invoices
                </Link>
              ) : null}
            </section>
          )}
        </section>

        <div className="ui-footer">OLD_OAK_HORSES // UPLOAD</div>
      </main>
    </div>
  );
}

function BillStatusRow({
  fileName,
  fileId,
  status,
  onRetry,
  onStageChange,
}: {
  fileName: string;
  fileId: string;
  status: TrackedStatus;
  onRetry: (fileId: string) => void;
  onStageChange: (fileId: string, stage: FileStage, error?: string) => void;
}) {
  const bill = useQuery(api.bills.getBillById, status.billId ? { billId: status.billId } : "skip");

  useEffect(() => {
    if (!status.billId || bill === undefined || !bill) return;
    if (bill.status === "done" || bill.status === "pending") {
      onStageChange(fileId, "done");
      return;
    }
    if (bill.status === "error") {
      onStageChange(fileId, "error", bill.errorMessage ?? "Parsing failed");
      return;
    }
    if (bill.status === "parsing") {
      onStageChange(fileId, "parsing");
    }
  }, [bill, fileId, onStageChange, status.billId]);

  return (
    <div className={styles.progressRow}>
      <div className={styles.progressFile}>{fileName}</div>
      <div className={styles.progressStage}>{stageLabel(status.stage)}</div>
      {status.stage === "error" ? (
        <button type="button" className="ui-button-outlined" onClick={() => onRetry(fileId)}>
          retry
        </button>
      ) : null}
      {status.error ? <p className={styles.progressError}>{status.error}</p> : null}
    </div>
  );
}

function stageLabel(stage: FileStage) {
  switch (stage) {
    case "uploading":
      return "uploading...";
    case "parsing":
      return "parsing...";
    case "done":
      return "done ✓";
    case "error":
      return "error ✗";
    default:
      return "queued";
  }
}

function isPdfFile(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Invalid file result"));
        return;
      }
      const [, base64] = result.split(",");
      resolve(base64 ?? "");
    };
    reader.readAsDataURL(file);
  });
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}
