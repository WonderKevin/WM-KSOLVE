"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, ClipboardList, List, Plus, RefreshCw, Search, Upload } from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase/client";
import { blankOrder, businessToday, calculatedShortage, dateLabel, orderDates, orderHealth, ORDER_STATUSES, poKey, quantityLabel, shortageDiscrepancy, STATUS_COLORS, validateOrder, type Order, type OrderStatus, type SavedOrder } from "@/lib/order-monitoring";
import { parseOrderWorkbook, type ImportResult } from "@/lib/order-monitoring-import";
import OrderMonitoringEditor, { type EditorState, type EditorTab } from "./OrderMonitoringEditor";

const fieldClass = "rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-violet-100";
const dayMs = 86400000;
const dayNumber = (s: string) => new Date(s + "T00:00:00Z").getTime() / dayMs;
const fromDay = (n: number) => new Date(n * dayMs).toISOString().slice(0, 10);
const healthColors = { "On track": "bg-emerald-50 text-emerald-800", "At risk": "bg-amber-50 text-amber-900", Delayed: "bg-red-50 text-red-800", Delivered: "bg-teal-50 text-teal-800" };
const stageColors = ["bg-amber-200 text-amber-950", "bg-violet-200 text-violet-950", "bg-blue-200 text-blue-950", "bg-emerald-200 text-emerald-950"];
function stages(o: Order) {
  const knownEtas = o.materials.map(m => m.eta).filter(Boolean).sort();
  const materialReady = o.materials.length > 0 && o.materials.every(m => calculatedShortage(m) === 0);
  return [
    { name: "Materials", start: o.orderDate, end: knownEtas.at(-1) || "", note: materialReady ? "Ready from saved stock" : "Readiness to confirm" },
    { name: "Production", start: o.productionStart, end: o.productionFinish, note: "To confirm" },
    { name: "COA", start: o.coaExpected, end: o.coaActual, note: o.coaRequired === false ? "Not applicable" : "To confirm", na: o.coaRequired === false },
    { name: "Shipping", start: o.pickupDate, end: o.actualDelivery || o.expectedDelivery, note: "To confirm" },
  ];
}
function Timeline({ order, start, end }: { order: Order; start: number; end: number }) {
  const width = (end - start + 1) * 30;
  const position = (date: string) => (dayNumber(date) - start) * 30 + 15;
  return <div className="relative h-[154px]" style={{ width, backgroundImage: "linear-gradient(to right, #f1f5f9 1px, transparent 1px)", backgroundSize: "30px 100%" }}>
    {stages(order).map((stage, i) => {
      if (stage.na) return <div key={stage.name} className="absolute left-3 text-[10px] text-slate-400" style={{ top: i * 23 + 5 }}>COA · Not applicable</div>;
      const a = stage.start || stage.end, b = stage.end || stage.start;
      if (!a || !b) return <div key={stage.name} className="absolute left-3 text-[10px] text-slate-400" style={{ top: i * 23 + 5 }}>{stage.name} · {stage.note}</div>;
      const left = position(a), right = position(b);
      if (Math.max(left, right) < 0 || Math.min(left, right) > width) return null;
      const x = Math.max(0, Math.min(left, right)), w = Math.max(20, Math.min(width, Math.max(left, right)) - x);
      const hasBoth = !!stage.start && !!stage.end;
      if (!hasBoth) return <div key={stage.name} title={`${stage.name}: ${dateLabel(a)}; remaining date to confirm`} className="absolute flex items-center gap-1 whitespace-nowrap text-[10px] text-slate-500" style={{ left: Math.min(x, Math.max(0, width - 160)), top: i * 23 + 5 }}><span className={`h-2 w-2 rounded-full ${stageColors[i]}`} />{stage.name} · To confirm</div>;
      return <div key={stage.name} title={`${stage.name}: ${dateLabel(stage.start)} → ${dateLabel(stage.end)}`} className={`absolute truncate rounded-md px-2 text-[10px] font-semibold leading-[19px] ${stageColors[i]} ${hasBoth ? "" : "border border-dashed border-current"}`} style={{ left: Math.min(x, width - 20), top: i * 23 + 3, width: w }}>{stage.name}{hasBoth ? "" : " · To confirm"}</div>;
    })}
    {[[order.requiredDelivery, "Required", "border-violet-700 bg-white"], [order.expectedDelivery, "Expected", "border-indigo-700 bg-indigo-700"], [order.actualDelivery, "Actual", "border-emerald-700 bg-emerald-700"]].map(([date, label, color], i) => date && dayNumber(date) >= start && dayNumber(date) <= end ? <div key={label} title={`${label} delivery: ${dateLabel(date)}`} className="absolute flex items-center gap-1 whitespace-nowrap text-[10px] text-slate-600" style={{ top: 100 + i * 16, left: Math.max(4, Math.min(width - 90, position(date))) }}><span className={`inline-block h-2.5 w-2.5 rotate-45 border-2 ${color}`} />{label} {date.slice(5)}</div> : null)}
    {!order.requiredDelivery && !order.expectedDelivery && !order.actualDelivery && <span className="absolute left-3 top-[101px] text-[10px] text-slate-400">Delivery · To confirm</span>}
  </div>;
}
function Details({ saved, busy, onEdit, onAction }: { saved: SavedOrder; busy: boolean; onEdit: (tab: EditorTab) => void; onAction: (id: string, value: boolean) => void }) {
  const o = saved.order, ready = o.materials.filter(m => calculatedShortage(m) === 0).length;
  return <div className="grid gap-4 border-t border-slate-200 bg-slate-50/70 p-5 xl:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
    <div className="min-w-0 space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="mb-4 flex items-start justify-between gap-3"><div><h3 className="font-bold text-slate-900">{o.poNumber} · Material readiness</h3><p className="mt-1 text-xs text-slate-500">{ready} of {o.materials.length} materials have enough available stock. Incoming is not available until received.</p></div><button onClick={() => onEdit("materials")} className="text-xs font-semibold text-violet-700">Edit materials</button></div>
        {o.materials.length ? <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{["WM material", "Required", "Available − reserved", "Incoming", "Shortage", "Supplier PO", "ETA", "Material status"].map(h => <th className="px-3 py-3 font-medium" key={h}>{h}</th>)}</tr></thead><tbody>{o.materials.map(m => <tr className="border-t border-slate-100" key={m.id}><td className="min-w-[180px] px-3 py-3"><div className="font-medium text-slate-800">{m.description || "Description to confirm"}</div><div className="mt-1 text-slate-400">{m.itemNumber || "Item number to confirm"}{m.unit ? ` · ${m.unit}` : ""}</div></td><td className="px-3 py-3">{quantityLabel(m.required, m.unit)}</td><td className="px-3 py-3">{quantityLabel(m.available, m.unit)}</td><td className="px-3 py-3">{quantityLabel(m.incoming, m.unit)}</td><td className={`px-3 py-3 font-medium ${(calculatedShortage(m) ?? 0) > 0 ? "text-amber-800" : "text-slate-700"}`}>{quantityLabel(calculatedShortage(m), m.unit)}{shortageDiscrepancy(m) && <div className="mt-1 text-[10px] text-amber-800">Uploaded: {quantityLabel(m.uploadedShortage, m.unit)} · review recorded</div>}</td><td className="px-3 py-3">{m.supplierPo || "To confirm"}</td><td className="whitespace-nowrap px-3 py-3">{dateLabel(m.eta)}</td><td className="px-3 py-3"><span className={`inline-flex rounded-full px-2 py-1 ${calculatedShortage(m) === 0 ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>{m.status || (calculatedShortage(m) === 0 ? "Ready" : "To confirm")}</span></td></tr>)}</tbody></table></div> : <p className="py-4 text-sm text-slate-400">No material information saved.</p>}
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="mb-4 flex justify-between"><h3 className="font-bold text-slate-900">Order details</h3><button className="text-xs font-semibold text-violet-700" onClick={() => onEdit("po")}>Edit PO</button></div><dl className="grid gap-x-5 gap-y-4 sm:grid-cols-3">
        {[["Product / SKU", o.product || "To confirm"], ["Order date", dateLabel(o.orderDate)], ["Owner", o.owner || "To confirm"], ["Production start", dateLabel(o.productionStart)], ["Production finish", dateLabel(o.productionFinish)], ["COA required", o.coaRequired === null ? "To confirm" : o.coaRequired ? "Yes" : "Not applicable"], ["COA expected release", o.coaRequired === false ? "Not applicable" : dateLabel(o.coaExpected)], ["COA actual release", o.coaRequired === false ? "Not applicable" : dateLabel(o.coaActual)], ["Pickup / ship", dateLabel(o.pickupDate)], ["Required delivery", dateLabel(o.requiredDelivery)], ["Expected delivery / ETA", dateLabel(o.expectedDelivery)], ["Actual delivery", dateLabel(o.actualDelivery)], ["Destination", o.destination || "To confirm"]].map(([label, value]) => <div key={label}><dt className="text-[11px] text-slate-400">{label}</dt><dd className="mt-1 text-xs font-medium text-slate-800">{value}</dd></div>)}
      </dl><div className="mt-4 border-t border-slate-100 pt-3"><p className="text-[11px] text-slate-400">Notes</p><p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{o.notes || "No notes saved."}</p></div>{o.sourceFile && <p className="mt-3 text-[10px] text-slate-400">Imported from {o.sourceFile}</p>}</div>
    </div>
    <div className="h-fit rounded-2xl border border-slate-200 bg-white p-4"><div className="mb-4 flex justify-between"><h3 className="font-bold text-slate-900">Next actions</h3><button onClick={() => onEdit("actions")} className="text-xs font-semibold text-violet-700">Edit actions</button></div>
      {!o.actions.length && <p className="py-3 text-sm text-slate-400">No next actions saved.</p>}
      <div className="space-y-4">{o.actions.map(a => <label key={a.id} className="flex items-start gap-3 text-sm"><input type="checkbox" checked={a.completed} disabled={busy} onChange={e => onAction(a.id, e.target.checked)} className="mt-1 accent-violet-600" /><span><span className={a.completed ? "text-slate-400 line-through" : "text-slate-800"}>{a.description}</span><span className="mt-1 block text-[11px] text-slate-400">{a.owner || "Owner to confirm"} · {dateLabel(a.dueDate)}</span></span></label>)}</div>
      <div className="mt-5 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4"><div><p className="text-[11px] text-slate-400">Required delivery</p><p className="mt-1 text-sm font-bold">{dateLabel(o.requiredDelivery)}</p></div><div><p className="text-[11px] text-slate-400">Expected delivery</p><p className="mt-1 text-sm font-bold">{dateLabel(o.expectedDelivery)}</p></div></div>
    </div>
  </div>;
}
export default function OrderMonitoringView() {
  const [records, setRecords] = useState<SavedOrder[]>([]), [loading, setLoading] = useState(true), [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState(""), [status, setStatus] = useState("all"), [from, setFrom] = useState(""), [to, setTo] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set()), [menu, setMenu] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null), [editorError, setEditorError] = useState(""), [saving, setSaving] = useState(false);
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set()), [notice, setNotice] = useState(""), [error, setError] = useState("");
  const [imports, setImports] = useState<ImportResult[]>([]), [importIndex, setImportIndex] = useState(0), [importFile, setImportFile] = useState("");
  const [reading, setReading] = useState(false);
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
  useEffect(() => { if (!menu) return; const close = () => setMenu(null); const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); }; document.addEventListener("click", close); document.addEventListener("keydown", key); return () => { document.removeEventListener("click", close); document.removeEventListener("keydown", key); }; }, [menu]);
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
    if (from || to) { const dates = orderDates(o); if (!dates.length) return false; if (from && dates[dates.length - 1] < from) return false; if (to && dates[0] > to) return false; }
    return true;
  }).sort((a, b) => (a.order.requiredDelivery || a.order.expectedDelivery || "9999").localeCompare(b.order.requiredDelivery || b.order.expectedDelivery || "9999") || a.order.poNumber.localeCompare(b.order.poNumber)), [records, search, status, from, to]);
  const range = useMemo(() => {
    const dates = filtered.flatMap(r => orderDates(r.order)).sort();
    const start = dayNumber(from || dates[0] || businessToday()) - 1;
    const end = Math.max(start + 13, dayNumber(to || dates.at(-1) || fromDay(start + 29)) + 1);
    return { start, end };
  }, [filtered, from, to]);
  const days = Math.min(366, Math.max(1, range.end - range.start + 1));
  const end = range.start + days - 1;
  const counts = { active: filtered.filter(r => r.order.status !== "Delivered").length, track: filtered.filter(r => orderHealth(r.order) === "On track").length, risk: filtered.filter(r => orderHealth(r.order) === "At risk").length, delayed: filtered.filter(r => orderHealth(r.order) === "Delayed").length };
  function toggle(key: string) { setExpanded(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; }); }
  return <div className="space-y-5 text-slate-900">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-3xl font-extrabold tracking-tight">Order Monitoring</h2><p className="mt-1 text-sm text-slate-500">From order confirmation to customer delivery</p></div><div className="flex flex-wrap gap-2">
      <button onClick={() => void load()} disabled={loading || !!editor || busyKeys.size > 0} className={`${fieldClass} disabled:opacity-50`} aria-label="Refresh orders"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></button>
      <button onClick={() => fileInput.current?.click()} disabled={reading || loading || !!loadError} className={`${fieldClass} flex items-center gap-2 disabled:opacity-50`}><Upload className="h-4 w-4" />{reading ? "Reading…" : "Upload Excel"}</button>
      <button onClick={() => { setEditorError(""); setEditor({ order: blankOrder(), tab: "po" }); }} disabled={loading || !!loadError} className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-50"><Plus className="h-4 w-4" />Add PO</button>
      <input ref={fileInput} type="file" accept=".xlsx,.xls" className="hidden" aria-label="Upload Order Monitoring workbook" onChange={e => void upload(e.target.files?.[0])} />
    </div></header>
    {notice && <p role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p>}
    {(error || loadError) && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error || loadError}{loadError && <button onClick={() => void load()} className="ml-3 font-bold underline">Retry</button>}</div>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[{ label: "Active orders", value: counts.active, icon: ClipboardList, color: "bg-violet-50 text-violet-700" }, { label: "On track", value: counts.track, icon: CheckCircle2, color: "bg-emerald-50 text-emerald-700" }, { label: "At risk", value: counts.risk, icon: AlertTriangle, color: "bg-amber-50 text-amber-700" }, { label: "Delayed", value: counts.delayed, icon: AlertTriangle, color: "bg-red-50 text-red-700" }].map(card => <div key={card.label} className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className={`rounded-full p-3 ${card.color}`}><card.icon className="h-5 w-5" /></div><div><p className="text-xs text-slate-500">{card.label}</p><p className="mt-1 text-2xl font-bold">{loading ? "—" : card.value}</p></div></div>)}</div>
    <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4">
      <label className="min-w-[200px] flex-1 text-xs text-slate-500">Search PO or customer<div className="relative mt-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input className={`${fieldClass} w-full pl-9`} value={search} onChange={e => setSearch(e.target.value)} placeholder="PO number or customer…" /></div></label>
      <label className="text-xs text-slate-500">PO status<select className={`${fieldClass} mt-1 block`} value={status} onChange={e => setStatus(e.target.value)}><option value="all">All statuses</option>{ORDER_STATUSES.map(s => <option key={s}>{s}</option>)}</select></label>
      <label className="text-xs text-slate-500">From<input type="date" className={`${fieldClass} mt-1 block`} value={from} onChange={e => setFrom(e.target.value)} /></label><label className="text-xs text-slate-500">Through<input type="date" className={`${fieldClass} mt-1 block`} value={to} min={from} onChange={e => setTo(e.target.value)} /></label>
      {(search || status !== "all" || from || to) && <button className="py-2 text-xs font-semibold text-violet-700" onClick={() => { setSearch(""); setStatus("all"); setFrom(""); setTo(""); }}>Clear filters</button>}
      <p className="w-full text-[10px] text-slate-400">Cards reflect filtered orders. Date range matches any saved order or material milestone. Orders with no dates remain visible when no date filter is set. At risk includes shortages, overdue actions/COAs, or an ETA later than required delivery.</p>
    </div>
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm" aria-label="Order timeline">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4"><h3 className="text-lg font-bold">Order timeline <span className="ml-2 text-xs font-normal text-slate-400">{filtered.length} orders</span></h3><div className="flex flex-wrap gap-4 text-[10px] text-slate-500">{["Materials", "Production", "COA", "Shipping"].map((label, i) => <span className="flex items-center gap-1" key={label}><span className={`h-2.5 w-2.5 rounded-full ${stageColors[i]}`} />{label}</span>)}<span>◇ Required delivery</span><span>◆ Expected / actual delivery</span></div></div>
      {loading && <div className="p-12 text-center text-sm text-slate-500">Loading saved orders…</div>}
      {!loading && !filtered.length && !loadError && <div className="px-6 py-16 text-center"><ClipboardList className="mx-auto mb-4 h-9 w-9 text-violet-300" /><h4 className="text-lg font-bold">{records.length ? "No matching orders" : "Your order timeline starts here"}</h4><p className="mx-auto mt-2 max-w-md text-sm text-slate-500">{records.length ? "Adjust the search or filters to see your saved orders." : "Add a PO or upload your monitoring workbook. Materials, production, COA, shipping and delivery will appear as dates are confirmed."}</p></div>}
      {!loading && filtered.length > 0 && <div className="overflow-auto"><div style={{ minWidth: 355 + days * 30 }}>
        <div className="flex border-b border-slate-200 bg-slate-50"><div className="sticky left-0 z-20 flex w-[355px] shrink-0 items-center justify-between border-r border-slate-200 bg-slate-50 px-5 text-[11px] font-semibold text-slate-500"><span>Customer / PO / Cases</span><span>PO status</span></div><div className="flex">{Array.from({ length: days }, (_, i) => fromDay(range.start + i)).map((date, i) => <div key={date} className={`w-[30px] shrink-0 border-l border-slate-100 py-2 text-center text-[10px] ${date === businessToday() ? "bg-violet-100 text-violet-900" : "text-slate-500"}`}><span className="block text-[8px]">{i === 0 || date.endsWith("-01") ? date.slice(5, 7) + "/" + date.slice(2, 4) : ""}</span><span>{date.slice(-2)}</span></div>)}</div></div>
        {filtered.map(saved => { const o = saved.order, key = poKey(o.poNumber), open = expanded.has(key), busy = busyKeys.has(key), health = orderHealth(o); return <React.Fragment key={key}>
          <div className={`flex border-b border-slate-100 ${open ? "bg-violet-50/40" : "bg-white"}`}>
            <div className="sticky left-0 z-10 flex w-[355px] shrink-0 items-center gap-2 border-r border-slate-200 bg-white px-4 py-4">
              <button aria-label={`${open ? "Collapse" : "Expand"} ${o.poNumber}`} aria-expanded={open} aria-controls={`order-details-${key}`} onClick={() => toggle(key)} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button>
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold" title={o.customer}>{o.customer}</p><button className="mt-1 text-left text-xs font-medium text-violet-800 hover:underline" onClick={() => toggle(key)} aria-expanded={open}>{o.poNumber}</button><p className="mt-1 text-[10px] text-slate-400">{quantityLabel(o.cases, "cases")}</p><span className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[9px] font-semibold ${healthColors[health]}`}>{health}</span></div>
              <select aria-label={`Status for ${o.poNumber}`} className={`max-w-[112px] rounded-xl border px-2 py-2 text-[11px] font-semibold ${STATUS_COLORS[o.status as OrderStatus] || ""} disabled:opacity-50`} value={o.status} disabled={busy} onChange={e => void immediate(saved, { operation: "status", status: e.target.value })}>{ORDER_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</select>
              <div className="relative"><button aria-label={`Actions for ${o.poNumber}`} aria-haspopup="menu" aria-expanded={menu === key} onClick={e => { e.stopPropagation(); setMenu(prev => prev === key ? null : key); }} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"><List className="h-4 w-4" /></button>
                {menu === key && <div role="menu" className="absolute right-0 top-8 z-40 w-44 rounded-xl border border-slate-200 bg-white py-1 shadow-xl" onClick={e => e.stopPropagation()}>{([['View details', null], ['Edit PO', 'po'], ['Edit materials', 'materials'], ['Edit next actions', 'actions']] as const).map(([label, tab]) => <button key={label} role="menuitem" className="block w-full px-4 py-2 text-left text-xs hover:bg-violet-50 disabled:opacity-50" disabled={busy} onClick={() => { if (tab) edit(saved, tab); else { setExpanded(prev => new Set(prev).add(key)); setMenu(null); } }}>{label}</button>)}</div>}
              </div>
            </div><Timeline order={o} start={range.start} end={end} />
          </div>
          {open && <div id={`order-details-${key}`} className="sticky left-0" style={{ maxWidth: "calc(100vw - 100px)" }}><Details saved={saved} busy={busy} onEdit={tab => edit(saved, tab)} onAction={(id, completed) => void immediate(saved, { operation: "complete-action", actionId: id, completed })} /></div>}
        </React.Fragment>; })}
      </div></div>}
      {range.end - range.start + 1 > 366 && <p className="border-t p-3 text-xs text-slate-500">Showing the first 366 days. Use the date range filters to inspect later milestones.</p>}
    </section>
    {editor && <OrderMonitoringEditor key={`${editor.originalPo || "new"}-${editor.importInfo?.sheet || "manual"}-${importIndex}`} state={editor} saving={saving} error={editorError} onClose={() => { setEditor(null); setImports([]); }} onSave={(o, reviewed, update) => void save(o, reviewed, update)} />}
  </div>;
}
