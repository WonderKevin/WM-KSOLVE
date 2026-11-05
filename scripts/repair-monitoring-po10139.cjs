// Explicit PO-10139 supplier reference and two footer-row repairs requested November 5, 2026. No Arctanis writes.
const { createClient } = require('@supabase/supabase-js');
const PREFIX = 'order-monitoring:v1:';
const { repairOrder: correctOrder } = require('../lib/order-monitoring-material-repair.cjs');
async function run() {
  if (process.env.ORDER_MONITORING_REPAIR_10139 !== '20261105') return;
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
  let orderCount = 0, materialCount = 0, rowCount = 0;
  const saved = await records();
  if (!saved.some(record => record.payload.poNumber.trim().toUpperCase() === 'PO-10139')) throw new Error('Target monitoring order was not found.');
  for (const record of saved) {
    const correction = correctOrder(record.payload);
    if (!correction.changed) continue;
    const backup = await db.from('report_snapshots').insert({ report_key: 'order-monitoring-backup:po10139-repair:' + record.report_key + ':' + record.version, payload: record.payload, version: record.version, updated_at: new Date().toISOString(), updated_by: 'codex:po10139-repair-source-update' });
    if (backup.error && backup.error.code !== '23505') throw new Error('Could not preserve original monitoring record; update stopped.');
    const result = await db.from('report_snapshots').update({ payload: correction.order, version: record.version + 1, updated_at: new Date().toISOString(), updated_by: 'codex:po10139-repair-source-update' }).eq('report_key', record.report_key).eq('version', record.version).select('version').maybeSingle();
    if (result.error || !result.data) throw new Error('Correction stopped: storage error or concurrent edit. No concurrent changes were overwritten.');
    orderCount++; materialCount += correction.referencesChanged; rowCount += correction.rowsRemoved;
  }
  const remaining = (await records()).reduce((n, record) => n + correctOrder(record.payload).changed, 0);
  if (remaining) throw new Error('Material repair verification found unapplied changes.');
  console.log(`PO-10139 repair verified: ${materialCount} supplier references updated, ${rowCount} explanatory rows removed; zero pending changes remain.`);
}
module.exports = { correctOrder };
if (require.main === module) run().catch(error => { console.error(error.message); process.exitCode = 1; });
