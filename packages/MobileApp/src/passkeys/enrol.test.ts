import * as Crypto from "expo-crypto";
import {
  requestPasskeyEnrolment,
  verifySecurityKeyEnrolment,
  type LoginResponse,
} from "../api/auth";
import { getServerUrl } from "../storage/serverUrl";
import { openAppAuthSession, type AppAuthSessionOptions } from "./authSession";
import {
  enrolPasskey,
  PasskeyEnrolmentOutcome,
  PasskeyEnrolmentProgress,
} from "./enrol";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * THE THREE STEPS OF SETTING UP A PASSKEY FROM THE APP (#9817): the
 * server's hand-off, asked with the email and password; the phone's browser
 * on the page that makes the passkey; and the verify that saves it, asked
 * with the email and password again. The password never goes to the
 * browser, and nothing is saved for an answer that is not this attempt's.
 */

jest.mock("expo-crypto", () => {
  return { getRandomBytesAsync: jest.fn() };
});
jest.mock("../api/auth", () => {
  return {
    requestPasskeyEnrolment: jest.fn(),
    verifySecurityKeyEnrolment: jest.fn(),
  };
});
jest.mock("../storage/serverUrl", () => {
  return { getServerUrl: jest.fn() };
});
jest.mock("./authSession", () => {
  return { openAppAuthSession: jest.fn() };
});

const SERVER: string = "https://oneuptime.example.com";
const EMAIL: string = "responder@example.com";
const PASSWORD: string = "correct-horse-battery-staple";
const HAND_OFF_ID: string = "H".repeat(43);
const STATE: string = "cd".repeat(32);

const CREDENTIAL: Record<string, unknown> = {
  id: "Y3JlZGVudGlhbA",
  rawId: "Y3JlZGVudGlhbA",
  type: "public-key",
  response: {
    attestationObject: "o2NmbXRkbm9uZQ",
    clientDataJSON: "eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0",
  },
};

const SIGNED_IN: LoginResponse = {
  accessToken: "access",
  refreshToken: "refresh",
  refreshTokenExpiresAt: "2026-12-01T00:00:00.000Z",
  user: {
    _id: "user-1",
    email: EMAIL,
    name: "Responder",
    isMasterAdmin: false,
  },
  backupCodes: ["AAAAA-BBBBB"],
};

function answer(params: Record<string, string>): string {
  return `oneuptime://passkey-enrolment?${Object.entries(params)
    .map(([key, value]: [string, string]): string => {
      return `${key}=${encodeURIComponent(value)}`;
    })
    .join("&")}`;
}

const SUCCESS: string = answer({
  state: STATE,
  serverOrigin: SERVER,
  credential: Buffer.from(JSON.stringify(CREDENTIAL)).toString("base64url"),
});

let progress: Array<PasskeyEnrolmentProgress>;

function run(signal?: AbortSignal): Promise<PasskeyEnrolmentOutcome> {
  return enrolPasskey({
    email: EMAIL,
    password: PASSWORD,
    signal: signal || new AbortController().signal,
    onProgress: (step: PasskeyEnrolmentProgress): void => {
      progress.push(step);
    },
  });
}

function sessionOptions(): AppAuthSessionOptions {
  return jest.mocked(openAppAuthSession).mock
    .calls[0]![0] as AppAuthSessionOptions;
}

beforeEach(() => {
  progress = [];
  jest.mocked(getServerUrl).mockResolvedValue(SERVER);
  jest
    .mocked(Crypto.getRandomBytesAsync)
    .mockResolvedValue(new Uint8Array(32).fill(0xcd) as never);
  jest.mocked(requestPasskeyEnrolment).mockResolvedValue(HAND_OFF_ID);
  jest.mocked(verifySecurityKeyEnrolment).mockResolvedValue(SIGNED_IN);
  jest
    .mocked(openAppAuthSession)
    .mockResolvedValue({ status: "callback", url: SUCCESS });
});

describe("a passkey set up end to end", () => {
  test("is saved with the email and password, and signs in", async () => {
    await expect(run()).resolves.toEqual({
      status: "enrolled",
      response: SIGNED_IN,
    });

    expect(requestPasskeyEnrolment).toHaveBeenCalledWith({
      email: EMAIL,
      password: PASSWORD,
    });
    expect(verifySecurityKeyEnrolment).toHaveBeenCalledWith({
      email: EMAIL,
      password: PASSWORD,
      credential: CREDENTIAL,
    });
    expect(progress).toEqual(["preparing", "browser", "verifying"]);
  });

  test("opens the server's own page, with the hand-off and its state, and waits for its own callback", async () => {
    await run();

    const options: AppAuthSessionOptions = sessionOptions();

    expect(options.url).toBe(
      `${SERVER}/accounts/mobile-passkey-enrolment#handOff=${HAND_OFF_ID}&state=${STATE}`,
    );
    expect(options.callbackUrl).toBe("oneuptime://passkey-enrolment");
    // The password never goes to the browser.
    expect(options.url).not.toContain(PASSWORD);
    expect(options.url).not.toContain(encodeURIComponent(EMAIL));

    expect(options.isOwnCallback(SUCCESS)).toBe(true);
    expect(options.isOwnCallback(SUCCESS.replace(STATE, "ef".repeat(32)))).toBe(
      false,
    );
    expect(
      options.isOwnCallback(`oneuptime://passkey?code=${"c".repeat(43)}`),
    ).toBe(false);
  });
});

describe("a passkey not set up", () => {
  test("closing the browser is a cancel, and nothing is saved", async () => {
    jest.mocked(openAppAuthSession).mockResolvedValue({ status: "cancelled" });

    await expect(run()).resolves.toEqual({ status: "cancelled" });
    expect(verifySecurityKeyEnrolment).not.toHaveBeenCalled();
  });

  test("Cancel on the page is a cancel, and nothing is saved", async () => {
    jest.mocked(openAppAuthSession).mockResolvedValue({
      status: "callback",
      url: answer({
        error: "access_denied",
        state: STATE,
        serverOrigin: SERVER,
      }),
    });

    await expect(run()).resolves.toEqual({ status: "cancelled" });
    expect(verifySecurityKeyEnrolment).not.toHaveBeenCalled();
  });

  test("a browser that makes no passkeys says so, and nothing is saved", async () => {
    jest.mocked(openAppAuthSession).mockResolvedValue({
      status: "callback",
      url: answer({
        error: "unsupported",
        state: STATE,
        serverOrigin: SERVER,
      }),
    });

    await expect(run()).resolves.toEqual({ status: "unsupported" });
    expect(verifySecurityKeyEnrolment).not.toHaveBeenCalled();
  });

  test("an attempt canceled before it starts asks nothing of anybody", async () => {
    const controller: AbortController = new AbortController();
    controller.abort();

    await expect(run(controller.signal)).resolves.toEqual({
      status: "cancelled",
    });
    expect(requestPasskeyEnrolment).not.toHaveBeenCalled();
    expect(openAppAuthSession).not.toHaveBeenCalled();
  });

  test("an attempt canceled while the server answered opens no browser", async () => {
    const controller: AbortController = new AbortController();
    jest
      .mocked(requestPasskeyEnrolment)
      .mockImplementation(async (): Promise<string> => {
        controller.abort();
        return HAND_OFF_ID;
      });

    await expect(run(controller.signal)).resolves.toEqual({
      status: "cancelled",
    });
    expect(openAppAuthSession).not.toHaveBeenCalled();
  });

  test("the server's refusal of the password reaches the screen", async () => {
    jest
      .mocked(requestPasskeyEnrolment)
      .mockRejectedValue(new Error("Email or password does not match."));

    await expect(run()).rejects.toThrow("Email or password does not match.");
    expect(openAppAuthSession).not.toHaveBeenCalled();
  });

  test("a server reached over plain HTTP opens no browser", async () => {
    jest.mocked(getServerUrl).mockResolvedValue("http://oneuptime.internal");

    await expect(run()).rejects.toThrow("HTTPS");
    expect(openAppAuthSession).not.toHaveBeenCalled();
  });

  test("a passkey the server refuses is an error, never a sign-in", async () => {
    jest
      .mocked(verifySecurityKeyEnrolment)
      .mockRejectedValue(new Error("Registration verification failed."));

    await expect(run()).rejects.toThrow("Registration verification failed.");
  });

  test("a browser that could not be opened is an error", async () => {
    jest
      .mocked(openAppAuthSession)
      .mockRejectedValue(
        new Error(
          "Could not open or complete the passkey setup. Please try again.",
        ),
      );

    await expect(run()).rejects.toThrow("Could not open or complete");
    expect(verifySecurityKeyEnrolment).not.toHaveBeenCalled();
  });
});
