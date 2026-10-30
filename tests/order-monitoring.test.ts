import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { blankMaterial, blankOrder, calculatedShortage, shortageDiscrepancy, validateOrder, orderHealth, orderRiskReasons, materialSchedule, validDate, poKey } from "../lib/order-monitoring";
import { timelineWindow, timelineStages, fromDay } from "../lib/order-monitoring-timeline";
import { parseOrderWorkbook, parseQuantity, parseExcelDate } from "../lib/order-monitoring-import";

const headers = ["WM material", "Required", "Available - Reserved", "Incoming", "Shortage", "PO", "ETA", "Status"];
function workbook(rows: unknown[][], date1904 = false) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Order");
  wb.Workbook = { WBProps: { date1904 } };
  return wb;
}
test("section-layout import preserves descriptions, item numbers, units, supplier PO and blanks", () => {
  const wb = workbook([["PO number", "PO-UNIT-1"], ["Cases", "306 cases"], ["Production date", "11/06/2026"], ["COA required", "Yes"], ["Pickup date", 46339], [], headers,
    ["Graham Crumbs ITM-10126", "167.62 LB", "100 LB", "100 LB", "0 LB", "PO-SUPPLIER", "11/05/2026", "Pending"],
    ["Case labels", "306 cases", "306 cases", null, "0 cases", null, null, "Ready"]]);
  const { order, errors } = parseOrderWorkbook(wb, "fixture.xlsx")[0];
  assert.deepEqual(errors, []); assert.equal(order.poNumber, "PO-UNIT-1"); assert.equal(order.cases, 306);
  assert.equal(order.productionStart, "2026-11-06"); assert.equal(order.productionFinish, ""); assert.equal(order.coaRequired, true);
  assert.equal(order.materials[0].itemNumber, "ITM-10126"); assert.equal(order.materials[0].description, "Graham Crumbs ITM-10126");
  assert.equal(order.materials[0].supplierPo, "PO-SUPPLIER"); assert.equal(order.materials[0].unit, "LB");
  assert.equal(calculatedShortage(order.materials[0]), 67.62); assert.equal(shortageDiscrepancy(order.materials[0]), true);
  assert.equal(order.materials[1].incoming, null); assert.equal(order.materials[1].eta, "");
  assert.equal(order.customer, ""); assert.equal(order.status, ""); assert.equal(order.materials[0].sourceValues?.required, "167.62 LB");
});
test("horizontal metadata, multiple sheets, dates and mixed units are handled explicitly", () => {
  const wb = workbook([["PO", "Cases", "Production date", "COA required", "Pickup date"], ["PO-2", 12, "2026-11-01", "No", null], headers, ["Lids", 12, 0, null, 12, "SUP-2", null, null]]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["PO number", "PO-3"], ["Cases", 5], headers, ["Bases", "2 LB", "1 CS"]]), "Other");
  const result = parseOrderWorkbook(wb, "fixture.xlsx"); assert.equal(result.length, 2);
  assert.equal(result[0].order.poNumber, "PO-2"); assert.equal(result[0].order.cases, 12); assert.equal(result[0].order.coaRequired, false);
  assert.ok(result[1].errors.some(e => e.includes("mixed quantity units")));
  assert.equal(parseExcelDate(1, true).date, "1904-01-02"); assert.equal(parseExcelDate(1).date, "1900-01-01");
  assert.ok(parseExcelDate("02/30/2026").error); assert.ok(parseExcelDate("11/5").error);
  assert.equal(parseExcelDate(null).date, ""); assert.equal(parseQuantity("1,234.50 LB").quantity, 1234.5);
  assert.equal(parseQuantity("-").quantity, null); assert.ok(parseQuantity("1.2.3 LB").error);
});
test("unknown quantities stay unknown and incoming stock never satisfies a shortage", () => {
  const m = { ...blankMaterial(), description: "Material", required: 100, available: null, incoming: 200 };
  assert.equal(calculatedShortage(m), null);
  assert.equal(calculatedShortage({ ...m, available: 20 }), 80);
  assert.equal(calculatedShortage({ ...m, available: -5 }), 105);
  assert.equal(calculatedShortage({ ...m, available: 120 }), 0);
});
test("validation requires order identity and valid quantities, preserves unknown dates, and flags discrepancies", () => {
  const order = { ...blankOrder(), poNumber: "PO-TEST", customer: "QA", cases: 10 };
  assert.deepEqual(validateOrder(order), []); assert.equal(validDate("2026-02-30"), false);
  assert.ok(validateOrder({ ...order, cases: 0 }).length); assert.ok(validateOrder({ ...order, customer: "" }).length);
  assert.ok(validateOrder({ ...order, productionStart: "2026-11-10", productionFinish: "2026-11-09" }).length);
  const material = { ...blankMaterial(), description: "Lids", required: 100, available: 50, uploadedShortage: 0 };
  assert.ok(validateOrder({ ...order, materials: [material] }).some(e => e.includes("discrepancies")));
  assert.deepEqual(validateOrder({ ...order, materials: [material], shortageReviewed: true }), []);
  assert.equal(poKey(" po-123 "), poKey("PO-123"));
});
test("risk and delivery distinguish PO status, material shortages and required vs expected dates", () => {
  const o = { ...blankOrder(), requiredDelivery: "2026-11-05", expectedDelivery: "2026-11-06" };
  assert.equal(orderHealth(o, "2026-10-30"), "At risk");
  assert.equal(orderHealth({ ...o, status: "In transit" }, "2026-11-07"), "Delayed");
  assert.equal(orderHealth({ ...o, status: "Delivered" }, "2026-11-07"), "Delivered");
  assert.equal(orderHealth({ ...o, expectedDelivery: "2026-11-04" }, "2026-10-30"), "On track");
});
test("scheduled incoming can cover production without becoming available stock", () => {
  const material = { ...blankMaterial(), description: "Lids", required: 100, available: 25, incoming: 75, eta: "2026-11-05" };
  const order = { ...blankOrder(), productionStart: "2026-11-06", materials: [material] };
  assert.equal(calculatedShortage(material), 75);
  assert.equal(materialSchedule(material, order.productionStart, "2026-10-30").ready, false);
  assert.equal(materialSchedule(material, order.productionStart, "2026-10-30").covered, true);
  assert.equal(orderHealth(order, "2026-10-30"), "On track");
  assert.ok(orderRiskReasons({ ...order, materials: [{ ...material, incoming: 74 }] }, "2026-10-30")[0].includes("does not cover"));
  assert.ok(orderRiskReasons({ ...order, materials: [{ ...material, eta: "2026-11-07" }] }, "2026-10-30")[0].includes("after production"));
  assert.ok(orderRiskReasons(order, "2026-11-06")[0].includes("has passed"));
  assert.ok(orderRiskReasons({ ...order, materials: [{ ...material, eta: "" }] }, "2026-10-30")[0].includes("ETA is to confirm"));
  assert.ok(orderRiskReasons({ ...order, materials: [{ ...material, status: "Unconfirmed" }] }, "2026-10-30")[0].includes("Unconfirmed"));
});
test("timeline always excludes past columns while preserving historical order dates", () => {
  const order = { ...blankOrder(), orderDate: "2026-10-19", productionStart: "2026-11-10", expectedDelivery: "2026-12-07" };
  const range = timelineWindow([order], "", "", "2026-10-30");
  assert.equal(fromDay(range.start), "2026-10-30"); assert.equal(order.orderDate, "2026-10-19");
  assert.equal(fromDay(timelineWindow([order], "2026-10-01", "", "2026-10-30").start), "2026-10-30");
  assert.equal(fromDay(timelineWindow([order], "2026-11-02", "", "2026-10-30").start), "2026-11-02");
  assert.equal(fromDay(timelineWindow([order], "", "", "2026-10-31").start), "2026-10-31");
  const pickup = { ...order, fulfillmentMode: "Pickup" as const, pickupDate: "2026-11-12" };
  const stage = timelineStages(pickup).at(-1)!; assert.equal(stage.name, "Pickup"); assert.equal(stage.end, pickup.pickupDate);
  assert.equal(timelineStages({ ...pickup, coaRequired: false })[2].na, true);
  assert.ok(validateOrder({ ...blankOrder(), poNumber: "PO-1", customer: "QA", cases: 1, fulfillmentMode: "Pickup" }).length === 0);
});
