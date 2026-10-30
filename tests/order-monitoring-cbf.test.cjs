const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyCbfSource, DELAY_NOTE } = require('../lib/order-monitoring-cbf.cjs');
test('replaces only PO-10077 supplier references, appends one note, and preserves all other fields', () => {
  const order = { poNumber: 'CUSTOMER-PO', actionNotes: 'Keep my note', actions: [{ id: 'keep' }], materials: [
    { supplierPo: 'PO-10077', eta: '2026-11-02', incoming: 100 },
    { supplierPo: ' 10077 ', eta: '' },
    { supplierPo: 'PO-10078', eta: '2026-11-09' },
  ] };
  const original = structuredClone(order), result = applyCbfSource(order);
  assert.equal(result.referencesChanged, 2); assert.equal(result.order.actionNotes, 'Keep my note\n' + DELAY_NOTE);
  assert.deepEqual(result.order.materials, [{ ...order.materials[0], supplierPo: 'CBF-Sell' }, { ...order.materials[1], supplierPo: 'CBF-Sell' }, order.materials[2]]);
  assert.deepEqual(result.order.actions, order.actions); assert.deepEqual(order, original);
  assert.equal(applyCbfSource(result.order).changed, 0);
  assert.equal(applyCbfSource({ ...order, actionNotes: DELAY_NOTE }).order.actionNotes, DELAY_NOTE);
  assert.equal(applyCbfSource({ ...order, materials: [] }).order.actionNotes, 'Keep my note');
});
