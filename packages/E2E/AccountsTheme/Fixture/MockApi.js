/*
 * What the sign-in pages ask a server, answered here before it leaves the
 * browser (see Index.js). Every request is recorded on
 * window.__accountsThemeFixture, and one the fixture does not answer is
 * recorded as unexpected - the spec fails on it - and answered 404.
 *
 * The scenario comes from the page's query string, and is kept for the
 * visit (sessionStorage), so a move to another page of the app - the sign-in
 * page's link to single sign-on, say - keeps it:
 *
 *   ssorequired=1          the whole server requires SSO (one instance-wide
 *                          provider unless providers= says)
 *   providers=<n>          how many instance-wide providers (0 to 2)
 *   lookup=found           the email lookup on Login with SSO finds a provider
 *                          in two projects (it finds none otherwise)
 *   firstaccount=1         a self-hosted server with no account yet
 *   signup=verify|sent     what a sign-up is answered: the account is held
 *                          until its email is verified (the "check your
 *                          inbox" screen), or a link went to an address that
 *                          already has one
 *   signin=wrong|methods|totp|enrol|codes|nocodes
 *                          what a password sign-in is answered: a wrong
 *                          password; two second steps to pick from; an
 *                          authenticator app alone; a required enrolment
 *                          (a QR code); then, after a code, the backup codes
 *                          it minted, or the offer of some
 *   verify=failed          the email verification link is refused
 *   mcp=read|write|loopback|noprojects|error
 *                          what the MCP consent screen is told
 *   market=ready|error     what the marketplace purchase page is told
 *   form=ok|missing        the public form, or a link to none - on its
 *                          link, and on its own domain (the server's / with
 *                          formdomain=1)
 *   brand=name|logo|logos  an installation that goes by a name of its own:
 *                          with no logo, with a logo for light backgrounds
 *                          only, or with logos for light and dark ones
 */
import API from "Common/UI/Utils/API/API";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import {
  FORM,
  MARKETPLACE_DETAILS,
  MCP_DETAILS,
  PROVIDERS,
  SIGNED_IN_USER,
  lookupProviders,
} from "./Data";

const SCENARIO_KEY = "accounts-theme-fixture-scenario";

const readScenario = () => {
  let kept = {};

  try {
    kept = JSON.parse(window.sessionStorage.getItem(SCENARIO_KEY) || "{}");
  } catch {
    kept = {};
  }

  const fromAddress = new URLSearchParams(window.location.search);

  for (const [key, value] of fromAddress.entries()) {
    kept[key] = value;
  }

  try {
    window.sessionStorage.setItem(SCENARIO_KEY, JSON.stringify(kept));
  } catch {
    // The scenario still holds for this page.
  }

  return kept;
};

const scenario = readScenario();

/*
 * The installation's branding, as env.js would carry it (PRODUCT_BRANDING).
 * Read by the pages when they draw, never when a module loads, so setting it
 * here - before anything renders - is setting it for the whole visit.
 */
const BRANDING = {
  name: { productName: "Acme Ops" },
  logo: { productName: "Acme Ops", logoUrl: "/fixture/brand-logo-light.svg" },
  logos: {
    productName: "Acme Ops",
    logoUrl: "/fixture/brand-logo-light.svg",
    darkLogoUrl: "/fixture/brand-logo-dark.svg",
  },
};

if (Object.prototype.hasOwnProperty.call(BRANDING, scenario["brand"] || "")) {
  window.process.env.PRODUCT_BRANDING = JSON.stringify(
    BRANDING[scenario["brand"]],
  );
}

const record = {
  requests: [],
  // Where each request went: the whole address, for a page that must keep its own origin.
  addresses: [],
  unexpected: [],
};

window.__accountsThemeFixture = record;

const ok = (data) => {
  // A copy each time: a page is free to change what it is handed.
  return new HTTPResponse(200, JSON.parse(JSON.stringify(data)), {});
};

const refused = (status, message) => {
  return new HTTPErrorResponse(status, { message }, {});
};

const never = () => {
  return new Promise(() => {});
};

const isSsoRequired = scenario["ssorequired"] === "1";
const providerCount = scenario["providers"]
  ? Number(scenario["providers"])
  : isSsoRequired
    ? 1
    : 0;

const TOTP = {
  _id: "11111111-1111-4111-8111-111111111111",
  name: "Phone",
};
const SECURITY_KEY = {
  _id: "22222222-2222-4222-8222-222222222222",
  name: "YubiKey 5C",
};
const BACKUP_CODES = [
  "4f7k-2m9q",
  "8x3n-6c1v",
  "q2w9-r5t7",
  "z8m4-k3j6",
  "p6l1-h9d2",
  "c5v8-b2n4",
  "j7g3-f1s9",
  "u4y6-e8w2",
  "a1q5-z7x3",
  "t9r2-m6k8",
];

// What /identity/login answers a password sign-in, by scenario.
const answerPasswordSignIn = () => {
  const signIn = scenario["signin"];

  if (signIn === "wrong") {
    return refused(400, "Invalid email or password.");
  }

  if (signIn === "methods") {
    return ok({
      ...SIGNED_IN_USER,
      _miscData: {
        totpAuthList: [TOTP],
        webAuthnList: [SECURITY_KEY],
        backupCodeCount: 8,
      },
    });
  }

  if (signIn === "totp" || signIn === "codes" || signIn === "nocodes") {
    return ok({
      ...SIGNED_IN_USER,
      _miscData: {
        totpAuthList: [TOTP],
        webAuthnList: [],
        backupCodeCount: signIn === "nocodes" ? 0 : 8,
      },
    });
  }

  if (signIn === "enrol") {
    return ok({
      ...SIGNED_IN_USER,
      _miscData: {
        twoFactorEnrolmentRequired: true,
        twoFactorAuthId: TOTP._id,
        twoFactorOtpUrl:
          "otpauth://totp/OneUptime:jane%40acme.example?secret=JBSWY3DPEHPK3PXP&issuer=OneUptime",
      },
    });
  }

  // A sign-in that never answers: the page stays as it is.
  return never();
};

/*
 * What /identity/signup answers, by scenario: no session either way. The
 * hosted service holds a new account until its email is verified, with a
 * credential to send the link again after a wait; an address that already
 * has an account is sent a link instead of a second one.
 */
const answerSignUp = () => {
  if (scenario["signup"] === "sent") {
    return ok({ _miscData: { registrationEmailSent: true } });
  }

  if (scenario["signup"] === "verify") {
    return ok({
      _miscData: {
        emailVerificationRequired: true,
        verificationEmailResendToken: "fixture-resend-token",
        verificationEmailResendAvailableInSeconds: 45,
      },
    });
  }

  // A sign-up that never answers: the page stays as it is.
  return never();
};

// What a correct second step answers, by scenario.
const answerSecondStep = () => {
  if (scenario["signin"] === "enrol" || scenario["signin"] === "codes") {
    return ok({ ...SIGNED_IN_USER, _miscData: { backupCodes: BACKUP_CODES } });
  }

  // nocodes: signed in, with no backup codes - the page offers some.
  return ok({ ...SIGNED_IN_USER, _miscData: {} });
};

const answer = (method, apiPath, data) => {
  // How this server signs people in: what every sign-in page reads first.
  if (apiPath === "/identity/sign-in-methods") {
    return ok({
      isSsoRequired: isSsoRequired,
      ssoProviders: PROVIDERS.slice(0, providerCount),
      hasProjectSsoProviders: isSsoRequired && scenario["projectsso"] === "1",
    });
  }

  if (apiPath === "/identity/first-account") {
    return ok({ isAwaitingFirstAccount: scenario["firstaccount"] === "1" });
  }

  if (apiPath === "/identity/login") {
    return answerPasswordSignIn();
  }

  if (apiPath === "/identity/signup") {
    return answerSignUp();
  }

  if (
    apiPath === "/identity/verify-totp-auth" ||
    apiPath === "/identity/verify-totp-enrolment" ||
    apiPath === "/identity/verify-backup-code"
  ) {
    return answerSecondStep();
  }

  if (apiPath === "/api/user-two-factor-backup-code/generate") {
    return ok({ codes: BACKUP_CODES });
  }

  if (
    apiPath === "/identity/service-provider-login" ||
    apiPath === "/identity/service-provider-login-oidc"
  ) {
    return ok(
      scenario["lookup"] === "found"
        ? lookupProviders(apiPath.endsWith("-oidc"))
        : [],
    );
  }

  if (apiPath === "/identity/passkey-login-options") {
    return ok({
      options: {
        challenge: "-_8A",
        rpId: "127.0.0.1",
        timeout: 60000,
        userVerification: "required",
      },
    });
  }

  if (apiPath === "/identity/forgot-password") {
    return ok({});
  }

  if (apiPath === "/identity/reset-password") {
    return ok({});
  }

  if (apiPath === "/identity/verify-email") {
    return scenario["verify"] === "failed"
      ? refused(400, "This link has expired. Ask for a new one below.")
      : ok({});
  }

  if (apiPath === "/identity/resend-verification-email") {
    return ok({});
  }

  if (apiPath === "/mcp/oauth/consent/details") {
    if (scenario["mcp"] === "error") {
      return refused(400, "This sign-in request has expired.");
    }

    return ok(MCP_DETAILS(scenario["mcp"] || "read"));
  }

  /*
   * What the edition pill's dialog reads (Learn more, on the sign-in page):
   * a Community Edition server on the newest version.
   */
  if (apiPath === "/api/global-config/license") {
    return ok({ currentVersion: "1.0.0", latestVersion: "1.0.0" });
  }

  if (apiPath === "/api/marketplace/purchase/details") {
    if (scenario["market"] === "error") {
      return refused(400, "This purchase could not be found.");
    }

    return ok(MARKETPLACE_DETAILS);
  }

  if (apiPath.startsWith("/api/form/public/")) {
    if (scenario["form"] === "missing") {
      return refused(404, "This form does not exist.");
    }

    return ok(FORM);
  }

  /*
   * A form on its own domain: read, and submitted, at the domain it was
   * opened on, naming no key (Accounts Utils/Form.ts).
   */
  if (apiPath === "/api/form/custom-domain" && method === "GET") {
    if (scenario["form"] === "missing") {
      return refused(
        404,
        "This form is not available. It may have been turned off, or the link may be out of date.",
      );
    }

    return ok(FORM);
  }

  if (apiPath === "/api/form/custom-domain/submit" && method === "POST") {
    return ok({ reference: "INC-7" });
  }

  return null;
};

API.fetch = async (options) => {
  const url = new URL(options.url.toString());
  const apiPath = url.pathname;

  record.requests.push(`${options.method} ${apiPath}`);
  record.addresses.push(url.toString());

  const response = answer(options.method, apiPath, options.data);

  if (response) {
    return response;
  }

  record.unexpected.push(`${options.method} ${apiPath}`);

  return refused(404, `The fixture does not answer ${apiPath}`);
};
