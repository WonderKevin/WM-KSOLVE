// Explicit CBF-Sell supplier reference and next-action note update requested October 30, 2026. No Arctanis writes.
const { createClient } = require('@supabase/supabase-js');
const PREFIX = 'order-monitoring:v1:';
const { applyCbfSource: correctOrder } = require('../lib/order-monitoring-cbf.cjs');
async function run() {
  if (process.env.ORDER_MONITORING_CBF_SOURCE_UPDATE !== '20261030') return;
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
    const backup = await db.from('report_snapshots').insert({ report_key: 'order-monitoring-backup:cbf-sell:' + record.report_key + ':' + record.version, payload: record.payload, version: record.version, updated_at: new Date().toISOString(), updated_by: 'codex:cbf-sell-source-update' });
    if (backup.error && backup.error.code !== '23505') throw new Error('Could not preserve original monitoring record; update stopped.');
    const result = await db.from('report_snapshots').update({ payload: correction.order, version: record.version + 1, updated_at: new Date().toISOString(), updated_by: 'codex:cbf-sell-source-update' }).eq('report_key', record.report_key).eq('version', record.version).select('version').maybeSingle();
    if (result.error || !result.data) throw new Error('Correction stopped: storage error or concurrent edit. No concurrent changes were overwritten.');
    orderCount++; materialCount += correction.referencesChanged;
  }
  const remaining = (await records()).reduce((n, record) => n + correctOrder(record.payload).changed, 0);
  if (remaining) throw new Error('CBF-Sell update verification found unapplied changes.');
  console.log(`CBF-Sell update verified: ${materialCount} supplier references replaced and delay notes added across ${orderCount} orders; zero old references remain.`);
}
module.exports = { correctOrder };
if (require.main === module) run().catch(error => { console.error(error.message); process.exitCode = 1; });
