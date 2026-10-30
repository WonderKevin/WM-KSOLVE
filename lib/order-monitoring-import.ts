import productReferences from "./order-monitoring-products.json";
import * as XLSX from "xlsx";
import { blankMaterial, blankOrder, validDate, type Order } from "./order-monitoring";

export type ImportResult = { order: Order; errors: string[]; warnings: string[]; sheet: string };
const text = (v: unknown) => String(v ?? "").replace(/\u00a0/g, " ").trim();
const unknownValue = (v: unknown) => /^(?:unknown|tbc|to confirm|not recorded|not specified|n\/?a|—|-)$/i.test(text(v));
const key = (v: unknown) => text(v).toLowerCase().replace(/[^a-z0-9]/g, "");
export function parseQuantity(value: unknown): { quantity: number | null; unit: string; error?: string } {
  const raw = text(value);
  if (!raw || unknownValue(raw)) return { quantity: null, unit: "" };
  const match = raw.match(/^([-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|[-+]?\.\d+)\s*([a-zA-Z][a-zA-Z\s/.-]*)?$/);
  if (!match) return { quantity: null, unit: "", error: `Invalid quantity: ${raw}` };
  return { quantity: Number(match[1].replace(/,/g, "")), unit: text(match[2]) };
}
export function parseExcelDate(value: unknown, date1904 = false): { date: string; error?: string } {
  if (value === null || value === undefined || text(value) === "" || unknownValue(value)) return { date: "" };
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value, { date1904 });
    const date = parsed ? `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}` : "";
    return validDate(date) ? { date } : { date: "", error: `Invalid Excel date: ${value}` };
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) return { date: value.toISOString().slice(0, 10) };
  const raw = text(value);
  if (validDate(raw)) return { date: raw };
  const m = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (m) {
    const date = `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    if (validDate(date)) return { date };
  }
  const named = raw.match(/^(?:([A-Za-z]+)\s+(\d{1,2})|(\d{1,2})\s+([A-Za-z]+)),?\s+(\d{4})$/);
  if (named) {
    const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf((named[1] || named[4]).slice(0, 3).toLowerCase()) + 1;
    const date = `${named[5]}-${String(month).padStart(2, "0")}-${(named[2] || named[3]).padStart(2, "0")}`;
    if (validDate(date)) return { date };
  }
  return { date: "", error: `Invalid or ambiguous date: ${raw}. Use MM/DD/YYYY or YYYY-MM-DD.` };
}
const aliases: Record<string, string[]> = {
  poNumber: ["po", "ponumber", "productionpo", "customerpo", "purchaseorder", "purchaseordernumber"],
  orderDate: ["orderdate"],
  cases: ["cases", "totalcases", "quantitycases"], productionStart: ["productiondate", "productionstart"],
  productionFinish: ["productionfinish", "productionend"], coaRequired: ["coarequired", "coa"],
  pickupDate: ["pickupdate", "pickup", "shipdate", "expectedpickupshipdate", "expectedpickupdate", "expectedshipdate", "expectedpickupshipmentdate"], customer: ["customer", "customername"], product: ["product", "sku", "productsku"],
};
export function parseOrderWorkbook(workbook: XLSX.WorkBook, sourceFile: string): ImportResult[] {
  const results: ImportResult[] = [];
  for (const sheet of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheet], { header: 1, raw: true, defval: null });
    const headerIndex = rows.findIndex(row => row.some(v => key(v) === "wmmaterial") && row.some(v => key(v) === "required"));
    if (headerIndex < 0) continue;
    const errors: string[] = [], warnings: string[] = [], order = blankOrder();
    order.status = ""; order.sourceFile = sourceFile;
    const meta = rows.slice(0, headerIndex);
    const date1904 = !!workbook.Workbook?.WBProps?.date1904;
    for (const [field, labels] of Object.entries(aliases)) {
      let value: unknown;
      for (let r = 0; r < meta.length; r++) {
        const c = meta[r].findIndex(cell => labels.includes(key(cell)));
        if (c < 0) continue;
        // Support both label/value pairs and a horizontal PO header + value row.
        const right = meta[r].slice(c + 1).find(v => text(v) !== "");
        const rightIsLabel = Object.values(aliases).some(keys => keys.includes(key(right)));
        const below = meta[r + 1]?.[c];
        const belowIsLabel = Object.values(aliases).some(keys => keys.includes(key(below)));
        value = right !== undefined && !rightIsLabel ? right : belowIsLabel ? undefined : below;
        break;
      }
      if (value === undefined || value === null) continue;
      if (field === "cases") {
        const parsed = parseQuantity(value); order.cases = parsed.quantity;
        if (parsed.error) errors.push(`Cases: ${parsed.error}`);
        if (parsed.unit && !/^cases?$/i.test(parsed.unit)) errors.push(`Cases must be in cases, not ${parsed.unit}.`);
      } else if (["orderDate", "productionStart", "productionFinish", "pickupDate"].includes(field)) {
        const parsed = parseExcelDate(value, date1904);
        (order as unknown as Record<string, unknown>)[field] = parsed.date;
        if (parsed.error) errors.push(`${field}: ${parsed.error}`);
      } else if (field === "coaRequired") {
        const v = key(value);
        order.coaRequired = ["yes", "true", "required", "1"].includes(v) ? true : ["no", "false", "notrequired", "0", "na"].includes(v) ? false : null;
        if (v && !unknownValue(value) && order.coaRequired === null) errors.push(`Invalid COA required: ${text(value)}`);
      } else (order as unknown as Record<string, unknown>)[field] = text(value);
    }
    const productReference = productReferences[order.poNumber.trim().toUpperCase() as keyof typeof productReferences];
    if (!order.product && productReference) order.product = `${productReference.itemNumber} · ${productReference.description}`;
    const headers = rows[headerIndex];
    const index = (names: string[]) => headers.findIndex(h => names.includes(key(h)));
    const col = { description: index(["wmmaterial"]), required: index(["required"]), available: index(["availablereserved", "availableafterreservations", "available", "availableqty", "availablequantity", "availableminusreserved", "availablereservedqty", "availablereservedquantity"]), incoming: index(["incoming", "incomingqty", "incomingquantity", "incomingstock"]), shortage: index(["shortage"]), supplierPo: index(["po", "supplierpo"]), eta: index(["eta"]), status: index(["status"]), itemNumber: index(["itemnumber", "item", "sku"]), unit: index(["unit", "uom"]) };
    for (const [name, i] of Object.entries(col)) if (i < 0 && !["itemNumber", "unit"].includes(name)) errors.push(`Missing material column: ${name}.`);
    for (let r = headerIndex + 1; r < rows.length; r++) {
      const row = rows[r]; if (row.every(v => !text(v))) continue;
      if (/^(?:total|totals|notes|next actions)$/i.test(text(row[col.description]))) break;
      const m = blankMaterial(); m.description = text(row[col.description]); m.itemNumber = text(row[col.itemNumber]); m.unit = text(row[col.unit]);
      if (!m.description && !m.itemNumber) { warnings.push(`Sheet ${sheet}, row ${r + 1}: no material description; row skipped.`); continue; }
      m.itemNumber ||= m.description.match(/\bITM-\d+\b/i)?.[0] || "";
      m.sourceValues = {};
      const units = new Set<string>();
      if (m.unit) units.add(m.unit.toUpperCase().replace(/^CASES?$/, "CS").replace(/^LBS?$/, "LB"));
      for (const [column, field] of [["required", "required"], ["available", "available"], ["incoming", "incoming"], ["shortage", "uploadedShortage"]] as const) {
        const raw = row[col[column]], parsed = parseQuantity(raw); m[field] = parsed.quantity;
        m.sourceValues[column] = text(raw);
        if (parsed.error) errors.push(`Row ${r + 1}, ${column}: ${parsed.error}`);
        if (parsed.unit) units.add(parsed.unit.toUpperCase().replace(/^CASES?$/, "CS").replace(/^LBS?$/, "LB"));
      }
      if (units.size > 1) errors.push(`Row ${r + 1}: mixed quantity units (${[...units].join(", ")}); review before importing.`);
      m.unit ||= [...units][0] || "";
      m.supplierPo = /^to\s*confirm$/i.test(text(row[col.supplierPo])) ? "" : text(row[col.supplierPo]); m.status = text(row[col.status]);
      const eta = parseExcelDate(row[col.eta], date1904); m.eta = eta.date;
      if (eta.error) errors.push(`Row ${r + 1}, ETA: ${eta.error}`);
      order.materials.push(m);
    }
    results.push({ order, errors, warnings, sheet });
  }
  if (!results.length) throw new Error('No materials table found. The workbook must contain "WM material" and "Required" headers below its PO information.');
  return results;
}

// Source-file findings must not remain blockers after the preview has been corrected.
export function importReviewIssues(info: Pick<ImportResult, "errors" | "warnings">, order: Order): string[] {
  return [...info.errors, ...info.warnings].filter(issue => {
    const field = issue.match(/^(orderDate|productionStart|productionFinish|pickupDate):/)?.[1];
    if (field && validDate(order[field as "orderDate" | "productionStart" | "productionFinish" | "pickupDate"])) return false;
    if (issue.startsWith("Invalid COA required:") && typeof order.coaRequired === "boolean") return false;
    if (issue.startsWith("Cases:") && order.cases !== null && Number.isFinite(order.cases) && order.cases > 0) return false;
    const missing = issue.match(/^Missing material column: (\w+)\./)?.[1];
    if (missing && order.materials.length) {
      const fields: Record<string, keyof Order["materials"][number]> = { required: "required", available: "available", incoming: "incoming", shortage: "uploadedShortage", supplierPo: "supplierPo", eta: "eta", status: "status", description: "description" };
      const target = fields[missing];
      if (target && order.materials.every(m => m[target] !== null && m[target] !== "" && m[target] !== undefined)) return false;
    }
    return true;
  });
}
