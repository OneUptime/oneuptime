import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";

/*
 * ---------------------------------------------------------------------------
 * THE REGISTER PAGE'S HALF OF "VERIFY YOUR EMAIL BEFORE YOU SIGN IN".
 *
 * On the hosted service /signup now creates the account and answers
 * `emailVerificationRequired` instead of a session
 * (Tests/FeatureSet/Identity/SignupEmailVerification.test.ts). Each way this
 * page could get that wrong fails silently in a browser:
 *
 *  - THE KEY NAME. A rename on either side means the page never sees the flag
 *    and falls through to LoginUtil.login with no token -- which "logs in" to
 *    a dashboard that immediately bounces back to the sign-in page, with no
 *    word about the email that is waiting;
 *  - THE ORDER. The verification branch has to return BEFORE LoginUtil.login.
 *    After it, the page navigates away and the "check your email" screen is
 *    never seen;
 *  - THE ADDRESS. The response deliberately carries no account, so the
 *    address shown on the screen has to come from what the form submitted;
 *  - THE COPY. i18next falls back to English for a missing key, so a locale
 *    that lost one renders a half-English screen and throws nothing.
 * ---------------------------------------------------------------------------
 */

const APP_DIR: string = nodePath.join(__dirname, "..", "..");

const ACCOUNTS_SRC: string = nodePath.join(
  APP_DIR,
  "FeatureSet",
  "Accounts",
  "src",
);

const LOCALES_DIR: string = nodePath.join(ACCOUNTS_SRC, "Locales");

// Comments removed and whitespace collapsed, so prettier re-wrapping is noise.
function readCode(absolutePath: string): string {
  return fs
    .readFileSync(absolutePath, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, " ");
}

const registerSource: string = readCode(
  nodePath.join(ACCOUNTS_SRC, "Pages", "Register.tsx"),
);

const verifyEmailSource: string = readCode(
  nodePath.join(ACCOUNTS_SRC, "Pages", "VerifyEmail.tsx"),
);

const authenticationSource: string = readCode(
  nodePath.join(APP_DIR, "FeatureSet", "Identity", "API", "Authentication.ts"),
);

describe("Register.tsx and /signup agree on the verification flag", () => {
  test("the server sends emailVerificationRequired", () => {
    expect(authenticationSource).toContain("emailVerificationRequired: true");
  });

  test("the page reads the same key off the misc data", () => {
    expect(registerSource).toContain('miscData["emailVerificationRequired"]');
  });
});

describe("Register.tsx stops at the verification screen", () => {
  test("the verification branch returns before the page logs anybody in", () => {
    const branch: number = registerSource.indexOf(
      "if (isEmailVerificationRequired) {",
    );
    const login: number = registerSource.indexOf("LoginUtil.login(");

    expect(branch).toBeGreaterThan(-1);
    expect(login).toBeGreaterThan(branch);

    const branchBody: string = registerSource.slice(branch, login);

    expect(branchBody).toContain("setEmailAwaitingVerification(");
    expect(branchBody).toContain("return;");
  });

  test("the address on the screen is the one the form submitted", () => {
    expect(registerSource).toContain("submittedEmail.current = item.email");
    expect(registerSource).toContain(
      "setEmailAwaitingVerification( submittedEmail.current?.toString()",
    );
  });

  test("the verification screen renders ahead of the form", () => {
    const screen: number = registerSource.indexOf(
      "if (emailAwaitingVerification !== null) {",
    );
    const form: number = registerSource.indexOf("<ModelForm<User>");

    expect(screen).toBeGreaterThan(-1);
    expect(form).toBeGreaterThan(screen);
  });

  test("the verification screen offers the way to sign in", () => {
    const screenStart: number = registerSource.indexOf(
      "if (emailAwaitingVerification !== null) {",
    );
    const screenEnd: number = registerSource.indexOf(
      "if (registrationEmailSent) {",
    );
    const screen: string = registerSource.slice(screenStart, screenEnd);

    expect(screen).toContain('new Route("/accounts/login")');
    expect(screen).toContain('data-testid="verify-email-required"');
  });

  test("a completed signup is still counted when there is no session yet", () => {
    /*
     * The account exists; only the session is deferred. Dropping the funnel
     * event here would make every hosted signup look abandoned.
     */
    const analytics: number = registerSource.indexOf(
      "RevenueEventName.SignupCompleted",
    );
    const branch: number = registerSource.indexOf(
      "if (isEmailVerificationRequired) {",
    );

    expect(analytics).toBeGreaterThan(-1);
    expect(branch).toBeGreaterThan(analytics);
  });
});

describe("VerifyEmail.tsx sends a verified account to sign in", () => {
  test("the success state links to the sign-in page", () => {
    expect(verifyEmailSource).toContain('t("verifyEmail.continueToSignIn")');
    expect(verifyEmailSource).toContain('new Route("/accounts/login")');
  });
});

/*
 * ---------------------------------------------------------------------------
 * Locale parity for every key the two pages ask for.
 * ---------------------------------------------------------------------------
 */

const NEW_KEYS: Array<string> = [
  "register.verifyEmailTitle",
  "register.verifyEmailSentTo",
  "register.verifyEmailSent",
  "register.verifyEmailInstructions",
  "register.verifyEmailResendHint",
  "register.verifyEmailLoginLink",
  "verifyEmail.continueToSignIn",
];

const localeCodes: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((fileName: string): boolean => {
    return fileName.endsWith(".json");
  })
  .map((fileName: string): string => {
    return fileName.replace(/\.json$/, "");
  })
  .sort();

function lookUp(code: string, key: string): unknown {
  let node: unknown = JSON.parse(
    fs.readFileSync(nodePath.join(LOCALES_DIR, `${code}.json`), "utf8"),
  );

  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) {
      return undefined;
    }

    node = (node as Record<string, unknown>)[part];
  }

  return node;
}

describe("the verification copy exists in every Accounts locale", () => {
  test("all seventeen locales are checked", () => {
    expect(localeCodes).toHaveLength(17);
    expect(localeCodes).toContain("en");
  });

  test("every key the pages use is one this file checks", () => {
    const used: Array<string> = Array.from(
      `${registerSource} ${verifyEmailSource}`.matchAll(
        /t\("((?:register\.verifyEmail|verifyEmail\.continueToSignIn)[A-Za-z.]*)"/g,
      ),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(used.length).toBeGreaterThan(0);

    for (const key of used) {
      expect(NEW_KEYS).toContain(key);
    }
  });

  test.each(
    localeCodes.flatMap((code: string): Array<[string, string]> => {
      return NEW_KEYS.map((key: string): [string, string] => {
        return [code, key];
      });
    }),
  )("%s has a non-empty %s", (code: string, key: string) => {
    const value: unknown = lookUp(code, key);

    expect(typeof value).toBe("string");
    expect((value as string).trim().length).toBeGreaterThan(0);
  });

  test.each(localeCodes)(
    "%s keeps the {{email}} placeholder the page fills in",
    (code: string) => {
      /*
       * A translator who "translated" the placeholder would render the
       * literal braces instead of the address the link went to.
       */
      expect(lookUp(code, "register.verifyEmailSentTo")).toContain("{{email}}");
    },
  );
});
