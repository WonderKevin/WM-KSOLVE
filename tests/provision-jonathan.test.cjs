const { test } = require('node:test');
const assert = require('node:assert/strict');
const { provision } = require('../scripts/provision-jonathan.cjs');
function fixture(existing = true) {
  const flags = ['can_view_user_account', 'can_view_admin_automation', ...Array.from({ length: 21 }, (_, i) => 'can_test_' + i)];
  const rows = [{ id: 'admin', email: 'kevin@wondermonday.com', ...Object.fromEntries(flags.map(key => [key, false])) }];
  let account = existing ? { id: 'jonathan', email: 'jonathan@wondermonday.com' } : null, confirmations = 0;
  const from = () => {
    let predicate = () => true, patch;
    const query = {
      select: () => query,
      eq: (key, value) => {
        predicate = row => row[key] === value;
        if (patch) { Object.assign(rows.find(predicate), patch); return Promise.resolve({ error: null }); }
        return query;
      },
      maybeSingle: async () => ({ data: rows.find(predicate) || null, error: null }),
      insert: async row => { rows.push({ id: 'permission-row', ...row }); return { error: null }; },
      update: row => { patch = row; return query; },
    };
    return query;
  };
  const admin = { from, auth: { admin: {
    listUsers: async () => ({ data: { users: account ? [account] : [] }, error: null }),
    updateUserById: async (id, change) => { confirmations++; assert.equal(id, 'jonathan'); assert.deepEqual(change, { email_confirm: true }); account.email_confirmed_at = 'confirmed'; return { data: { user: account }, error: null }; },
  } } };
  return { admin, rows, flags, confirmations: () => confirmations };
}
test('confirms only the requested account and enables every application permission without a password', async () => {
  const f = fixture();
  assert.deepEqual(await provision(f.admin), { permissionCount: 23 });
  assert.equal(f.confirmations(), 1);
  assert.ok(f.flags.every(key => f.rows[1][key] === true));
  assert.ok(f.flags.every(key => f.rows[0][key] === false));
});
test('does not create accounts or grant access if the requested login is missing', async () => {
  const f = fixture(false);
  await assert.rejects(provision(f.admin), /must first be created directly/);
  assert.equal(f.confirmations(), 0); assert.equal(f.rows.length, 1);
});
