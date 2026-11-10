const { test } = require('node:test');
const assert = require('node:assert/strict');
const { enableAccounts } = require('../scripts/enable-order-monitoring-users.cjs');
test('covers registered users without broadening existing Admin or other access', async () => {
  const rows = [
    { email: 'kevin@wondermonday.com', can_view_user_account: true, can_view_admin_automation: true, can_reprocess_invoices: true, can_view_dashboard: true },
    { email: 'member@example.test', can_view_user_account: false, can_view_admin_automation: false, can_reprocess_invoices: false, can_view_dashboard: false },
  ];
  const original = structuredClone(rows);
  const db = {
    auth: { admin: { listUsers: async () => ({ data: { users: [...rows.slice(0, 2), { email: 'missing@example.test' }] }, error: null }) } },
    from: () => {
      let email;
      const query = {
        select: () => query, order: () => query,
        range: async () => ({ data: rows.slice(), error: null }),
        eq: (_, value) => { email = value; return query; },
        maybeSingle: async () => ({ data: rows.find(row => row.email === email) || null, error: null }),
        insert: async row => { rows.push(row); return { error: null }; },
      };
      return query;
    },
  };
  assert.deepEqual(await enableAccounts(db), { users: 3, newlyCovered: 2, created: 1 });
  assert.deepEqual(rows.slice(0, 2), original);
  assert.equal(rows[2].can_view_user_account, false); assert.equal(rows[2].can_view_admin_automation, false);
  assert.equal(rows[2].can_reprocess_invoices, false); assert.equal(rows[2].can_view_dashboard, true);
  assert.equal((await enableAccounts(db)).created, 0);
});
