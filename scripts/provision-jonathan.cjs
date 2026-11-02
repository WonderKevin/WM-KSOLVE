// Explicitly requested WM application account. Credentials are deployment inputs only.
const { createClient } = require('@supabase/supabase-js');
const EMAIL = 'jonathan@wondermonday.com';
async function provision(admin, loginClient, password) {
  if (!password) throw new Error('Provisioning password is missing.');
  const template = await admin.from('user_permissions').select('*').eq('email', 'kevin@wondermonday.com').maybeSingle();
  if (template.error || !template.data) throw new Error('Could not inspect existing application permission columns.');
  const keys = Object.keys(template.data).filter(key => key.startsWith('can_'));
  if (keys.length < 23 || !keys.includes('can_view_user_account') || !keys.includes('can_view_admin_automation')) throw new Error('Application permission template is incomplete.');
  let account;
  for (let page = 1; ; page++) {
    const result = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (result.error) throw new Error('Could not check existing login accounts.');
    account = result.data.users.find(user => user.email?.toLowerCase() === EMAIL);
    if (account || result.data.users.length < 200) break;
  }
  let created = false;
  if (!account) {
    const result = await admin.auth.admin.createUser({ email: EMAIL, password, email_confirm: true, user_metadata: { full_name: 'Jonathan' } });
    if (result.error || !result.data.user) throw new Error('Could not create Jonathan’s login account.');
    account = result.data.user; created = true;
  }
  // Never reset an existing account password as a side effect of provisioning.
  const login = await loginClient.auth.signInWithPassword({ email: EMAIL, password });
  if (login.error || login.data.user?.id !== account.id) throw new Error(created ? 'Account created, but sign-in verification failed.' : 'Account already exists; supplied password did not verify. Existing password was not changed.');
  const existing = await admin.from('user_permissions').select('id').eq('email', EMAIL).maybeSingle();
  if (existing.error) throw new Error('Could not check Jonathan’s permission record.');
  const permissions = Object.fromEntries(keys.map(key => [key, true]));
  const change = { email: EMAIL, ...permissions, updated_at: new Date().toISOString() };
  const write = existing.data
    ? await admin.from('user_permissions').update(change).eq('id', existing.data.id)
    : await admin.from('user_permissions').insert(change);
  if (write.error) throw new Error('Login verified, but application permission update failed.');
  const verified = await loginClient.from('user_permissions').select('*').eq('email', EMAIL).maybeSingle();
  if (verified.error || !verified.data || keys.some(key => verified.data[key] !== true)) throw new Error('Permissions saved, but verification as Jonathan failed.');
  for (const permission_name of ['can_view_user_account', 'can_view_admin_automation']) {
    const result = await loginClient.rpc('has_app_permission', { permission_name });
    if (result.error || result.data !== true) throw new Error('Administrator permission check failed.');
  }
  await loginClient.auth.signOut({ scope: 'local' });
  return { created, permissionCount: keys.length };
}
async function main() {
  if (process.env.WM_PROVISION_ACCOUNT !== 'jonathan-20261102') return;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, service = process.env.SUPABASE_SERVICE_ROLE_KEY, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !service || !anon) throw new Error('Existing application authentication configuration is unavailable.');
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const result = await provision(createClient(url, service, options), createClient(url, anon, options), process.env.WM_PROVISION_PASSWORD);
  console.log(`Jonathan account ${result.created ? 'created' : 'verified'}: login verified; all ${result.permissionCount} application permissions enabled; Admin and Automation checks passed.`);
}
module.exports = { provision };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
