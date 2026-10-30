// Explicit item metadata and supplier placeholder cleanup requested October 30, 2026. No Arctanis writes.
const { createClient } = require('@supabase/supabase-js');
const PREFIX = 'order-monitoring:v1:';
const products = require('../lib/order-monitoring-products.json');
function correctOrder(order) {
  let changed = 0;
  const reference = products[String(order.poNumber).trim().toUpperCase()];
  const product = reference ? reference.itemNumber + ' · ' + reference.description : order.product;
  if (product !== order.product) changed++;
  const materials = order.materials.map(m => {
    if (!/^to\s*confirm$/i.test(String(m.supplierPo).trim())) return m;
    changed++;
    return { ...m, supplierPo: '' };
  });
  return { order: changed ? { ...order, product, materials } : order, changed };
}
async function run() {
  if (process.env.ORDER_MONITORING_ITEM_UPDATE !== '20261030') return;
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
    const result = await db.from('report_snapshots').update({ payload: correction.order, version: record.version + 1, updated_at: new Date().toISOString(), updated_by: 'codex:monitoring-item-update' }).eq('report_key', record.report_key).eq('version', record.version).select('version').maybeSingle();
    if (result.error || !result.data) throw new Error('Correction stopped: storage error or concurrent edit. No concurrent changes were overwritten.');
    orderCount++; materialCount += correction.changed;
  }
  const remaining = (await records()).reduce((n, record) => n + correctOrder(record.payload).changed, 0);
  if (remaining) throw new Error('Item update verification found unapplied changes.');
  console.log(`Monitoring item update verified: ${materialCount} item or supplier placeholder changes across ${orderCount} orders; zero pending changes remain.`);
}
module.exports = { correctOrder };
if (require.main === module) run().catch(error => { console.error(error.message); process.exitCode = 1; });
