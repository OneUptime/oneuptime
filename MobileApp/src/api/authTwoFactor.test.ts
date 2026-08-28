import AsyncStorage from "@react-native-async-storage/async-storage";
import { clearTokens, getTokens, type StoredTokens } from "../storage/keychain";
import { setServerUrl } from "../storage/serverUrl";
import apiClient from "./client";
import {
  generateBackupCodes,
  login,
  verifyBackupCode,
  verifyTotpAuth,
  verifyTotpEnrolment,
  type LoginResponse,
} from "./auth";
import { describe, expect, test, beforeEach } from "@jest/globals";

/*
 * The two-factor half of src/api/auth.ts: everything that happens between the
 * password being accepted and a session existing.
 *
 * Every failure this file guards against is silent. Nothing here throws when
 * it goes wrong - the app just quietly does the wrong thing to somebody who is
 * holding a phone at 3am trying to get at an incident:
 *
 *   - A challenge mistaken for a success stores an EMPTY access token, which
 *     leaves the app believing it is signed in and every screen 401ing.
 *   - A missing backup-code count read as zero makes the recovery screen say
 *     "you have no backup codes, ask an administrator" to a user who is
 *     holding ten of them. The server deliberately OMITS the count when it
 *     could not read it, precisely so the client can tell "unknown" from
 *     "none"; collapsing the two undoes that on the client side.
 *   - The forced-enrolment response carries no factors (that is the whole
 *     point of it), so it must be recognised BEFORE the factor lists are
 *     consulted. Checked in the other order it falls through to the success
 *     path with an empty token and the sign-in button simply does nothing.
 *   - A credential re-submitted as a bare string is refused by the server with
 *     "Email and password are required" - App/FeatureSet/Identity/API/
 *     Authentication.ts runs the body through BaseModel.fromJSON, which only
 *     understands {_type:"Email"} / {_type:"HashedString"}. There is no
 *     session on the second step, so both have to go again with every verify
 *     request.
 *   - twoFactorAuthId names WHICH enrolment a code belongs to. The server
 *     drops an undefined predicate rather than matching nothing, so an omitted
 *     id stops meaning "this enrolment" and starts meaning "whichever one this
 *     account happens to have".
 *   - The enrolment response carries recovery codes in PLAINTEXT and is the
 *     only copy that will ever exist; the server keeps digests. A client that
 *     drops them leaves the account holding codes nobody has ever seen, which
 *     reads everywhere else as "this user is covered".
 *
 * The routes, the field names and the _miscData envelope are re-stated here
 * rather than imported: they are a wire contract with a server that ships
 * separately from the app, and they are what the tests are actually pinning.
 *
 * apiClient is faked the way src/api/pushDevice.test.ts fakes it, so the
 * assertions are about the request auth.ts builds. The token store and the
 * server-url store are REAL over the AsyncStorage mock in
 * src/__tests__/setup.ts, so "did this store a session" is answered by reading
 * the store back rather than by watching a spy.
 *
 * None of this is platform-specific, so every test is expected to hold under
 * both the ios and the android Jest project.
 */

jest.mock("./client", () => {
  return {
    __esModule: true,
    default: {
      post: jest.fn(),
    },
  };
});

const SERVER_URL: string = "https://oneuptime.example.com";
const EMAIL: string = "responder@example.com";
const PASSWORD: string = "correct-horse-battery-staple";

const PHONE_TOTP_ID: string = "11111111-1111-1111-1111-111111111111";
const LAPTOP_TOTP_ID: string = "22222222-2222-2222-2222-222222222222";
const SECURITY_KEY_ID: string = "33333333-3333-3333-3333-333333333333";
const PENDING_ENROLMENT_ID: string = "44444444-4444-4444-4444-444444444444";

const OTP_URL: string =
  "otpauth://totp/OneUptime:responder@example.com?secret=JBSWY3DPEHPK3PXP&issuer=OneUptime";

/* The exact shapes BaseModel.fromJSON turns back into an Email/HashedString. */
const SERIALIZED_EMAIL: Record<string, unknown> = {
  _type: "Email",
  value: EMAIL,
};

const SERIALIZED_PASSWORD: Record<string, unknown> = {
  _type: "HashedString",
  value: PASSWORD,
};

/* What sendEntityResponse puts under `data` on every one of these responses. */
const USER_ENTITY: Record<string, unknown> = {
  _id: "55555555-5555-5555-5555-555555555555",
  email: EMAIL,
  name: "On Call Engineer",
  isMasterAdmin: false,
};

/* What finalizeUserLogin puts in _miscData once a session really exists. */
const SESSION_MISC: Record<string, unknown> = {
  accessToken: "access-token-value",
  refreshToken: "refresh-token-value",
  refreshTokenExpiresAt: "2026-09-04T12:00:00.000Z",
};

function postSpy(): jest.SpyInstance {
  return apiClient.post as unknown as jest.SpyInstance;
}

/**
 * Queue the identity envelope the server sends: the user under `data`, and
 * everything the two-factor flow needs under `_miscData`.
 */
function respondWith(misc: Record<string, unknown>): void {
  postSpy().mockResolvedValue({
    data: {
      data: USER_ENTITY,
      _miscData: misc,
    },
  } as never);
}

function lastCall(): Array<unknown> {
  const calls: Array<Array<unknown>> = postSpy().mock.calls;

  return calls[calls.length - 1]!;
}

function lastUrl(): string {
  return lastCall()[0] as string;
}

/* The whole request body - the identity routes read req.body["data"]. */
function lastEnvelope(): Record<string, unknown> {
  return lastCall()[1] as Record<string, unknown>;
}

function lastData(): Record<string, unknown> {
  return lastEnvelope()["data"] as Record<string, unknown>;
}

beforeEach(async () => {
  /*
   * The AsyncStorage mock is a module-level Map shared by the whole file, and
   * the keychain module keeps an in-memory copy of the access token beside it.
   * Both have to go, or "no tokens were stored" passes because the PREVIOUS
   * test stored some.
   */
  await AsyncStorage.clear();
  await clearTokens();
  await setServerUrl(SERVER_URL);

  postSpy().mockReset();
});

describe("login() on an account that has a second factor", () => {
  test("reports the challenge instead of pretending to be a session", async () => {
    respondWith({
      totpAuthList: [{ _id: PHONE_TOTP_ID, name: "Phone" }],
      webAuthnList: [],
      backupCodeCount: 8,
    });

    const result: LoginResponse = await login(EMAIL, PASSWORD);

    expect(result.twoFactorRequired).toBe(true);
    expect(result.twoFactorEnrolmentRequired).toBeUndefined();
  });

  test("maps every authenticator app to the {_id, name} the picker draws", async () => {
    /*
     * The id is not decoration: it is what /verify-totp-auth is quoted back
     * with. A list rendered from names alone cannot answer the challenge.
     */
    respondWith({
      totpAuthList: [
        { _id: PHONE_TOTP_ID, name: "Phone" },
        { _id: LAPTOP_TOTP_ID, name: "Laptop" },
      ],
      webAuthnList: [],
      backupCodeCount: 8,
    });

    const result: LoginResponse = await login(EMAIL, PASSWORD);

    expect(result.totpAuthList).toEqual([
      { _id: PHONE_TOTP_ID, name: "Phone" },
      { _id: LAPTOP_TOTP_ID, name: "Laptop" },
    ]);
  });

  test("carries the security keys through as well as the authenticator apps", async () => {
    /*
     * WebAuthn cannot be answered by this client, but the keys are still
     * surfaced so the challenge screen can SAY they exist. Dropping them here
     * would look to their owner like the key had been deleted, at the exact
     * moment they are trying to work out why they cannot get in.
     */
    respondWith({
      totpAuthList: [],
      webAuthnList: [{ _id: SECURITY_KEY_ID, name: "YubiKey" }],
      backupCodeCount: 8,
    });

    const result: LoginResponse = await login(EMAIL, PASSWORD);

    expect(result.twoFactorRequired).toBe(true);
    expect(result.webAuthnList).toEqual([
      { _id: SECURITY_KEY_ID, name: "YubiKey" },
    ]);
  });

  test("a security-key-only account is still a challenge, not a login", async () => {
    /*
     * The account has no TOTP at all. If the branch only looked at
     * totpAuthList this response would fall through to the success path and
     * sign the user in on a password alone.
     */
    respondWith({
      webAuthnList: [{ _id: SECURITY_KEY_ID, name: "YubiKey" }],
    });

    const result: LoginResponse = await login(EMAIL, PASSWORD);

    expect(result.twoFactorRequired).toBe(true);
    expect(result.accessToken).toBe("");
    expect(await getTokens()).toBeNull();
  });

  test("hands back an empty list, never undefined, for the factor kind the server omitted", async () => {
    /*
     * The challenge screen maps over both lists. An undefined here is a
     * crash-on-render at the only screen that can complete the sign-in.
     */
    respondWith({
      totpAuthList: [{ _id: PHONE_TOTP_ID, name: "Phone" }],
    });

    const result: LoginResponse = await login(EMAIL, PASSWORD);

    expect(result.webAuthnList).toEqual([]);
  });

  test("stores no tokens, because there is no session yet", async () => {
    /*
     * The single most damaging thing this function could do. The challenge
     * response carries no tokens; storing the empty strings anyway would leave
     * getTokens() answering with a session, the app believing it is signed in,
     * and every subsequent request 401ing with no way back to the login
     * screen.
     */
    respondWith({
      totpAuthList: [{ _id: PHONE_TOTP_ID, name: "Phone" }],
      webAuthnList: [],
      backupCodeCount: 8,
    });

    const result: LoginResponse = await login(EMAIL, PASSWORD);

    expect(await getTokens()).toBeNull();
    expect(result.accessToken).toBe("");
    expect(result.refreshToken).toBe("");
  });

  test("still identifies who is being challenged", async () => {
    /* The follow-up screens key the backup-code snooze on this user id. */
    respondWith({
      totpAuthList: [{ _id: PHONE_TOTP_ID, name: "Phone" }],
      webAuthnList: [],
    });

    const result: LoginResponse = await login(EMAIL, PASSWORD);

    expect(result.user._id).toBe(USER_ENTITY["_id"]);
    expect(result.user.email).toBe(EMAIL);
  });
});

describe("backupCodeCount has three states, not two", () => {
  test("a reported count is carried through untouched", async () => {
    respondWith({
      totpAuthList: [{ _id: PHONE_TOTP_ID, name: "Phone" }],
      webAuthnList: [],
      backupCodeCount: 7,
    });

    const result: LoginResponse = await login(EMAIL, PASSWORD);

    expect(result.backupCodeCount).toBe(7);
  });

  test("zero is reported as zero", async () => {
    /*
     * Zero is a CLAIM, and the recovery screen acts on it: it stops showing
     * the code form and tells the user to find an administrator. A falsy-check
     * regression here (`count || null`) would turn that claim back into
     * "unknown" and offer a code form to somebody who has no codes - a route
     * that can only refuse them.
     */
    respondWith({
      totpAuthList: [{ _id: PHONE_TOTP_ID, name: "Phone" }],
      webAuthnList: [],
      backupCodeCount: 0,
    });

    const result: LoginResponse = await login(EMAIL, PASSWORD);

    expect(result.backupCodeCount).toBe(0);
    expect(result.backupCodeCount).not.toBeNull();
  });

  test("an ABSENT count is null - unknown - and never 0", async () => {
    /*
     * The server omits the key when the count could not be read (see the
     * try/catch around countUnusedForUser in Authentication.ts): a bad index
     * or an exhausted pool must not take the sign-in down. Reading that
     * absence as zero is how a user holding ten printed codes gets sent to
     * find an administrator instead of typing one in.
     */
    respondWith({
      totpAuthList: [{ _id: PHONE_TOTP_ID, name: "Phone" }],
      webAuthnList: [],
    });

    const result: LoginResponse = await login(EMAIL, PASSWORD);

    expect(result.backupCodeCount).toBeNull();
    expect(result.backupCodeCount).not.toBe(0);
  });

  test("a count that is not a number is unknown rather than a guess", async () => {
    /*
     * Anything the client cannot read as a number has to degrade to "unknown"
     * - the state that keeps the recovery form available - rather than to a
     * NaN that every comparison in the UI answers false for.
     */
    respondWith({
      totpAuthList: [{ _id: PHONE_TOTP_ID, name: "Phone" }],
      webAuthnList: [],
      backupCodeCount: "3",
    });

    const result: LoginResponse = await login(EMAIL, PASSWORD);

    expect(result.backupCodeCount).toBeNull();
  });
});

describe("login() recognises a forced enrolment before it looks at the factors", () => {
  test("an enrolment demand with empty factor lists is reported as enrolment", async () => {
    /*
     * This IS the ordering bug, in the shape the server actually sends it: an
     * account being forced to enrol has nothing set up, so both lists are
     * empty. Checked after them, this response reaches the success path, gets
     * an empty access token, and the sign-in button does nothing at all - no
     * error, no screen change.
     */
    respondWith({
      twoFactorEnrolmentRequired: true,
      twoFactorAuthId: PENDING_ENROLMENT_ID,
      twoFactorOtpUrl: OTP_URL,
      totpAuthList: [],
      webAuthnList: [],
    });

    const result: LoginResponse = await login(EMAIL, PASSWORD);

    expect(result.twoFactorEnrolmentRequired).toBe(true);
    expect(result.twoFactorRequired).toBe(true);
  });

  test("carries the pending enrolment id and the otpauth URL", async () => {
    /*
     * The URL is the only way onto the handset's authenticator app (a phone
     * cannot scan its own screen) and the id is what the first working code
     * has to be quoted back with. Losing either one makes the enrolment screen
     * a dead end for an account that cannot sign in any other way.
     */
    respondWith({
      twoFactorEnrolmentRequired: true,
      twoFactorAuthId: PENDING_ENROLMENT_ID,
      twoFactorOtpUrl: OTP_URL,
    });

    const result: LoginResponse = await login(EMAIL, PASSWORD);

    expect(result.twoFactorAuthId).toBe(PENDING_ENROLMENT_ID);
    expect(result.twoFactorOtpUrl).toBe(OTP_URL);
  });

  test("enrolment wins even when the response also lists factors", async () => {
    /*
     * Pins the ORDER rather than the outcome: with the branches swapped this
     * response would be reported as an ordinary challenge and the user sent to
     * type a code for an enrolment they have not completed.
     */
    respondWith({
      twoFactorEnrolmentRequired: true,
      twoFactorAuthId: PENDING_ENROLMENT_ID,
      twoFactorOtpUrl: OTP_URL,
      totpAuthList: [{ _id: PHONE_TOTP_ID, name: "Phone" }],
    });

    const result: LoginResponse = await login(EMAIL, PASSWORD);

    expect(result.twoFactorEnrolmentRequired).toBe(true);
    expect(result.twoFactorAuthId).toBe(PENDING_ENROLMENT_ID);
  });

  test("an enrolment demand stores no tokens either", async () => {
    /* Nothing is authorized by the enrolment response. No session exists. */
    respondWith({
      twoFactorEnrolmentRequired: true,
      twoFactorAuthId: PENDING_ENROLMENT_ID,
      twoFactorOtpUrl: OTP_URL,
    });

    const result: LoginResponse = await login(EMAIL, PASSWORD);

    expect(await getTokens()).toBeNull();
    expect(result.accessToken).toBe("");
  });

  test("a login with neither branch still completes normally", async () => {
    /*
     * The other side of the two branches above: an account with no second
     * factor must not be caught by either of them. Without this, a regression
     * that widened the enrolment test (say, to any truthy _miscData) would
     * lock every single-factor user out and no other test here would notice.
     */
    respondWith(SESSION_MISC);

    const result: LoginResponse = await login(EMAIL, PASSWORD);

    expect(result.twoFactorRequired).toBeUndefined();
    expect(result.twoFactorEnrolmentRequired).toBeUndefined();
    expect(result.accessToken).toBe("access-token-value");
    expect((await getTokens())?.accessToken).toBe("access-token-value");
  });
});

describe("verifyTotpAuth", () => {
  beforeEach(() => {
    respondWith(SESSION_MISC);
  });

  test("posts to the identity route the server mounts it on", async () => {
    await verifyTotpAuth({
      email: EMAIL,
      password: PASSWORD,
      twoFactorAuthId: PHONE_TOTP_ID,
      code: "123456",
    });

    expect(lastUrl()).toBe(`${SERVER_URL}/identity/verify-totp-auth`);
  });

  test("re-submits the credentials in the serialized shape the server parses", async () => {
    /*
     * There is no session to authenticate the second step with - /login
     * answered the password step with a list of factors and nothing else - so
     * both credentials go again. As bare strings they never survive
     * BaseModel.fromJSON, and the user is told "Email and password are
     * required" while looking at a screen that asked for neither.
     */
    await verifyTotpAuth({
      email: EMAIL,
      password: PASSWORD,
      twoFactorAuthId: PHONE_TOTP_ID,
      code: "123456",
    });

    expect(lastData()["email"]).toEqual(SERIALIZED_EMAIL);
    expect(lastData()["password"]).toEqual(SERIALIZED_PASSWORD);
  });

  test("wraps the body in the `data` envelope the identity routes read", async () => {
    /* The route reads req.body["data"]; a flat body is an empty login. */
    await verifyTotpAuth({
      email: EMAIL,
      password: PASSWORD,
      twoFactorAuthId: PHONE_TOTP_ID,
      code: "123456",
    });

    expect(Object.keys(lastEnvelope())).toEqual(["data"]);
  });

  test("sends the code and names WHICH enrolment it belongs to", async () => {
    /*
     * The id is not optional. The server builds its query from it, and an
     * undefined predicate is DROPPED rather than matched as nothing - so an
     * omitted id silently widens "does this code match this authenticator" to
     * "does it match any row this account has", which is a different and
     * weaker question.
     */
    await verifyTotpAuth({
      email: EMAIL,
      password: PASSWORD,
      twoFactorAuthId: LAPTOP_TOTP_ID,
      code: "123456",
    });

    expect(lastData()["code"]).toBe("123456");
    expect(lastData()["twoFactorAuthId"]).toBe(LAPTOP_TOTP_ID);
  });

  test("stores the whole session it was handed", async () => {
    /*
     * All three tokens or none. Storing the access token without the refresh
     * one signs the user in until the first refresh and then drops them, in
     * the middle of whatever they were paged about.
     */
    await verifyTotpAuth({
      email: EMAIL,
      password: PASSWORD,
      twoFactorAuthId: PHONE_TOTP_ID,
      code: "123456",
    });

    const tokens: StoredTokens | null = await getTokens();

    expect(tokens).toEqual({
      accessToken: "access-token-value",
      refreshToken: "refresh-token-value",
      refreshTokenExpiresAt: "2026-09-04T12:00:00.000Z",
    });
  });

  test("returns the session to the caller as well as storing it", async () => {
    const result: LoginResponse = await verifyTotpAuth({
      email: EMAIL,
      password: PASSWORD,
      twoFactorAuthId: PHONE_TOTP_ID,
      code: "123456",
    });

    expect(result.accessToken).toBe("access-token-value");
    expect(result.refreshToken).toBe("refresh-token-value");
    expect(result.user.email).toBe(EMAIL);
  });

  test("stores nothing when the response carries no tokens", async () => {
    /*
     * A response that is not a session must not become one. Persisting empty
     * strings here is indistinguishable, to every later reader, from a real
     * sign-in - which is how a rejected code ends up looking like a completed
     * login that 401s on the first screen.
     */
    respondWith({});

    await verifyTotpAuth({
      email: EMAIL,
      password: PASSWORD,
      twoFactorAuthId: PHONE_TOTP_ID,
      code: "000000",
    });

    expect(await getTokens()).toBeNull();
  });

  test("stores nothing when only half a session came back", async () => {
    respondWith({ accessToken: "access-token-value" });

    await verifyTotpAuth({
      email: EMAIL,
      password: PASSWORD,
      twoFactorAuthId: PHONE_TOTP_ID,
      code: "123456",
    });

    expect(await getTokens()).toBeNull();
  });

  test("a rejected request propagates instead of becoming a fake success", async () => {
    /*
     * A wrong code is a 400 from this route. Swallowing it would resolve with
     * empty tokens, which the screen reads as "signed in" and acts on by
     * swapping the navigator - stranding the user on a dashboard with no
     * session.
     */
    postSpy().mockRejectedValue(new Error("Invalid code") as never);

    await expect(
      verifyTotpAuth({
        email: EMAIL,
        password: PASSWORD,
        twoFactorAuthId: PHONE_TOTP_ID,
        code: "000000",
      }),
    ).rejects.toThrow("Invalid code");

    expect(await getTokens()).toBeNull();
  });
});

describe("verifyBackupCode", () => {
  beforeEach(() => {
    respondWith(SESSION_MISC);
  });

  test("posts to its own identity route", async () => {
    /*
     * Its own route, not the TOTP one: the server rate-limits this one far
     * harder, because it is the route an attacker with a password would
     * grind.
     */
    await verifyBackupCode({
      email: EMAIL,
      password: PASSWORD,
      backupCode: "ABCD-1234",
    });

    expect(lastUrl()).toBe(`${SERVER_URL}/identity/verify-backup-code`);
  });

  test("re-submits the credentials in the serialized shape", async () => {
    await verifyBackupCode({
      email: EMAIL,
      password: PASSWORD,
      backupCode: "ABCD-1234",
    });

    expect(lastData()["email"]).toEqual(SERIALIZED_EMAIL);
    expect(lastData()["password"]).toEqual(SERIALIZED_PASSWORD);
  });

  test("sends the recovery code exactly as it was typed", async () => {
    /*
     * Hyphens, spacing and case are normalized on the SERVER, so the client
     * must not try to help. A client-side "clean up" that stripped what a
     * password manager pasted in would be one more way to fail the request a
     * locked-out user has one shot at.
     */
    await verifyBackupCode({
      email: EMAIL,
      password: PASSWORD,
      backupCode: " abcd-1234 ",
    });

    expect(lastData()["backupCode"]).toBe(" abcd-1234 ");
  });

  test("sends the code under `backupCode`, not under `code`", async () => {
    /*
     * The route reads data["backupCode"] and asserts it is present. Under the
     * TOTP field name it arrives as nothing, and the user is refused with
     * "Backup code is required" while looking at the code they just typed.
     */
    await verifyBackupCode({
      email: EMAIL,
      password: PASSWORD,
      backupCode: "ABCD-1234",
    });

    expect(lastData()["backupCode"]).toBe("ABCD-1234");
    expect(lastData()["code"]).toBeUndefined();
  });

  test("stores the session the accepted code returned", async () => {
    await verifyBackupCode({
      email: EMAIL,
      password: PASSWORD,
      backupCode: "ABCD-1234",
    });

    expect(await getTokens()).toEqual({
      accessToken: "access-token-value",
      refreshToken: "refresh-token-value",
      refreshTokenExpiresAt: "2026-09-04T12:00:00.000Z",
    });
  });

  test("stores nothing when the response carries no tokens", async () => {
    respondWith({});

    await verifyBackupCode({
      email: EMAIL,
      password: PASSWORD,
      backupCode: "WRONG-CODE",
    });

    expect(await getTokens()).toBeNull();
  });

  test("a rejected request propagates", async () => {
    postSpy().mockRejectedValue(new Error("Invalid backup code") as never);

    await expect(
      verifyBackupCode({
        email: EMAIL,
        password: PASSWORD,
        backupCode: "WRONG-CODE",
      }),
    ).rejects.toThrow("Invalid backup code");
  });
});

describe("verifyTotpEnrolment", () => {
  beforeEach(() => {
    respondWith(SESSION_MISC);
  });

  test("posts to the enrolment route, not the challenge one", async () => {
    /*
     * Two different routes with two different preconditions: this one refuses
     * an account that already has factors, and /verify-totp-auth refuses one
     * that does not. Sending an enrolment to the challenge route is a refusal
     * for the only account that cannot sign in any other way.
     */
    await verifyTotpEnrolment({
      email: EMAIL,
      password: PASSWORD,
      twoFactorAuthId: PENDING_ENROLMENT_ID,
      code: "123456",
    });

    expect(lastUrl()).toBe(`${SERVER_URL}/identity/verify-totp-enrolment`);
  });

  test("re-submits the credentials in the serialized shape", async () => {
    await verifyTotpEnrolment({
      email: EMAIL,
      password: PASSWORD,
      twoFactorAuthId: PENDING_ENROLMENT_ID,
      code: "123456",
    });

    expect(lastData()["email"]).toEqual(SERIALIZED_EMAIL);
    expect(lastData()["password"]).toEqual(SERIALIZED_PASSWORD);
  });

  test("quotes back the pending enrolment the code was generated for", async () => {
    /*
     * Same undefined-predicate hazard as the challenge route, and worse here:
     * the enrolment being finalized is the one that gets marked verified, so
     * the wrong row would leave the account permanently unable to complete a
     * factor it believes it has set up.
     */
    await verifyTotpEnrolment({
      email: EMAIL,
      password: PASSWORD,
      twoFactorAuthId: PENDING_ENROLMENT_ID,
      code: "123456",
    });

    expect(lastData()["code"]).toBe("123456");
    expect(lastData()["twoFactorAuthId"]).toBe(PENDING_ENROLMENT_ID);
  });

  test("stores the session the completed enrolment returned", async () => {
    await verifyTotpEnrolment({
      email: EMAIL,
      password: PASSWORD,
      twoFactorAuthId: PENDING_ENROLMENT_ID,
      code: "123456",
    });

    expect(await getTokens()).toEqual({
      accessToken: "access-token-value",
      refreshToken: "refresh-token-value",
      refreshTokenExpiresAt: "2026-09-04T12:00:00.000Z",
    });
  });

  test("surfaces the recovery codes minted behind the enrolment", async () => {
    /*
     * This response is the ONLY copy that will ever exist anywhere - the
     * server stores keyed digests and cannot re-print them. A client that
     * drops them leaves the account holding codes nobody has ever seen, and
     * every count in the product then says the user is covered.
     */
    respondWith({
      ...SESSION_MISC,
      backupCodes: ["ABCD-1234", "EFGH-5678"],
    });

    const result: LoginResponse = await verifyTotpEnrolment({
      email: EMAIL,
      password: PASSWORD,
      twoFactorAuthId: PENDING_ENROLMENT_ID,
      code: "123456",
    });

    expect(result.backupCodes).toEqual(["ABCD-1234", "EFGH-5678"]);
  });

  test("omits the backupCodes key entirely when none were minted", async () => {
    /*
     * ABSENT, not []. The follow-up decision is "do I have codes in my hand",
     * and an empty array present on the response is a value the caller has to
     * remember to length-check; absent is the state that cannot be mistaken
     * for a set worth showing.
     */
    const result: LoginResponse = await verifyTotpEnrolment({
      email: EMAIL,
      password: PASSWORD,
      twoFactorAuthId: PENDING_ENROLMENT_ID,
      code: "123456",
    });

    expect("backupCodes" in result).toBe(false);
  });

  test("surfaces hasBackupCodes when the account already had a set", async () => {
    /*
     * The server sends this INSTEAD of minting, and it is what stops the app
     * offering to generate a fresh set to somebody already holding one -
     * generation is destructive and would void the printed codes they have.
     */
    respondWith({
      ...SESSION_MISC,
      hasBackupCodes: true,
    });

    const result: LoginResponse = await verifyTotpEnrolment({
      email: EMAIL,
      password: PASSWORD,
      twoFactorAuthId: PENDING_ENROLMENT_ID,
      code: "123456",
    });

    expect(result.hasBackupCodes).toBe(true);
  });

  test("does not invent hasBackupCodes when the server stayed silent", async () => {
    /*
     * Silence means "no set was found", which is exactly when the offer must
     * be made. Defaulting it to true would hide the offer from the users who
     * have nothing - the population this whole feature exists for.
     */
    const result: LoginResponse = await verifyTotpEnrolment({
      email: EMAIL,
      password: PASSWORD,
      twoFactorAuthId: PENDING_ENROLMENT_ID,
      code: "123456",
    });

    expect("hasBackupCodes" in result).toBe(false);
  });

  test("does not carry a false hasBackupCodes through as a truthy key", async () => {
    respondWith({
      ...SESSION_MISC,
      hasBackupCodes: false,
    });

    const result: LoginResponse = await verifyTotpEnrolment({
      email: EMAIL,
      password: PASSWORD,
      twoFactorAuthId: PENDING_ENROLMENT_ID,
      code: "123456",
    });

    expect("hasBackupCodes" in result).toBe(false);
  });

  test("a rejected request propagates", async () => {
    postSpy().mockRejectedValue(new Error("Invalid code") as never);

    await expect(
      verifyTotpEnrolment({
        email: EMAIL,
        password: PASSWORD,
        twoFactorAuthId: PENDING_ENROLMENT_ID,
        code: "000000",
      }),
    ).rejects.toThrow("Invalid code");

    expect(await getTokens()).toBeNull();
  });
});

describe("generateBackupCodes", () => {
  test("posts to the APP API route, not an identity one", async () => {
    /*
     * The difference is what authenticates it. The identity routes take an
     * email and password; this one takes the SESSION the second step just
     * stored, which is the only reason it can be offered at all - a
     * password-authenticated version would hand recovery codes to whoever is
     * holding the password, which is precisely what a second factor exists to
     * stop. Pointed at /identity it is simply a 404 the user reads as "we
     * could not generate your codes".
     */
    postSpy().mockResolvedValue({
      data: { codes: ["ABCD-1234"], replacedCodeCount: 0 },
    } as never);

    await generateBackupCodes();

    expect(lastUrl()).toBe(
      `${SERVER_URL}/api/user-two-factor-backup-code/generate`,
    );
    expect(lastUrl()).not.toContain("/identity/");
  });

  test("returns the codes it was handed, in order", async () => {
    /*
     * Returned and never persisted: this array is the only copy, and the
     * screen that received it is the only place it will ever be shown.
     */
    postSpy().mockResolvedValue({
      data: { codes: ["ABCD-1234", "EFGH-5678", "IJKL-9012"] },
    } as never);

    const codes: Array<string> = await generateBackupCodes();

    expect(codes).toEqual(["ABCD-1234", "EFGH-5678", "IJKL-9012"]);
  });

  test("a response with no codes is an empty set, not a crash", async () => {
    /*
     * The caller renders whatever comes back on a screen the user was sent to
     * on purpose. A throw here from a body shaped slightly differently than
     * expected turns "no codes were generated" into an unhandled rejection on
     * the sign-in path.
     */
    postSpy().mockResolvedValue({ data: {} } as never);

    await expect(generateBackupCodes()).resolves.toEqual([]);
  });

  test("a null codes field is an empty set too", async () => {
    postSpy().mockResolvedValue({ data: { codes: null } } as never);

    await expect(generateBackupCodes()).resolves.toEqual([]);
  });

  test("a rejected request propagates rather than reading as an empty set", async () => {
    /*
     * An empty array and a failed request mean opposite things to the caller:
     * one is "you have no codes", the other is "we do not know". Swallowing
     * the failure into [] tells a user their codes were generated and then
     * shows them none.
     */
    postSpy().mockRejectedValue(new Error("network unreachable") as never);

    await expect(generateBackupCodes()).rejects.toThrow("network unreachable");
  });
});
