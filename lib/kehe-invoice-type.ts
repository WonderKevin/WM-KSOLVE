export const KEHE_WM_INVOICE_TYPE = "Kehe WM Invoice";

export function isKeheWmInvoiceType(value: string | null | undefined) {
  const key = String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return key === "wminvoice" || key === "kehewminvoice";
}

export function normalizeKeheWmInvoiceType(value: string | null | undefined) {
  return isKeheWmInvoiceType(value)
    ? KEHE_WM_INVOICE_TYPE
    : String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}
