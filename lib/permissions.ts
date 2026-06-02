type UserRole = "admin" | "owner" | "team" | "investor" | undefined;

const ROUTE_PERMISSIONS: Record<string, UserRole[]> = {
  "/invoices": ["admin", "owner"],
  "/billing": ["admin"],
  "/owners": ["admin"],
  "/contacts": ["admin", "team"],
  "/dashboard": ["admin", "team"],
  "/horses": ["admin", "owner", "team"],
  "/records": ["admin", "owner", "team"],
  "/meds": ["admin", "owner", "team"],
  "/team": ["admin", "team"],
  "/accounts": ["admin", "owner", "team"],
  // Admin-only sub-route — must come BEFORE the broader /accounts rule
  // wins in the match loop (sorted by length descending below).
  "/accounts/users": ["admin"],
};

export function canAccessRoute(role: UserRole, pathname: string): boolean {
  if (role === "admin") return true;

  // Sort routes by path length descending so more-specific rules (e.g.
  // /accounts/users) win over their broader parents (e.g. /accounts).
  const sortedRoutes = Object.entries(ROUTE_PERMISSIONS).sort((a, b) => b[0].length - a[0].length);
  for (const [route, allowedRoles] of sortedRoutes) {
    if (pathname === route || pathname.startsWith(`${route}/`)) {
      return allowedRoles.includes(role);
    }
  }
  return false;
}

export function getNavSections(role: UserRole) {
  const sections = [
    {
      label: "Home",
      items: [
        { label: "home", href: "/dashboard", icon: "🏠" },
      ],
    },
    {
      label: "Barn",
      items: [
        { label: "horses", href: "/horses", icon: "🐴" },
        { label: "records", href: "/records", icon: "📋" },
        { label: "meds", href: "/meds", icon: "💊" },
        { label: "team", href: "/team", icon: "🧑‍🤝‍🧑" },
      ],
    },
    {
      label: "Admin",
      items: [
        { label: "invoices", href: "/invoices", icon: "📄" },
        { label: "billing", href: "/billing", icon: "💰" },
        { label: "owners", href: "/owners", icon: "👥" },
        { label: "contacts", href: "/contacts", icon: "👤" },
      ],
    },
    {
      label: "Settings",
      items: [
        { label: "account", href: "/accounts", icon: "🔑" },
      ],
    },
  ];

  if (role === "admin") return sections;

  if (role === "team") {
    return sections.map((section) => ({
      ...section,
      items: section.items.filter((item) => canAccessRoute("team", item.href)),
    })).filter((section) => section.items.length > 0);
  }

  if (role === "owner") {
    return sections.map((section) => ({
      ...section,
      items: section.items.filter((item) => canAccessRoute("owner", item.href)),
    })).filter((section) => section.items.length > 0);
  }

  return [];
}
