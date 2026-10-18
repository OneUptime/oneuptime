import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * HOW AN SSH CREDENTIAL SIGNS IN: ONE CHOICE.
 *
 * A new SSH credential's SSH Authentication step showed a Private Key
 * (PEM), its Passphrase and a Password at once - the key "Leave empty when
 * using a password", the password "A key is the better option where you
 * have the choice". The two are alternatives, so the step asks which first
 * and then shows only that one's fields, the key first and preselected.
 *
 * Form-only: the columns are the key, the passphrase and the password, as
 * before (the server still refuses an SSH credential with neither). Stored
 * secrets are never read back, so an existing credential's Edit form asks
 * no choice and offers every secret field, each left as it is when blank.
 *
 * React-free on purpose: App's tests read this without the page.
 */
export enum SshSignIn {
  PrivateKey = "private-key",
  Password = "password",
}

// The form value the choice keeps; never sent (formOnly).
export const SSH_SIGN_IN_FIELD_KEY: string = "sshSignIn";

export const SSH_SIGN_IN_FIELD_TITLE: string = translationKey("Sign in with");

export const SSH_SIGN_IN_ANSWERS: ReadonlyArray<SshSignIn> = [
  SshSignIn.PrivateKey,
  SshSignIn.Password,
];

export const SSH_SIGN_IN_COPY: Record<
  SshSignIn,
  { title: string; description: string }
> = {
  [SshSignIn.PrivateKey]: {
    title: translationKey("Private key"),
    description: translationKey("The better option where you have the choice."),
  },
  [SshSignIn.Password]: {
    title: translationKey("Password"),
    description: translationKey("For hosts without key access."),
  },
};

function asValues(values: unknown): Record<string, unknown> {
  return values && typeof values === "object"
    ? (values as Record<string, unknown>)
    : {};
}

/*
 * The sign-in a form picked, or null where the form asks none - an
 * existing credential's Edit form.
 */
export function getSshSignIn(values: unknown): SshSignIn | null {
  const value: unknown = asValues(values)[SSH_SIGN_IN_FIELD_KEY];

  return value === SshSignIn.PrivateKey || value === SshSignIn.Password
    ? value
    : null;
}

/*
 * Whether a secret field shows: the answer picked is its own, or no answer
 * is asked (an Edit form offers every secret).
 */
export function showsSshSecret(values: unknown, signIn: SshSignIn): boolean {
  const picked: SshSignIn | null = getSshSignIn(values);

  return picked === null || picked === signIn;
}
