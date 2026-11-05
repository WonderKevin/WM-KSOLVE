import { test } from "node:test";
import assert from "node:assert/strict";
import { GET, POST, PATCH } from "../app/api/order-monitoring/route";
import { blankOrder, blankMaterial } from "../lib/order-monitoring";

test("authenticated storage, exact duplicates, atomic children, status-only patches and stale-version protection", async () => {
  const oldFetch = globalThis.fetch;
  const previous = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, role: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://monitoring.example.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "isolated-anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "isolated-role";
  let allowed = false, simulateConcurrentChange = false;
  const records = new Map<string, Record<string, unknown>>();
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    assert.equal(url.host, "monitoring.example.test", "Test must never contact production");
    if (url.pathname.endsWith("/auth/v1/user")) return json({ id: "00000000-0000-4000-8000-000000000001", email: "qa@example.test", app_metadata: {}, user_metadata: {} });
    if (url.pathname.endsWith("/rpc/has_app_permission")) return json(allowed);
    assert.ok(url.pathname.endsWith("/report_snapshots"));
    const key = url.searchParams.get("report_key")?.replace(/^eq\./, "");
    const method = init?.method || "GET", headers = new Headers(init?.headers);
    const object = headers.get("Accept")?.includes("object+json");
    if (method === "GET") {
      const rows = key?.startsWith("like.") ? [...records.values()].filter(row => String(row.report_key).startsWith(key.slice(5).replace(/%$/, ""))) : records.has(key || "") ? [records.get(key || "")] : [];
      return json(object ? rows[0] || null : rows);
    }
    const body = JSON.parse(String(init?.body));
    if (method === "POST") {
      if (records.has(body.report_key)) return json({ code: "23505", message: "duplicate" }, 409);
      records.set(body.report_key, body); return json(object ? body : [body]);
    }
    assert.equal(method, "PATCH");
    const row = records.get(key || "");
    const expected = Number(url.searchParams.get("version")?.replace("eq.", ""));
    if (simulateConcurrentChange) { simulateConcurrentChange = false; if (row) row.version = Number(row.version) + 1; }
    if (!row || row.version !== expected) return json(null);
    const updated = { ...row, ...body }; records.set(key!, updated); return json(object ? updated : [updated]);
  };
  const request = (method: string, body?: unknown, token = true) => new Request("http://localhost/api/order-monitoring", { method, headers: { ...(token ? { Authorization: "Bearer isolated-session" } : {}), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    assert.equal((await GET(request("GET", undefined, false))).status, 401);
    assert.equal((await GET(request("GET"))).status, 403);
    allowed = true;
    assert.deepEqual(await (await GET(request("GET"))).json(), { orders: [] });
    const order = { ...blankOrder(), poNumber: "PO-QA-API", customer: "Synthetic QA", cases: 12, materials: [{ ...blankMaterial(), id: "m1", description: "QA material", status: "Ready" }], actions: [{ id: "a1", description: "QA action", owner: "", dueDate: "", completed: false }] };
    const created = await POST(request("POST", { order })); assert.equal(created.status, 201);
    assert.equal(records.size, 1);
    assert.equal((await POST(request("POST", { order: { ...order, poNumber: " po-qa-api " } }))).status, 409);
    const stored = await (await GET(request("GET"))).json(); assert.deepEqual(stored.orders[0].order, order);
    const changed = await PATCH(request("PATCH", { poNumber: order.poNumber, version: 1, operation: "status", status: "Confirmed" })); assert.equal(changed.status, 200);
    const changedBody = await changed.json(); assert.equal(changedBody.saved.order.actions.length, 1); assert.equal(changedBody.saved.version, 2);
    assert.equal((await PATCH(request("PATCH", { poNumber: order.poNumber, version: 1, operation: "replace", order }))).status, 409);
    assert.equal((await PATCH(request("PATCH", { poNumber: order.poNumber, version: 2, operation: "status", status: "not-a-status" }))).status, 400);
    simulateConcurrentChange = true;
    assert.equal((await PATCH(request("PATCH", { poNumber: order.poNumber, version: 2, operation: "replace", order }))).status, 409);
    assert.equal((await POST(request("POST", { order: { ...order, poNumber: "NEW", cases: -1 } }))).status, 400);
    const final = await (await GET(request("GET"))).json(); assert.equal(final.orders[0].order.status, "Confirmed"); assert.equal(final.orders[0].order.actions[0].completed, false);
    const mode = await PATCH(request("PATCH", { poNumber: order.poNumber, version: final.orders[0].version, operation: "fulfillment", fulfillmentMode: "Pickup" }));
    assert.equal(mode.status, 200); const modeResult = await mode.json(); assert.equal(modeResult.saved.order.fulfillmentMode, "Pickup"); assert.equal(modeResult.saved.order.status, "Confirmed");
    assert.equal((await PATCH(request("PATCH", { poNumber: order.poNumber, version: modeResult.saved.version, operation: "fulfillment", fulfillmentMode: "Other" }))).status, 400);
    const material = await PATCH(request("PATCH", { poNumber: order.poNumber, version: modeResult.saved.version, operation: "material-status", materialId: "m1", status: "In transit" }));
    assert.equal(material.status, 200); const materialResult = await material.json();
    assert.equal(materialResult.saved.order.materials[0].status, "In transit");
    assert.equal(materialResult.saved.order.status, "Confirmed");
    assert.equal(materialResult.saved.order.materials[0].available, null);
    for (const fields of [{ materialId: "m1", status: "Ready" }, { materialId: "missing", status: "Sent" }]) {
      assert.equal((await PATCH(request("PATCH", { poNumber: order.poNumber, version: materialResult.saved.version, operation: "material-status", ...fields }))).status, 400);
    }
    const notes = await PATCH(request("PATCH", { poNumber: order.poNumber, version: materialResult.saved.version, operation: "action-notes", actionNotes: "Typed notes" }));
    assert.equal(notes.status, 200); const notesResult = await notes.json();
    assert.equal(notesResult.saved.order.actionNotes, "Typed notes"); assert.equal(notesResult.saved.order.materials[0].status, "In transit");
    assert.equal((await PATCH(request("PATCH", { poNumber: order.poNumber, version: notesResult.saved.version, operation: "action-notes", actionNotes: 123 }))).status, 400);
    const missingDelete = await PATCH(request("PATCH", { poNumber: order.poNumber, version: notesResult.saved.version, operation: "delete-material", materialId: "missing" })); assert.equal(missingDelete.status, 400);
    const deleted = await PATCH(request("PATCH", { poNumber: order.poNumber, version: notesResult.saved.version, operation: "delete-material", materialId: "m1" }));
    assert.equal(deleted.status, 200); const deletedBody = await deleted.json(); assert.equal(deletedBody.saved.order.materials.length, 0); assert.equal(deletedBody.saved.order.actionNotes, "Typed notes");
    assert.ok([...records.values()].some(row => String(row.report_key).startsWith("order-monitoring-backup:delete-material:")));
    const reloaded = await (await GET(request("GET"))).json(); assert.equal(reloaded.orders.length, 1); assert.equal(reloaded.orders[0].order.materials.length, 0);
  } finally {
    globalThis.fetch = oldFetch;
    for (const [key, value] of [["NEXT_PUBLIC_SUPABASE_URL", previous.url], ["NEXT_PUBLIC_SUPABASE_ANON_KEY", previous.anon], ["SUPABASE_SERVICE_ROLE_KEY", previous.role]]) if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
  }
});
