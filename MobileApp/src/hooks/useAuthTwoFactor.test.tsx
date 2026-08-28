import React from "react";
import { Text } from "react-native";
import { act, render, waitFor } from "@testing-library/react-native";
import { describe, expect, test, jest, beforeEach } from "@jest/globals";
import { AuthProvider, useAuth } from "./useAuth";
import {
  login as apiLogin,
  logout as apiLogout,
  verifyTotpAuth as apiVerifyTotpAuth,
  verifyBackupCode as apiVerifyBackupCode,
  verifyTotpEnrolment as apiVerifyTotpEnrolment,
  type LoginResponse,
  type TwoFactorMethod,
} from "../api/auth";
import { hasServerUrl } from "../storage/serverUrl";
import { getTokens } from "../storage/keychain";
import {
  clearAllSsoTokens,
  getGlobalSsoToken,
  getSsoTokens,
} from "../storage/ssoTokens";
import { consumeInitialSsoCallbackUrl } from "../sso/deepLink";
import { unregisterPushToken } from "./pushTokenUtils";

/*
 * AuthProvider is the only thing in the mobile app that decides a person is
 * signed in, and `setIsAuthenticated(true)` is not a flag - it swaps the whole
 * navigator out from under whatever is on screen. That single fact is what
 * every assertion in this file is protecting, from two directions:
 *
 *   - Too early. A password step that answered with a two-factor challenge is
 *     NOT a login. If the provider authenticates on that response, an on-call
 *     engineer who typed a stolen password lands in the dashboard having
 *     proved exactly one factor, and the second one may as well not exist.
 *   - Too eagerly. The second step DOES produce a real session - the api layer
 *     has already stored the tokens by the time the provider sees it - but the
 *     enrolment response also carries the account's recovery codes in
 *     plaintext, and that response is the only copy that will ever exist
 *     anywhere. Authenticating the moment the code verifies replaces the
 *     screen showing those codes with the dashboard, and they are gone. So the
 *     completed user is HELD, and only `completePendingLogin()` publishes it.
 *
 * The third thing being pinned is where the credentials live. Every identity
 * verify route re-submits the email and password, because there is no session
 * to authenticate the second step with. The provider holds them in memory for
 * exactly that, and the tests below prove they reach the api layer - and that
 * they are dropped the moment the attempt ends, however it ends. The
 * alternative the code is avoiding is passing a plaintext password through
 * React Navigation params, which are serialized into navigation state that
 * gets persisted, restored and printed by developer tooling.
 *
 * The api layer is a stand-in throughout: what a verify route posts and how it
 * stores tokens is auth.ts's business and has its own suite. This file is only
 * about the decisions AuthProvider makes given each answer.
 */

jest.mock("../api/auth", () => {
  return {
    login: jest.fn(),
    logout: jest.fn(),
    verifyTotpAuth: jest.fn(),
    verifyBackupCode: jest.fn(),
    verifyTotpEnrolment: jest.fn(),
  };
});

jest.mock("../storage/serverUrl", () => {
  return {
    hasServerUrl: jest.fn(),
  };
});

jest.mock("../storage/keychain", () => {
  return {
    getTokens: jest.fn(),
  };
});

jest.mock("../storage/ssoTokens", () => {
  return {
    getSsoTokens: jest.fn(),
    getGlobalSsoToken: jest.fn(),
    clearAllSsoTokens: jest.fn(),
  };
});

jest.mock("../sso/deepLink", () => {
  return {
    startSsoCallbackCapture: jest.fn(),
    stopSsoCallbackCapture: jest.fn(),
    consumeInitialSsoCallbackUrl: jest.fn(),
  };
});

jest.mock("../sso/session", () => {
  return {
    completeSsoLoginFromUrl: jest.fn(),
  };
});

/*
 * The provider only needs setOnAuthFailure from the client, but mocking the
 * module also keeps the real axios instance (and its interceptors) out of the
 * test entirely.
 */
jest.mock("../api/client", () => {
  return {
    __esModule: true,
    default: { post: jest.fn(), get: jest.fn() },
    setOnAuthFailure: jest.fn(),
  };
});

jest.mock("./pushTokenUtils", () => {
  return {
    PUSH_TOKEN_KEY: "oneuptime_expo_push_token",
    unregisterPushToken: jest.fn(),
  };
});

const EMAIL: string = "on-call@example.com";

/*
 * The value the whole "hold it in memory, never in navigation params" design
 * exists for. Every assertion that names it is asserting about a plaintext
 * password.
 */
const PASSWORD: string = "correct-horse-battery-staple";

const USER: LoginResponse["user"] = {
  _id: "user-1",
  email: EMAIL,
  name: "On Call Engineer",
  isMasterAdmin: false,
};

const AUTHENTICATOR: TwoFactorMethod = {
  _id: "totp-1",
  name: "iPhone Authenticator",
};

const SECURITY_KEY: TwoFactorMethod = {
  _id: "webauthn-1",
  name: "YubiKey 5C",
};

const MINTED_CODES: Array<string> = [
  "aaaa-1111",
  "bbbb-2222",
  "cccc-3333",
  "dddd-4444",
];

function loginApi(): jest.Mock {
  return apiLogin as unknown as jest.Mock;
}

function logoutApi(): jest.Mock {
  return apiLogout as unknown as jest.Mock;
}

function totpApi(): jest.Mock {
  return apiVerifyTotpAuth as unknown as jest.Mock;
}

function backupCodeApi(): jest.Mock {
  return apiVerifyBackupCode as unknown as jest.Mock;
}

function enrolmentApi(): jest.Mock {
  return apiVerifyTotpEnrolment as unknown as jest.Mock;
}

/** What /login answers with when the account has factors enrolled. */
function challenge(overrides: Partial<LoginResponse> = {}): LoginResponse {
  return {
    accessToken: "",
    refreshToken: "",
    refreshTokenExpiresAt: "",
    user: USER,
    twoFactorRequired: true,
    totpAuthList: [AUTHENTICATOR],
    webAuthnList: [SECURITY_KEY],
    backupCodeCount: 8,
    ...overrides,
  };
}

/**
 * What /login answers with when an administrator turned the requirement on for
 * an account that has nothing enrolled. Note the EMPTY factor lists - that is
 * why the provider cannot decide "enrolment" by looking at the lists.
 */
function enrolmentChallenge(
  overrides: Partial<LoginResponse> = {},
): LoginResponse {
  return {
    accessToken: "",
    refreshToken: "",
    refreshTokenExpiresAt: "",
    user: USER,
    twoFactorRequired: true,
    twoFactorEnrolmentRequired: true,
    twoFactorAuthId: "pending-enrolment-1",
    twoFactorOtpUrl:
      "otpauth://totp/OneUptime:on-call%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=OneUptime",
    ...overrides,
  };
}

/** A real session: what the api layer returns once tokens are stored. */
function session(overrides: Partial<LoginResponse> = {}): LoginResponse {
  return {
    accessToken: "access-abc",
    refreshToken: "refresh-abc",
    refreshTokenExpiresAt: "2030-01-01T00:00:00.000Z",
    user: USER,
    ...overrides,
  };
}

type AuthValue = ReturnType<typeof useAuth>;

/*
 * The house pattern for reading a context: a child that renders inside the
 * provider, publishes whatever the context currently holds, and re-publishes
 * on every re-render so assertions always see the latest value.
 */
const authProbe: { current: AuthValue | null } = { current: null };

function AuthProbe(): React.JSX.Element {
  const auth: AuthValue = useAuth();
  authProbe.current = auth;

  return <Text>{auth.isLoading ? "loading" : "ready"}</Text>;
}

function currentAuth(): AuthValue {
  if (!authProbe.current) {
    throw new Error("AuthProvider was never rendered");
  }

  return authProbe.current;
}

interface RenderedProvider {
  unmount: () => Promise<void> | void;
}

/*
 * `render` is awaited because React 19's `act` is asynchronous, which makes
 * @testing-library/react-native return a promise here; not awaiting it leaves
 * the tree half-mounted and leaks into the next test. The wait on `isLoading`
 * is the provider saying its startup check has finished - asserting before
 * that races the effect that would flip `isAuthenticated`.
 */
async function renderAuthProvider(): Promise<RenderedProvider> {
  const rendered: RenderedProvider = (await render(
    <AuthProvider>
      <AuthProbe />
    </AuthProvider>,
  )) as unknown as RenderedProvider;

  await waitFor((): void => {
    expect(authProbe.current?.isLoading).toBe(false);
  });

  return rendered;
}

/** Render the provider and run the password step against `response`. */
async function signInWith(response: LoginResponse): Promise<LoginResponse> {
  loginApi().mockResolvedValue(response as never);

  await renderAuthProvider();

  let result: LoginResponse | null = null;

  await act(async (): Promise<void> => {
    result = await currentAuth().login(EMAIL, PASSWORD);
  });

  return result as unknown as LoginResponse;
}

function pending(): NonNullable<AuthValue["pendingTwoFactor"]> {
  const value: AuthValue["pendingTwoFactor"] = currentAuth().pendingTwoFactor;

  if (!value) {
    throw new Error("No two factor challenge is pending");
  }

  return value;
}

beforeEach((): void => {
  authProbe.current = null;

  /*
   * Defaults: a configured server, no SSO callback waiting, no stored session.
   * Anything else and the provider would authenticate at startup, which would
   * make every "it did not authenticate" assertion below pass for free.
   */
  (hasServerUrl as unknown as jest.Mock).mockResolvedValue(true as never);
  (consumeInitialSsoCallbackUrl as unknown as jest.Mock).mockResolvedValue(
    null as never,
  );
  (getTokens as unknown as jest.Mock).mockResolvedValue(null as never);
  (getSsoTokens as unknown as jest.Mock).mockResolvedValue({} as never);
  (getGlobalSsoToken as unknown as jest.Mock).mockResolvedValue(null as never);
  (clearAllSsoTokens as unknown as jest.Mock).mockResolvedValue(
    undefined as never,
  );
  (unregisterPushToken as unknown as jest.Mock).mockResolvedValue(
    undefined as never,
  );

  logoutApi().mockResolvedValue(undefined as never);
  loginApi().mockResolvedValue(session() as never);
  totpApi().mockResolvedValue(session() as never);
  backupCodeApi().mockResolvedValue(session() as never);
  enrolmentApi().mockResolvedValue(session() as never);
});

describe("A password step answered with a two factor challenge", () => {
  test("the challenge is parked on the context instead of being dropped", async () => {
    /*
     * Before this existed the mobile app answered a 2FA account with "not yet
     * supported" and sent the user to the web dashboard - which is the one
     * with the incident on it.
     */
    await signInWith(challenge());

    expect(currentAuth().pendingTwoFactor).not.toBeNull();
  });

  test("the credentials are held, because the verify routes have no session", async () => {
    /*
     * There is no token until the second step completes, so the email and
     * password ARE the authentication for it. Dropping them here means the
     * verify call goes out with an empty credential and the server answers
     * "Email and password are required."
     */
    await signInWith(challenge());

    expect(pending().email).toBe(EMAIL);
    expect(pending().password).toBe(PASSWORD);
  });

  test("both factor lists are carried through", async () => {
    /*
     * The security key list matters even though this client cannot use one:
     * the challenge screen lists it as unavailable. Dropping it here makes the
     * screen look, to the key's owner, like the key had been deleted.
     */
    await signInWith(challenge());

    expect(pending().totpAuthList).toEqual([AUTHENTICATOR]);
    expect(pending().webAuthnList).toEqual([SECURITY_KEY]);
  });

  test("a missing factor list becomes an empty array, not undefined", async () => {
    /*
     * The challenge screen maps over both. An undefined list is a crash on the
     * screen a user reaches only when they are already locked out.
     */
    await signInWith(
      challenge({ totpAuthList: [AUTHENTICATOR], webAuthnList: undefined }),
    );

    expect(pending().webAuthnList).toEqual([]);
  });

  test("the recovery code count is carried through", async () => {
    await signInWith(challenge({ backupCodeCount: 3 }));

    expect(pending().backupCodeCount).toBe(3);
  });

  test("a count of zero survives as zero", async () => {
    /*
     * Zero is the one value the UI acts on: it is what makes the app say "you
     * have no recovery codes, ask an administrator" instead of showing a code
     * box that can never accept anything.
     */
    await signInWith(challenge({ backupCodeCount: 0 }));

    expect(pending().backupCodeCount).toBe(0);
  });

  test("an unreported count becomes null rather than zero", async () => {
    /*
     * NULL IS NOT ZERO. The server omits the count when it could not read it.
     * Collapsing that to zero tells a user holding ten printed recovery codes
     * that they have none and sends them to find an administrator, in the
     * middle of the incident that made them sign in.
     */
    await signInWith(challenge({ backupCodeCount: undefined }));

    expect(pending().backupCodeCount).toBeNull();
  });

  test("the user is NOT authenticated", async () => {
    /*
     * The headline assertion of the file. `isAuthenticated` swaps the whole
     * navigator, so flipping it here walks somebody who has proved exactly one
     * factor straight into the dashboard - which is the entire thing the
     * second factor exists to prevent.
     */
    await signInWith(challenge());

    expect(currentAuth().isAuthenticated).toBe(false);
    expect(currentAuth().user).toBeNull();
  });

  test("nothing is held for completion either", async () => {
    /*
     * `completePendingLogin` is reachable from the screens the challenge
     * navigates to. If the password step had already parked a user for
     * release, one of those screens could publish it without a code.
     */
    await signInWith(challenge());

    expect(currentAuth().pendingLoginUserId).toBeNull();
  });

  test("the response is still returned, so the screen can route on it", async () => {
    /*
     * LoginScreen picks TwoFactor vs TwoFactorEnrolment from this value. A
     * provider that swallowed it would leave the user on the login screen with
     * a spinner that stopped.
     */
    const response: LoginResponse = await signInWith(challenge());

    expect(response.twoFactorRequired).toBe(true);
  });
});

describe("A password step that needs no second factor", () => {
  test("signs the user in exactly as before", async () => {
    /*
     * The regression guard. Everything else in this file is about NOT
     * authenticating; this is the path that must still work for the accounts
     * with no second factor, which is most of them.
     */
    await signInWith(session());

    expect(currentAuth().isAuthenticated).toBe(true);
    expect(currentAuth().user).toEqual(USER);
  });

  test("parks no challenge", async () => {
    await signInWith(session());

    expect(currentAuth().pendingTwoFactor).toBeNull();
  });
});

describe("A password step from an account being forced to enrol", () => {
  test("the enrolment is parked with its id and otpauth URL", async () => {
    /*
     * Both halves are load-bearing. The id is quoted back with the first
     * working code - the server drops an undefined predicate rather than
     * matching nothing, so an omitted id stops meaning "this enrolment". The
     * URL carries the secret the enrolment screen prints, because a handset
     * cannot scan its own screen.
     */
    await signInWith(enrolmentChallenge());

    expect(pending().enrolment).toEqual({
      twoFactorAuthId: "pending-enrolment-1",
      twoFactorOtpUrl:
        "otpauth://totp/OneUptime:on-call%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=OneUptime",
    });
  });

  test("the credentials are held for the enrolment verify too", async () => {
    await signInWith(enrolmentChallenge());

    expect(pending().email).toBe(EMAIL);
    expect(pending().password).toBe(PASSWORD);
  });

  test("the empty factor lists do not stop the challenge being parked", async () => {
    /*
     * An account being forced to enrol has NOTHING set up, so both lists are
     * empty. A provider that decided "is this a challenge?" by looking at the
     * lists would treat this as a plain login and hand back a session that
     * does not exist.
     */
    await signInWith(enrolmentChallenge());

    expect(currentAuth().pendingTwoFactor).not.toBeNull();
    expect(pending().totpAuthList).toEqual([]);
    expect(pending().webAuthnList).toEqual([]);
  });

  test("the user is NOT authenticated", async () => {
    await signInWith(enrolmentChallenge());

    expect(currentAuth().isAuthenticated).toBe(false);
    expect(currentAuth().user).toBeNull();
  });

  test("a plain challenge carries no enrolment", async () => {
    /*
     * The enrolment screen is reached off this field. Setting it on an ordinary
     * challenge would ask a user who already has an authenticator app to enrol
     * a second one to get past their own sign-in.
     */
    await signInWith(challenge());

    expect(pending().enrolment).toBeUndefined();
  });
});

describe("The verify wrappers re-submit the held credentials", () => {
  test("verifyTotpAuth posts the held email and password with the code", async () => {
    /*
     * This is the whole reason the context holds them. If the screen had to
     * supply them, they would have to travel there in navigation params - i.e.
     * a plaintext password inside serialized, persisted, tooling-visible
     * navigation state.
     */
    await signInWith(challenge());

    await act(async (): Promise<void> => {
      await currentAuth().verifyTotpAuth({
        twoFactorAuthId: AUTHENTICATOR._id,
        code: "123456",
      });
    });

    expect(totpApi()).toHaveBeenCalledWith({
      email: EMAIL,
      password: PASSWORD,
      twoFactorAuthId: AUTHENTICATOR._id,
      code: "123456",
    });
  });

  test("verifyBackupCode posts the held email and password with the code", async () => {
    await signInWith(challenge());

    await act(async (): Promise<void> => {
      await currentAuth().verifyBackupCode({ backupCode: "aaaa-1111" });
    });

    expect(backupCodeApi()).toHaveBeenCalledWith({
      email: EMAIL,
      password: PASSWORD,
      backupCode: "aaaa-1111",
    });
  });

  test("verifyTotpEnrolment quotes back the enrolment id the server issued", async () => {
    /*
     * The id comes from the parked enrolment, not from the screen. The screen
     * only ever has the six digits the user typed; an enrolment verified
     * against some other row is an account that thinks it enrolled a device it
     * did not.
     */
    await signInWith(enrolmentChallenge());

    await act(async (): Promise<void> => {
      await currentAuth().verifyTotpEnrolment({ code: "654321" });
    });

    expect(enrolmentApi()).toHaveBeenCalledWith({
      email: EMAIL,
      password: PASSWORD,
      twoFactorAuthId: "pending-enrolment-1",
      code: "654321",
    });
  });
});

/*
 * The guard the tests below are after has to be a real guard, not an accident.
 * Reaching through a null challenge for the email would ALSO reject - with a
 * TypeError - and would also leave the api layer uncalled, so an assertion
 * that only checks "something threw" passes just as well against code that has
 * no guard at all. The message is what separates the two, and it is also what
 * the screen puts in front of the user instead of a red box.
 */
const NO_CHALLENGE_MESSAGE: RegExp = /waiting/i;

describe("A verify wrapper called with no challenge in flight", () => {
  test("verifyTotpAuth throws instead of posting an empty credential", async () => {
    /*
     * Reachable for real: the challenge screen can be left mounted while
     * `cancelTwoFactor` or a 401 clears the context underneath it. Posting
     * anyway sends an empty email and password to the identity route, and the
     * failure the user sees is "wrong code" for a code that was right.
     */
    await renderAuthProvider();

    await expect(
      currentAuth().verifyTotpAuth({
        twoFactorAuthId: AUTHENTICATOR._id,
        code: "123456",
      }),
    ).rejects.toThrow(NO_CHALLENGE_MESSAGE);

    expect(totpApi()).not.toHaveBeenCalled();
  });

  test("verifyBackupCode throws instead of posting an empty credential", async () => {
    await renderAuthProvider();

    await expect(
      currentAuth().verifyBackupCode({ backupCode: "aaaa-1111" }),
    ).rejects.toThrow(NO_CHALLENGE_MESSAGE);

    expect(backupCodeApi()).not.toHaveBeenCalled();
  });

  test("verifyTotpEnrolment throws when nothing is enrolling", async () => {
    await renderAuthProvider();

    await expect(
      currentAuth().verifyTotpEnrolment({ code: "654321" }),
    ).rejects.toThrow(NO_CHALLENGE_MESSAGE);

    expect(enrolmentApi()).not.toHaveBeenCalled();
  });

  test("verifyTotpEnrolment throws on an ordinary challenge, which has no enrolment id", async () => {
    /*
     * A pending challenge is not enough - this route needs the id of the
     * enrolment being set up, and an ordinary challenge has none. Without the
     * check the call would go out with an empty id, which the server treats as
     * "whichever enrolment this account happens to have".
     */
    await signInWith(challenge());

    await expect(
      currentAuth().verifyTotpEnrolment({ code: "654321" }),
    ).rejects.toThrow(NO_CHALLENGE_MESSAGE);

    expect(enrolmentApi()).not.toHaveBeenCalled();
  });
});

describe("A second step that succeeded is held, not published", () => {
  test("the challenge is cleared, so the password does not outlive the attempt", async () => {
    /*
     * It has done its job. Keeping it is keeping a plaintext password in
     * memory for the rest of the process's life for no reason at all.
     */
    await signInWith(challenge());

    await act(async (): Promise<void> => {
      await currentAuth().verifyTotpAuth({
        twoFactorAuthId: AUTHENTICATOR._id,
        code: "123456",
      });
    });

    expect(currentAuth().pendingTwoFactor).toBeNull();
  });

  test("the user is still not authenticated afterwards", async () => {
    /*
     * The other half, and the one that is easy to get wrong: the session is
     * REAL by now - the api layer stored the tokens - so authenticating here
     * looks correct. It is not. It swaps the navigator, and if the response
     * carried show-once recovery codes the screen displaying them is destroyed
     * with codes that exist in no other place, ever.
     */
    await signInWith(challenge());

    await act(async (): Promise<void> => {
      await currentAuth().verifyTotpAuth({
        twoFactorAuthId: AUTHENTICATOR._id,
        code: "123456",
      });
    });

    expect(currentAuth().isAuthenticated).toBe(false);
    expect(currentAuth().user).toBeNull();
  });

  test("the held user's id is readable while the login is parked", async () => {
    /*
     * `user` is deliberately still null, so the held screens have nothing else
     * to key per-user storage off - the recovery-code offer snooze is recorded
     * per user id, and a snooze recorded under the wrong id silences the offer
     * for somebody else.
     */
    await signInWith(challenge());

    await act(async (): Promise<void> => {
      await currentAuth().verifyTotpAuth({
        twoFactorAuthId: AUTHENTICATOR._id,
        code: "123456",
      });
    });

    expect(currentAuth().pendingLoginUserId).toBe(USER._id);
  });

  test("no id is reported when nobody is held", async () => {
    await renderAuthProvider();

    expect(currentAuth().pendingLoginUserId).toBeNull();
  });

  test("completePendingLogin is what finally signs the user in", async () => {
    await signInWith(challenge());

    await act(async (): Promise<void> => {
      await currentAuth().verifyBackupCode({ backupCode: "aaaa-1111" });
    });

    expect(currentAuth().isAuthenticated).toBe(false);

    await act(async (): Promise<void> => {
      currentAuth().completePendingLogin();
    });

    expect(currentAuth().isAuthenticated).toBe(true);
    expect(currentAuth().user).toEqual(USER);
  });

  test("the held slot is emptied once the login is released", async () => {
    /*
     * Otherwise a stale id sits on the context for the whole session and any
     * later screen reading it thinks a login is still parked.
     */
    await signInWith(challenge());

    await act(async (): Promise<void> => {
      await currentAuth().verifyTotpAuth({
        twoFactorAuthId: AUTHENTICATOR._id,
        code: "123456",
      });
    });

    await act(async (): Promise<void> => {
      currentAuth().completePendingLogin();
    });

    expect(currentAuth().pendingLoginUserId).toBeNull();
  });

  test("completePendingLogin with nobody held signs nobody in", async () => {
    /*
     * The screens that call this are also reachable by a back gesture and by a
     * restored navigation state. Releasing "whoever" when nothing was held
     * would be an authentication with no password step behind it at all.
     */
    await renderAuthProvider();

    await act(async (): Promise<void> => {
      currentAuth().completePendingLogin();
    });

    expect(currentAuth().isAuthenticated).toBe(false);
    expect(currentAuth().user).toBeNull();
  });
});

describe("Recovery codes the second step minted", () => {
  test("codes on the verify response land on the context", async () => {
    /*
     * The enrolment response is the ONLY copy that will ever exist - the
     * server keeps keyed digests. A provider that read the session out of this
     * response and ignored the codes would leave the account holding codes
     * nobody has ever seen, which reads everywhere else as "you are covered".
     */
    await signInWith(enrolmentChallenge());

    enrolmentApi().mockResolvedValue(
      session({ backupCodes: MINTED_CODES }) as never,
    );

    await act(async (): Promise<void> => {
      await currentAuth().verifyTotpEnrolment({ code: "654321" });
    });

    expect(currentAuth().pendingBackupCodes).toEqual(MINTED_CODES);
  });

  test("codes on the context still do not authenticate on their own", async () => {
    /*
     * This is the pairing that matters: codes to show AND the navigator left
     * alone. Either one without the other loses them.
     */
    await signInWith(enrolmentChallenge());

    enrolmentApi().mockResolvedValue(
      session({ backupCodes: MINTED_CODES }) as never,
    );

    await act(async (): Promise<void> => {
      await currentAuth().verifyTotpEnrolment({ code: "654321" });
    });

    expect(currentAuth().isAuthenticated).toBe(false);
  });

  test("a response with no codes leaves the slot empty", async () => {
    /*
     * An account that already had codes gets none minted. Showing a stale or
     * empty "here are your codes" screen at that point teaches the user to
     * skip past the one that is real.
     */
    await signInWith(challenge());

    await act(async (): Promise<void> => {
      await currentAuth().verifyTotpAuth({
        twoFactorAuthId: AUTHENTICATOR._id,
        code: "123456",
      });
    });

    expect(currentAuth().pendingBackupCodes).toBeNull();
  });

  test("an empty array is not treated as a set to show", async () => {
    await signInWith(challenge());

    totpApi().mockResolvedValue(session({ backupCodes: [] }) as never);

    await act(async (): Promise<void> => {
      await currentAuth().verifyTotpAuth({
        twoFactorAuthId: AUTHENTICATOR._id,
        code: "123456",
      });
    });

    expect(currentAuth().pendingBackupCodes).toBeNull();
  });

  test("showBackupCodes hands a freshly generated set to the screen", async () => {
    /*
     * The other way codes arrive: the user accepted the offer after signing
     * in, and the app-API route minted them. Same slot, same show-once rules.
     */
    await signInWith(challenge());

    await act(async (): Promise<void> => {
      await currentAuth().verifyTotpAuth({
        twoFactorAuthId: AUTHENTICATOR._id,
        code: "123456",
      });
    });

    await act(async (): Promise<void> => {
      currentAuth().showBackupCodes(MINTED_CODES);
    });

    expect(currentAuth().pendingBackupCodes).toEqual(MINTED_CODES);
    expect(currentAuth().isAuthenticated).toBe(false);
  });

  test("completePendingLogin clears the codes as it signs the user in", async () => {
    /*
     * Cleared as the navigator swaps, not later: the screen that displayed
     * them is unmounted by that swap, so anything left here is a set of
     * plaintext sign-in credentials sitting in memory for the life of the
     * session with nothing left to render it.
     */
    await signInWith(enrolmentChallenge());

    enrolmentApi().mockResolvedValue(
      session({ backupCodes: MINTED_CODES }) as never,
    );

    await act(async (): Promise<void> => {
      await currentAuth().verifyTotpEnrolment({ code: "654321" });
    });

    expect(currentAuth().pendingBackupCodes).toEqual(MINTED_CODES);

    await act(async (): Promise<void> => {
      currentAuth().completePendingLogin();
    });

    expect(currentAuth().pendingBackupCodes).toBeNull();
    expect(currentAuth().isAuthenticated).toBe(true);
    expect(currentAuth().user).toEqual(USER);
  });
});

describe("Abandoning a challenge", () => {
  test("cancelTwoFactor drops the held password", async () => {
    /*
     * "Sign in as a different user" from the challenge screen. The next person
     * to reach that screen must not inherit the previous one's credentials,
     * and the previous one's password must not be sitting in memory after they
     * walked away from the attempt.
     */
    await signInWith(challenge());

    expect(currentAuth().pendingTwoFactor).not.toBeNull();

    await act(async (): Promise<void> => {
      currentAuth().cancelTwoFactor();
    });

    expect(currentAuth().pendingTwoFactor).toBeNull();
  });

  test("cancelTwoFactor releases nobody", async () => {
    await signInWith(challenge());

    await act(async (): Promise<void> => {
      currentAuth().cancelTwoFactor();
    });

    expect(currentAuth().isAuthenticated).toBe(false);
    expect(currentAuth().user).toBeNull();
  });

  test("cancelTwoFactor drops a held user and any codes with it", async () => {
    /*
     * Cancelling from the recovery-code screen means the user walked away
     * mid-flow. The session tokens are already stored, but nothing may be
     * published from a flow that was abandoned, and the codes must not survive
     * to be shown to whoever signs in next.
     */
    await signInWith(enrolmentChallenge());

    enrolmentApi().mockResolvedValue(
      session({ backupCodes: MINTED_CODES }) as never,
    );

    await act(async (): Promise<void> => {
      await currentAuth().verifyTotpEnrolment({ code: "654321" });
    });

    await act(async (): Promise<void> => {
      currentAuth().cancelTwoFactor();
    });

    expect(currentAuth().pendingLoginUserId).toBeNull();
    expect(currentAuth().pendingBackupCodes).toBeNull();
    expect(currentAuth().isAuthenticated).toBe(false);
  });

  test("a cancelled challenge cannot be verified afterwards", async () => {
    /*
     * Proves the clear is real rather than cosmetic: with the credentials
     * gone, the wrapper has nothing to post and says so instead of sending an
     * empty one.
     */
    await signInWith(challenge());

    await act(async (): Promise<void> => {
      currentAuth().cancelTwoFactor();
    });

    await expect(
      currentAuth().verifyTotpAuth({
        twoFactorAuthId: AUTHENTICATOR._id,
        code: "123456",
      }),
    ).rejects.toThrow(NO_CHALLENGE_MESSAGE);

    expect(totpApi()).not.toHaveBeenCalled();
  });
});

describe("Signing out", () => {
  test("logout clears a challenge that was still in flight", async () => {
    /*
     * Reachable through the 401 handler and through a sign-out from another
     * tab of the flow. The plaintext password must not survive a sign-out.
     */
    await signInWith(challenge());

    await act(async (): Promise<void> => {
      await currentAuth().logout();
    });

    expect(currentAuth().pendingTwoFactor).toBeNull();
  });

  test("logout clears the held user and the show-once codes", async () => {
    await signInWith(enrolmentChallenge());

    enrolmentApi().mockResolvedValue(
      session({ backupCodes: MINTED_CODES }) as never,
    );

    await act(async (): Promise<void> => {
      await currentAuth().verifyTotpEnrolment({ code: "654321" });
    });

    await act(async (): Promise<void> => {
      await currentAuth().logout();
    });

    expect(currentAuth().pendingLoginUserId).toBeNull();
    expect(currentAuth().pendingBackupCodes).toBeNull();
  });

  test("a signed-out session cannot be released by completePendingLogin", async () => {
    /*
     * The failure this rules out: sign out from a screen that is still holding
     * a completed login, then have that screen release it - signing the user
     * back in after they asked to leave.
     */
    await signInWith(challenge());

    await act(async (): Promise<void> => {
      await currentAuth().verifyTotpAuth({
        twoFactorAuthId: AUTHENTICATOR._id,
        code: "123456",
      });
    });

    await act(async (): Promise<void> => {
      await currentAuth().logout();
    });

    await act(async (): Promise<void> => {
      currentAuth().completePendingLogin();
    });

    expect(currentAuth().isAuthenticated).toBe(false);
    expect(currentAuth().user).toBeNull();
  });
});
