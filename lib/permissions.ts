type UserRole = "admin" | "owner" | "team" | "investor" | undefined;

const ROUTE_PERMISSIONS: Record<string, UserRole[]> = {
  "/invoices": ["admin", "owner"],
  "/billing": ["admin"],
  "/owners": ["admin"],
  "/contacts": ["admin", "team"],
  "/dashboard": ["admin", "team"],
  "/horses": ["admin", "owner", "team"],
  "/records": ["admin", "owner", "team"],
  "/team": ["admin", "team"],
  "/accounts": ["admin", "owner", "team"],
};

export function canAccessRoute(role: UserRole, pathname: string): boolean {
  if (role === "admin") return true;

  for (const [route, allowedRoles] of Object.entries(ROUTE_PERMISSIONS)) {
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
