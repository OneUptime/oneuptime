import SignOutRequest, {
  SignOutAnswer,
  SignOutResult,
} from "../../../UI/Utils/SignOutRequest";
import UserUtil from "../../../UI/Utils/User";
import URL from "../../../Types/API/URL";
import { IDENTITY_PROVIDER_SIGN_OUT_URL_FIELD } from "../../../Types/SSO/IdentityProviderSignOut";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHERE THE BROWSER GOES ONCE IT IS SIGNED OUT (#9535).
 *
 * The sign-in page, as always - unless the person signed in through an
 * identity provider set to sign people out of it too: then the server's
 * answer to the sign-out names the provider's own sign-out, which ends the
 * person's session there and comes back to the sign-in page. Only an answer
 * the server gave, saying it signed the browser out, can name one, and only
 * an http(s) address is ever followed. The browser's fetch is the only
 * stand-in.
 */

const SIGN_OUT_ADDRESS: string =
  "https://oneuptime.example.com/identity/logout";

const PROVIDER_SIGN_OUT: string =
  "https://idp.example.com/realms/acme/protocol/openid-connect/logout?id_token_hint=eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1In0.c2ln&client_id=oneuptime&post_logout_redirect_uri=https%3A%2F%2Foneuptime.example.com%2Faccounts";

// The server's answer, as fetch hands it over.
interface Answer {
  status: number;
  body?: unknown;
  // A body that is not JSON.
  isNotJson?: boolean;
}

let answer: Answer | "unreachable" | "never" = { status: 200, body: {} };

function installFetch(): void {
  Object.defineProperty(window, "fetch", {
    configurable: true,
    writable: true,
    value: (): Promise<Response> => {
      if (answer === "unreachable") {
        return Promise.reject(
          new TypeError("NetworkError when attempting to fetch resource."),
        );
      }

      if (answer === "never") {
        return new Promise<Response>(() => {});
      }

      const current: Answer = answer;

      return Promise.resolve({
        ok: current.status >= 200 && current.status < 300,
        status: current.status,
        json: (): Promise<unknown> => {
          return current.isNotJson
            ? Promise.reject(new SyntaxError("Unexpected token < in JSON"))
            : Promise.resolve(current.body);
        },
      } as Response);
    },
  });
}

function signOut(waitInMs?: number): Promise<SignOutResult> {
  return SignOutRequest.sendAndRead(URL.fromString(SIGN_OUT_ADDRESS), {
    waitInMs: waitInMs,
  });
}

beforeEach(() => {
  answer = { status: 200, body: {} };
  SignOutRequest.forgetSignOutsOnTheirWayForTests();
  installFetch();
});

afterEach(() => {
  jest.useRealTimers();
  SignOutRequest.forgetSignOutsOnTheirWayForTests();
});

describe("SignOutRequest.sendAndRead", () => {
  test("an answer that names the provider's sign-out hands it on", async () => {
    answer = {
      status: 200,
      body: { [IDENTITY_PROVIDER_SIGN_OUT_URL_FIELD]: PROVIDER_SIGN_OUT },
    };

    await expect(signOut()).resolves.toEqual({
      answer: SignOutAnswer.SignedOut,
      identityProviderSignOutUrl: PROVIDER_SIGN_OUT,
    });
  });

  test("an answer that names none - every other sign-out - goes to the sign-in page", async () => {
    await expect(signOut()).resolves.toEqual({
      answer: SignOutAnswer.SignedOut,
      identityProviderSignOutUrl: null,
    });
  });

  test.each([
    ["a javascript: address", "javascript:alert(document.cookie)"],
    ["a relative path", "/somewhere"],
    ["something that is not text", { href: PROVIDER_SIGN_OUT }],
  ])(
    "never follows %s, whatever the answer holds",
    async (_: string, address: unknown) => {
      answer = {
        status: 200,
        body: { [IDENTITY_PROVIDER_SIGN_OUT_URL_FIELD]: address },
      };

      await expect(signOut()).resolves.toEqual({
        answer: SignOutAnswer.SignedOut,
        identityProviderSignOutUrl: null,
      });
    },
  );

  test("an answer that is not JSON names none", async () => {
    answer = { status: 200, isNotJson: true };

    await expect(signOut()).resolves.toEqual({
      answer: SignOutAnswer.SignedOut,
      identityProviderSignOutUrl: null,
    });
  });

  // Only a sign-out the server answered as done may send the browser on.
  test("a refused sign-out names none, whatever its body says", async () => {
    answer = {
      status: 500,
      body: { [IDENTITY_PROVIDER_SIGN_OUT_URL_FIELD]: PROVIDER_SIGN_OUT },
    };

    await expect(signOut()).resolves.toEqual({
      answer: SignOutAnswer.Refused,
      identityProviderSignOutUrl: null,
    });
  });

  test("an unreachable server names none", async () => {
    answer = "unreachable";

    await expect(signOut()).resolves.toEqual({
      answer: SignOutAnswer.Unreachable,
      identityProviderSignOutUrl: null,
    });
  });

  test("a sign-out still on its way when the wait is over names none", async () => {
    jest.useFakeTimers();
    answer = "never";

    const result: Promise<SignOutResult> = signOut(1000);

    jest.advanceTimersByTime(1000);

    await expect(result).resolves.toEqual({
      answer: SignOutAnswer.StillOnItsWay,
      identityProviderSignOutUrl: null,
    });
  });

  test("send still answers what came of it, as before", async () => {
    answer = {
      status: 200,
      body: { [IDENTITY_PROVIDER_SIGN_OUT_URL_FIELD]: PROVIDER_SIGN_OUT },
    };

    await expect(
      SignOutRequest.send(URL.fromString(SIGN_OUT_ADDRESS)),
    ).resolves.toBe(SignOutAnswer.SignedOut);
  });
});

describe("UserUtil.logout", () => {
  test("answers the provider's sign-out, for the Sign Out page to open", async () => {
    answer = {
      status: 200,
      body: { [IDENTITY_PROVIDER_SIGN_OUT_URL_FIELD]: PROVIDER_SIGN_OUT },
    };

    const next: URL | null = await UserUtil.logout();

    expect(next?.toString()).toBe(PROVIDER_SIGN_OUT);
  });

  test("answers null for the sign-in page, as every sign-out did before", async () => {
    await expect(UserUtil.logout()).resolves.toBeNull();
  });

  test("forgets the person in this browser before the answer, as always", async () => {
    window.localStorage.setItem("user_email", "night.shift@example.com");
    answer = {
      status: 200,
      body: { [IDENTITY_PROVIDER_SIGN_OUT_URL_FIELD]: PROVIDER_SIGN_OUT },
    };

    await UserUtil.logout();

    expect(window.localStorage.getItem("user_email")).toBeNull();
  });
});
