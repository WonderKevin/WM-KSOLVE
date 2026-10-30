import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ORDER_STATUSES, poKey, validateOrder, type Order, type SavedOrder } from "@/lib/order-monitoring";

export const dynamic = "force-dynamic";
const PREFIX = "order-monitoring:v1:";
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
async function access(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) throw new HttpError(401, "Please sign in again.");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const client = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Your session has expired. Please sign in again.");
  const email = data.user.email || "";
  if (email.toLowerCase() !== "kevin@wondermonday.com") {
    const checks = await Promise.all(["can_view_user_account", "can_view_admin_automation"].map(permission_name => client.rpc("has_app_permission", { permission_name })));
    if (!checks.some(c => !c.error && c.data === true)) throw new HttpError(403, "Order Monitoring requires Admin access.");
  }
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new HttpError(503, "Order Monitoring storage is not configured. Contact your administrator.");
  // The existing document store is accessed only after verified application permissions.
  // Keeping each PO and its child rows together makes saves atomic without partial material/action writes.
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return { db, email };
}
function storageKey(poNumber: string) { return PREFIX + encodeURIComponent(poKey(poNumber)); }
function checkOrder(input: unknown): Order {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new HttpError(400, "Invalid order.");
  const o = input as Order;
  const strings = ["poNumber", "customer", "product", "orderDate", "status", "productionStart", "productionFinish", "coaExpected", "coaActual", "pickupDate", "requiredDelivery", "expectedDelivery", "actualDelivery", "destination", "owner", "notes"] as const;
  if (strings.some(k => typeof o[k] !== "string" || o[k].length > 10000) || o.poNumber.length > 120) throw new HttpError(400, "Invalid order fields.");
  if (!Array.isArray(o.materials) || !Array.isArray(o.actions) || o.materials.length > 500 || o.actions.length > 200) throw new HttpError(400, "Invalid materials or actions.");
  for (const m of o.materials) {
    if (!m || ["id", "description", "itemNumber", "unit", "supplierPo", "eta", "status"].some(k => typeof (m as unknown as Record<string, unknown>)[k] !== "string")) throw new HttpError(400, "Invalid material fields.");
    if ([m.required, m.available, m.incoming, m.uploadedShortage].some(n => n !== null && typeof n !== "number")) throw new HttpError(400, "Invalid material quantities.");
  }
  for (const a of o.actions) if (!a || [a.id, a.description, a.owner, a.dueDate].some(v => typeof v !== "string") || typeof a.completed !== "boolean") throw new HttpError(400, "Invalid action fields.");
  const errors = validateOrder(o);
  if (errors.length) throw new HttpError(400, errors.join(" "));
  return { ...o, poNumber: o.poNumber.trim(), customer: o.customer.trim() };
}
function fail(error: unknown) {
  if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("Order Monitoring storage error", error instanceof Error ? error.message : "Database request failed");
  return NextResponse.json({ error: "Could not save or load orders. Please retry; your changes have not been discarded." }, { status: 500 });
}
async function body(request: Request) {
  const text = await request.text();
  if (text.length > 2_000_000) throw new HttpError(413, "Order is too large.");
  try { return JSON.parse(text); } catch { throw new HttpError(400, "Invalid request."); }
}
export async function GET(request: Request) {
  try {
    const { db } = await access(request);
    const orders: SavedOrder[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await db.from("report_snapshots").select("payload,version,updated_at").like("report_key", PREFIX + "%").order("report_key").range(offset, offset + 499);
      if (error) throw error;
      orders.push(...(data || []).map(r => ({ order: r.payload as Order, version: r.version, updatedAt: r.updated_at })));
      if ((data || []).length < 500) break;
    }
    return NextResponse.json({ orders }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return fail(e); }
}
export async function POST(request: Request) {
  try {
    const { db, email } = await access(request), input = await body(request), order = checkOrder(input.order);
    const updatedAt = new Date().toISOString();
    const { data, error } = await db.from("report_snapshots").insert({ report_key: storageKey(order.poNumber), payload: order, version: 1, updated_at: updatedAt, updated_by: email }).select("payload,version,updated_at").single();
    if (error?.code === "23505") throw new HttpError(409, "This PO already exists. Refresh and choose Update existing PO in the import preview, or edit the saved order.");
    if (error) throw error;
    return NextResponse.json({ saved: { order: data.payload, version: data.version, updatedAt: data.updated_at } }, { status: 201 });
  } catch (e) { return fail(e); }
}
export async function PATCH(request: Request) {
  try {
    const { db, email } = await access(request), input = await body(request);
    if (typeof input.poNumber !== "string" || !Number.isInteger(input.version) || input.version < 1) throw new HttpError(400, "Invalid order version.");
    const key = storageKey(input.poNumber);
    const current = await db.from("report_snapshots").select("payload,version").eq("report_key", key).maybeSingle();
    if (current.error) throw current.error;
    if (!current.data) throw new HttpError(404, "Order no longer exists. Refresh the page.");
    if (current.data.version !== input.version) throw new HttpError(409, "This order changed in another session. Cancel, refresh, and reopen it before saving so no changes are overwritten.");
    let order: Order = current.data.payload;
    if (input.operation === "status") {
      if (!ORDER_STATUSES.includes(input.status)) throw new HttpError(400, "Invalid status.");
      order = { ...order, status: input.status };
    } else if (input.operation === "fulfillment") {
      if (!["", "Pickup", "Shipment"].includes(input.fulfillmentMode)) throw new HttpError(400, "Choose Pickup or Shipment.");
      order = { ...order, fulfillmentMode: input.fulfillmentMode };
    } else if (input.operation === "material-status") {
      if (!ORDER_STATUSES.includes(input.status) || typeof input.materialId !== "string" || !order.materials.some(m => m.id === input.materialId)) throw new HttpError(400, "Invalid material or material status.");
      order = { ...order, materials: order.materials.map(m => m.id === input.materialId ? { ...m, status: input.status } : m) };
    } else if (input.operation === "action-notes") {
      if (typeof input.actionNotes !== "string" || input.actionNotes.length > 10000) throw new HttpError(400, "Next action notes must be text of at most 10,000 characters.");
      order = { ...order, actionNotes: input.actionNotes };
    } else if (input.operation === "complete-action") {
      if (typeof input.completed !== "boolean" || !order.actions.some(a => a.id === input.actionId)) throw new HttpError(400, "Invalid action.");
      order = { ...order, actions: order.actions.map(a => a.id === input.actionId ? { ...a, completed: input.completed } : a) };
    } else if (input.operation === "replace") {
      order = checkOrder(input.order);
      if (storageKey(order.poNumber) !== key) throw new HttpError(400, "PO number identifies this order and cannot be changed. Edit its details instead.");
    } else throw new HttpError(400, "Invalid operation.");
    const updatedAt = new Date().toISOString();
    const { data, error } = await db.from("report_snapshots").update({ payload: order, version: input.version + 1, updated_at: updatedAt, updated_by: email }).eq("report_key", key).eq("version", input.version).select("payload,version,updated_at").maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError(409, "Order changed while saving. Refresh and reopen it; no changes were overwritten.");
    return NextResponse.json({ saved: { order: data.payload, version: data.version, updatedAt: data.updated_at } });
  } catch (e) { return fail(e); }
}
