type InvoiceTitleInput = {
  category: string;
  providerName?: string | null;
  subcategory?: string | null;
  date: string;
};

const CATEGORY_LABELS: Record<string, string> = {
  veterinary: "Veterinary",
  farrier: "Farrier",
  stabling: "Stabling",
  travel: "Travel",
  housing: "Housing",
  "feed-bedding": "Feed & Bedding",
  feed_bedding: "Feed & Bedding",
  "horse-transport": "Horse Transport",
  horse_transport: "Horse Transport",
  "show-expenses": "Show Expenses",
  show_expenses: "Show Expenses",
  bodywork: "Bodywork",
  salaries: "Salaries",
  marketing: "Marketing",
  commissions: "Commissions",
  admin: "Admin",
  supplies: "Supplies",
};

const SUBCATEGORY_LABELS: Record<string, string> = {
  "rental-car": "Rental Car",
  flights: "Flights",
  trains: "Trains",
  gas: "Gas",
  meals: "Meals",
  hotels: "Hotels",
  "rider-housing": "Rider Housing",
  "groom-housing": "Groom Housing",
  "vip-tickets": "VIP Tickets",
  photography: "Photography",
  "social-media": "Social Media",
  rider: "Rider",
  groom: "Groom",
  freelance: "Freelance",
};

export function formatCategoryName(category: string) {
  const key = normalize(category);
  return CATEGORY_LABELS[key] ?? startCase(key);
}

export function formatSubcategoryName(subcategory?: string | null) {
  if (!subcategory) return "";
  const key = normalize(subcategory);
  return SUBCATEGORY_LABELS[key] ?? startCase(key);
}

export function toIsoDateString(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown Date";
  return date.toISOString().slice(0, 10);
}

export function formatInvoiceTitle(input: InvoiceTitleInput) {
  const categoryLabel = formatCategoryName(input.category);
  const middle = input.providerName?.trim() || formatSubcategoryName(input.subcategory) || "Unknown";
  const dateStr = toIsoDateString(input.date);
  return `${categoryLabel} - ${middle} - ${dateStr}`;
}

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

function startCase(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}
