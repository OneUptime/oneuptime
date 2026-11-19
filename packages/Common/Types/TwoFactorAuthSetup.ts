import TwoFactorAuthStatus from "./TwoFactorAuthStatus";

/*
 * NO SECOND STEP, NO TWO-FACTOR AUTHENTICATION (issue #9666).
 *
 * A person could switch two-factor authentication on from their profile with
 * no authenticator app, security key or passkey behind it. The profile then
 * said "Enabled" in green over "No security keys added yet", and the account
 * had no second factor at all: the next sign-in with the password - the
 * owner's or a thief's - was handed a QR code to enrol whatever app the
 * person holding the password chose.
 *
 * So, on the server, for a person's own account (UserService):
 *
 *   - two-factor authentication is turned on only once a second step is set
 *     up and verified: an authenticator app whose code was entered, a
 *     security key or a passkey (TWO_FACTOR_AUTH_NEEDS_A_METHOD_MESSAGE).
 *     The profile's Enable starts that setup, and turns it on at its end;
 *   - the last of them is not removed while two-factor authentication is on
 *     (TWO_FACTOR_AUTH_LAST_METHOD_MESSAGE): turning it off is its own,
 *     confirmed decision, never what removing a phone quietly does.
 *
 * "Required, with nothing set up" stays a state a master admin can create
 * (Admin Dashboard > Users: Require two-factor authentication, or Reset it
 * for a lost device): the person is walked through enrolment at their next
 * sign-in with a password, which is the point of requiring it. The profile
 * says so as it is - "Setup needed", never "Enabled" - and so it does for
 * an account switched on the old way. Nothing is migrated: the two cannot
 * be told apart, and turning either off would quietly take a requirement
 * away (TwoFactorAuthStatus.EnabledPendingSetup).
 *
 * React-free and server-safe: the API, the Dashboard and their tests read it.
 */

// What GET /user/two-factor-auth-status answers for the signed-in person.
export interface TwoFactorAuthSetup {
  status: TwoFactorAuthStatus;
  /*
   * Authenticator apps whose code was entered, security keys and passkeys:
   * what a sign-in's second step can ask for. Backup codes are not counted
   * (UserService.countVerifiedTwoFactorAuthMethods says why).
   */
  verifiedMethodCount: number;
}

// Under the API's address (APP_API_URL), for the signed-in person.
export const TWO_FACTOR_AUTH_STATUS_API_ROUTE: string =
  "/user/two-factor-auth-status";

// Turning it on for an account with nothing to ask for.
export const TWO_FACTOR_AUTH_NEEDS_A_METHOD_MESSAGE: string =
  "Set up an authenticator app, a security key or a passkey first, then turn on two factor authentication.";

// Removing the last thing it can ask for while it is on.
export const TWO_FACTOR_AUTH_LAST_METHOD_MESSAGE: string =
  "Two factor authentication is on, and this is the last authenticator app, security key or passkey it can ask for. Add another one, or turn off two factor authentication, before you remove this one.";

// Turning it on for an account that is not the caller's, outside the Admin Dashboard.
export const TWO_FACTOR_AUTH_OWN_ACCOUNT_ON_MESSAGE: string =
  "You can only turn on two factor authentication for your own account.";

const STATUSES: ReadonlyArray<string> = Object.values(TwoFactorAuthStatus);

export default class TwoFactorAuthSetupUtil {
  /*
   * The requirement and what is set up behind it, as one value: required
   * with nothing set up is EnabledPendingSetup, the state a master admin
   * creates, and never EnabledConfigured.
   */
  public static getStatus(data: {
    isTwoFactorAuthEnabled: boolean;
    verifiedMethodCount: number;
  }): TwoFactorAuthStatus {
    if (!data.isTwoFactorAuthEnabled) {
      return TwoFactorAuthStatus.NotEnabled;
    }

    if (data.verifiedMethodCount > 0) {
      return TwoFactorAuthStatus.EnabledConfigured;
    }

    return TwoFactorAuthStatus.EnabledPendingSetup;
  }

  /*
   * The answer of GET /user/two-factor-auth-status, or null when it is not
   * one. A status that disagrees with its own count - "configured" with
   * nothing set up - is no answer either: the page would offer what the
   * server then refuses.
   */
  public static parse(value: unknown): TwoFactorAuthSetup | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const answer: Record<string, unknown> = value as Record<string, unknown>;
    const status: unknown = answer["status"];
    const count: unknown = answer["verifiedMethodCount"];

    if (typeof status !== "string" || !STATUSES.includes(status)) {
      return null;
    }

    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
      return null;
    }

    const derived: TwoFactorAuthStatus = TwoFactorAuthSetupUtil.getStatus({
      isTwoFactorAuthEnabled: status !== TwoFactorAuthStatus.NotEnabled,
      verifiedMethodCount: count,
    });

    if (derived !== status) {
      return null;
    }

    return {
      status: status as TwoFactorAuthStatus,
      verifiedMethodCount: count,
    };
  }
}
