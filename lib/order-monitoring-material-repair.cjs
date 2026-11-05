/** @param {import('./order-monitoring').Material} m */
function isWorkbookFooter(m) {
  return !m.itemNumber && !m.supplierPo && !m.eta && [m.required, m.available, m.incoming, m.uploadedShortage].every(v => v === null)
    && /^(?:\*\s*Available\s*[-−–]\s*Reserved\b|Source:\s*Arctanis\b)/i.test(m.description.trim());
}
const references = { 'ITM-10004': 'PO-10101', 'ITM-10003': 'PO-10101', 'ITM-10361': 'PO-10105', 'ITM-10113': 'PO-10105', 'ITM-10365': 'PO-10104', 'ITM-10391': 'PO-10104', 'ITM-10367': 'PO-10141' };
/** @param {import('./order-monitoring').Order} order */
function repairOrder(order) {
  if (order.poNumber.trim().toUpperCase() !== 'PO-10139') return { order, changed: 0, referencesChanged: 0, rowsRemoved: 0 };
  let referencesChanged = 0, rowsRemoved = 0;
  const materials = order.materials.filter(m => { if (!isWorkbookFooter(m)) return true; rowsRemoved++; return false; }).map(m => {
    const item = (m.itemNumber || m.description.match(/\bITM-\d+\b/i)?.[0] || '').toUpperCase();
    const supplierPo = references[item];
    if (!supplierPo || supplierPo === m.supplierPo) return m;
    referencesChanged++;
    return { ...m, supplierPo };
  });
  return { order: referencesChanged || rowsRemoved ? { ...order, materials } : order, changed: referencesChanged + rowsRemoved, referencesChanged, rowsRemoved };
}
module.exports = { isWorkbookFooter, repairOrder };
