import { businessToday, orderDates, type Order } from "./order-monitoring";

export const dayNumber = (s: string) => new Date(s + "T00:00:00Z").getTime() / 86400000;
export const fromDay = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);
export function timelineWindow(orders: Order[], from = "", through = "", today = businessToday()) {
  const start = dayNumber(from && from > today ? from : today);
  const dates = orders.flatMap(orderDates).filter(d => dayNumber(d) >= start).sort();
  const desiredEnd = through ? Math.max(start, dayNumber(through)) : Math.max(start + 29, dayNumber(dates.at(-1) || fromDay(start + 29)) + 1);
  const end = Math.min(start + 365, desiredEnd);
  return { start, end, days: end - start + 1, truncated: desiredEnd > end };
}
export function timelineStages(o: Order) {
  const knownEtas = o.materials.map(m => m.eta).filter(Boolean).sort();
  return [
    { name: "Materials", start: o.orderDate, end: knownEtas.at(-1) || "", na: false },
    { name: "Production", start: o.productionStart, end: o.productionFinish, na: false },
    { name: "COA", start: o.coaRequired === true ? o.productionFinish : "", end: o.coaActual || o.coaExpected, na: o.coaRequired === false },
    { name: o.fulfillmentMode === "Pickup" ? "Pickup" : "Shipping", start: o.pickupDate, end: o.pickupDate, na: false },
  ];
}
