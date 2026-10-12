import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * A first look at a pasted signing secret, before it is sent: Huntress's
 * secrets are "whsec_" and base64. The server checks it properly
 * (HuntressConnectionService); this only catches the usual slips - the
 * webhook URL pasted back, a secret cut short - while the dialog is open.
 *
 * React-free, so App's tests read it.
 */

const SECRET_PATTERN: RegExp = /^(whsec_)?[A-Za-z0-9+/]{16,}={0,2}$/;

export const HUNTRESS_SIGNING_SECRET_PROBLEM: string = translationKey(
  "This is not a signing secret. In Huntress, choose View Signing Secret on the endpoint and copy all of it: it starts with whsec_.",
);

export function getHuntressSigningSecretProblem(
  value: string | null | undefined,
): string | null {
  const secret: string = (value || "").trim();

  if (!secret) {
    return null;
  }

  if (secret.length > 1100 || !SECRET_PATTERN.test(secret)) {
    return HUNTRESS_SIGNING_SECRET_PROBLEM;
  }

  return null;
}
