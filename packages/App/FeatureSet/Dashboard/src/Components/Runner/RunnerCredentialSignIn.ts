import RunbookCredentialType from "Common/Types/Runbook/RunbookCredentialType";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT A CREDENTIAL REACHES: TWO PLAIN ANSWERS.
 *
 * A credential's Type was a dropdown of two with nothing picked. It is the
 * question every later step follows (SSH Host and SSH Authentication, or
 * Kubernetes), so it is two answers now, each with what it reaches in a
 * line, SSH picked for a new credential (the page's createInitialValues).
 * The column and its values are as before.
 */
export const RUNNER_CREDENTIAL_TYPE_ANSWERS: ReadonlyArray<RunbookCredentialType> =
  [RunbookCredentialType.SSH, RunbookCredentialType.Kubernetes];

export const RUNNER_CREDENTIAL_TYPE_COPY: Record<
  RunbookCredentialType,
  { title: string; description: string }
> = {
  // Names, the same in every language.
  [RunbookCredentialType.SSH]: {
    title: "SSH",
    description: translationKey(
      "A server the Runner signs in to with a key or a password.",
    ),
  },
  [RunbookCredentialType.Kubernetes]: {
    title: "Kubernetes",
    description: translationKey(
      "A cluster's API server, reached with a service account token.",
    ),
  },
};

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
