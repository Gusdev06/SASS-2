// One-off: ban every customer email present in the PerfectPay report and revoke
// their course entitlements. Cross-checks processed_orders to flag anyone who is
// actually a paying customer (so they can be reactivated). Reversible: set
// profiles.banned=false ("Reativar") and re-grant entitlement to undo.
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = fs.readFileSync('.env.local', 'utf8');
const get = (k) => {
  const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
};

const sb = createClient(get('NEXT_PUBLIC_SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
});

const emails = fs.readFileSync('/tmp/all_emails.txt', 'utf8').split('\n').map((e) => e.trim().toLowerCase()).filter(Boolean);
const DRY = process.argv.includes('--dry');

const { data: profiles, error: pe } = await sb.from('profiles').select('user_id,email,banned').in('email', emails);
if (pe) throw pe;
const { data: paid } = await sb.from('processed_orders').select('user_id').in('user_id', profiles.map((p) => p.user_id));
const paidIds = new Set((paid || []).map((r) => r.user_id));

const toBan = profiles.filter((p) => !p.banned);
const alreadyBanned = profiles.filter((p) => p.banned);
const paying = profiles.filter((p) => paidIds.has(p.user_id));

console.log(`Report emails:            ${emails.length}`);
console.log(`Matched profiles:         ${profiles.length}`);
console.log(`Already banned:           ${alreadyBanned.length}`);
console.log(`Will ban:                 ${toBan.length}`);
console.log(`⚠️  Have a paid order:      ${paying.length}${paying.length ? ' (flagged below — reactivate if desired)' : ''}`);
if (paying.length) paying.forEach((p) => console.log('   PAID  ' + p.email));

if (DRY) { console.log('\n[dry run] no writes performed'); process.exit(0); }

const banIds = toBan.map((p) => p.user_id);
if (banIds.length) {
  const { error, count } = await sb.from('profiles').update({ banned: true, updated_at: new Date().toISOString() }, { count: 'exact' }).in('user_id', banIds);
  if (error) throw error;
  console.log(`\nBanned: ${count} profiles`);
}

const { data: ents } = await sb.from('course_entitlements').select('email').in('email', emails);
if (ents && ents.length) {
  const { error, count } = await sb.from('course_entitlements').delete({ count: 'exact' }).in('email', emails);
  if (error) throw error;
  console.log(`Revoked course_entitlements: ${count}`);
} else {
  console.log('Revoked course_entitlements: 0');
}
console.log('\nDone.');
