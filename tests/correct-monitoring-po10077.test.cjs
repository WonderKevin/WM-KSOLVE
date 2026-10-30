const { test } = require('node:test');
const assert = require('node:assert/strict');
const { correctOrder } = require('../scripts/correct-monitoring-po10077.cjs');
test('supplier ETA correction is narrowly scoped, preserves other data, and is idempotent', () => {
  const order = { poNumber: 'PO-CUSTOMER', pickupDate: '2026-11-09', materials: [
    { supplierPo: 'PO-10077', eta: '2026-11-09', incoming: 100, status: 'Confirmed' },
    { supplierPo: '10077', eta: '2026-11-09' },
    { supplierPo: 'PO-10077', eta: '2026-11-16' },
    { supplierPo: 'PO-10078', eta: '2026-11-09' },
    { supplierPo: 'PO-10077', eta: '' },
  ] };
  const original = structuredClone(order), result = correctOrder(order);
  assert.equal(result.changed, 2); assert.deepEqual(order, original);
  assert.equal(result.order.pickupDate, '2026-11-09');
  assert.deepEqual(result.order.materials[0], { ...order.materials[0], eta: '2026-11-02' });
  assert.equal(result.order.materials[1].eta, '2026-11-02');
  assert.deepEqual(result.order.materials.slice(2), order.materials.slice(2));
  assert.equal(correctOrder(result.order).changed, 0);
});
