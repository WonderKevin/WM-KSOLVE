const DELAY_NOTE = 'PO-10077 was delayed, Delivery on 11/9.';
/** @param {import('./order-monitoring').Order} order */
function applyCbfSource(order) {
  let referencesChanged = 0;
  const materials = order.materials.map(m => {
    if (!['PO-10077', '10077'].includes(String(m.supplierPo).replace(/\s/g, '').toUpperCase())) return m;
    referencesChanged++;
    return { ...m, supplierPo: 'CBF-Sell' };
  });
  if (!referencesChanged) return { order, changed: 0, referencesChanged: 0 };
  const previous = order.actionNotes || '';
  const actionNotes = previous.includes(DELAY_NOTE) ? previous : [previous, DELAY_NOTE].filter(Boolean).join('\n');
  return { order: { ...order, materials, actionNotes }, changed: referencesChanged + Number(actionNotes !== previous), referencesChanged };
}
module.exports = { applyCbfSource, DELAY_NOTE };
