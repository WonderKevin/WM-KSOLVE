const { test } = require('node:test');
const assert = require('node:assert/strict');
const { provision } = require('../scripts/provision-jonathan.cjs');
function fixture(existing = false, loginFails = false) {
  const flags = ['can_view_user_account', 'can_view_admin_automation', ...Array.from({ length: 21 }, (_, i) => 'can_test_' + i)];
  const rows = [{ id: 'admin', email: 'kevin@wondermonday.com', ...Object.fromEntries(flags.map(key => [key, false])) }];
  let account = existing ? { id: 'jonathan', email: 'jonathan@wondermonday.com' } : null, creates = 0;
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
    createUser: async input => { creates++; assert.equal(input.email_confirm, true); account = { id: 'jonathan', email: input.email }; return { data: { user: account }, error: null }; },
  } } };
  const login = { from, auth: { signInWithPassword: async () => ({ data: { user: loginFails ? null : account }, error: loginFails ? new Error('Invalid credentials') : null }), signOut: async () => ({ error: null }) }, rpc: async () => ({ data: true, error: null }) };
  return { admin, login, rows, flags, creates: () => creates };
}
test('creates only the requested account and verifies every permission', async () => {
  const f = fixture();
  assert.deepEqual(await provision(f.admin, f.login, 'test-only-password'), { created: true, permissionCount: 23 });
  assert.equal(f.creates(), 1);
  assert.ok(f.flags.every(key => f.rows[1][key] === true));
  assert.ok(f.flags.every(key => f.rows[0][key] === false));
});
test('does not reset existing passwords or grant permissions when supplied credentials fail', async () => {
  const f = fixture(true, true);
  await assert.rejects(provision(f.admin, f.login, 'test-only-password'), /Existing password was not changed/);
  assert.equal(f.creates(), 0); assert.equal(f.rows.length, 1);
});
