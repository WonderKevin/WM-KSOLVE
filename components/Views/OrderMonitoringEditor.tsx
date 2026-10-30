"use client";

import React, { useEffect, useRef, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { ORDER_STATUSES, calculatedShortage, quantityLabel, shortageDiscrepancy, blankMaterial, type Order, type Material, type NextAction } from "@/lib/order-monitoring";

export type EditorTab = "po" | "materials" | "actions";
export type EditorState = {
  order: Order; originalPo?: string; version?: number; tab: EditorTab;
  importInfo?: { sheet: string; errors: string[]; warnings: string[]; file: string };
};
const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 disabled:bg-slate-50 disabled:text-slate-500";
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid content-start gap-1.5 text-xs font-medium text-slate-600">{label}{children}</label>;
}
function TextField({ label, value, onChange, type = "text", disabled = false }: { label: string; value: string; onChange: (v: string) => void; type?: string; disabled?: boolean }) {
  return <Field label={label}><input className={inputClass} type={type} value={value} onChange={e => onChange(e.target.value)} disabled={disabled} /></Field>;
}
function Quantity({ label, value, onChange, min }: { label: string; value: number | null; onChange: (v: number | null) => void; min?: number }) {
  return <Field label={label}><input className={inputClass} type="number" step="any" min={min} value={value ?? ""} onChange={e => onChange(e.target.value === "" ? null : Number(e.target.value))} placeholder="Unknown" /></Field>;
}
export default function OrderMonitoringEditor({ state, saving, error, onClose, onSave }: {
  state: EditorState; saving: boolean; error: string; onClose: () => void;
  onSave: (order: Order, importReviewed: boolean, updateExisting: boolean) => void;
}) {
  const [order, setOrder] = useState<Order>(() => structuredClone(state.order));
  const [tab, setTab] = useState(state.tab);
  const [reviewed, setReviewed] = useState(false), [updateExisting, setUpdateExisting] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = dialog.current; d?.showModal(); return () => d?.close(); }, []);
  function set<K extends keyof Order>(field: K, value: Order[K]) { setOrder(o => ({ ...o, [field]: value })); }
  function material(id: string, changes: Partial<Material>) {
    setOrder(o => ({ ...o, shortageReviewed: false, materials: o.materials.map(m => m.id === id ? { ...m, ...changes } : m) }));
  }
  function action(id: string, changes: Partial<NextAction>) { setOrder(o => ({ ...o, actions: o.actions.map(a => a.id === id ? { ...a, ...changes } : a) })); }
  const info = state.importInfo;
  const importIssues = !!info && (info.errors.length > 0 || info.warnings.length > 0);
  const missingColumns = info?.errors.some(e => e.startsWith("Missing material column"));
  const discrepancies = order.materials.filter(shortageDiscrepancy);
  const close = () => { if (!saving) onClose(); };
  return <dialog ref={dialog} aria-labelledby="order-editor-title" className="m-auto max-h-[92vh] w-[min(1100px,96vw)] overflow-hidden rounded-3xl border border-slate-200 p-0 shadow-2xl backdrop:bg-slate-950/40" onCancel={e => { e.preventDefault(); close(); }}>
    <form className="flex max-h-[92vh] flex-col" onSubmit={e => { e.preventDefault(); onSave(order, reviewed, updateExisting); }}>
      <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
        <div><h2 id="order-editor-title" className="text-xl font-bold text-slate-900">{info ? "Review Excel import" : state.originalPo ? "Edit order" : "Add PO"}</h2><p className="mt-1 text-xs text-slate-500">{info ? `${info.file} · ${info.sheet} · Preview only until you save` : "Unknown dates and quantities can stay blank."}</p></div>
        <button type="button" onClick={close} disabled={saving} aria-label="Close editor" className="rounded-full p-2 hover:bg-slate-100"><X className="h-5 w-5" /></button>
      </div>
      <div className="flex gap-2 border-b border-slate-100 px-6 py-3" role="tablist" aria-label="Order sections">
        {([['po', 'PO details'], ['materials', `Materials (${order.materials.length})`], ['actions', `Next actions (${order.actions.length})`]] as const).map(([value, label]) => <button type="button" key={value} role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={`rounded-xl px-4 py-2 text-sm font-semibold ${tab === value ? "bg-violet-100 text-violet-900" : "text-slate-500 hover:bg-slate-50"}`}>{label}</button>)}
      </div>
      <div className="overflow-y-auto px-6 py-5">
        {error && <div role="alert" className="mb-4 whitespace-pre-line rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
        {info && <div className="mb-5 space-y-3 rounded-2xl border border-violet-200 bg-violet-50/60 p-4 text-sm text-slate-700">
          <p><strong>{order.poNumber || "PO number missing"}</strong> · {quantityLabel(order.cases, "cases")} · {order.materials.length} materials. Check all three tabs before confirming.</p>
          <p className="text-xs">Incoming quantities are separate from available stock. Uploaded shortages are retained alongside calculated shortages. Excel dates use the workbook date system.</p>
          {state.originalPo && <label className="flex items-start gap-2"><input type="checkbox" checked={updateExisting} onChange={e => setUpdateExisting(e.target.checked)} className="mt-1" />Update existing {state.originalPo}. Replace its materials with this preview; retain other saved details and next actions unless edited here. Cancel keeps the saved record unchanged.</label>}
          {importIssues && <><ul className="list-disc space-y-1 pl-5 text-xs text-amber-900">{[...info.errors, ...info.warnings].map((issue, i) => <li key={i}>{issue}</li>)}</ul>
            {missingColumns ? <p className="font-semibold text-red-800">Correct the missing workbook columns and upload again.</p> : <label className="flex items-start gap-2"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} className="mt-1" />I reviewed these import issues and corrected the fields below, or intentionally left unknown values blank.</label>}</>}
        </div>}
        {tab === "po" && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <TextField label="Customer *" value={order.customer} onChange={v => set("customer", v)} />
          <TextField label={state.originalPo ? "PO number (record identifier)" : "PO number *"} value={order.poNumber} onChange={v => set("poNumber", v)} disabled={!!state.originalPo} />
          <TextField label="Product / SKU" value={order.product} onChange={v => set("product", v)} />
          <Quantity label="Cases *" value={order.cases} min={0} onChange={v => set("cases", v)} />
          <TextField label="Order date" type="date" value={order.orderDate} onChange={v => set("orderDate", v)} />
          <Field label="PO status *"><select className={inputClass} value={order.status} onChange={e => set("status", e.target.value as Order["status"])}><option value="">Select status</option>{ORDER_STATUSES.map(s => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Pickup / shipment"><select className={inputClass} value={order.fulfillmentMode || ""} onChange={e => set("fulfillmentMode", e.target.value as Order["fulfillmentMode"])}><option value="">To confirm</option><option value="Pickup">Pickup</option><option value="Shipment">Shipment</option></select></Field>
          <TextField label="Production start" type="date" value={order.productionStart} onChange={v => set("productionStart", v)} />
          <TextField label="Production finish" type="date" value={order.productionFinish} onChange={v => set("productionFinish", v)} />
          <Field label="COA required"><select className={inputClass} value={order.coaRequired === null ? "" : String(order.coaRequired)} onChange={e => { setOrder(o => ({ ...o, coaRequired: e.target.value === "" ? null : e.target.value === "true", ...(e.target.value === "false" ? { coaExpected: "", coaActual: "" } : {}) })); }}><option value="">To confirm</option><option value="true">Yes</option><option value="false">No — not applicable</option></select></Field>
          <TextField label="COA expected release" type="date" value={order.coaExpected} disabled={order.coaRequired === false} onChange={v => set("coaExpected", v)} />
          <TextField label="COA actual release" type="date" value={order.coaActual} disabled={order.coaRequired === false} onChange={v => set("coaActual", v)} />
          <TextField label="Expected pickup / ship date" type="date" value={order.pickupDate} onChange={v => set("pickupDate", v)} />
          <TextField label="Required delivery date" type="date" value={order.requiredDelivery} onChange={v => set("requiredDelivery", v)} />
          <TextField label="Expected delivery / ETA" type="date" value={order.expectedDelivery} onChange={v => set("expectedDelivery", v)} />
          <TextField label="Actual delivery date" type="date" value={order.actualDelivery} onChange={v => set("actualDelivery", v)} />
          <TextField label="Destination" value={order.destination} onChange={v => set("destination", v)} />
          <TextField label="Owner" value={order.owner} onChange={v => set("owner", v)} />
          <div className="sm:col-span-2 lg:col-span-3"><Field label="Notes"><textarea aria-label="Notes" className={inputClass} rows={4} value={order.notes} onChange={e => set("notes", e.target.value)} /></Field></div>
        </div>}
        {tab === "materials" && <div className="space-y-4">
          <p className="text-xs text-slate-500">Available means stock after reservations. Shortage = max(required − available, 0); incoming stock is not subtracted.</p>
          {!order.materials.length && <p className="rounded-xl bg-slate-50 p-5 text-sm text-slate-500">No materials added yet.</p>}
          {order.materials.map((m, index) => <fieldset key={m.id} className="rounded-2xl border border-slate-200 p-4"><legend className="px-2 text-sm font-semibold text-slate-700">Material {index + 1}</legend>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="sm:col-span-2"><TextField label="Material description" value={m.description} onChange={v => material(m.id, { description: v })} /></div>
              <TextField label="Item number" value={m.itemNumber} onChange={v => material(m.id, { itemNumber: v })} />
              <TextField label="Unit" value={m.unit} onChange={v => material(m.id, { unit: v })} />
              <Quantity label="Required" value={m.required} min={0} onChange={v => material(m.id, { required: v })} />
              <Quantity label="Available − reserved" value={m.available} onChange={v => material(m.id, { available: v })} />
              <Quantity label="Incoming (not yet available)" value={m.incoming} min={0} onChange={v => material(m.id, { incoming: v })} />
              <div><p className="text-xs text-slate-500">Calculated shortage</p><p className={`mt-3 text-sm font-semibold ${(calculatedShortage(m) ?? 0) > 0 ? "text-amber-700" : "text-slate-700"}`}>{quantityLabel(calculatedShortage(m), m.unit)}</p></div>
              <TextField label="Supplier PO (material order)" value={m.supplierPo} onChange={v => material(m.id, { supplierPo: v })} />
              <TextField label="Material ETA" type="date" value={m.eta} onChange={v => material(m.id, { eta: v })} />
              <TextField label="Material status (separate from PO)" value={m.status} onChange={v => material(m.id, { status: v })} />
              <button type="button" onClick={() => set("materials", order.materials.filter(row => row.id !== m.id))} className="mt-5 flex items-center gap-2 text-sm text-red-700"><Trash2 className="h-4 w-4" />Remove material</button>
            </div>
            {m.sourceValues && <details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer">Original workbook quantities</summary><p className="mt-2">{Object.entries(m.sourceValues).map(([k, v]) => `${k}: ${v || "Unknown"}`).join(" · ")}</p></details>}
            {shortageDiscrepancy(m) && <p className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">Review: uploaded shortage {quantityLabel(m.uploadedShortage, m.unit)} differs from calculated {quantityLabel(calculatedShortage(m), m.unit)}.</p>}
          </fieldset>)}
          <button type="button" onClick={() => set("materials", [...order.materials, blankMaterial()])} className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold"><Plus className="h-4 w-4" />Add material</button>
        </div>}
        {tab === "actions" && <div className="space-y-4">
          {!order.actions.length && <p className="rounded-xl bg-slate-50 p-5 text-sm text-slate-500">No next actions yet.</p>}
          {order.actions.map((a, index) => <fieldset key={a.id} className="rounded-2xl border border-slate-200 p-4"><legend className="px-2 text-sm font-semibold">Action {index + 1}</legend><div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Action description" value={a.description} onChange={v => action(a.id, { description: v })} />
            <TextField label="Owner" value={a.owner} onChange={v => action(a.id, { owner: v })} />
            <TextField label="Due date" type="date" value={a.dueDate} onChange={v => action(a.id, { dueDate: v })} />
            <div className="flex items-end justify-between gap-3 py-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={a.completed} onChange={e => action(a.id, { completed: e.target.checked })} />Completed</label><button type="button" aria-label={`Remove action ${index + 1}`} onClick={() => set("actions", order.actions.filter(row => row.id !== a.id))}><Trash2 className="h-4 w-4 text-red-600" /></button></div>
          </div></fieldset>)}
          <button type="button" onClick={() => set("actions", [...order.actions, { id: crypto.randomUUID(), description: "", owner: "", dueDate: "", completed: false }])} className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold"><Plus className="h-4 w-4" />Add next action</button>
        </div>}
      </div>
      <div className="space-y-3 border-t border-slate-100 bg-slate-50 px-6 py-4">
        {discrepancies.length > 0 && <label className="flex items-start gap-2 text-xs text-amber-900"><input className="mt-0.5" type="checkbox" checked={!!order.shortageReviewed} onChange={e => set("shortageReviewed", e.target.checked)} />I reviewed {discrepancies.length} uploaded shortage discrepancies. Save both uploaded and calculated values for reference.</label>}
        <div className="flex justify-end gap-3"><button type="button" onClick={close} disabled={saving} className="rounded-xl border border-slate-200 bg-white px-5 py-2 text-sm font-semibold disabled:opacity-50">Cancel</button><button disabled={saving || !!missingColumns || (importIssues && !reviewed) || (!!info && !!state.originalPo && !updateExisting)} className="rounded-xl bg-slate-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : info ? state.originalPo ? "Confirm update" : "Confirm import" : "Save"}</button></div>
      </div>
    </form>
  </dialog>;
}
