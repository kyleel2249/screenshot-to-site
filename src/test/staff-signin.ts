import type { Client } from "../lib/api-client";
import { totp } from "../lib/security/totp";

const state = new Map<string, { secret: string; recovery: string[] }>();
/** Signs a staff member in the way a person does: first time sets up the authenticator, afterwards uses a one-time recovery code. */
export async function signInStaff(api: Client, portal: string, email: string, password: string) {
  const login = await api.login(email, password);
  if (!login.ok) return login;
  const admin = api.admin(portal), me = await admin.me();
  if (me.data?.mfa === "setup_required") {
    const s = await admin.mfaSetup(); const c = await admin.mfaConfirm(await totp(s.data!.secret));
    state.set(email, { secret: s.data!.secret, recovery: c.data!.recoveryCodes });
  } else if (me.data?.mfa === "code_required") await admin.mfaVerify(state.get(email)!.recovery.shift()!);
  return login;
}
