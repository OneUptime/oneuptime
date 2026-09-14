import Protocol from "Common/Types/API/Protocol";
import URL from "Common/Types/API/URL";
import { getSignupPasswordValidationError } from "Common/Types/Password";

type GetEnvFunction = (key: string) => string;

export const env: GetEnvFunction = (key: string): string => {
  return (process.env[key] as string) || "";
};

export const HOST: string = env("HOST") || "localhost";

export const HTTP_PROTOCOL: Protocol =
  env("HTTP_PROTOCOL") === "https" ? Protocol.HTTPS : Protocol.HTTP;

export const BASE_URL: URL = URL.fromString(`${HTTP_PROTOCOL}${HOST}`);

export const IS_USER_REGISTERED: boolean =
  env("E2E_TEST_IS_USER_REGISTERED") === "true";
export const REGISTERED_USER_EMAIL: string =
  env("E2E_TEST_REGISTERED_USER_EMAIL") || "";
export const REGISTERED_USER_PASSWORD: string =
  env("E2E_TEST_REGISTERED_USER_PASSWORD") || "";

/*
 * Every spec that signs a brand new account up shares this passphrase, so a
 * change to the signup password policy has one place to land instead of one
 * per spec.
 */
export const E2E_SIGNUP_PASSWORD: string = "violet river lantern";

/*
 * Checked here against the very function the register form validates with,
 * because a password the policy rejects does not fail visibly: the form blocks
 * submission, no request reaches /identity/signup, the SPA never navigates, and
 * every spec that calls registerAndCreateProject sits on waitForURL until its
 * timeout. Refusing to load is the difference between one readable message and
 * a suite that burns its whole budget on hangs. The message never contains the
 * password itself.
 */
const signupPasswordError: string | null =
  getSignupPasswordValidationError(E2E_SIGNUP_PASSWORD);

if (signupPasswordError) {
  throw new Error(
    `E2E_SIGNUP_PASSWORD does not satisfy the signup password policy: ${signupPasswordError}`,
  );
}

export const IS_BILLING_ENABLED: boolean = env("BILLING_ENABLED") === "true";

export const STATUS_PAGE_URL: URL | null = env("E2E_TEST_STATUS_PAGE_URL")
  ? URL.fromString(env("E2E_TEST_STATUS_PAGE_URL"))
  : null;
