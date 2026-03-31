"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import Modal from "@/components/Modal";

type ContactEditModalProps = {
  open: boolean;
  onClose: () => void;
  billId: Id<"bills">;
  currentContactId?: Id<"contacts"> | null;
  currentName?: string;
  currentContact?: {
    providerName?: string;
    contactName?: string;
    phone?: string;
    email?: string;
    address?: string;
    website?: string;
    accountNumber?: string;
  };
};

export default function ContactEditModal({
  open,
  onClose,
  billId,
  currentContactId,
  currentName,
  currentContact,
}: ContactEditModalProps) {
  const allContacts = useQuery(api.contacts.getAllContacts) ?? [];
  const updateBillContact = useMutation(api.bills.updateBillContact);

  const [search, setSearch] = useState(currentName ?? currentContact?.providerName ?? "");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState<Id<"contacts"> | null>(currentContactId ?? null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    providerName: currentContact?.providerName ?? currentName ?? "",
    contactName: currentContact?.contactName ?? "",
    phone: currentContact?.phone ?? "",
    email: currentContact?.email ?? "",
    address: currentContact?.address ?? "",
    website: currentContact?.website ?? "",
    accountNumber: currentContact?.accountNumber ?? "",
  });

  // Reset form when modal opens
  const suggestions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allContacts.slice(0, 8);
    return allContacts
      .filter((c) => {
        const haystack = [c.name, c.fullName, c.providerName, c.email, c.phone]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, 8);
  }, [allContacts, search]);

  function selectContact(contact: (typeof allContacts)[number]) {
    setSelectedContactId(contact._id);
    setSearch(contact.name);
    setShowSuggestions(false);
    setForm({
      providerName: contact.name,
      contactName: contact.contactName ?? contact.primaryContactName ?? "",
      phone: contact.phone ?? contact.primaryContactPhone ?? "",
      email: contact.email ?? "",
      address: contact.address ?? "",
      website: contact.website ?? "",
      accountNumber: contact.accountNumber ?? "",
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      await updateBillContact({
        billId,
        contactId: selectedContactId ?? undefined,
        extractedProviderContact: {
          providerName: form.providerName || undefined,
          contactName: form.contactName || undefined,
          phone: form.phone || undefined,
          email: form.email || undefined,
          address: form.address || undefined,
          website: form.website || undefined,
          accountNumber: form.accountNumber || undefined,
        },
      });
      onClose();
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} title="edit contact" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "4px 0" }}>
        <div style={{ position: "relative" }}>
          <Label>CONTACT</Label>
          <input
            style={inputStyle}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setForm((p) => ({ ...p, providerName: e.target.value }));
              setSelectedContactId(null);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            placeholder="search or type contact name..."
            autoComplete="off"
          />
          {showSuggestions && suggestions.length > 0 && (
            <div style={dropdownStyle}>
              {suggestions.map((c) => (
                <button
                  key={String(c._id)}
                  type="button"
                  style={suggestionStyle}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectContact(c);
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{c.name}</span>
                  {c.email ? (
                    <span style={{ fontSize: 10, color: "#9ea2b0", marginLeft: 6 }}>{c.email}</span>
                  ) : null}
                </button>
              ))}
            </div>
          )}
          {selectedContactId && (
            <div style={{ fontSize: 9, color: "#22C583", marginTop: 2 }}>✓ linked to existing contact</div>
          )}
        </div>

        <div>
          <Label>CONTACT NAME</Label>
          <input style={inputStyle} value={form.contactName} onChange={(e) => setForm((p) => ({ ...p, contactName: e.target.value }))} />
        </div>
        <div>
          <Label>PHONE</Label>
          <input style={inputStyle} value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
        </div>
        <div>
          <Label>EMAIL</Label>
          <input style={inputStyle} value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} type="email" />
        </div>
        <div>
          <Label>ADDRESS</Label>
          <input style={inputStyle} value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} />
        </div>
        <div>
          <Label>WEBSITE</Label>
          <input style={inputStyle} value={form.website} onChange={(e) => setForm((p) => ({ ...p, website: e.target.value }))} />
        </div>
        <div>
          <Label>ACCOUNT #</Label>
          <input style={inputStyle} value={form.accountNumber} onChange={(e) => setForm((p) => ({ ...p, accountNumber: e.target.value }))} />
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 6, justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose} style={cancelBtnStyle}>cancel</button>
          <button type="button" disabled={saving} onClick={() => void handleSave()} style={saveBtnStyle}>
            {saving ? "saving..." : "save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        color: "#9ea2b0",
        marginBottom: 3,
      }}
    >
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  fontSize: 12,
  padding: "8px 10px",
  border: "1px solid rgba(0,0,0,0.12)",
  borderRadius: 6,
  width: "100%",
  boxSizing: "border-box",
  color: "#1a1a2e",
  outline: "none",
};

const dropdownStyle: React.CSSProperties = {
  position: "absolute",
  top: "100%",
  left: 0,
  right: 0,
  background: "#fff",
  border: "1px solid rgba(0,0,0,0.12)",
  borderRadius: 6,
  boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
  maxHeight: 200,
  overflowY: "auto",
  zIndex: 20,
  marginTop: 2,
};

const suggestionStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  width: "100%",
  padding: "8px 10px",
  border: "none",
  borderBottom: "1px solid rgba(0,0,0,0.04)",
  background: "none",
  cursor: "pointer",
  textAlign: "left",
  fontSize: 11,
  color: "#1a1a2e",
};

const cancelBtnStyle: React.CSSProperties = {
  fontSize: 11,
  border: "none",
  background: "none",
  color: "#8b8fa3",
  cursor: "pointer",
  padding: "6px 12px",
};

const saveBtnStyle: React.CSSProperties = {
  fontSize: 11,
  border: "none",
  background: "#4A5BDB",
  color: "#fff",
  cursor: "pointer",
  padding: "6px 14px",
  borderRadius: 6,
  fontWeight: 600,
};
