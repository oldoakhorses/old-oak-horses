"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import NavBar from "@/components/NavBar";
import FilterTabs from "@/components/FilterTabs";
import { formatInvoiceTitle, toIsoDateString } from "@/lib/invoiceTitle";
import styles from "./bizOverview.module.css";

type Period = "thisMonth" | "ytd" | "2024" | "all";

const PERIOD_OPTIONS = [
  { key: "thisMonth", label: "This Month" },
  { key: "ytd", label: "YTD" },
  { key: "2024", label: "2024" },
  { key: "all", label: "All" }
] as const;

export default function BizOverviewPage() {
  const [period, setPeriod] = useState<Period>("thisMonth");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const data = useQuery(api.bills.getBizOverview, { period });

  const filteredInvoices = useMemo(() => {
    const rows = data?.recentInvoices ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      [row.invoiceNumber, row.provider, row.date, row.category, ...row.entities].join(" ").toLowerCase().includes(q)
    );
  }, [data?.recentInvoices, search]);

  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(filteredInvoices.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedInvoices = filteredInvoices.slice((safePage - 1) * pageSize, safePage * pageSize);

  const maxCategorySpend = useMemo(() => Math.max(1, ...(data?.categories ?? []).map((row) => row.spend)), [data?.categories]);

  if (data === undefined) {
    return (
      <div className="page-shell">
        <main className="page-main">
          <section className="ui-card">Loading biz overview…</section>
        </main>
      </div>
    );
  }

  if (data.invoiceCount === 0) {
    return (
      <div className="page-shell">
        <NavBar
          items={[
            { label: "old-oak-horses", href: "/dashboard", brand: true },
            { label: "biz_overview", current: true }
          ]}
          actions={[{ label: "upload invoices", href: "/upload", variant: "outlined" }]}
        />
        <main className="page-main">
          <Link href="/dashboard" className="ui-back-link">← cd /dashboard</Link>
          <section className={styles.emptyCard}>
            <div className="ui-label">// no data</div>
            <h1 className={styles.title}>biz_overview</h1>
            <p className={styles.emptyText}>No invoices found for this period.</p>
            <Link href="/upload" className="ui-button-outlined">upload invoices</Link>
          </section>
          <div className="ui-footer">OLD_OAK_HORSES // BIZ_OVERVIEW</div>
        </main>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <NavBar
        items={[
          { label: "old-oak-horses", href: "/dashboard", brand: true },
          { label: "biz_overview", current: true }
        ]}
        actions={[{ label: "upload invoices", href: "/upload", variant: "outlined" }]}
      />

      <main className="page-main">
        <Link href="/dashboard" className="ui-back-link">← cd /dashboard</Link>

        <div className={styles.headerRow}>
          <div>
            <div className="ui-label">// billing</div>
            <h1 className={styles.title}>biz_overview</h1>
          </div>
          <FilterTabs options={PERIOD_OPTIONS as any} value={period} onChange={(value) => { setPeriod(value); setPage(1); }} />
        </div>

        <section className={styles.heroCard}>
          <div className={styles.heroTop}>
            <div>
              <div className="ui-label">TOTAL SPEND</div>
              <div className={styles.heroSub}>{data.invoiceCount} invoices across {data.categoryCount} categories</div>
            </div>
            <div className={styles.iconBox}>$</div>
          </div>
          <div className={styles.heroAmount}>{fmtUSD(data.totalSpend)}</div>
          <div className={styles.momRow}>{renderMom(data.totalSpend, data.previousPeriodSpend)}</div>
        </section>

        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle}>spend_by_category</h2>
            <div className={styles.cardMeta}>{data.categories.length} categories</div>
          </div>

          <div className={styles.tableWrap}>
            <div className={styles.table}>
              <div className={styles.tableHead}>
                <div>CATEGORY</div>
                <div>SHARE</div>
                <div className={styles.amount}>SPEND</div>
                <div className={styles.mom}>MOM</div>
                <div className={styles.count}>BILLS</div>
              </div>

              {data.categories.map((row) => {
                const pctOfTop = maxCategorySpend > 0 ? (row.spend / maxCategorySpend) * 100 : 0;
                const pctOfTotal = data.totalSpend > 0 ? (row.spend / data.totalSpend) * 100 : 0;
                const mom = computeMom(row.spend, row.previousSpend);
                return (
                  <Link href={`/${row.slug}`} key={row.slug} className={styles.tableRow}>
                    <div className={styles.catName}><span className={styles.dot} style={{ background: row.color }} />{snakeCase(row.name)}</div>
                    <div className={styles.barWrap}>
                      <div className={styles.progressTrack}><div className={styles.progressFill} style={{ width: `${pctOfTop}%`, background: row.color }} /></div>
                      <div className={styles.percent}>{pctOfTotal.toFixed(1)}%</div>
                    </div>
                    <div className={styles.amount}>{fmtUSD(row.spend)}</div>
                    <div className={`${styles.mom} ${mom.className}`}>{mom.label}</div>
                    <div className={styles.count}>{row.invoiceCount}</div>
                  </Link>
                );
              })}

              <div className={styles.tableTotal}>
                <div className={styles.catName}>total</div>
                <div />
                <div className={styles.amount}>{fmtUSD(data.totalSpend)}</div>
                <div className={styles.mom}>{renderMomText(data.totalSpend, data.previousPeriodSpend)}</div>
                <div className={styles.count}>{data.invoiceCount}</div>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.twoCol}>
          <section className={styles.card}>
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle}>spend_by_horse</h2>
              <div className={styles.cardMeta}>all categories</div>
            </div>
            <div className={styles.list}>
              {data.horses.map((row) => (
                <div key={row.name} className={styles.listRow}>
                  <div className={styles.listTop}>
                    <div className={styles.listName}>🐴 {row.name}</div>
                    <div className={styles.listMeta}>{row.pctOfTotal.toFixed(1)}% · {fmtUSD(row.totalSpend)}</div>
                  </div>
                  <StackBar
                    segments={[
                      { color: "#4A5BDB", value: row.breakdown.veterinary },
                      { color: "#14B8A6", value: row.breakdown.farrier },
                      { color: "#F59E0B", value: row.breakdown.stabling },
                      { color: "#6B7084", value: row.breakdown.other }
                    ]}
                    total={row.totalSpend}
                  />
                  <div className={styles.breakdown}>
                    <span><i className={styles.breakDot} style={{ background: "#4A5BDB" }} />vet {fmtUSD(row.breakdown.veterinary)}</span>
                    <span><i className={styles.breakDot} style={{ background: "#14B8A6" }} />farrier {fmtUSD(row.breakdown.farrier)}</span>
                    <span><i className={styles.breakDot} style={{ background: "#F59E0B" }} />stabling {fmtUSD(row.breakdown.stabling)}</span>
                    <span><i className={styles.breakDot} style={{ background: "#6B7084" }} />other {fmtUSD(row.breakdown.other)}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className={styles.card}>
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle}>spend_by_person</h2>
              <div className={styles.cardMeta}>travel + housing</div>
            </div>
            <div className={styles.list}>
              {data.people.map((row) => (
                <div key={row.personId} className={styles.listRow}>
                  <div className={styles.listTop}>
                    <div>
                      <div className={styles.listName}>{initials(row.name)} {row.name}</div>
                      <span className={`${styles.roleBadge} ${roleClass(row.role, styles)}`}>{row.role}</span>
                    </div>
                    <div className={styles.listMeta}>{fmtUSD(row.totalSpend)}</div>
                  </div>
                  <StackBar
                    segments={[
                      { color: "#EC4899", value: row.breakdown.travel },
                      { color: "#A78BFA", value: row.breakdown.housing }
                    ]}
                    total={row.totalSpend}
                  />
                  <div className={styles.breakdown}>
                    {row.breakdown.travel > 0 ? <span><i className={styles.breakDot} style={{ background: "#EC4899" }} />travel {fmtUSD(row.breakdown.travel)}</span> : null}
                    {row.breakdown.housing > 0 ? <span><i className={styles.breakDot} style={{ background: "#A78BFA" }} />housing {fmtUSD(row.breakdown.housing)}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </section>

        <section className={styles.card}>
          <div className={styles.invoiceHead}>
            <h2 className={styles.cardTitle}>recent_invoices</h2>
            <input
              className={styles.search}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="search invoices..."
            />
          </div>

          {pagedInvoices.map((row) => {
            const href = buildInvoiceHref(row.categorySlug, row.providerSlug, String(row._id));
            return (
              <Link key={String(row._id)} href={href} className={styles.invoiceRow}>
                <div className={styles.invoiceNumber}>
                  {formatInvoiceTitle({
                    category: row.categorySlug,
                    providerName: row.provider,
                    date: row.date,
                  })}
                </div>
                <span className={styles.catTag} style={{ background: `${row.categoryColor}1A`, color: row.categoryColor }}>
                  {shortCategory(row.categorySlug)}
                </span>
                <div className={row.providerSlug === "other" ? `${styles.providerText} ${styles.providerTagCustom}` : styles.providerText}>{row.provider}</div>
                <div className={styles.invoiceDate}>#{row.invoiceNumber} · {toIsoDateString(row.date)}</div>
                <div className={styles.entities}>
                  {row.entities.slice(0, 3).map((entity) => (
                    <span className={styles.entityPill} key={`${row._id}-${entity}`}>{row.entityType === "person" ? firstName(entity) : entity}</span>
                  ))}
                </div>
                <span className={`${styles.statusDot} ${row.status === "done" ? styles.statusDone : styles.statusPending}`} />
                <div className={styles.invoiceAmount}>{fmtUSD(row.total)}</div>
                <div className={styles.arrow}>→</div>
              </Link>
            );
          })}

          {totalPages > 1 ? (
            <div className={styles.pagination}>
              <button type="button" className="ui-button-outlined" onClick={() => setPage((p) => Math.max(1, p - 1))}>prev</button>
              <span className={styles.pageText}>{safePage} / {totalPages}</span>
              <button type="button" className="ui-button-outlined" onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>next</button>
            </div>
          ) : null}
        </section>

        <div className="ui-footer">OLD_OAK_HORSES // BIZ_OVERVIEW</div>
      </main>
    </div>
  );
}

function fmtUSD(v: number) {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function snakeCase(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function buildInvoiceHref(categorySlug: string, providerSlug: string, billId: string) {
  if (categorySlug === "travel") return `/travel/${providerSlug}/${billId}`;
  if (categorySlug === "housing") return `/housing/${providerSlug}/${billId}`;
  if (categorySlug === "stabling") return `/stabling/${providerSlug}/${billId}`;
  return `/${categorySlug}/${providerSlug}/${billId}`;
}

function shortCategory(slug: string) {
  const map: Record<string, string> = {
    veterinary: "vet",
    stabling: "stb",
    travel: "trv",
    housing: "hsg",
    farrier: "far"
  };
  return (map[slug] ?? slug.slice(0, 3)).toUpperCase();
}

function renderMom(current: number, previous: number) {
  const mom = computeMom(current, previous);
  return <span className={`${styles.mom} ${mom.className}`}>{mom.label} from last month</span>;
}

function renderMomText(current: number, previous: number) {
  return computeMom(current, previous).label;
}

function computeMom(current: number, previous: number) {
  if (!Number.isFinite(previous) || previous <= 0) {
    return { label: "—", className: styles.momFlat };
  }
  const delta = ((current - previous) / previous) * 100;
  if (Math.abs(delta) < 0.05) return { label: "0.0%", className: styles.momFlat };
  if (delta > 0) return { label: `↗ +${delta.toFixed(1)}%`, className: styles.momUp };
  return { label: `↘ ${delta.toFixed(1)}%`, className: styles.momDown };
}

function StackBar({ segments, total }: { segments: Array<{ color: string; value: number }>; total: number }) {
  return (
    <div className={styles.progressTrack}>
      <div style={{ display: "flex", width: "100%", height: "100%" }}>
        {segments.map((segment, idx) => {
          const pct = total > 0 ? (segment.value / total) * 100 : 0;
          if (pct <= 0) return null;
          return <div key={idx} className={styles.progressFill} style={{ width: `${pct}%`, background: segment.color }} />;
        })}
      </div>
    </div>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "[]";
  if (parts.length === 1) return `[${parts[0].slice(0, 2).toUpperCase()}]`;
  return `[${parts[0][0].toUpperCase()}${parts[parts.length - 1][0].toUpperCase()}]`;
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] ?? name;
}

function roleClass(role: string, css: Record<string, string>) {
  if (role === "rider") return css.roleRider;
  if (role === "groom") return css.roleGroom;
  if (role === "trainer") return css.roleTrainer;
  return css.roleFreelance;
}
