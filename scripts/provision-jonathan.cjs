// Explicitly requested full application access. Passwords never enter this deployment process.
const { createClient } = require('@supabase/supabase-js');
const EMAIL = 'jonathan@wondermonday.com';
async function provision(admin) {
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
  if (!account) throw new Error('Jonathan’s login account must first be created directly with the authentication service.');
  if (!account.email_confirmed_at) {
    const confirmation = await admin.auth.admin.updateUserById(account.id, { email_confirm: true });
    if (confirmation.error || !confirmation.data.user?.email_confirmed_at) throw new Error('Could not confirm Jonathan’s requested account.');
  }
  const existing = await admin.from('user_permissions').select('id').eq('email', EMAIL).maybeSingle();
  if (existing.error) throw new Error('Could not check Jonathan’s permission record.');
  const permissions = Object.fromEntries(keys.map(key => [key, true]));
  const change = { email: EMAIL, ...permissions, updated_at: new Date().toISOString() };
  const write = existing.data
    ? await admin.from('user_permissions').update(change).eq('id', existing.data.id)
    : await admin.from('user_permissions').insert(change);
  if (write.error) throw new Error('Account found, but application permission update failed.');
  const verified = await admin.from('user_permissions').select('*').eq('email', EMAIL).maybeSingle();
  if (verified.error || !verified.data || keys.some(key => verified.data[key] !== true)) throw new Error('Permissions saved, but stored permission verification failed.');
  return { permissionCount: keys.length };
}
async function main() {
  if (process.env.WM_PROVISION_ACCOUNT !== 'jonathan-20261102') return;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) throw new Error('Existing application authentication configuration is unavailable.');
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const result = await provision(createClient(url, service, options));
  console.log(`Jonathan account confirmed: all ${result.permissionCount} application permissions enabled and verified.`);
}
module.exports = { provision };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
