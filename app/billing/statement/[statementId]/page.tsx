"use client";

import Link from "next/link";
import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import NavBar from "@/components/NavBar";
import Modal from "@/components/Modal";
import styles from "./reconcile.module.css";

const CONFIDENCE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  exact: { label: "EXACT", color: "#22C583", bg: "rgba(34,197,131,0.1)" },
  high: { label: "HIGH", color: "#14B8A6", bg: "rgba(20,184,166,0.1)" },
  medium: { label: "MEDIUM", color: "#F59E0B", bg: "rgba(245,158,11,0.1)" },
  low: { label: "LOW", color: "#EF4444", bg: "rgba(239,68,68,0.1)" },
  none: { label: "NO MATCH", color: "#9EA2B0", bg: "rgba(158,162,176,0.1)" },
};

const ASSIGN_COLORS: Record<string, string> = {
  horse: "#4A5BDB",
  person: "#A78BFA",
  business: "#22C583",
  personal: "#F59E0B",
  ignore: "#9EA2B0",
};

type Tab = "all" | "matched" | "unmatched" | "assigned" | "approved";

function fmtUSD(amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

function fmtDate(dateStr: string) {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

function truncDesc(desc: string, len = 60) {
  if (desc.length <= len) return desc;
  return desc.slice(0, len) + "...";
}

export default function StatementReconcilePage() {
  const params = useParams();
  const router = useRouter();
  const statementId = params.statementId as Id<"ccStatements">;

  const stmt = useQuery(api.ccReconcile.getStatement, { statementId });
  const matchableBills = useQuery(api.ccReconcile.getMatchableBills) ?? [];
  const horses = useQuery(api.horses.getAllHorses) ?? [];
  const people = useQuery(api.people.getAllPeople) ?? [];

  const updateMatch = useMutation(api.ccReconcile.updateTransactionMatch);
  const assignTxn = useMutation(api.ccReconcile.assignTransaction);
  const approveTxn = useMutation(api.ccReconcile.approveTransaction);
  const approveAllAssigned = useMutation(api.ccReconcile.approveAllAssigned);
  const deleteStatement = useMutation(api.ccReconcile.deleteStatement);

  const [tab, setTab] = useState<Tab>("all");
  const [expandedTxn, setExpandedTxn] = useState<string | null>(null);
  const [matchModal, setMatchModal] = useState<string | null>(null);
  const [assignModal, setAssignModal] = useState<string | null>(null);
  const [billSearch, setBillSearch] = useState("");

  // Assignment form state
  const [assignType, setAssignType] = useState<"horse" | "person" | "business" | "personal" | "ignore">("business");
  const [selectedHorses, setSelectedHorses] = useState<Array<{ horseId: Id<"horses">; horseName: string; amount: number }>>([]);
  const [selectedPeople, setSelectedPeople] = useState<Array<{ personId: Id<"people">; personName: string; role?: string; amount: number }>>([]);
  const [assignCategory, setAssignCategory] = useState("");

  const activeHorses = useMemo(() => horses.filter((h) => h.status === "active" && !h.isSold), [horses]);

  if (stmt === undefined) {
    return (
      <div className="page-shell">
        <NavBar items={[{ label: "billing", href: "/billing" }, { label: "loading..." }]} />
        <main className="page-content"><div className={styles.loading}>loading...</div></main>
      </div>
    );
  }
  if (stmt === null) {
    return (
      <div className="page-shell">
        <NavBar items={[{ label: "billing", href: "/billing" }, { label: "not found" }]} />
        <main className="page-content"><div className={styles.loading}>statement not found</div></main>
      </div>
    );
  }

  const txns = stmt.transactions;
  const filtered = tab === "all" ? txns
    : tab === "matched" ? txns.filter((t) => t.matchedBillId)
    : tab === "unmatched" ? txns.filter((t) => !t.matchedBillId && t.amount < 0)
    : tab === "assigned" ? txns.filter((t) => t.assignType)
    : txns.filter((t) => t.isApproved);

  // Smart bill suggestions: score bills by relevance to the selected transaction
  const matchTxn = matchModal ? txns.find((t) => String(t._id) === matchModal) : null;
  const scoredBills = useMemo(() => {
    if (!matchTxn) return matchableBills;
    const absAmount = Math.round(Math.abs(matchTxn.amount) * 100) / 100;
    const txnKeywords = matchTxn.description.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim().split(" ").filter((w) => w.length > 2);
    const txnDateStr = matchTxn.postingDate;

    return matchableBills.map((b) => {
      let score = 0;
      // Amount match
      const amountDiff = Math.abs(b.amount - absAmount);
      if (amountDiff < 0.02) score += 100;
      else if (amountDiff / Math.max(absAmount, 1) < 0.05) score += 60;
      else if (amountDiff / Math.max(absAmount, 1) < 0.15) score += 20;

      // Keyword match
      const billKw = (b.providerKeywords ?? []) as string[];
      const common = txnKeywords.filter((kw) => billKw.some((bk) => bk.includes(kw) || kw.includes(bk)));
      score += common.length * 30;

      // Date proximity (within 30 days)
      if (b.invoiceDate && txnDateStr) {
        try {
          const txnDate = new Date(txnDateStr).getTime();
          const invDate = new Date(b.invoiceDate).getTime();
          const daysDiff = Math.abs(txnDate - invDate) / 86400000;
          if (daysDiff < 3) score += 40;
          else if (daysDiff < 14) score += 20;
          else if (daysDiff < 30) score += 10;
        } catch {}
      }

      return { ...b, score };
    }).sort((a, b) => b.score - a.score);
  }, [matchTxn, matchableBills]);

  const filteredBills = billSearch
    ? scoredBills.filter((b) =>
        b.fileName.toLowerCase().includes(billSearch.toLowerCase()) ||
        b.providerName.toLowerCase().includes(billSearch.toLowerCase())
      )
    : scoredBills;

  // Split into suggestions (score > 0) and the rest
  const suggestedBills = filteredBills.filter((b) => b.score > 50);
  const otherBills = filteredBills.filter((b) => b.score <= 50);

  function openAssignModal(txnId: string, amount: number) {
    const txn = txns.find((t) => String(t._id) === txnId);
    setAssignModal(txnId);
    // Pre-populate from existing assignments (may have been carried over from matched invoice)
    if (txn?.assignType) {
      setAssignType(txn.assignType);
      setSelectedHorses((txn.assignedHorses ?? []).map((h) => ({ horseId: h.horseId as Id<"horses">, horseName: h.horseName, amount: h.amount })));
      setSelectedPeople((txn.assignedPeople ?? []).map((p) => ({ personId: p.personId as Id<"people">, personName: p.personName, role: p.role, amount: p.amount })));
      setAssignCategory(txn.category ?? "");
    } else {
      setAssignType("business");
      setSelectedHorses([]);
      setSelectedPeople([]);
      setAssignCategory("");
    }
  }

  async function handleAssign() {
    if (!assignModal) return;
    await assignTxn({
      transactionId: assignModal as Id<"ccTransactions">,
      assignType,
      assignedHorses: assignType === "horse" ? selectedHorses : undefined,
      assignedPeople: assignType === "person" ? selectedPeople : undefined,
      category: assignCategory || undefined,
    });
    setAssignModal(null);
  }

  function addHorse(horseId: Id<"horses">, horseName: string) {
    if (selectedHorses.find((h) => String(h.horseId) === String(horseId))) return;
    const txn = txns.find((t) => String(t._id) === assignModal);
    const remaining = Math.abs(txn?.amount ?? 0) - selectedHorses.reduce((s, h) => s + h.amount, 0);
    setSelectedHorses([...selectedHorses, { horseId, horseName, amount: Math.round(remaining * 100) / 100 }]);
  }

  function removeHorse(idx: number) {
    setSelectedHorses(selectedHorses.filter((_, i) => i !== idx));
  }

  function updateHorseAmount(idx: number, amount: number) {
    setSelectedHorses(selectedHorses.map((h, i) => i === idx ? { ...h, amount } : h));
  }

  function addPerson(personId: Id<"people">, personName: string, role?: string) {
    if (selectedPeople.find((p) => String(p.personId) === String(personId))) return;
    const txn = txns.find((t) => String(t._id) === assignModal);
    const remaining = Math.abs(txn?.amount ?? 0) - selectedPeople.reduce((s, p) => s + p.amount, 0);
    setSelectedPeople([...selectedPeople, { personId, personName, role, amount: Math.round(remaining * 100) / 100 }]);
  }

  function removePerson(idx: number) {
    setSelectedPeople(selectedPeople.filter((_, i) => i !== idx));
  }

  function updatePersonAmount(idx: number, amount: number) {
    setSelectedPeople(selectedPeople.map((p, i) => i === idx ? { ...p, amount } : p));
  }

  const assignedCount = txns.filter((t) => t.assignType && !t.isApproved).length;

  return (
    <div className="page-shell">
      <NavBar items={[{ label: "billing", href: "/billing" }, { label: `Statement ${stmt.accountLast4 ? `•••• ${stmt.accountLast4}` : ""}` }]} />
      <main className="page-content">
        {/* Header */}
        <div className={styles.headerCard}>
          <div className={styles.headerLeft}>
            <div className={styles.headerLabel}>// CC STATEMENT RECONCILIATION</div>
            <h1 className={styles.stmtTitle}>{stmt.fileName}</h1>
            <div className={styles.headerMeta}>
              {stmt.transactionCount} transactions &middot; {fmtUSD(stmt.totalDebits)} debits &middot; {fmtUSD(stmt.totalCredits)} credits
            </div>
          </div>
          <div className={styles.headerRight}>
            <div className={styles.matchStat}>
              <span className={styles.matchNum}>{stmt.matchedCount}</span>
              <span className={styles.matchLabel}>matched</span>
            </div>
            <div className={styles.matchStat}>
              <span className={styles.unmatchNum}>{stmt.unmatchedCount}</span>
              <span className={styles.matchLabel}>unmatched</span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className={styles.actionsRow}>
          {assignedCount > 0 ? (
            <button
              type="button"
              className={styles.btnApproveAll}
              onClick={() => approveAllAssigned({ statementId })}
            >
              approve all assigned ({assignedCount})
            </button>
          ) : null}
          <div style={{ flex: 1 }} />
          <button
            type="button"
            className={styles.btnDelete}
            onClick={async () => {
              if (window.confirm("Delete this statement and all transactions?")) {
                await deleteStatement({ statementId });
                router.push("/billing");
              }
            }}
          >
            delete statement
          </button>
        </div>

        {/* Tabs */}
        <div className={styles.tabs}>
          {([
            ["all", `All (${txns.length})`],
            ["matched", `Matched (${stmt.matchedCount})`],
            ["unmatched", `Unmatched (${stmt.unmatchedCount})`],
            ["assigned", `Assigned (${stmt.assignedCount})`],
            ["approved", `Approved (${stmt.approvedCount})`],
          ] as [Tab, string][]).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={tab === key ? styles.tabActive : styles.tab}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Transaction list */}
        <div className={styles.txnList}>
          {filtered.map((txn) => {
            const isDebit = txn.amount < 0;
            const conf = CONFIDENCE_LABELS[txn.matchConfidence ?? "none"] ?? CONFIDENCE_LABELS.none;
            const isExpanded = expandedTxn === String(txn._id);

            return (
              <div key={txn._id} className={`${styles.txnCard} ${txn.isApproved ? styles.txnApproved : ""}`}>
                <div className={styles.txnRow} onClick={() => setExpandedTxn(isExpanded ? null : String(txn._id))}>
                  <div className={styles.txnDate}>{fmtDate(txn.postingDate)}</div>
                  <div className={styles.txnInfo}>
                    <div className={styles.txnDesc}>{truncDesc(txn.description)}</div>
                    <div className={styles.txnBadges}>
                      {txn.matchedBillName ? (
                        <span className={styles.matchBadge} style={{ color: conf.color, background: conf.bg }}>
                          {conf.label}: {txn.matchedBillName}
                        </span>
                      ) : isDebit ? (
                        <span className={styles.matchBadge} style={{ color: conf.color, background: conf.bg }}>
                          NO MATCH
                        </span>
                      ) : null}
                      {txn.assignType ? (
                        <span className={styles.assignBadge} style={{ color: ASSIGN_COLORS[txn.assignType] }}>
                          {txn.assignType === "horse"
                            ? `🐴 ${txn.assignedHorses?.map((h) => h.horseName).join(", ") ?? ""}`
                            : txn.assignType === "person"
                            ? `👤 ${txn.assignedPeople?.map((p: { personName: string }) => p.personName).join(", ") ?? ""}`
                            : txn.assignType.toUpperCase()}
                        </span>
                      ) : null}
                      {txn.isApproved ? (
                        <span className={styles.approvedBadge}>✓ APPROVED</span>
                      ) : null}
                    </div>
                  </div>
                  <div className={isDebit ? styles.txnDebit : styles.txnCredit}>
                    {fmtUSD(txn.amount)}
                  </div>
                </div>

                {isExpanded ? (
                  <div className={styles.txnExpanded}>
                    <div className={styles.txnFullDesc}>{txn.description}</div>
                    <div className={styles.txnActions}>
                      {isDebit ? (
                        <>
                          <button
                            type="button"
                            className={styles.btnAction}
                            onClick={(e) => { e.stopPropagation(); setMatchModal(String(txn._id)); setBillSearch(""); }}
                          >
                            {txn.matchedBillId ? "change match" : "match to invoice"}
                          </button>
                          <button
                            type="button"
                            className={styles.btnAction}
                            onClick={(e) => { e.stopPropagation(); openAssignModal(String(txn._id), txn.amount); }}
                          >
                            {txn.assignType ? "change assignment" : "assign"}
                          </button>
                          {txn.assignType && !txn.isApproved ? (
                            <button
                              type="button"
                              className={styles.btnApprove}
                              onClick={(e) => { e.stopPropagation(); approveTxn({ transactionId: txn._id, approved: true }); }}
                            >
                              approve
                            </button>
                          ) : null}
                          {txn.isApproved ? (
                            <button
                              type="button"
                              className={styles.btnUnapprove}
                              onClick={(e) => { e.stopPropagation(); approveTxn({ transactionId: txn._id, approved: false }); }}
                            >
                              unapprove
                            </button>
                          ) : null}
                          {txn.matchedBillId ? (
                            <Link
                              href={`/invoices/preview/${txn.matchedBillId}`}
                              className={styles.btnViewInvoice}
                              onClick={(e) => e.stopPropagation()}
                            >
                              view invoice
                            </Link>
                          ) : null}
                        </>
                      ) : (
                        <span className={styles.creditLabel}>credit / refund</span>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* Match Modal */}
        <Modal open={!!matchModal} title="match to invoice" onClose={() => setMatchModal(null)}>
          <input
            className={styles.searchInput}
            placeholder="search invoices..."
            value={billSearch}
            onChange={(e) => setBillSearch(e.target.value)}
          />
          <div className={styles.billList}>
            {matchTxn?.matchedBillId ? (
              <button
                type="button"
                className={styles.billOption}
                onClick={async () => {
                  if (matchModal) {
                    await updateMatch({ transactionId: matchModal as Id<"ccTransactions"> });
                    setMatchModal(null);
                  }
                }}
              >
                <span style={{ color: "#EF4444" }}>clear match</span>
              </button>
            ) : null}
            {suggestedBills.length > 0 && !billSearch ? (
              <>
                <div className={styles.billSectionLabel}>suggested matches</div>
                {suggestedBills.map((bill) => (
                  <button
                    key={bill._id}
                    type="button"
                    className={`${styles.billOption} ${styles.billSuggested}`}
                    onClick={async () => {
                      if (matchModal) {
                        await updateMatch({
                          transactionId: matchModal as Id<"ccTransactions">,
                          matchedBillId: bill._id,
                          matchedBillName: bill.fileName,
                        });
                        setMatchModal(null);
                      }
                    }}
                  >
                    <div className={styles.billOptionInfo}>
                      <div className={styles.billOptionName}>{bill.fileName}</div>
                      <div className={styles.billOptionMeta}>
                        {bill.providerName}{bill.invoiceDate ? ` · ${bill.invoiceDate}` : ""}{bill.categorySlug ? ` · ${bill.categorySlug}` : ""}
                      </div>
                      {(bill.hasHorseAssignments || bill.hasPersonAssignments) && (
                        <div className={styles.billOptionAssigned}>
                          {bill.hasHorseAssignments ? "🐴 horses assigned" : "👤 people assigned"}
                        </div>
                      )}
                    </div>
                    <div className={styles.billOptionAmount}>{fmtUSD(bill.amount)}</div>
                  </button>
                ))}
                {otherBills.length > 0 && <div className={styles.billSectionLabel}>all invoices</div>}
              </>
            ) : null}
            {(billSearch ? filteredBills : otherBills).slice(0, 30).map((bill) => (
              <button
                key={bill._id}
                type="button"
                className={styles.billOption}
                onClick={async () => {
                  if (matchModal) {
                    await updateMatch({
                      transactionId: matchModal as Id<"ccTransactions">,
                      matchedBillId: bill._id,
                      matchedBillName: bill.fileName,
                    });
                    setMatchModal(null);
                  }
                }}
              >
                <div className={styles.billOptionInfo}>
                  <div className={styles.billOptionName}>{bill.fileName}</div>
                  <div className={styles.billOptionMeta}>
                    {bill.providerName}{bill.invoiceDate ? ` · ${bill.invoiceDate}` : ""} &middot; {bill.billingPeriod}
                  </div>
                </div>
                <div className={styles.billOptionAmount}>{fmtUSD(bill.amount)}</div>
              </button>
            ))}
          </div>
        </Modal>

        {/* Assign Modal */}
        <Modal open={!!assignModal} title="assign transaction" onClose={() => setAssignModal(null)}>
          <div className={styles.assignTypeRow}>
            {(["horse", "person", "business", "personal", "ignore"] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={assignType === t ? styles.assignTypeActive : styles.assignTypeBtn}
                onClick={() => setAssignType(t)}
              >
                {t === "horse" ? "🐴 Horse" : t === "person" ? "👤 Person" : t === "business" ? "💼 Business" : t === "personal" ? "🏠 Personal" : "⊘ Ignore"}
              </button>
            ))}
          </div>

          {assignType === "horse" ? (
            <div className={styles.horseAssignSection}>
              <div className={styles.assignLabel}>SELECT HORSES</div>
              <div className={styles.horsePickList}>
                {activeHorses.map((h) => (
                  <button
                    key={h._id}
                    type="button"
                    className={styles.horsePick}
                    onClick={() => addHorse(h._id, h.name)}
                    disabled={selectedHorses.some((s) => String(s.horseId) === String(h._id))}
                  >
                    🐴 {h.name}
                  </button>
                ))}
              </div>
              {selectedHorses.length > 0 ? (
                <div className={styles.selectedHorses}>
                  {selectedHorses.map((h, idx) => (
                    <div key={String(h.horseId)} className={styles.selectedHorseRow}>
                      <span className={styles.selectedHorseName}>{h.horseName}</span>
                      <input
                        type="number"
                        className={styles.amountInput}
                        value={h.amount}
                        onChange={(e) => updateHorseAmount(idx, parseFloat(e.target.value) || 0)}
                        step="0.01"
                      />
                      <button type="button" className={styles.removeHorse} onClick={() => removeHorse(idx)}>✕</button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {assignType === "person" ? (
            <div className={styles.horseAssignSection}>
              <div className={styles.assignLabel}>SELECT PEOPLE</div>
              <div className={styles.horsePickList}>
                {people.map((p) => (
                  <button
                    key={p._id}
                    type="button"
                    className={styles.horsePick}
                    onClick={() => addPerson(p._id, p.name, p.role)}
                    disabled={selectedPeople.some((s) => String(s.personId) === String(p._id))}
                  >
                    👤 {p.name} <span style={{ fontSize: 9, color: "#9ea2b0" }}>({p.role})</span>
                  </button>
                ))}
              </div>
              {selectedPeople.length > 0 ? (
                <div className={styles.selectedHorses}>
                  {selectedPeople.map((p, idx) => (
                    <div key={String(p.personId)} className={styles.selectedHorseRow}>
                      <span className={styles.selectedHorseName}>{p.personName}</span>
                      <input
                        type="number"
                        className={styles.amountInput}
                        value={p.amount}
                        onChange={(e) => updatePersonAmount(idx, parseFloat(e.target.value) || 0)}
                        step="0.01"
                      />
                      <button type="button" className={styles.removeHorse} onClick={() => removePerson(idx)}>✕</button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div style={{ marginTop: 12 }}>
            <div className={styles.assignLabel}>CATEGORY (OPTIONAL)</div>
            <input
              className={styles.searchInput}
              placeholder="e.g. feed-bedding, veterinary..."
              value={assignCategory}
              onChange={(e) => setAssignCategory(e.target.value)}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <button type="button" className={styles.btnCancel} onClick={() => setAssignModal(null)}>cancel</button>
            <button type="button" className={styles.btnSave} onClick={handleAssign}>assign</button>
          </div>
        </Modal>
      </main>
    </div>
  );
}
