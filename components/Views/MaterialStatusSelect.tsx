"use client";

import { ORDER_STATUSES, STATUS_COLORS, type OrderStatus } from "@/lib/order-monitoring";

export default function MaterialStatusSelect({ value, onChange, disabled, label, className = "" }: {
  value: string; onChange: (value: string) => void; disabled?: boolean; label: string; className?: string;
}) {
  const legacy = value && !ORDER_STATUSES.includes(value as OrderStatus);
  return <select aria-label={label} value={value} disabled={disabled} onClick={e => e.stopPropagation()} onChange={e => onChange(e.target.value)} className={`rounded-xl border px-2 py-2 text-xs ${STATUS_COLORS[value as OrderStatus] || "border-slate-200 bg-white text-slate-600"} disabled:opacity-50 ${className}`}>
    <option value="" disabled>To confirm</option>
    {legacy && <option value={value} disabled>{value}</option>}
    {ORDER_STATUSES.map(status => <option key={status} value={status}>{status}</option>)}
  </select>;
}
