"use client";

import { createPortal } from "react-dom";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ClipboardList, List, RefreshCw, Search, Upload } from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase/client";
import { businessToday, calculatedShortage, dateLabel, orderDates, orderHealth, materialSchedule, orderRiskReasons, ORDER_STATUSES, poKey, quantityLabel, shortageDiscrepancy, STATUS_COLORS, validateOrder, type Order, type OrderStatus, type SavedOrder } from "@/lib/order-monitoring";
import { dayNumber, fromDay, timelineWindow, timelineStages } from "@/lib/order-monitoring-timeline";
import { parseOrderWorkbook, type ImportResult } from "@/lib/order-monitoring-import";
import OrderMonitoringEditor, { type EditorState, type EditorTab } from "./OrderMonitoringEditor";

import MaterialStatusSelect from "./MaterialStatusSelect";

const fieldClass = "rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-violet-100";
const healthColors = { "On track": "bg-emerald-50 text-emerald-800", "At risk": "bg-amber-50 text-amber-900", Delayed: "bg-red-50 text-red-800", Delivered: "bg-teal-50 text-teal-800" };
const stageColors = ["bg-amber-200 text-amber-950", "bg-violet-200 text-violet-950", "bg-blue-200 text-blue-950", "bg-emerald-200 text-emerald-950"];
function Timeline({ order, start, end }: { order: Order; start: number; end: number }) {
  const width = (end - start + 1) * 30;
  const position = (date: string) => (dayNumber(date) - start) * 30;
  const missing: string[] = [];
  return <div className="relative h-[92px]" style={{ width, backgroundImage: "linear-gradient(to right, #f1f5f9 1px, transparent 1px)", backgroundSize: "30px 100%" }}>
    {timelineStages(order).map((stage, i) => {
      if (stage.na) { missing.push("COA: not applicable"); return null; }
      const a = stage.start || stage.end, b = stage.end || stage.start;
      if (!a || !b) { missing.push(stage.name + ": to confirm"); return null; }
      if (!stage.start || !stage.end) missing.push(stage.name + ": remaining date to confirm");
      const first = Math.min(position(a), position(b)), last = Math.max(position(a), position(b)) + 30;
      if (last <= 0 || first >= width) return null;
      const left = Math.max(0, first), barWidth = Math.min(width, last) - left;
      const point = !stage.start || !stage.end;
      if (point) return null;
      return <div key={stage.name} title={stage.name + ": " + dateLabel(stage.start) + " → " + dateLabel(stage.end)} className={"absolute top-[19px] h-6 truncate rounded-md px-2 text-center text-[11px] font-semibold leading-6 " + stageColors[i] + (point ? " border border-dashed border-current" : "")} style={{ left, width: Math.max(1, barWidth) }}>{stage.name}</div>;
    })}
    {(() => {
      const primary = order.pickupDate;
      const label = "Expected pickup / ship";
      const visible = primary && dayNumber(primary) >= start && dayNumber(primary) <= end;
      return <>
        {visible && <div data-pickup-marker={primary} title={label + ": " + dateLabel(primary)} className="absolute top-[48px] flex items-center gap-2 whitespace-nowrap text-[11px] font-semibold text-indigo-950" style={{ left: position(primary) + 10 }}><span className="h-2.5 w-2.5 rotate-45 bg-indigo-800" /><span className="absolute" style={width - position(primary) < 250 ? { right: 16 } : { left: 16 }}>{label}: {dateLabel(primary).replace(/, \d{4}$/, "")}</span></div>}
        {!primary && <span className="absolute left-3 top-[49px] text-[10px] text-slate-400">Expected pickup / ship: To confirm</span>}
        {primary && dayNumber(primary) < start && <span className="absolute left-3 top-[49px] text-[10px] text-slate-400">No upcoming pickup / ship date</span>}
      </>;
    })()}
    <p className="absolute left-3 top-[68px] truncate text-[9px] text-slate-400" style={{ maxWidth: Math.min(width - 20, 650) }}>{missing.join(" · ")}</p>
  </div>;
}
function Details({ saved, busy, onEdit, onAction, onMaterialStatus }: { saved: SavedOrder; busy: boolean; onEdit: (tab: EditorTab) => void; onAction: (id: string, value: boolean) => void; onMaterialStatus: (id: string, status: string) => void }) {
  const o = saved.order, ready = o.materials.filter(m => calculatedShortage(m) === 0).length;
  const risks = orderRiskReasons(o);
  const coveredIncoming = o.materials.filter(m => !materialSchedule(m, o.productionStart).ready && materialSchedule(m, o.productionStart).covered).length;
  return <div className="grid gap-4 border-t border-slate-200 bg-slate-50/70 p-5 xl:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
    <div className="min-w-0 space-y-4">
      <div className={`rounded-2xl border p-4 text-xs ${risks.length ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}><h3 className="font-bold">{risks.length ? `Why ${orderHealth(o)}` : "Schedule check"}</h3>{risks.length ? <ul className="mt-2 list-disc space-y-1 pl-4">{risks.map((reason, i) => <li key={i}>{reason}</li>)}</ul> : <p className="mt-2">No late material ETA flagged. Unknown arrival or production dates remain To confirm.{coveredIncoming > 0 ? ` ${coveredIncoming} ${coveredIncoming === 1 ? "material has" : "materials have"} sufficient incoming quantities with an ETA on or before production. They remain separate from available stock until received.` : ""}</p>}</div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="mb-4 flex items-start justify-between gap-3"><div><h3 className="font-bold text-slate-900">{o.poNumber} · Material readiness</h3><p className="mt-1 text-xs text-slate-500">{ready} of {o.materials.length} materials have enough available stock. Incoming is not available until received.</p></div><button onClick={() => onEdit("materials")} className="text-xs font-semibold text-violet-700">Edit materials</button></div>
        {o.materials.length ? <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{["WM material", "Required", "Available − reserved", "Incoming", "Shortage", "Supplier PO", "ETA", "Material status"].map(h => <th className="px-3 py-3 font-medium" key={h}>{h}</th>)}</tr></thead><tbody>{o.materials.map(m => <tr className="border-t border-slate-100" key={m.id}><td className="min-w-[180px] px-3 py-3"><div className="font-medium text-slate-800">{m.description || "Description to confirm"}</div><div className="mt-1 text-slate-400">{m.itemNumber || "Item number to confirm"}{m.unit ? ` · ${m.unit}` : ""}</div></td><td className="px-3 py-3">{quantityLabel(m.required, m.unit)}</td><td className="px-3 py-3">{quantityLabel(m.available, m.unit)}</td><td className="px-3 py-3">{quantityLabel(m.incoming, m.unit)}</td><td className={`px-3 py-3 font-medium ${(calculatedShortage(m) ?? 0) > 0 ? "text-amber-800" : "text-slate-700"}`}>{quantityLabel(calculatedShortage(m), m.unit)}{shortageDiscrepancy(m) && <div className="mt-1 text-[10px] text-amber-800">Uploaded: {quantityLabel(m.uploadedShortage, m.unit)} · review recorded</div>}</td><td className="px-3 py-3">{m.supplierPo || "To confirm"}</td><td className="whitespace-nowrap px-3 py-3">{dateLabel(m.eta)}</td><td className="px-3 py-3"><MaterialStatusSelect label={`Material status for ${m.description || m.itemNumber || m.id}`} value={m.status} disabled={busy} onChange={status => onMaterialStatus(m.id, status)} /></td></tr>)}</tbody></table></div> : <p className="py-4 text-sm text-slate-400">No material information saved.</p>}
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="mb-4 flex justify-between"><h3 className="font-bold text-slate-900">Order details</h3><button className="text-xs font-semibold text-violet-700" onClick={() => onEdit("po")}>Edit PO</button></div><dl className="grid gap-x-5 gap-y-4 sm:grid-cols-3">
        {[["Product / SKU", o.product || "To confirm"], ["Order date", dateLabel(o.orderDate)], ["Owner", o.owner || "To confirm"], ["Production start", dateLabel(o.productionStart)], ["Production finish", dateLabel(o.productionFinish)], ["COA required", o.coaRequired === null ? "To confirm" : o.coaRequired ? "Yes" : "Not applicable"], ["COA expected release", o.coaRequired === false ? "Not applicable" : dateLabel(o.coaExpected)], ["COA actual release", o.coaRequired === false ? "Not applicable" : dateLabel(o.coaActual)], ["Pickup / shipment", o.fulfillmentMode || "To confirm"], ["Pickup / ship", dateLabel(o.pickupDate)], ["Required delivery", dateLabel(o.requiredDelivery)], ["Expected delivery / ETA", dateLabel(o.expectedDelivery)], ["Actual delivery", dateLabel(o.actualDelivery)], ["Destination", o.destination || "To confirm"]].map(([label, value]) => <div key={label}><dt className="text-[11px] text-slate-400">{label}</dt><dd className="mt-1 text-xs font-medium text-slate-800">{value}</dd></div>)}
      </dl><div className="mt-4 border-t border-slate-100 pt-3"><p className="text-[11px] text-slate-400">Notes</p><p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{o.notes || "No notes saved."}</p></div>{o.sourceFile && <p className="mt-3 text-[10px] text-slate-400">Imported from {o.sourceFile}</p>}</div>
    </div>
    <div className="h-fit rounded-2xl border border-slate-200 bg-white p-4"><div className="mb-4 flex justify-between"><h3 className="font-bold text-slate-900">Next actions</h3><button onClick={() => onEdit("actions")} className="text-xs font-semibold text-violet-700">Edit actions</button></div>
      {!o.actions.length && <p className="py-3 text-sm text-slate-400">No next actions saved.</p>}
      <div className="space-y-4">{o.actions.map(a => <label key={a.id} className="flex items-start gap-3 text-sm"><input type="checkbox" checked={a.completed} disabled={busy} onChange={e => onAction(a.id, e.target.checked)} className="mt-1 accent-violet-600" /><span><span className={a.completed ? "text-slate-400 line-through" : "text-slate-800"}>{a.description}</span><span className="mt-1 block text-[11px] text-slate-400">{a.owner || "Owner to confirm"} · {dateLabel(a.dueDate)}</span></span></label>)}</div>
      <div className="mt-5 border-t border-slate-100 pt-4"><p className="text-[11px] text-slate-400">Expected pickup / ship date</p><p className="mt-1 text-sm font-bold">{dateLabel(o.pickupDate)}</p></div>
    </div>
  </div>;
}
export default function OrderMonitoringView() {
  const [records, setRecords] = useState<SavedOrder[]>([]), [loading, setLoading] = useState(true), [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState(""), [status, setStatus] = useState("all"), [from, setFrom] = useState(""), [to, setTo] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set()), [menu, setMenu] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });
  const [editor, setEditor] = useState<EditorState | null>(null), [editorError, setEditorError] = useState(""), [saving, setSaving] = useState(false);
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set()), [notice, setNotice] = useState(""), [error, setError] = useState("");
  const [imports, setImports] = useState<ImportResult[]>([]), [importIndex, setImportIndex] = useState(0), [importFile, setImportFile] = useState("");
  const [reading, setReading] = useState(false);
  const [today, setToday] = useState(businessToday);
  const [fulfillment, setFulfillment] = useState("all");
  useEffect(() => { const tick = () => setToday(businessToday()); const timer = window.setInterval(tick, 60000); window.addEventListener("focus", tick); return () => { window.clearInterval(timer); window.removeEventListener("focus", tick); }; }, []);
  const fileInput = useRef<HTMLInputElement>(null), locks = useRef(new Set<string>());
  const api = useCallback(async (method: string, body?: unknown) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Please sign in again.");
    const response = await fetch("/api/order-monitoring", { method, headers: { Authorization: `Bearer ${session.access_token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "The request failed. Please retry.");
    return data as { orders: SavedOrder[]; saved: SavedOrder };
  }, []);
  const load = useCallback(async () => {
    setLoading(true); setLoadError("");
    try { setRecords((await api("GET")).orders); } catch (e) { setLoadError(e instanceof Error ? e.message : "Failed to load orders."); }
    finally { setLoading(false); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!menu) return; const close = () => setMenu(null); const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); }; window.addEventListener("resize", close); document.addEventListener("scroll", close, true); document.addEventListener("click", close); document.addEventListener("keydown", key); return () => { window.removeEventListener("resize", close); document.removeEventListener("scroll", close, true); document.removeEventListener("click", close); document.removeEventListener("keydown", key); }; }, [menu]);
  function replace(saved: SavedOrder) { setRecords(prev => [saved, ...prev.filter(r => poKey(r.order.poNumber) !== poKey(saved.order.poNumber))]); }
  async function immediate(saved: SavedOrder, operation: object) {
    const key = poKey(saved.order.poNumber); if (locks.current.has(key)) return;
    locks.current.add(key); setBusyKeys(new Set(locks.current)); setNotice(""); setError("");
    try { replace((await api("PATCH", { poNumber: saved.order.poNumber, version: saved.version, ...operation })).saved); setNotice(`${saved.order.poNumber} saved.`); }
    catch (e) { setError(e instanceof Error ? e.message : "Save failed. Please retry."); }
    finally { locks.current.delete(key); setBusyKeys(new Set(locks.current)); }
  }
  function edit(saved: SavedOrder, tab: EditorTab) { setMenu(null); setEditorError(""); setEditor({ order: saved.order, originalPo: saved.order.poNumber, version: saved.version, tab }); }
  function preview(result: ImportResult, file: string, currentRecords = records) {
    const existing = currentRecords.find(r => poKey(r.order.poNumber) === poKey(result.order.poNumber));
    let order = structuredClone(result.order);
    if (existing) {
      const imported = Object.fromEntries(Object.entries(order).filter(([key, value]) => !["actions", "materials", "status", "shortageReviewed"].includes(key) && value !== "" && value !== null && value !== undefined));
      order = { ...existing.order, ...imported, materials: order.materials, shortageReviewed: false, sourceFile: file };
      if (order.coaRequired === false) { order.coaExpected = ""; order.coaActual = ""; }
    }
    setEditorError(""); setEditor({ order, originalPo: existing?.order.poNumber, version: existing?.version, tab: "po", importInfo: { sheet: result.sheet, errors: result.errors, warnings: result.warnings, file } });
  }
  async function upload(file?: File) {
    if (!file) return;
    setReading(true); setError(""); setNotice("");
    try {
      if (!/\.xlsx?$/i.test(file.name)) throw new Error("Choose an .xlsx or .xls workbook.");
      if (file.size > 10 * 1024 * 1024) throw new Error("Choose a workbook smaller than 10 MB.");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
      const parsed = parseOrderWorkbook(workbook, file.name);
      setImports(parsed); setImportIndex(0); setImportFile(file.name); preview(parsed[0], file.name);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not read the workbook."); }
    finally { setReading(false); if (fileInput.current) fileInput.current.value = ""; }
  }
  async function save(order: Order, importReviewed: boolean, updateExisting: boolean) {
    if (!editor || saving) return;
    const errors = validateOrder(order);
    if (editor.importInfo && (editor.importInfo.errors.length || editor.importInfo.warnings.length) && !importReviewed) errors.push("Review the import issues before saving.");
    if (editor.importInfo && editor.originalPo && !updateExisting) errors.push("Choose Update existing PO or cancel.");
    if (errors.length) { setEditorError(errors.join("\n")); return; }
    setSaving(true); setEditorError("");
    try {
      const final = { ...order, ...(editor.importInfo ? { importedAt: new Date().toISOString() } : {}) };
      const result = editor.originalPo ? await api("PATCH", { poNumber: editor.originalPo, version: editor.version, operation: "replace", order: final }) : await api("POST", { order: final });
      replace(result.saved); setNotice(`${order.poNumber} ${editor.importInfo ? "imported" : "saved"} successfully.`); setError("");
      if (editor.importInfo && importIndex + 1 < imports.length) { const next = importIndex + 1; setImportIndex(next); setEditor(null); const current = [result.saved, ...records.filter(r => poKey(r.order.poNumber) !== poKey(result.saved.order.poNumber))]; setTimeout(() => preview(imports[next], importFile, current), 0); }
      else { setEditor(null); setImports([]); }
    } catch (e) { setEditorError(e instanceof Error ? e.message : "Save failed. Your edits are still here."); }
    finally { setSaving(false); }
  }
  const filtered = useMemo(() => records.filter(({ order: o }) => {
    if (search && !`${o.poNumber} ${o.customer}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (status !== "all" && o.status !== status) return false;
    if (fulfillment !== "all" && o.fulfillmentMode !== fulfillment) return false;
    if (from || to) { const dates = orderDates(o); if (!dates.length) return false; if (from && dates[dates.length - 1] < from) return false; if (to && dates[0] > to) return false; }
    return true;
  }).sort((a, b) => (a.order.requiredDelivery || a.order.expectedDelivery || "9999").localeCompare(b.order.requiredDelivery || b.order.expectedDelivery || "9999") || a.order.poNumber.localeCompare(b.order.poNumber)), [records, search, status, from, to, fulfillment]);
  const range = useMemo(() => timelineWindow(filtered.map(r => r.order), from, to, today), [filtered, from, to, today]);
  const { days, end } = range;
  const monthGroups: { label: string; count: number }[] = [];
  for (let i = 0; i < days; i++) { const d = fromDay(range.start + i); const label = new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short", year: "numeric" }); const group = monthGroups.at(-1); if (group?.label === label) group.count++; else monthGroups.push({ label, count: 1 }); }
  function toggle(key: string) { setExpanded(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; }); }
  return <div className="space-y-5 text-slate-900">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-3xl font-extrabold tracking-tight">Order Monitoring</h2><p className="mt-1 text-sm text-slate-500">From order confirmation to customer delivery</p></div><div className="flex flex-wrap gap-2">
      <button onClick={() => void load()} disabled={loading || !!editor || busyKeys.size > 0} className={`${fieldClass} disabled:opacity-50`} aria-label="Refresh orders"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></button>
      <button onClick={() => fileInput.current?.click()} disabled={reading || loading || !!loadError} className={`${fieldClass} flex items-center gap-2 disabled:opacity-50`}><Upload className="h-4 w-4" />{reading ? "Reading…" : "Upload Excel"}</button>
      <input ref={fileInput} type="file" accept=".xlsx,.xls" className="hidden" aria-label="Upload Order Monitoring workbook" onChange={e => void upload(e.target.files?.[0])} />
    </div></header>
    {notice && <p role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p>}
    {(error || loadError) && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error || loadError}{loadError && <button onClick={() => void load()} className="ml-3 font-bold underline">Retry</button>}</div>}
    <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4">
      <label className="min-w-[200px] flex-1 text-xs text-slate-500">Search PO or customer<div className="relative mt-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input className={`${fieldClass} w-full pl-9`} value={search} onChange={e => setSearch(e.target.value)} placeholder="PO number or customer…" /></div></label>
      <label className="text-xs text-slate-500">PO status<select className={`${fieldClass} mt-1 block`} value={status} onChange={e => setStatus(e.target.value)}><option value="all">All statuses</option>{ORDER_STATUSES.map(s => <option key={s}>{s}</option>)}</select></label>
      <label className="text-xs text-slate-500">Pickup / shipment<select className={fieldClass + " mt-1 block"} value={fulfillment} onChange={e => setFulfillment(e.target.value)}><option value="all">All</option><option value="Pickup">Pickup</option><option value="Shipment">Shipment</option></select></label>
      <label className="text-xs text-slate-500">From<input min={today} type="date" className={`${fieldClass} mt-1 block`} value={from} onChange={e => setFrom(e.target.value)} /></label><label className="text-xs text-slate-500">Through<input type="date" className={`${fieldClass} mt-1 block`} value={to} min={from && from > today ? from : today} onChange={e => setTo(e.target.value)} /></label>
      {(search || status !== "all" || fulfillment !== "all" || from || to) && <button className="py-2 text-xs font-semibold text-violet-700" onClick={() => { setSearch(""); setStatus("all"); setFrom(""); setTo(""); setFulfillment("all"); }}>Clear filters</button>}
      <p className="w-full text-[10px] text-slate-400">As of {today}. Timeline shows today onward; historical dates remain in order details. At risk only means a needed material has a saved ETA later than production. Arrival on the production date is on time; missing dates remain To confirm.</p>
    </div>
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm" aria-label="Order timeline">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4"><h3 className="text-lg font-bold">Order timeline <span className="ml-2 text-xs font-normal text-slate-400">{filtered.length} orders</span></h3><div className="flex flex-wrap gap-4 text-[10px] text-slate-500">{["Materials", "Production", "COA", "Shipping"].map((label, i) => <span className="flex items-center gap-1" key={label}><span className={`h-2.5 w-2.5 rounded-full ${stageColors[i]}`} />{label}</span>)}<span>◆ Expected pickup / ship date</span></div></div>
      {loading && <div className="p-12 text-center text-sm text-slate-500">Loading saved orders…</div>}
      {!loading && !filtered.length && !loadError && <div className="px-6 py-16 text-center"><ClipboardList className="mx-auto mb-4 h-9 w-9 text-violet-300" /><h4 className="text-lg font-bold">{records.length ? "No matching orders" : "Your order timeline starts here"}</h4><p className="mx-auto mt-2 max-w-md text-sm text-slate-500">{records.length ? "Adjust the search or filters to see your saved orders." : "Upload your monitoring workbook. Materials, production, COA, shipping and delivery will appear as dates are confirmed."}</p></div>}
      {!loading && filtered.length > 0 && <div className="overflow-auto"><div style={{ minWidth: 355 + days * 30 }}>
        <div className="flex border-b border-slate-200 bg-slate-50"><div className="sticky left-0 z-20 flex w-[355px] shrink-0 items-center justify-between border-r border-slate-200 bg-slate-50 px-5 text-[11px] font-semibold text-slate-500"><span>Customer / PO / Cases</span><span>PO status</span></div><div><div className="flex border-b border-slate-200">{monthGroups.map(g => <div key={g.label} className="shrink-0 border-l border-slate-200 px-1 py-1 text-[10px] whitespace-nowrap font-semibold text-slate-600" style={{ width: g.count * 30 }}>{g.label}</div>)}</div><div className="flex">{Array.from({ length: days }, (_, i) => fromDay(range.start + i)).map(date => <div data-timeline-date={date} key={date} className={"w-[30px] shrink-0 border-l border-slate-100 py-2 text-center text-[10px] " + (date === today ? "bg-violet-100 font-bold text-violet-900" : "text-slate-500")}>{date.slice(-2)}</div>)}</div></div></div>

        {filtered.map(saved => { const o = saved.order, key = poKey(o.poNumber), open = expanded.has(key), busy = busyKeys.has(key), health = orderHealth(o, today); return <React.Fragment key={key}>
          <div className={`flex border-b border-slate-100 ${open ? "bg-violet-50/40" : "bg-white"}`}>
            <div className="sticky left-0 z-10 flex w-[355px] shrink-0 items-center gap-2 border-r border-slate-200 bg-white px-4 py-4">
              <button aria-label={`${open ? "Collapse" : "Expand"} ${o.poNumber}`} aria-expanded={open} aria-controls={`order-details-${key}`} onClick={() => toggle(key)} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button>
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold" title={o.customer}>{o.customer}</p><button className="mt-1 text-left text-xs font-medium text-violet-800 hover:underline" onClick={() => toggle(key)} aria-expanded={open}>{o.poNumber}</button><span className="ml-1 text-[10px] text-slate-400">· {quantityLabel(o.cases, "cases")}</span><br /><span title={orderRiskReasons(o).join("\n") || "No late material ETA flagged. Unknown arrival or production dates remain To confirm."} className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[9px] font-semibold ${healthColors[health]}`}>{health}</span></div>
              <div className="grid gap-1"><select aria-label={`Status for ${o.poNumber}`} className={`max-w-[112px] rounded-xl border px-2 py-2 text-[11px] font-semibold ${STATUS_COLORS[o.status as OrderStatus] || ""} disabled:opacity-50`} value={o.status} disabled={busy} onChange={e => void immediate(saved, { operation: "status", status: e.target.value })}>{ORDER_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</select><select aria-label={`Pickup or shipment for ${o.poNumber}`} className="max-w-[112px] rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-600" value={o.fulfillmentMode || ""} disabled={busy} onChange={e => void immediate(saved, { operation: "fulfillment", fulfillmentMode: e.target.value })}><option value="">To confirm</option><option value="Pickup">Pickup</option><option value="Shipment">Shipment</option></select></div>
              <div className="relative"><button aria-label={`Actions for ${o.poNumber}`} aria-haspopup="menu" aria-expanded={menu === key} onClick={e => { e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); setMenuPosition({ left: Math.max(8, Math.min(rect.right - 176, window.innerWidth - 184)), top: rect.bottom + 164 > window.innerHeight ? Math.max(8, rect.top - 160) : rect.bottom + 4 }); setMenu(prev => prev === key ? null : key); }} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"><List className="h-4 w-4" /></button>
                {menu === key && createPortal(<div role="menu" aria-label={`Actions for ${o.poNumber}`} style={menuPosition} className="fixed z-[9999] w-44 rounded-xl border border-slate-200 bg-white py-1 shadow-xl" onClick={e => e.stopPropagation()}>{([['View details', null], ['Edit PO', 'po'], ['Edit materials', 'materials'], ['Edit next actions', 'actions']] as const).map(([label, tab]) => <button key={label} role="menuitem" className="block w-full px-4 py-2 text-left text-xs hover:bg-violet-50 disabled:opacity-50" disabled={busy} onClick={() => { if (tab) edit(saved, tab); else { setExpanded(prev => new Set(prev).add(key)); setMenu(null); } }}>{label}</button>)}</div>, document.body)}
              </div>
            </div><Timeline order={o} start={range.start} end={end} />
          </div>
          {open && <div id={`order-details-${key}`} className="sticky left-0" style={{ maxWidth: "calc(100vw - 100px)" }}><Details saved={saved} busy={busy} onEdit={tab => edit(saved, tab)} onMaterialStatus={(materialId, status) => void immediate(saved, { operation: "material-status", materialId, status })} onAction={(id, completed) => void immediate(saved, { operation: "complete-action", actionId: id, completed })} /></div>}
        </React.Fragment>; })}
      </div></div>}
      {range.truncated && <p className="border-t p-3 text-xs text-slate-500">Showing the first 366 days. Use the date range filters to inspect later milestones.</p>}
    </section>
    {editor && <OrderMonitoringEditor key={`${editor.originalPo || "new"}-${editor.importInfo?.sheet || "manual"}-${importIndex}`} state={editor} saving={saving} error={editorError} onClose={() => { setEditor(null); setImports([]); }} onSave={(o, reviewed, update) => void save(o, reviewed, update)} />}
  </div>;
}
