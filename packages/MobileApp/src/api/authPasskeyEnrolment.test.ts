import AsyncStorage from "@react-native-async-storage/async-storage";
import { clearTokens, getTokens, type StoredTokens } from "../storage/keychain";
import { setServerUrl } from "../storage/serverUrl";
import apiClient from "./client";
import {
  login,
  requestPasskeyEnrolment,
  verifySecurityKeyEnrolment,
  type LoginResponse,
} from "./auth";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The mobile app's half of setting up a passkey when sign-in requires a
 * second step (#9817): the two identity requests it makes itself, with the
 * email and password it holds - the same two the web sign-in page makes -
 * and what /login says about whether the server offers it at all.
 *
 * The routes, field names and envelope are re-stated, not imported: they
 * are a wire contract with a server that ships separately from the app.
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
const HAND_OFF_ID: string = "h".repeat(43);

const USER_ENTITY: Record<string, unknown> = {
  _id: "55555555-5555-5555-5555-555555555555",
  email: EMAIL,
  name: "On Call Engineer",
  isMasterAdmin: false,
};

const CREDENTIAL: Record<string, unknown> = {
  id: "credential-id",
  rawId: "credential-id",
  type: "public-key",
  response: {
    attestationObject: "attestation",
    clientDataJSON: "client-data",
    transports: ["internal"],
  },
  clientExtensionResults: {},
};

function postSpy(): jest.SpyInstance {
  return apiClient.post as unknown as jest.SpyInstance;
}

function lastCall(): Array<unknown> {
  const calls: Array<Array<unknown>> = postSpy().mock.calls;
  return calls[calls.length - 1]!;
}

function lastEnvelope(): Record<string, unknown> {
  return lastCall()[1] as Record<string, unknown>;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await clearTokens();
  await setServerUrl(SERVER_URL);
  postSpy().mockReset();
});

describe("asking the server to start a passkey's setup", () => {
  test("re-submits the email and password, asks for the browser hand-off, and answers its id", async () => {
    postSpy().mockResolvedValue({ data: { handOffId: HAND_OFF_ID } } as never);

    await expect(
      requestPasskeyEnrolment({ email: EMAIL, password: PASSWORD }),
    ).resolves.toBe(HAND_OFF_ID);

    expect(lastCall()[0]).toBe(
      `${SERVER_URL}/identity/security-key-enrolment-options`,
    );
    expect(lastEnvelope()).toEqual({
      mobileHandOff: true,
      data: {
        email: { _type: "Email", value: EMAIL },
        password: { _type: "HashedString", value: PASSWORD },
      },
    });
  });

  test("an answer with no id is an error, never an empty setup", async () => {
    postSpy().mockResolvedValue({ data: { options: {} } } as never);

    await expect(
      requestPasskeyEnrolment({ email: EMAIL, password: PASSWORD }),
    ).rejects.toThrow("The server did not start the passkey setup.");
  });

  test("an answer with no body at all is an error too", async () => {
    postSpy().mockResolvedValue({ data: null } as never);

    await expect(
      requestPasskeyEnrolment({ email: EMAIL, password: PASSWORD }),
    ).rejects.toThrow("The server did not start the passkey setup.");
  });

  test("the server's refusal reaches the caller as it came", async () => {
    postSpy().mockRejectedValue(new Error("Email or password does not match."));

    await expect(
      requestPasskeyEnrolment({ email: EMAIL, password: PASSWORD }),
    ).rejects.toThrow("Email or password does not match.");
  });
});

describe("finishing it with the passkey the browser made", () => {
  test("sends the passkey's answer with the email and password, to the route the web uses", async () => {
    postSpy().mockResolvedValue({
      data: {
        ...USER_ENTITY,
        _miscData: {
          accessToken: "access-token-value",
          refreshToken: "refresh-token-value",
          refreshTokenExpiresAt: "2026-09-04T12:00:00.000Z",
        },
      },
    } as never);

    await verifySecurityKeyEnrolment({
      email: EMAIL,
      password: PASSWORD,
      credential: CREDENTIAL,
    });

    expect(lastCall()[0]).toBe(
      `${SERVER_URL}/identity/verify-security-key-enrolment`,
    );
    expect(lastEnvelope()).toEqual({
      data: {
        email: { _type: "Email", value: EMAIL },
        password: { _type: "HashedString", value: PASSWORD },
        credential: CREDENTIAL,
      },
    });
    // No hand-off flag on the verify: it is exactly the web's request.
    expect(lastEnvelope()).not.toHaveProperty("mobileHandOff");
  });

  test("stores the session and hands back the codes minted behind it, once", async () => {
    postSpy().mockResolvedValue({
      data: {
        ...USER_ENTITY,
        _miscData: {
          accessToken: "access-token-value",
          refreshToken: "refresh-token-value",
          refreshTokenExpiresAt: "2026-09-04T12:00:00.000Z",
          backupCodes: ["AAAAA-BBBBB", "CCCCC-DDDDD"],
        },
      },
    } as never);

    const response: LoginResponse = await verifySecurityKeyEnrolment({
      email: EMAIL,
      password: PASSWORD,
      credential: CREDENTIAL,
    });

    expect(response.backupCodes).toEqual(["AAAAA-BBBBB", "CCCCC-DDDDD"]);

    const tokens: StoredTokens | null = await getTokens();
    expect(tokens?.accessToken).toBe("access-token-value");
    expect(tokens?.refreshToken).toBe("refresh-token-value");
  });

  test("an account that already had codes says so, and none are invented", async () => {
    postSpy().mockResolvedValue({
      data: {
        ...USER_ENTITY,
        _miscData: {
          accessToken: "access-token-value",
          refreshToken: "refresh-token-value",
          refreshTokenExpiresAt: "2026-09-04T12:00:00.000Z",
          hasBackupCodes: true,
        },
      },
    } as never);

    const response: LoginResponse = await verifySecurityKeyEnrolment({
      email: EMAIL,
      password: PASSWORD,
      credential: CREDENTIAL,
    });

    expect(response.hasBackupCodes).toBe(true);
    expect(response.backupCodes).toBeUndefined();
  });

  test("a refused passkey stores no session", async () => {
    postSpy().mockRejectedValue(new Error("Registration verification failed."));

    await expect(
      verifySecurityKeyEnrolment({
        email: EMAIL,
        password: PASSWORD,
        credential: CREDENTIAL,
      }),
    ).rejects.toThrow("Registration verification failed.");

    expect(await getTokens()).toBeNull();
  });
});

describe("what /login says about it", () => {
  test("a required setup says when the server offers a passkey", async () => {
    postSpy().mockResolvedValue({
      data: {
        ...USER_ENTITY,
        _miscData: {
          twoFactorEnrolmentRequired: true,
          twoFactorAuthId: "pending-enrolment-1",
          twoFactorOtpUrl: "otpauth://totp/OneUptime:x?secret=ABC",
          mobilePasskeyEnrolment: true,
        },
      },
    } as never);

    const response: LoginResponse = await login(EMAIL, PASSWORD);

    expect(response.twoFactorEnrolmentRequired).toBe(true);
    expect(response.passkeyEnrolmentOffered).toBe(true);
  });

  test("an older server that says nothing offers no passkey", async () => {
    postSpy().mockResolvedValue({
      data: {
        ...USER_ENTITY,
        _miscData: {
          twoFactorEnrolmentRequired: true,
          twoFactorAuthId: "pending-enrolment-1",
          twoFactorOtpUrl: "otpauth://totp/OneUptime:x?secret=ABC",
        },
      },
    } as never);

    const response: LoginResponse = await login(EMAIL, PASSWORD);

    expect(response.passkeyEnrolmentOffered).toBeUndefined();
  });

  test("anything but true offers no passkey", async () => {
    postSpy().mockResolvedValue({
      data: {
        ...USER_ENTITY,
        _miscData: {
          twoFactorEnrolmentRequired: true,
          twoFactorAuthId: "pending-enrolment-1",
          twoFactorOtpUrl: "otpauth://totp/OneUptime:x?secret=ABC",
          mobilePasskeyEnrolment: "true",
        },
      },
    } as never);

    expect((await login(EMAIL, PASSWORD)).passkeyEnrolmentOffered).toBe(
      undefined,
    );
  });

  test("a challenge says which of its keys are passkeys", async () => {
    postSpy().mockResolvedValue({
      data: {
        ...USER_ENTITY,
        _miscData: {
          totpAuthList: [],
          webAuthnList: [
            { _id: "key-1", name: "Passkey", isPasskey: true },
            { _id: "key-2", name: "YubiKey", isPasskey: false },
            { _id: "key-3", name: "Old Key" },
          ],
          backupCodeCount: 10,
        },
      },
    } as never);

    const response: LoginResponse = await login(EMAIL, PASSWORD);

    expect(response.webAuthnList).toEqual([
      { _id: "key-1", name: "Passkey", isPasskey: true },
      { _id: "key-2", name: "YubiKey" },
      { _id: "key-3", name: "Old Key" },
    ]);
  });
});
