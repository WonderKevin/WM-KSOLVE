const { test } = require('node:test');
const assert = require('node:assert/strict');
const { repairOrder, isWorkbookFooter } = require('../lib/order-monitoring-material-repair.cjs');
const empty = { itemNumber: '', supplierPo: '', eta: '', required: null, available: null, incoming: null, uploadedShortage: null };
test('repairs only the requested order and explanatory rows while retaining real material quantities', () => {
  const refs = ['PO-10101', 'PO-10101', 'PO-10105', 'PO-10105', 'PO-10104', 'PO-10104', 'PO-10141'];
  const items = ['ITM-10004', 'ITM-10003', 'ITM-10361', 'ITM-10113', 'ITM-10365', 'ITM-10391', 'ITM-10367'];
  const order = { poNumber: 'PO-10139', notes: 'Keep', materials: [
    ...items.map(itemNumber => ({ ...empty, itemNumber, description: itemNumber, required: 5, available: 0 })),
    { ...empty, description: '* Available - Reserved includes globally unreserved on-hand' },
    { ...empty, description: 'Source: Arctanis PO-10139 material coverage' },
  ] };
  const original = structuredClone(order), result = repairOrder(order);
  assert.equal(result.rowsRemoved, 2); assert.equal(result.referencesChanged, 7);
  assert.deepEqual(result.order.materials.map(m => m.supplierPo), refs);
  assert.ok(result.order.materials.every(m => m.required === 5 && m.available === 0));
  assert.deepEqual(order, original); assert.equal(repairOrder(result.order).changed, 0);
  assert.equal(repairOrder({ ...order, poNumber: 'PO-OTHER' }).changed, 0);
  assert.equal(isWorkbookFooter({ ...empty, description: 'Source: Arctanis', required: 0 }), false);
});
