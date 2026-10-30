export const ORDER_STATUSES = ["Sent", "Confirmed", "Delayed", "In transit", "Delivered"] as const;
export type OrderStatus = typeof ORDER_STATUSES[number];
export const STATUS_COLORS: Record<OrderStatus, string> = {
  Sent: "bg-slate-100 text-slate-700 border-slate-200",
  Confirmed: "bg-emerald-50 text-emerald-800 border-emerald-200",
  Delayed: "bg-red-50 text-red-800 border-red-200",
  "In transit": "bg-sky-50 text-sky-800 border-sky-200",
  Delivered: "bg-teal-50 text-teal-800 border-teal-200",
};
export type Material = {
  id: string; description: string; itemNumber: string; unit: string;
  required: number | null; available: number | null; incoming: number | null;
  uploadedShortage: number | null; supplierPo: string; eta: string; status: string;
  sourceValues?: Record<string, string>;
};
export type NextAction = { id: string; description: string; owner: string; dueDate: string; completed: boolean };
export type Order = {
  fulfillmentMode?: "Pickup" | "Shipment" | "";
  poNumber: string; customer: string; product: string; cases: number | null;
  orderDate: string; status: OrderStatus | ""; productionStart: string; productionFinish: string;
  coaRequired: boolean | null; coaExpected: string; coaActual: string; pickupDate: string;
  requiredDelivery: string; expectedDelivery: string; actualDelivery: string;
  destination: string; owner: string; notes: string; materials: Material[]; actions: NextAction[];
  sourceFile?: string; importedAt?: string; shortageReviewed?: boolean;
};
export type SavedOrder = { order: Order; version: number; updatedAt: string };
export const DATE_FIELDS = ["orderDate", "productionStart", "productionFinish", "coaExpected", "coaActual", "pickupDate", "requiredDelivery", "expectedDelivery", "actualDelivery"] as const;
export function blankOrder(): Order {
  return { poNumber: "", customer: "", product: "", cases: null, orderDate: "", status: "Sent", productionStart: "", productionFinish: "", coaRequired: null, coaExpected: "", coaActual: "", pickupDate: "", requiredDelivery: "", expectedDelivery: "", actualDelivery: "", destination: "", owner: "", notes: "", materials: [], actions: [] };
}
export function blankMaterial(): Material {
  return { id: crypto.randomUUID(), description: "", itemNumber: "", unit: "", required: null, available: null, incoming: null, uploadedShortage: null, supplierPo: "", eta: "", status: "" };
}
export function poKey(value: string) { return value.trim().toUpperCase().replace(/\s+/g, ""); }
export function calculatedShortage(m: Material): number | null {
  return m.required === null || m.available === null ? null : Math.max(0, Number((m.required - m.available).toFixed(6)));
}
export function shortageDiscrepancy(m: Material) {
  const calculated = calculatedShortage(m);
  return calculated !== null && m.uploadedShortage !== null && Math.abs(calculated - m.uploadedShortage) > 0.00001;
}
export function hasSupplierPo(m: Material) {
  return !!m.supplierPo.trim() && !/^to\s*confirm$/i.test(m.supplierPo.trim());
}
export function materialRows(materials: Material[], showAll = false) {
  return materials.filter(m => showAll || calculatedShortage(m) !== 0 || hasSupplierPo(m) || shortageDiscrepancy(m))
    .sort((a, b) => Number((calculatedShortage(b) ?? 0) > 0 || hasSupplierPo(b)) - Number((calculatedShortage(a) ?? 0) > 0 || hasSupplierPo(a)));
}
export function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
export function validateOrder(o: Order): string[] {
  const errors: string[] = [];
  if (!o.poNumber.trim()) errors.push("PO number is required.");
  if (!o.customer.trim()) errors.push("Customer is required.");
  if (o.cases === null || !Number.isFinite(o.cases) || o.cases <= 0) errors.push("Cases must be greater than zero.");
  if (!ORDER_STATUSES.includes(o.status as OrderStatus)) errors.push("Select a PO status.");
  if (o.fulfillmentMode !== undefined && !["", "Pickup", "Shipment"].includes(o.fulfillmentMode)) errors.push("Choose Pickup or Shipment.");
  for (const field of DATE_FIELDS) if (o[field] && !validDate(o[field])) errors.push(`Invalid ${field} date.`);
  if (o.productionStart && o.productionFinish && o.productionFinish < o.productionStart) errors.push("Production finish cannot precede production start.");
  if (o.coaRequired !== null && typeof o.coaRequired !== "boolean") errors.push("Invalid COA required value.");
  if ((o.coaExpected || o.coaActual) && o.coaRequired === false) errors.push("Clear COA dates when COA is not required.");
  for (const [i, m] of o.materials.entries()) {
    if (!m.description.trim() && !m.itemNumber.trim()) errors.push(`Material ${i + 1}: description or item number is required.`);
    for (const field of ["required", "available", "incoming", "uploadedShortage"] as const) {
      const n = m[field];
      if (n !== null && (!Number.isFinite(n) || (field !== "available" && n < 0))) errors.push(`Material ${i + 1}: invalid ${field} quantity.`);
    }
    if (m.eta && !validDate(m.eta)) errors.push(`Material ${i + 1}: invalid ETA.`);
  }
  for (const [i, a] of o.actions.entries()) {
    if (!a.description.trim()) errors.push(`Action ${i + 1}: description is required.`);
    if (a.dueDate && !validDate(a.dueDate)) errors.push(`Action ${i + 1}: invalid due date.`);
  }
  if (o.materials.some(shortageDiscrepancy) && !o.shortageReviewed) errors.push("Review and acknowledge the uploaded shortage discrepancies.");
  return errors;
}
export function businessToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
export function materialSchedule(m: Material, productionStart: string, today = businessToday()): { ready: boolean; covered: boolean; reason: string } {
  const shortage = calculatedShortage(m), name = m.description || m.itemNumber || "Material";
  if (shortage === 0) return { ready: true, covered: true, reason: "Available stock covers required quantity." };
  if (shortage === null) return { ready: false, covered: false, reason: `${name}: required or available quantity is unknown.` };
  if (m.incoming === null || m.incoming < shortage) return { ready: false, covered: false, reason: `${name}: ${quantityLabel(shortage, m.unit)} short in stock; incoming ${quantityLabel(m.incoming, m.unit)} does not cover it.` };
  if (!m.eta) return { ready: false, covered: false, reason: `${name}: incoming stock covers the shortage, but its ETA is to confirm.` };
  if (m.eta < today) return { ready: false, covered: false, reason: `${name}: incoming ETA ${dateLabel(m.eta)} has passed and saved available stock is still short.` };
  if (!productionStart) return { ready: false, covered: false, reason: `${name}: incoming is expected ${dateLabel(m.eta)}; production start is needed to check coverage.` };
  if (m.eta > productionStart) return { ready: false, covered: false, reason: `${name}: incoming ETA ${dateLabel(m.eta)} is after production starts ${dateLabel(productionStart)}.` };
  if (/\b(?:delayed|overdue|unconfirmed)\b/i.test(m.status)) return { ready: false, covered: false, reason: `${name}: material status is ${m.status}.` };
  return { ready: false, covered: true, reason: `${name}: incoming covers the stock shortage by production (${dateLabel(m.eta)}); not yet available stock.` };
}
export function orderRiskReasons(o: Order): string[] {
  if (o.status === "Delivered" || !o.productionStart) return [];
  const reasons: string[] = [];
  for (const m of o.materials) {
    // Already-available materials do not depend on a later replenishment.
    // Unknown ETAs stay To confirm; only a known arrival after production flags risk.
    if (calculatedShortage(m) !== 0 && m.eta && m.eta > o.productionStart) {
      reasons.push(`${m.description || m.itemNumber || "Material"}: ETA ${dateLabel(m.eta)} is after the production date ${dateLabel(o.productionStart)}.`);
    }
  }
  return reasons;
}
export function orderHealth(o: Order, today = businessToday()): "Delivered" | "Delayed" | "At risk" | "On track" {
  if (o.status === "Delivered") return "Delivered";
  if (o.status === "Delayed" || (!o.actualDelivery && !!o.expectedDelivery && o.expectedDelivery < today)) return "Delayed";
  if (orderRiskReasons(o).length) return "At risk";
  return "On track";
}
export function orderDates(o: Order) {
  return [...DATE_FIELDS.filter(f => o.coaRequired !== false || !["coaExpected", "coaActual"].includes(f)).map(f => o[f]), ...o.materials.map(m => m.eta)].filter(Boolean).sort();
}
export function dateLabel(value: string) {
  return value ? new Date(value + "T00:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }) : "To confirm";
}
export function quantityLabel(value: number | null, unit = "") { return value === null ? "Unknown" : `${value.toLocaleString("en-US", { maximumFractionDigits: 6 })}${unit ? " " + unit : ""}`; }
