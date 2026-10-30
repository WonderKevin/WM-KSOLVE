const { test } = require('node:test');
const assert = require('node:assert/strict');
const { correctOrder } = require('../scripts/update-monitoring-items.cjs');
const products = require('../lib/order-monitoring-products.json');
test('item update applies the supplied PO mapping and clears only supplier placeholders', () => {
  for (const [poNumber, reference] of Object.entries(products)) {
    const order = { poNumber, product: '', materials: [{ supplierPo: ' To confirm ', eta: '2026-11-02', required: 100 }, { supplierPo: 'PO-10077' }] };
    const original = structuredClone(order), result = correctOrder(order);
    assert.equal(result.order.product, reference.itemNumber + ' · ' + reference.description);
    assert.deepEqual(result.order.materials[0], { ...original.materials[0], supplierPo: '' });
    assert.deepEqual(result.order.materials[1], original.materials[1]);
    assert.deepEqual(order, original); assert.equal(correctOrder(result.order).changed, 0);
  }
  const other = { poNumber: 'PO-OTHER', product: 'Existing product', materials: [] };
  assert.equal(correctOrder(other).order, other);
});
