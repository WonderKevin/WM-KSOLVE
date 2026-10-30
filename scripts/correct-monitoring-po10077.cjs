// Explicit, one-time correction requested October 30, 2026. No Arctanis writes.
const { createClient } = require('@supabase/supabase-js');
const PREFIX = 'order-monitoring:v1:';
function correctOrder(order) {
  let changed = 0;
  const materials = order.materials.map(m => {
    const po = String(m.supplierPo || '').replace(/\s/g, '').toUpperCase();
    if (!['PO-10077', '10077'].includes(po) || m.eta !== '2026-11-09') return m;
    changed++;
    return { ...m, eta: '2026-11-02' };
  });
  return { order: changed ? { ...order, materials } : order, changed };
}
async function run() {
  if (process.env.ORDER_MONITORING_ETA_CORRECTION !== 'po10077-20261102') return;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Correction requires existing deployment storage configuration.');
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  async function records() {
    const all = [];
    for (let offset = 0; ; offset += 500) {
      const result = await db.from('report_snapshots').select('report_key,payload,version').like('report_key', PREFIX + '%').order('report_key').range(offset, offset + 499);
      if (result.error) throw new Error('Could not read monitoring records for correction.');
      all.push(...result.data);
      if (result.data.length < 500) return all;
    }
  }
  let orderCount = 0, materialCount = 0;
  for (const record of await records()) {
    const correction = correctOrder(record.payload);
    if (!correction.changed) continue;
    const result = await db.from('report_snapshots').update({ payload: correction.order, version: record.version + 1, updated_at: new Date().toISOString(), updated_by: 'codex:po10077-eta-correction' }).eq('report_key', record.report_key).eq('version', record.version).select('version').maybeSingle();
    if (result.error || !result.data) throw new Error('Correction stopped: storage error or concurrent edit. No concurrent changes were overwritten.');
    orderCount++; materialCount += correction.changed;
  }
  const remaining = (await records()).reduce((n, record) => n + correctOrder(record.payload).changed, 0);
  if (remaining) throw new Error('Correction verification found remaining November 9 ETAs.');
  console.log(`PO-10077 correction verified: ${materialCount} material ETAs updated across ${orderCount} orders; zero matching November 9 ETAs remain.`);
}
module.exports = { correctOrder };
if (require.main === module) run().catch(error => { console.error(error.message); process.exitCode = 1; });
