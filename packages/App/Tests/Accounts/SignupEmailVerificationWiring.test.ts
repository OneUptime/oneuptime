import { VERIFICATION_EMAIL_RESEND_INVALID_MESSAGE } from "../../FeatureSet/Identity/Utils/VerificationEmailResendPolicy";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";

/*
 * ---------------------------------------------------------------------------
 * THE ACCOUNTS APP'S HALF OF "VERIFY YOUR EMAIL BEFORE YOU SIGN IN".
 *
 * On the hosted service /signup now creates the account and answers
 * `emailVerificationRequired` instead of a session
 * (Tests/FeatureSet/Identity/SignupEmailVerification.test.ts), and
 * POST /resend-verification-email mails a fresh link to an account in that
 * state without anybody signing in
 * (Tests/FeatureSet/Identity/ResendVerificationEmail.test.ts). Each way the
 * pages could get that wrong fails silently in a browser:
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
 *  - THE RESEND CREDENTIAL. /signup hands back `verificationEmailResendToken`
 *    and Register.tsx passes it down to the resend button. Lose it anywhere on
 *    that path -- a renamed key, a prop that is no longer passed -- and the
 *    screen quietly falls back to "sign in to get a new link". That fallback
 *    is a real, working screen, so nothing looks broken; the feature is just
 *    gone. The same goes for the rejected link on VerifyEmail.tsx, whose token
 *    is the credential for asking for a new one;
 *  - WHERE THE CREDENTIAL IS HANDED OUT. Only in the answer to a signup that
 *    just created an account it could not sign in. The invitation branch's
 *    `registrationEmailSent` answer is deliberately identical whether or not
 *    an account stood behind the address; a token there would tell whoever
 *    typed it that one did, and hand them a way to keep mailing its owner;
 *  - THE LIMITER. The route is anonymous and every request that gets past its
 *    checks sends an email. Registered without the identity limiter in front,
 *    it is bounded only by the per-account caps inside it;
 *  - THE COPY. i18next falls back to English for a missing key, so a locale
 *    that lost one renders a half-English screen and throws nothing. The
 *    server's refusals are shown as they came, and Alert looks each one up as
 *    a flat key -- a key that no longer matches the server's sentence byte for
 *    byte is, again, English for everybody and an error for nobody.
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

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/*
 * The source between `start` and the first `end` after it. Asserts both are
 * there, so a landmark that was renamed away fails here, loudly, rather than
 * turning every later `toContain` into a search of the wrong text.
 */
function sliceBetween(source: string, start: string, end: string): string {
  const startIndex: number = source.indexOf(start);

  expect(startIndex).toBeGreaterThan(-1);

  const endIndex: number = source.indexOf(end, startIndex + start.length);

  expect(endIndex).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
}

const registerSource: string = readCode(
  nodePath.join(ACCOUNTS_SRC, "Pages", "Register.tsx"),
);

const verifyEmailSource: string = readCode(
  nodePath.join(ACCOUNTS_SRC, "Pages", "VerifyEmail.tsx"),
);

const verifyEmailPendingSource: string = readCode(
  nodePath.join(
    ACCOUNTS_SRC,
    "Components",
    "VerifyEmailPending",
    "VerifyEmailPending.tsx",
  ),
);

const resendVerificationEmailSource: string = readCode(
  nodePath.join(
    ACCOUNTS_SRC,
    "Components",
    "ResendVerificationEmail",
    "ResendVerificationEmail.tsx",
  ),
);

const apiPathsSource: string = readCode(
  nodePath.join(ACCOUNTS_SRC, "Utils", "ApiPaths.ts"),
);

const verificationEmailResendClientSource: string = readCode(
  nodePath.join(ACCOUNTS_SRC, "Utils", "VerificationEmailResend.ts"),
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
    /*
     * The markup moved into its own component; what this page still owns is
     * rendering it, in the verification branch and nowhere else.
     */
    const screen: string = sliceBetween(
      registerSource,
      "if (emailAwaitingVerification !== null) {",
      "if (registrationEmailSent) {",
    );

    expect(screen).toContain("<VerifyEmailPending");

    expect(verifyEmailPendingSource).toContain('new Route("/accounts/login")');
    expect(verifyEmailPendingSource).toContain(
      'data-testid="verify-email-required"',
    );
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
 * THE RESEND ROUTE, AND THE URL THE PAGES POST TO.
 *
 * The route takes no session and no email address -- only a credential --
 * and every request that gets past its checks mails somebody. The limiter
 * has to run first: a limiter registered after the handler never runs for a
 * request the handler has already answered. The text-level check here is the
 * cheap one; IdentityRateLimit.test.ts walks the live router for the same
 * property on every POST route.
 *
 * On the client side the URL has to hang off IDENTITY_URL, because there is
 * no session at either screen that uses it. APP_API_URL resolves, and then
 * answers 401 to somebody who cannot sign in until this very request works.
 * ---------------------------------------------------------------------------
 */

describe("POST /resend-verification-email is registered behind its limiter", () => {
  test("the route exists, once, with the limiter as its first handler", () => {
    expect(
      countOccurrences(authenticationSource, '"/resend-verification-email"'),
    ).toBe(1);

    expect(authenticationSource).toContain(
      'router.post( "/resend-verification-email", verificationEmailResendRateLimit,',
    );
  });

  test("the limiter is its own bucket, not the sign-in one", () => {
    /*
     * The sign-in bucket is sized for password guesses keyed on an email in
     * the body. This body has no email, and its refusals have to talk about
     * verification emails rather than sign-in attempts.
     */
    const limiter: string = sliceBetween(
      authenticationSource,
      "const verificationEmailResendRateLimit:",
      ";",
    );

    expect(limiter).toContain(
      "IdentityRateLimit.getMiddleware( IdentityRateLimitBucket.VerificationEmailResend,",
    );
  });

  test("ApiPaths points RESEND_VERIFICATION_EMAIL_API_URL at the identity route", () => {
    const definition: string = sliceBetween(
      apiPathsSource,
      "export const RESEND_VERIFICATION_EMAIL_API_URL: URL =",
      ";",
    );

    expect(definition).toContain("IDENTITY_URL");
    expect(definition).toContain('new Route("/resend-verification-email")');
  });

  test("the client posts to that URL", () => {
    expect(verificationEmailResendClientSource).toContain(
      "url: RESEND_VERIFICATION_EMAIL_API_URL",
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * THE RESEND CREDENTIAL, FROM /signup TO THE BUTTON.
 *
 * Minted in exactly one place -- the answer to a hosted signup that created
 * an account and could not start a session -- and carried by name through
 * Register.tsx and VerifyEmailPending to ResendVerificationEmail. The rejected
 * link on VerifyEmail.tsx takes the other credential the route accepts: the
 * verification token the link carried.
 * ---------------------------------------------------------------------------
 */

describe("/signup hands out the resend token only with emailVerificationRequired", () => {
  const verificationBranch: () => string = (): string => {
    return sliceBetween(
      authenticationSource,
      "if (savedUser && isEmailVerificationRequired) {",
      "if (savedUser) {",
    );
  };

  test("the token is minted once, inside the verification branch", () => {
    expect(
      countOccurrences(
        authenticationSource,
        "VerificationEmailResendToken.generate(",
      ),
    ).toBe(1);

    expect(verificationBranch()).toContain(
      "VerificationEmailResendToken.generate(",
    );
  });

  test("the token rides in the same misc data as the flag, and nowhere else", () => {
    /*
     * One occurrence in the whole file, and that one inside the branch: the
     * invitation branch's `registrationEmailSent`, a self-hosted signup and a
     * claimed invitation all answer without it.
     */
    expect(
      countOccurrences(authenticationSource, "verificationEmailResendToken"),
    ).toBe(1);

    const branch: string = verificationBranch();
    const flag: number = branch.indexOf("emailVerificationRequired: true");
    const token: number = branch.indexOf(
      "verificationEmailResendToken: resendToken",
    );

    expect(flag).toBeGreaterThan(-1);
    expect(token).toBeGreaterThan(flag);
  });

  test("the token is minted after the welcome email's token row is written", () => {
    /*
     * The per-credential cap counts verification rows created after the
     * token was issued. Minted first, the welcome row would count as one of
     * the resends the token buys.
     */
    const welcomeToken: number = authenticationSource.indexOf(
      "welcomeEmailVerificationToken = generatedToken",
    );
    const welcomeRow: number = authenticationSource.indexOf(
      "EmailVerificationTokenService.create(",
      welcomeToken,
    );
    const minted: number = authenticationSource.indexOf(
      "VerificationEmailResendToken.generate(",
    );

    expect(welcomeToken).toBeGreaterThan(-1);
    expect(welcomeRow).toBeGreaterThan(welcomeToken);
    expect(minted).toBeGreaterThan(welcomeRow);
  });
});

describe("the resend credential reaches the button", () => {
  test("Register.tsx reads the token and its wait under the names the server sends", () => {
    expect(authenticationSource).toContain(
      "verificationEmailResendToken: resendToken",
    );
    expect(authenticationSource).toContain(
      "verificationEmailResendAvailableInSeconds: VERIFICATION_EMAIL_RESEND_COOLDOWN_IN_SECONDS",
    );

    expect(registerSource).toContain(
      'miscData["verificationEmailResendToken"]',
    );
    expect(registerSource).toContain(
      'miscData["verificationEmailResendAvailableInSeconds"]',
    );
  });

  test("Register.tsx keeps the token inside the verification branch", () => {
    const branchBody: string = sliceBetween(
      registerSource,
      "if (isEmailVerificationRequired) {",
      "LoginUtil.login(",
    );

    expect(branchBody).toContain("setVerificationEmailResendToken(");
    expect(branchBody).toContain(
      "setVerificationEmailResendAvailableInSeconds(",
    );
  });

  test("Register.tsx passes the token to VerifyEmailPending", () => {
    const element: string = sliceBetween(
      registerSource,
      "<VerifyEmailPending",
      "/>",
    );

    expect(element).toContain("email={emailAwaitingVerification}");
    expect(element).toContain("resendToken={verificationEmailResendToken}");
    expect(element).toContain(
      "resendAvailableInSeconds={verificationEmailResendAvailableInSeconds}",
    );
  });

  test("VerifyEmailPending passes it on to ResendVerificationEmail", () => {
    const element: string = sliceBetween(
      verifyEmailPendingSource,
      "<ResendVerificationEmail",
      "/>",
    );

    expect(element).toContain(
      "credential={{ resendToken: props.resendToken }}",
    );
  });

  test("VerifyEmail.tsx offers the link's own token as the credential", () => {
    /*
     * Read before anything on the page can clear it: once the token is gone
     * from the URL, a rejected link has nothing left to ask for a new one
     * with.
     */
    const read: number = verifyEmailSource.indexOf("SensitiveUrlToken.read()");
    const kept: number = verifyEmailSource.indexOf("setLinkToken(", read);
    const cleared: number = verifyEmailSource.indexOf(
      "SensitiveUrlToken.clear()",
    );

    expect(read).toBeGreaterThan(-1);
    expect(kept).toBeGreaterThan(read);
    expect(cleared).toBeGreaterThan(kept);

    const element: string = sliceBetween(
      verifyEmailSource,
      "<ResendVerificationEmail",
      "/>",
    );

    expect(element).toContain("credential={{ verificationToken: linkToken }}");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Locale parity for every key the verification screens ask for.
 * ---------------------------------------------------------------------------
 */

const NEW_KEYS: Array<string> = [
  "register.verifyEmailTitle",
  "register.verifyEmailSentTo",
  "register.verifyEmailSent",
  "register.verifyEmailInstructions",
  "register.verifyEmailResendHint",
  "register.verifyEmailLoginLink",
  "register.verifyEmailSpamHint",
  "register.verifyEmailOpenProvider",
  "register.verifyEmailOpensInNewTab",
  "register.verifyEmailAlreadyVerifiedPrompt",
  "register.verifyEmailWrongAddressPrompt",
  "register.verifyEmailUseDifferentEmail",
  "verifyEmail.successTitle",
  "verifyEmail.successDescription",
  "verifyEmail.continueToSignIn",
  "verifyEmail.linkInvalidTitle",
  "verifyEmail.requestNewLinkDescription",
  "verifyEmail.errorTitle",
  "verifyEmail.tryAgain",
  "verifyEmail.returnToSignIn",
  "verifyEmail.loginLink",
  "resendVerificationEmail.button",
  "resendVerificationEmail.countdown",
  "resendVerificationEmail.sent",
  "resendVerificationEmail.wait",
  "resendVerificationEmail.alreadyVerified",
  "resendVerificationEmail.failed",
];

/*
 * The other placeholders the components fill in, besides {{email}} (which
 * has its own test below). Same failure: a translated placeholder renders as
 * literal braces.
 */
const PLACEHOLDERS: Array<[string, string]> = [
  // A webmail brand name, which is never translated.
  ["register.verifyEmailOpenProvider", "{{provider}}"],
  // The m:ss countdown until the next resend is allowed.
  ["resendVerificationEmail.countdown", "{{time}}"],
];

/*
 * The server's curated refusals from /resend-verification-email. The button
 * shows a 4xx message as it came, and Alert translates it by using the whole
 * sentence as a flat key -- so each key has to match the server's constant
 * byte for byte, or every locale shows the English sentence.
 */
const SERVER_MESSAGES: Array<string> = [
  VERIFICATION_EMAIL_RESEND_INVALID_MESSAGE,
  ExceptionMessages.UserBlocked,
];

const USED_KEY_PATTERN: RegExp =
  /\bt\(\s*"((?:register\.verifyEmail|verifyEmail\.|resendVerificationEmail\.)[A-Za-z.]*)"/g;

const localeCodes: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((fileName: string): boolean => {
    return fileName.endsWith(".json");
  })
  .map((fileName: string): string => {
    return fileName.replace(/\.json$/, "");
  })
  .sort();

function readLocale(code: string): unknown {
  return JSON.parse(
    fs.readFileSync(nodePath.join(LOCALES_DIR, `${code}.json`), "utf8"),
  );
}

function lookUp(code: string, key: string): unknown {
  let node: unknown = readLocale(code);

  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) {
      return undefined;
    }

    node = (node as Record<string, unknown>)[part];
  }

  return node;
}

// A top-level key used whole, dots and all -- the way Alert looks one up.
function lookUpFlat(code: string, key: string): unknown {
  const locale: unknown = readLocale(code);

  if (typeof locale !== "object" || locale === null) {
    return undefined;
  }

  return (locale as Record<string, unknown>)[key];
}

function getUsedKeys(): Array<string> {
  return Array.from(
    [
      registerSource,
      verifyEmailSource,
      verifyEmailPendingSource,
      resendVerificationEmailSource,
    ]
      .join(" ")
      .matchAll(USED_KEY_PATTERN),
  ).map((match: RegExpMatchArray): string => {
    return match[1]!;
  });
}

describe("the verification copy exists in every Accounts locale", () => {
  test("all seventeen locales are checked", () => {
    expect(localeCodes).toHaveLength(17);
    expect(localeCodes).toContain("en");
  });

  test("every key the pages use is one this file checks", () => {
    const used: Array<string> = getUsedKeys();

    expect(used.length).toBeGreaterThan(0);

    for (const key of used) {
      expect(NEW_KEYS).toContain(key);
    }
  });

  test("every key this file checks is one the pages still use", () => {
    /*
     * The other direction. A key that no longer matches is either copy that
     * was dropped (so the list should shrink) or a call the pattern above has
     * stopped seeing -- and a pattern that sees nothing makes the test before
     * this one pass vacuously.
     */
    const used: Array<string> = getUsedKeys();

    for (const key of NEW_KEYS) {
      expect(used).toContain(key);
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

  test.each(
    localeCodes.flatMap((code: string): Array<[string, string, string]> => {
      return PLACEHOLDERS.map(
        ([key, placeholder]: [string, string]): [string, string, string] => {
          return [code, key, placeholder];
        },
      );
    }),
  )(
    "%s keeps the placeholder in %s: %s",
    (code: string, key: string, placeholder: string) => {
      expect(lookUp(code, key)).toContain(placeholder);
    },
  );
});

describe("the server's resend refusals are translatable", () => {
  test("the English keys are the server's sentences, verbatim", () => {
    for (const message of SERVER_MESSAGES) {
      expect(lookUpFlat("en", message)).toBe(message);
    }
  });

  test.each(
    localeCodes.flatMap((code: string): Array<[string, string]> => {
      return SERVER_MESSAGES.map((message: string): [string, string] => {
        return [code, message];
      });
    }),
  )("%s has a non-empty flat key for %s", (code: string, message: string) => {
    const value: unknown = lookUpFlat(code, message);

    expect(typeof value).toBe("string");
    expect((value as string).trim().length).toBeGreaterThan(0);
  });
});
