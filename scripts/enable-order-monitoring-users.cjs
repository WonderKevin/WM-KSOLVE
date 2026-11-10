// Requested November 10, 2026: grant Order Monitoring to all existing WM accounts.
// Existing permission values are preserved; no Admin privileges are granted.
const { createClient } = require('@supabase/supabase-js');
async function enableAccounts(db) {
  const users = [];
  for (let page = 1; ; page++) {
    const result = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (result.error) throw new Error('Could not audit registered WM users.');
    users.push(...result.data.users.filter(user => user.email));
    if (result.data.users.length < 200) break;
  }
  const permissions = [];
  for (let offset = 0; ; offset += 500) {
    const result = await db.from('user_permissions').select('*').order('email').range(offset, offset + 499);
    if (result.error) throw new Error('Could not audit application access records.');
    permissions.push(...result.data);
    if (result.data.length < 500) break;
  }
  const byEmail = new Map(permissions.map(row => [row.email.toLowerCase(), row]));
  const template = byEmail.get('kevin@wondermonday.com');
  if (!template) throw new Error('Application permission template is unavailable.');
  const defaults = Object.fromEntries(Object.keys(template).filter(key => key.startsWith('can_')).map(key => [key, false]));
  Object.assign(defaults, { can_view_dashboard: true, can_view_kehe_dashboard: true, can_view_tonys_dashboard: true });
  let newlyCovered = 0, created = 0;
  for (const user of users) {
    const email = user.email.toLowerCase(), row = byEmail.get(email);
    if (email !== 'kevin@wondermonday.com' && !row?.can_view_user_account && !row?.can_view_admin_automation) newlyCovered++;
    if (!row) {
      const result = await db.from('user_permissions').insert({ email, ...defaults });
      if (result.error && result.error.code !== '23505') throw new Error('Could not add a missing WM application access record.');
      created++;
    }
    const check = await db.from('user_permissions').select('email').eq('email', email).maybeSingle();
    if (check.error || !check.data) throw new Error('Application membership verification failed.');
  }
  return { users: users.length, newlyCovered, created };
}
async function main() {
  if (process.env.WM_ENABLE_ORDER_MONITORING_USERS !== '20261110') return;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Existing deployment configuration is unavailable.');
  const result = await enableAccounts(createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }));
  console.log(`Order Monitoring access verified for all ${result.users} registered accounts; ${result.newlyCovered} previously excluded by the Admin-only rule; ${result.created} missing WM access records added. Existing permissions preserved.`);
}
module.exports = { enableAccounts };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
