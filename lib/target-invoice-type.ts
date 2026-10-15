type TargetClassification = {
  type?: string | null;
  doc_header_text?: string | null;
  reason_code_description?: string | null;
};

export function isTargetInvoiceHeader(value: string | null | undefined) {
  return /^(?:\d{4}|INV\d+)$/i.test(String(value || "").trim());
}

export function normalizeTargetInvoiceRow<T extends TargetClassification>(row: T) {
  const reason = String(row.reason_code_description || "").trim();
  const missingReason = !reason || /^(?:unknown|unmapped)$/i.test(reason);
  const nextReason = missingReason && isTargetInvoiceHeader(row.doc_header_text)
    ? "WM Invoice"
    : reason;
  let type = String(row.type || "").trim();

  // Shared mappings historically saved Kehe labels for Target remittances.
  type = type.replace(/^Kehe(?:['’]s)?\s+/i, "Target's ");
  if (!type || /^(?:unknown|unmapped)$/i.test(type)) {
    const key = nextReason.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (key === "wminvoice") type = "Target's WM Invoice";
    if (key === "poshippedearlylate" || key === "assessorialcharges") {
      type = "Target's Distribution (MCB) Allowances";
    }
    if (key === "vendorincomefunding") type = "Target's TPR Funding";
  }

  return { ...row, type: type || null, reason_code_description: nextReason || null };
}
