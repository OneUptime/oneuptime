import ejs from "ejs";
import nodePath from "path";
import { beforeEach, describe, expect, test } from "@jest/globals";
import OidcEmailVerification, {
  EMAIL_VERIFIED_CLAIM,
  PROVIDER_EMAIL_NOT_VERIFIED_ERROR,
  PROVIDER_EMAIL_NOT_VERIFIED_MESSAGE,
  PROVIDER_EMAIL_NOT_VERIFIED_TITLE,
  ProviderEmailVerification,
  STANDARD_EMAIL_CLAIM,
} from "../../../FeatureSet/Identity/Utils/OidcEmailVerification";
import OidcEmailVerificationGate from "../../../FeatureSet/Identity/Utils/OidcEmailVerificationGate";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import { SignInFailureReason } from "Common/Types/AuditLog/AuditLogSignInFailure";
import Email from "Common/Types/Email";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  SessionSignIn,
  SignInMethod,
} from "Common/Types/UserSession/SessionSignIn";

/*
 * ---------------------------------------------------------------------------
 * WHAT AN OPENID CONNECT PROVIDER SAYS OF THE ADDRESS IT SENT, AND WHERE A
 * SIGN-IN STOPS WHEN IT DOES NOT VOUCH FOR IT (GHSA-8gwc-w386-fh6w).
 *
 * The rule, in Utils/OidcEmailVerification: an ID token whose provider says
 * it has not verified the address (email_verified false, or a value that is
 * neither true nor false) signs nobody in by it; one that says nothing -
 * Microsoft Entra ID, AD FS - signs in as before; and the claim speaks of
 * the standard `email` claim alone. Here every value a provider sends is
 * read, and the gate (Utils/OidcEmailVerificationGate) answers, records and
 * reads what it should and nothing more. The callbacks that ask it are
 * driven in OidcUnverifiedEmailSignIn.test.ts, and end to end against a
 * real provider in OidcEmailVerifiedEndToEnd.test.ts.
 * ---------------------------------------------------------------------------
 */

const ACCOUNT_ID: string = "88888888-8888-4888-8888-888888888888";
const ADDRESS: string = "victim@example.com";

const userFindOneBy: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return userFindOneBy(...args);
      },
    },
  };
});

const recordFailedSignIn: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/AuditLog/FailedSignInAuditLog", () => {
  return {
    __esModule: true,
    default: {
      record: (...args: Array<unknown>): unknown => {
        return recordFailedSignIn(...args);
      },
    },
  };
});

const logInfo: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      info: (...args: Array<unknown>): unknown => {
        return logInfo(...args);
      },
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    },
    getLogAttributesFromRequest: (): Record<string, unknown> => {
      return {};
    },
  };
});

const render: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      render: (...args: Array<unknown>): unknown => {
        return render(...args);
      },
    },
  };
});

const VIEW: string = nodePath.join(
  __dirname,
  "..",
  "..",
  "..",
  "FeatureSet",
  "Identity",
  "Views",
  "Message.ejs",
);

function readStandard(emailVerified: unknown): ProviderEmailVerification {
  return OidcEmailVerification.read({
    emailClaimName: STANDARD_EMAIL_CLAIM,
    emailVerified,
  });
}

describe("what a provider's email_verified says", () => {
  test("names the standard claims", () => {
    expect(STANDARD_EMAIL_CLAIM).toBe("email");
    expect(EMAIL_VERIFIED_CLAIM).toBe("email_verified");
  });

  test.each([
    ["the boolean true (OpenID Connect Core 5.1)", true],
    ['the string "true" (Google on some flows, Cognito\'s userinfo)', "true"],
    ['"TRUE", in any case', "TRUE"],
    ['"True", as a Python str() of a bool writes it', "True"],
    ['" true ", with spaces around it', " true "],
    ["the number 1", 1],
    ['the string "1"', "1"],
  ] as Array<[string, unknown]>)(
    "%s is verified",
    (_label: string, value: unknown) => {
      expect(readStandard(value)).toBe(ProviderEmailVerification.Verified);
    },
  );

  test.each([
    ["the boolean false (Keycloak, Auth0, authentik 2025.10 and later)", false],
    ['the string "false" (Cognito\'s userinfo)', "false"],
    ['"FALSE", in any case', "FALSE"],
    ['"False", as a Python str() of a bool writes it', "False"],
    ["the number 0", 0],
    ['the string "0"', "0"],
  ] as Array<[string, unknown]>)(
    "%s is not verified",
    (_label: string, value: unknown) => {
      expect(readStandard(value)).toBe(ProviderEmailVerification.Unverified);
    },
  );

  test.each([
    ["no claim at all (Microsoft Entra ID, AD FS)", undefined],
    ["null", null],
  ] as Array<[string, unknown]>)(
    "%s says nothing",
    (_label: string, value: unknown) => {
      expect(readStandard(value)).toBe(ProviderEmailVerification.NotStated);
    },
  );

  test.each([
    ['"yes"', "yes"],
    ['"no"', "no"],
    ["an empty string", ""],
    ['"verified"', "verified"],
    ["the number 2", 2],
    ["the number -1", -1],
    ["NaN", NaN],
    ["an object", { verified: true }],
    ['an array holding "true"', ["true"]],
    ["an array holding true", [true]],
  ] as Array<[string, unknown]>)(
    "%s cannot be read, and is not taken as verified",
    (_label: string, value: unknown) => {
      expect(readStandard(value)).toBe(ProviderEmailVerification.Unreadable);
    },
  );

  /*
   * email_verified speaks of the `email` claim. An address read from
   * another claim is taken as it always was, whatever email_verified says.
   */
  test.each([
    ["upn", false],
    ["upn", true],
    ["preferred_username", false],
    ["preferred_username", "false"],
    ["mail", false],
    ["Email", false],
    ["unique_name", "garbage"],
  ] as Array<[string, unknown]>)(
    "an address read from %s, with email_verified %p, says nothing",
    (emailClaimName: string, value: unknown) => {
      expect(
        OidcEmailVerification.read({ emailClaimName, emailVerified: value }),
      ).toBe(ProviderEmailVerification.NotStated);
    },
  );
});

describe("which addresses sign nobody in", () => {
  test("one the provider says it has not verified", () => {
    expect(
      OidcEmailVerification.refusesSignIn(ProviderEmailVerification.Unverified),
    ).toBe(true);
  });

  test("one whose verification cannot be read", () => {
    expect(
      OidcEmailVerification.refusesSignIn(ProviderEmailVerification.Unreadable),
    ).toBe(true);
  });

  test("not one the provider verified", () => {
    expect(
      OidcEmailVerification.refusesSignIn(ProviderEmailVerification.Verified),
    ).toBe(false);
  });

  /*
   * Microsoft Entra ID sends no email_verified, and AD FS none either:
   * requiring a true would lock every one of their people out.
   */
  test("not one the provider says nothing of", () => {
    expect(
      OidcEmailVerification.refusesSignIn(ProviderEmailVerification.NotStated),
    ).toBe(false);
  });
});

describe("what the person who is refused is told", () => {
  test("a title and a message, each a sentence", () => {
    for (const sentence of [
      PROVIDER_EMAIL_NOT_VERIFIED_TITLE,
      PROVIDER_EMAIL_NOT_VERIFIED_MESSAGE,
    ]) {
      expect(sentence).toMatch(/^[A-Z]/);
      expect(sentence.endsWith(".")).toBe(true);
    }
  });

  // Docs/ux/README.md#errors: what happened, and what to do next.
  test("says what happened and what to do: verify the address with the identity provider, then sign in again", () => {
    expect(PROVIDER_EMAIL_NOT_VERIFIED_TITLE).toContain("identity provider");
    expect(PROVIDER_EMAIL_NOT_VERIFIED_MESSAGE).toContain(
      "Verify your email address with your identity provider",
    );
    expect(PROVIDER_EMAIL_NOT_VERIFIED_MESSAGE).toContain(
      "ask your administrator",
    );
    expect(PROVIDER_EMAIL_NOT_VERIFIED_MESSAGE).toContain("sign in again");
  });

  // Docs/ux/README.md#names and #what-never-to-write.
  test("in plain words: no claim names, and never 'log in'", () => {
    for (const sentence of [
      PROVIDER_EMAIL_NOT_VERIFIED_TITLE,
      PROVIDER_EMAIL_NOT_VERIFIED_MESSAGE,
    ]) {
      expect(sentence).not.toMatch(/email_verified|claim|ID token|OIDC/);
      expect(sentence.toLowerCase()).not.toMatch(/log ?in|log out/);
    }
  });

  test("the mobile app's reason code is its own, apart from OneUptime's own unverified address", () => {
    expect(PROVIDER_EMAIL_NOT_VERIFIED_ERROR).toBe(
      "provider_email_not_verified",
    );
    expect(PROVIDER_EMAIL_NOT_VERIFIED_ERROR).not.toBe("email_not_verified");
  });

  test("the sign-in page draws both, as written", async () => {
    const html: string = await ejs.renderFile(VIEW, {
      enableGoogleTagManager: false,
      title: PROVIDER_EMAIL_NOT_VERIFIED_TITLE,
      message: PROVIDER_EMAIL_NOT_VERIFIED_MESSAGE,
    });

    expect(html).toContain(PROVIDER_EMAIL_NOT_VERIFIED_TITLE);
    expect(html).toContain(PROVIDER_EMAIL_NOT_VERIFIED_MESSAGE);
  });
});

/*
 * The gate both callbacks ask right after the provider's answer verified:
 * the page or the deep link, the audit log entry of the account at the
 * address, and nothing else.
 */
describe("the gate", () => {
  const SIGN_IN: SessionSignIn = {
    method: SignInMethod.OpenIdConnect,
    ssoProviderName: "Acme Keycloak",
  };

  type GateRun = {
    answered: boolean;
    resRedirect: jest.Mock;
    req: ExpressRequest;
  };

  async function runGate(data: {
    verification: ProviderEmailVerification;
    isMobileRequest?: boolean | undefined;
  }): Promise<GateRun> {
    const resRedirect: jest.Mock = jest.fn();

    const req: ExpressRequest = {
      headers: {},
      socket: { remoteAddress: "203.0.113.7" },
    } as unknown as ExpressRequest;

    const res: ExpressResponse = {
      redirect: resRedirect,
    } as unknown as ExpressResponse;

    const answered: boolean =
      await OidcEmailVerificationGate.refuseUnverifiedAddress({
        req,
        res,
        isMobileRequest: Boolean(data.isMobileRequest),
        identity: {
          email: new Email(ADDRESS),
          emailVerification: data.verification,
        },
        provider: "Global OIDC provider 1",
        signIn: SIGN_IN,
      });

    return { answered, resRedirect, req };
  }

  beforeEach(() => {
    jest.clearAllMocks();

    userFindOneBy.mockResolvedValue({ id: new ObjectID(ACCOUNT_ID) });
  });

  test.each([
    ProviderEmailVerification.Verified,
    ProviderEmailVerification.NotStated,
  ])(
    "lets the sign-in go on, untouched, when the provider says %s",
    async (verification: ProviderEmailVerification) => {
      const run: GateRun = await runGate({ verification });

      expect(run.answered).toBe(false);
      expect(render).not.toHaveBeenCalled();
      expect(run.resRedirect).not.toHaveBeenCalled();
      expect(userFindOneBy).not.toHaveBeenCalled();
      expect(recordFailedSignIn).not.toHaveBeenCalled();
      expect(logInfo).not.toHaveBeenCalled();
    },
  );

  // Mocks written before the field existed hand the callbacks none.
  test("lets the sign-in go on when no verification was read at all", async () => {
    const run: GateRun = await runGate({
      verification: undefined as unknown as ProviderEmailVerification,
    });

    expect(run.answered).toBe(false);
    expect(render).not.toHaveBeenCalled();
  });

  test.each([
    ProviderEmailVerification.Unverified,
    ProviderEmailVerification.Unreadable,
  ])(
    "answers with the page that says what to do when the provider says %s",
    async (verification: ProviderEmailVerification) => {
      const run: GateRun = await runGate({ verification });

      expect(run.answered).toBe(true);
      expect(render).toHaveBeenCalledTimes(1);
      expect(render.mock.calls[0]![2]).toBe(
        "/usr/src/app/FeatureSet/Identity/Views/Message.ejs",
      );
      expect(render.mock.calls[0]![3]).toEqual({
        title: PROVIDER_EMAIL_NOT_VERIFIED_TITLE,
        message: PROVIDER_EMAIL_NOT_VERIFIED_MESSAGE,
      });
      expect(run.resRedirect).not.toHaveBeenCalled();
    },
  );

  test("sends the mobile app back to its deep link with the reason and the words, and no page", async () => {
    const run: GateRun = await runGate({
      verification: ProviderEmailVerification.Unverified,
      isMobileRequest: true,
    });

    expect(run.answered).toBe(true);
    expect(render).not.toHaveBeenCalled();
    expect(run.resRedirect).toHaveBeenCalledTimes(1);

    const deepLink: string = run.resRedirect.mock.calls[0]![0] as string;
    const params: URLSearchParams = new URLSearchParams(
      deepLink.split("?")[1] || "",
    );

    expect(deepLink.startsWith("oneuptime://sso-callback?")).toBe(true);
    expect(params.get("error")).toBe(PROVIDER_EMAIL_NOT_VERIFIED_ERROR);
    expect(params.get("errorDescription")).toBe(
      PROVIDER_EMAIL_NOT_VERIFIED_MESSAGE,
    );
    expect(params.get("accessToken")).toBeNull();
    expect(params.get("code")).toBeNull();
    // The address is never put on the link.
    expect(deepLink).not.toContain(ADDRESS);
    expect(deepLink).not.toContain(encodeURIComponent(ADDRESS));
  });

  test("records the attempt in the audit logs of the account at the address, as an unverified address, with the provider", async () => {
    const run: GateRun = await runGate({
      verification: ProviderEmailVerification.Unverified,
    });

    expect(recordFailedSignIn).toHaveBeenCalledTimes(1);

    const attempt: {
      req: ExpressRequest;
      userId: ObjectID;
      reason: SignInFailureReason;
      signIn: SessionSignIn;
    } = recordFailedSignIn.mock.calls[0]![0] as never;

    expect(attempt.req).toBe(run.req);
    expect(attempt.userId.toString()).toBe(ACCOUNT_ID);
    expect(attempt.reason).toBe(SignInFailureReason.EmailNotVerified);
    expect(attempt.signIn).toEqual(SIGN_IN);
  });

  test("records nothing for an address no account has, and answers the same", async () => {
    userFindOneBy.mockResolvedValue(null);

    const run: GateRun = await runGate({
      verification: ProviderEmailVerification.Unverified,
    });

    expect(run.answered).toBe(true);
    expect(recordFailedSignIn).not.toHaveBeenCalled();
    expect(render.mock.calls[0]![3]).toEqual({
      title: PROVIDER_EMAIL_NOT_VERIFIED_TITLE,
      message: PROVIDER_EMAIL_NOT_VERIFIED_MESSAGE,
    });
  });

  /*
   * The same read whether an account has the address or not, and only its
   * id: nothing the answer could differ by.
   */
  test("reads the account at the address by its id alone", async () => {
    await runGate({ verification: ProviderEmailVerification.Unverified });

    expect(userFindOneBy).toHaveBeenCalledTimes(1);

    const lookup: {
      query: { email: Email };
      select: JSONObject;
      props: JSONObject;
    } = userFindOneBy.mock.calls[0]![0] as never;

    expect(lookup.query.email.toString()).toBe(ADDRESS);
    expect(lookup.select).toEqual({ _id: true });
    expect(lookup.props).toEqual({ isRoot: true });
  });

  test("tells whoever runs the server which provider refused, and why, without the address", async () => {
    await runGate({ verification: ProviderEmailVerification.Unverified });

    expect(logInfo).toHaveBeenCalledTimes(1);

    const line: string = logInfo.mock.calls[0]![0] as string;

    expect(line).toContain("Global OIDC provider 1");
    expect(line).toContain("email_verified is false");
    expect(line).not.toContain(ADDRESS);
  });

  test("says so when the provider's email_verified cannot be read", async () => {
    await runGate({ verification: ProviderEmailVerification.Unreadable });

    const line: string = logInfo.mock.calls[0]![0] as string;

    expect(line).toContain("neither true nor false");
    expect(line).not.toContain(ADDRESS);
  });
});
