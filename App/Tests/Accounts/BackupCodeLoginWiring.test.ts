import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";

/*
 * ---------------------------------------------------------------------------
 * THE RECOVERY PATH ON THE SIGN-IN SCREEN: "use a backup code instead".
 *
 * Everybody who ever reaches this form is ALREADY locked out. Their phone is
 * gone, their security key is in a taxi, and the piece of paper in their hand
 * is the last thing standing between them and a support ticket. Every failure
 * mode below is silent -- the page renders, nothing throws, and the user is
 * simply refused:
 *
 *  - the field name. Login.tsx declares `field: { backupCode: true }` and posts
 *    `backupCode: data["backupCode"]`; Authentication.ts reads
 *    `data["backupCode"]` and CredentialGuard.assertPresent then answers
 *    "Backup code is required". A rename on EITHER side turns a correctly typed
 *    code into that message, and the user -- reasonably -- concludes their
 *    printed codes have stopped working;
 *  - the host. VERIFY_BACKUP_CODE_API_URL must hang off IDENTITY_URL, not
 *    APP_API_URL. The two siblings in the same file split exactly that way
 *    (the WebAuthn *options* call is an APP_API_URL call, the verify is an
 *    identity call), so the wrong constant is one line away and 404s only at
 *    the moment somebody needs it;
 *  - the credentials. There is NO SESSION at this point -- /login answered the
 *    password step with a list of factors and nothing else -- so the request
 *    has to re-submit email and password out of `initialValues`. Dropping the
 *    spread leaves the server with "Email and password are required.";
 *  - the link's gate. `backupCodeCount` comes off the /login response and
 *    starts at 0. Rendering the link unconditionally sends somebody with no
 *    codes into a form that can only refuse them, at the worst possible moment;
 *  - and the four locale keys. i18next's fallbackLng is "en", so a locale file
 *    missing them renders English inside an otherwise translated page -- or,
 *    for a key missing from en.json too, renders the raw dotted path as the
 *    label of the field somebody is trying to type a recovery code into.
 *
 * WHY A LOCALE SWEEP LIVES HERE AT ALL
 *
 * There was no locale parity test for the Accounts feature set before this
 * file -- not for these keys, not for any of them. Scripts/I18n/ValidateLocales
 * .js does cover App/FeatureSet/Accounts/src/Locales, but it is an ESM module
 * that this CommonJS suite cannot require() and it runs only in the js-lint CI
 * job. So adding a key to en.json and forgetting the other fifteen files goes
 * GREEN in the App suite and red much later, in a different job, to a different
 * person. The sweep at the bottom closes that gap for the whole directory, not
 * just for the four keys this feature added.
 *
 * NOTHING IS MOCKED, AND NOTHING IS IMPORTED. The App jest suite is
 * testEnvironment "node" with no React renderer, and Login.tsx is a component
 * that pulls in Common/UI; ApiPaths.ts resolves IDENTITY_URL out of
 * Common/UI/Config at module load. What is being asserted on is which literals
 * these files contain, and no runtime value exposes that -- so the files are
 * read off disk as text, exactly as
 * App/Tests/AdminDashboard/BulkTwoFactorAuthWiring.test.ts and
 * App/Tests/AdminDashboard/AutoAcceptInvitationWiring.test.ts do. The parity
 * sweep is modelled on App/Tests/Dashboard/RunnerVersionLabel.test.ts.
 *
 * ADJACENT GROUND, DELIBERATELY NOT REPEATED HERE:
 *
 *  - Common/Tests/Server/Utils/TwoFactorBackupCode.test.ts owns generation,
 *    the alphabet, the HMAC construction and normalization -- which is why
 *    nothing below asserts anything about the SHAPE of a code;
 *  - App/Tests/FeatureSet/Identity/BackupCodeLoginVerification.test.ts owns
 *    the server end of this exact request: the order of the gates in front of
 *    the code check, single use, and what the route refuses. Nothing here
 *    re-states any of it -- this file only pins that the browser sends what
 *    that handler reads;
 *  - App/Tests/FeatureSet/Identity/TotpForcedEnrolment.test.ts and
 *    TotpLoginVerification.test.ts own the rest of the login state machine;
 *  - App/Tests/Dashboard/BackupCodesCardWiring.test.ts owns the other end of
 *    the feature, the profile card that mints the codes in the first place.
 *
 * Comments are stripped before every assertion. That matters more than usual
 * here: Login.tsx and ApiPaths.ts both explain in prose that the request
 * re-submits the password and that the route is an identity route, which are
 * two of the things asserted below.
 * ---------------------------------------------------------------------------
 */

const ACCOUNTS_SRC: string = nodePath.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Accounts",
  "src",
);

const LOCALES_DIR: string = nodePath.join(ACCOUNTS_SRC, "Locales");

type StripCommentsFunction = (source: string) => string;

/*
 * Block comments become a space rather than nothing so two tokens either side
 * of one cannot be squashed into a single identifier by the collapse below.
 */
const stripComments: StripCommentsFunction = (source: string): string => {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
};

type SquashFunction = (source: string) => string;

/*
 * Every assertion below runs against whitespace-collapsed text so that
 * prettier re-wrapping a long `t(...)` call or a JSX prop list cannot turn a
 * real regression check into a red herring.
 */
const squash: SquashFunction = (source: string): string => {
  return source.replace(/\s+/g, " ");
};

type ReadCodeFunction = (relativePath: string) => string;

const readCode: ReadCodeFunction = (relativePath: string): string => {
  return squash(
    stripComments(
      fs.readFileSync(nodePath.join(ACCOUNTS_SRC, relativePath), "utf8"),
    ),
  );
};

const loginSource: string = readCode("Pages/Login.tsx");
const apiPathsSource: string = readCode("Utils/ApiPaths.ts");

type CountOccurrencesFunction = (source: string, needle: string) => number;

/*
 * Used where "the call happens here" is only half the guarantee and "the call
 * happens nowhere else in this file" is the other half.
 */
const countOccurrences: CountOccurrencesFunction = (
  source: string,
  needle: string,
): number => {
  return source.split(needle).length - 1;
};

type BalancedBlockFunction = (data: {
  source: string;
  startIndex: number;
  open: string;
  close: string;
  marker: string;
}) => string;

/*
 * Walks delimiters from `startIndex` (which must be an `open`) to its match.
 * `marker` is carried only so the failure names what the caller was looking
 * for rather than reporting a bare index.
 */
const balancedBlockAt: BalancedBlockFunction = (data: {
  source: string;
  startIndex: number;
  open: string;
  close: string;
  marker: string;
}): string => {
  let depth: number = 0;

  for (
    let index: number = data.startIndex;
    index < data.source.length;
    index++
  ) {
    const character: string = data.source[index]!;

    if (character === data.open) {
      depth++;
    }

    if (character === data.close) {
      depth--;

      if (depth === 0) {
        return data.source.slice(data.startIndex, index + 1);
      }
    }
  }

  throw new Error(
    `Unbalanced ${data.open}${data.close} after marker: ${data.marker}`,
  );
};

type BlockAfterFunction = (data: {
  source: string;
  marker: string;
  open: string;
  close: string;
}) => string;

/*
 * The balanced block that follows `marker`. Used to bound an assertion to one
 * JSX branch, so that "the backup code screen posts to the backup code route"
 * cannot be satisfied -- or defeated -- by the TOTP challenge and the TOTP
 * enrolment screens, which sit in the same component and post the same
 * `...initialValues` spread to two different endpoints.
 */
const blockAfter: BlockAfterFunction = (data: {
  source: string;
  marker: string;
  open: string;
  close: string;
}): string => {
  const markerIndex: number = data.source.indexOf(data.marker);

  if (markerIndex === -1) {
    throw new Error(`Marker not found in source: ${data.marker}`);
  }

  const blockStart: number = data.source.indexOf(data.open, markerIndex);

  if (blockStart === -1) {
    throw new Error(`No block follows marker: ${data.marker}`);
  }

  return balancedBlockAt({
    source: data.source,
    startIndex: blockStart,
    open: data.open,
    close: data.close,
    marker: data.marker,
  });
};

/* The whole "type a recovery code" branch: the blurb, the form and the post. */
const BACKUP_CODE_SCREEN_MARKER: string =
  "showTwoFactorAuth && isUsingBackupCode && (";

const backupCodeScreen: string = blockAfter({
  source: loginSource,
  marker: BACKUP_CODE_SCREEN_MARKER,
  open: "(",
  close: ")",
});

/* The conditional that decides whether the recovery route is offered at all. */
const LINK_GATE_MARKER: string = "backupCodeCount > 0 && (";

const backupCodeLinkBlock: string = blockAfter({
  source: loginSource,
  marker: LINK_GATE_MARKER,
  open: "(",
  close: ")",
});

/* The one declaration, not the import of it in Login.tsx. */
const VERIFY_BACKUP_CODE_DECLARATION_MARKER: string =
  "export const VERIFY_BACKUP_CODE_API_URL";

type DeclarationAfterFunction = (source: string, marker: string) => string;

/*
 * ApiPaths.ts is a flat list of `export const X: URL = ...;` statements, so a
 * declaration is bounded by the next semicolon. Bounding matters: the file
 * mentions APP_API_URL twice for two neighbouring constants, and an unbounded
 * "does not use APP_API_URL" would fail on those instead of on this one.
 */
const declarationAfter: DeclarationAfterFunction = (
  source: string,
  marker: string,
): string => {
  const markerIndex: number = source.indexOf(marker);

  if (markerIndex === -1) {
    throw new Error(`Marker not found in source: ${marker}`);
  }

  const endIndex: number = source.indexOf(";", markerIndex);

  if (endIndex === -1) {
    throw new Error(`Declaration is not terminated: ${marker}`);
  }

  return source.slice(markerIndex, endIndex + 1);
};

const verifyBackupCodeDeclaration: string = declarationAfter(
  apiPathsSource,
  VERIFY_BACKUP_CODE_DECLARATION_MARKER,
);

/*
 * i18next's interpolation marker. None of these four strings is passed an
 * options object, so a placeholder appearing in one is rendered literally at a
 * user who is already locked out.
 */
const INTERPOLATION_PLACEHOLDER: RegExp = /\{\{\s*[\w.]+\s*\}\}/;

type TranslationKeysFunction = () => Array<string>;

/*
 * Every `t("login.twoFactor.<backup code key>")` the page asks for, derived
 * from the source rather than listed here -- so a key that is renamed stops
 * being looked up under its old name and starts being checked under its new
 * one without this file being edited, and the locale loops below cannot drift
 * into checking keys nothing renders.
 */
const backupCodeTranslationKeys: TranslationKeysFunction =
  (): Array<string> => {
    const keys: Set<string> = new Set<string>();
    const pattern: RegExp =
      /\bt\(\s*"(login\.twoFactor\.(?:useBackupCode|backupCode\w*))"/g;

    let match: RegExpExecArray | null = pattern.exec(loginSource);

    while (match) {
      keys.add(match[1]!);
      match = pattern.exec(loginSource);
    }

    return [...keys].sort();
  };

/*
 * The four the feature added. Held as a constant AS WELL AS extracted, because
 * the two catch opposite mistakes: the extractor catches a key renamed in the
 * source, and this list catches a key silently DELETED from the source -- which
 * the extractor alone would report as "nothing to check" and pass.
 */
const NEW_KEYS: Array<string> = [
  "login.twoFactor.backupCodeFieldDescription",
  "login.twoFactor.backupCodeFieldTitle",
  "login.twoFactor.backupCodeInstruction",
  "login.twoFactor.useBackupCode",
];

/*
 * en.json is the source of truth; Scripts/I18n/ValidateLocales.js requires
 * these fifteen to mirror it key-for-key.
 */
const TRANSLATED_LOCALES: Array<string> = [
  "da",
  "de",
  "es",
  "fr",
  "hi",
  "it",
  "ja",
  "ko",
  "nl",
  "no",
  "pt",
  "ru",
  "sv",
  "zh-CN",
  "zh-TW",
];

const ALL_LOCALES: Array<string> = ["en", ...TRANSLATED_LOCALES];

const localeFileNames: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((fileName: string): boolean => {
    return fileName.endsWith(".json");
  })
  .sort();

type ReadLocaleRawFunction = (code: string) => string;

const readLocaleRaw: ReadLocaleRawFunction = (code: string): string => {
  return fs.readFileSync(nodePath.join(LOCALES_DIR, `${code}.json`), "utf8");
};

/*
 * Parsing is memoized because the parity sweep compares whole key sets across
 * sixteen files -- re-reading per key turns a millisecond assertion into a
 * visibly slow one.
 */
const localeCache: Map<string, Record<string, unknown>> = new Map<
  string,
  Record<string, unknown>
>();

type ReadLocaleFunction = (code: string) => Record<string, unknown>;

const readLocale: ReadLocaleFunction = (
  code: string,
): Record<string, unknown> => {
  const cached: Record<string, unknown> | undefined = localeCache.get(code);

  if (cached) {
    return cached;
  }

  const parsed: Record<string, unknown> = JSON.parse(
    readLocaleRaw(code),
  ) as Record<string, unknown>;

  localeCache.set(code, parsed);

  return parsed;
};

type LookUpKeyFunction = (data: {
  locale: Record<string, unknown>;
  key: string;
}) => unknown;

/* Walks a dotted key against one locale file. */
const lookUpKeyInLocale: LookUpKeyFunction = (data: {
  locale: Record<string, unknown>;
  key: string;
}): unknown => {
  let node: unknown = data.locale;

  for (const part of data.key.split(".")) {
    if (typeof node !== "object" || node === null) {
      return undefined;
    }

    node = (node as Record<string, unknown>)[part];
  }

  return node;
};

type FlattenLocaleFunction = (data: {
  node: unknown;
  prefix: string;
}) => Array<string>;

/*
 * The Accounts locales are NESTED objects, not the flat "English string ->
 * translation" maps the Dashboard uses, so parity has to be compared on dotted
 * leaf paths. Comparing top-level keys only would call a locale that had lost
 * every string under `login.twoFactor` a perfect match.
 */
const flattenLocaleKeys: FlattenLocaleFunction = (data: {
  node: unknown;
  prefix: string;
}): Array<string> => {
  if (
    typeof data.node !== "object" ||
    data.node === null ||
    Array.isArray(data.node)
  ) {
    return [data.prefix];
  }

  const keys: Array<string> = [];

  for (const [key, value] of Object.entries(
    data.node as Record<string, unknown>,
  )) {
    keys.push(
      ...flattenLocaleKeys({
        node: value,
        prefix: data.prefix ? `${data.prefix}.${key}` : key,
      }),
    );
  }

  return keys;
};

type LocaleKeysFunction = (code: string) => Array<string>;

const localeKeys: LocaleKeysFunction = (code: string): Array<string> => {
  return flattenLocaleKeys({ node: readLocale(code), prefix: "" });
};

describe("the backup code screen was located in Login.tsx", () => {
  /*
   * Every assertion in this file is bounded by one of the blocks pulled out
   * above. A marker that stopped matching would throw at module load rather
   * than pass vacuously -- but a marker that matched the WRONG thing (the TOTP
   * challenge branch, say, which is the next JSX sibling and has an almost
   * identical shape) would not. These pin each extraction to text only the
   * intended block contains.
   */
  test("the recovery branch, the link gate and the route declaration were found", () => {
    expect(loginSource.indexOf(BACKUP_CODE_SCREEN_MARKER)).toBeGreaterThan(-1);
    expect(backupCodeScreen).toContain('id="two-factor-backup-code-form"');
    expect(backupCodeScreen).toContain("API.post");

    expect(loginSource.indexOf(LINK_GATE_MARKER)).toBeGreaterThan(-1);
    expect(backupCodeLinkBlock).toContain("<Link");

    expect(verifyBackupCodeDeclaration).toContain("addRoute");
  });

  test("the recovery branch is the only place the backup code route is used", () => {
    /*
     * Twice: the import at the top of the file, and the single call site. A
     * third occurrence would mean some other branch also posts recovery codes,
     * and every bounded assertion below would stop covering all of them.
     */
    expect(countOccurrences(loginSource, "VERIFY_BACKUP_CODE_API_URL")).toBe(2);
    expect(backupCodeScreen).toContain("VERIFY_BACKUP_CODE_API_URL");
  });

  test("the translation-key extractor found something", () => {
    /*
     * Paired with the locale loops below: a regex that stopped matching would
     * make "every key is translated in every locale" pass over an empty list.
     * Exact rather than a floor, because the way this extractor actually breaks
     * is partially -- one call hoisted into a variable drops one key out of the
     * list while the other three still match.
     */
    expect(backupCodeTranslationKeys().length).toBe(4);
  });

  test("all sixteen locale files are being looked at", () => {
    /*
     * The locale loops prove nothing if the directory read comes back short.
     * i18next's fallbackLng is "en", so a locale file that simply is not there
     * renders an English sign-in page with no error to notice.
     */
    expect(localeFileNames).toEqual([
      "da.json",
      "de.json",
      "en.json",
      "es.json",
      "fr.json",
      "hi.json",
      "it.json",
      "ja.json",
      "ko.json",
      "nl.json",
      "no.json",
      "pt.json",
      "ru.json",
      "sv.json",
      "zh-CN.json",
      "zh-TW.json",
    ]);

    expect(localeFileNames).toEqual(
      ALL_LOCALES.map((code: string): string => {
        return `${code}.json`;
      }).sort(),
    );
  });
});

describe("VERIFY_BACKUP_CODE_API_URL points at the identity service", () => {
  test("it is exported, and built on IDENTITY_URL", () => {
    /*
     * The verify routes live on the identity service because they are LOGIN
     * routes: the caller has no session and no cookie, so there is nothing for
     * the APP API's user authorization middleware to validate. Building this
     * one on APP_API_URL would produce a URL that resolves, 401s, and only
     * does so for somebody who is already locked out.
     */
    expect(verifyBackupCodeDeclaration).toMatch(
      /export const VERIFY_BACKUP_CODE_API_URL: URL = URL\.fromURL\(\s*IDENTITY_URL,?\s*\)\.addRoute\(new Route\("\/verify-backup-code"\)\);/,
    );

    expect(verifyBackupCodeDeclaration).not.toContain("APP_API_URL");
  });

  test("the path is exactly the route Authentication.ts registers", () => {
    /*
     * `/verify-backup-code`, not `/verify-backup-codes` and not
     * `/backup-code`. Express answers a near miss with the SPA's 404, which
     * arrives at the page as an unparseable response rather than as a message
     * anybody can act on.
     */
    expect(verifyBackupCodeDeclaration).toContain('"/verify-backup-code"');
    expect(countOccurrences(apiPathsSource, '"/verify-backup-code"')).toBe(1);
  });

  test("the negative above is not vacuous - APP_API_URL is still used in this file", () => {
    /*
     * The WebAuthn *options* call genuinely is an APP_API_URL call. If the
     * import were dropped, "the backup code URL does not use APP_API_URL"
     * would start passing for the wrong reason.
     */
    expect(apiPathsSource).toContain("GENERATE_WEBAUTHN_AUTH_OPTIONS_API_URL");
    expect(apiPathsSource).toContain("APP_API_URL");
    expect(apiPathsSource).toContain(
      'import { IDENTITY_URL, APP_API_URL } from "Common/UI/Config";',
    );
  });
});

describe("the recovery form posts what the server reads", () => {
  test("it posts to the backup code route and to nothing else", () => {
    expect(backupCodeScreen).toMatch(
      /await API\.post\(\{\s*url: VERIFY_BACKUP_CODE_API_URL,/,
    );

    /*
     * And not to either sibling. Both are imported into this file and both
     * accept the same `...initialValues` body, so a copy-paste that left the
     * TOTP URL behind would send a recovery code to a route that ignores it
     * and answers "Invalid two factor auth id."
     */
    expect(backupCodeScreen).not.toContain("VERIFY_TOTP_AUTH_API_URL");
    expect(backupCodeScreen).not.toContain("VERIFY_TOTP_ENROLMENT_API_URL");
    expect(backupCodeScreen).not.toContain("VERIFY_WEBAUTHN_AUTH_API_URL");
    expect(countOccurrences(backupCodeScreen, "API.post")).toBe(1);
  });

  test('the field name is "backupCode" on both sides of the form', () => {
    /*
     * THE RENAME THAT BREAKS THE FEATURE SILENTLY. BasicForm keys its values
     * object by the field name, so `field: { backupCode: true }` is what makes
     * `data["backupCode"]` non-empty; Authentication.ts then reads
     * `data["backupCode"]` off the request body. Three spellings have to agree
     * and nothing at runtime checks that they do -- a mismatch reaches the user
     * as "Backup code is required" while they are looking at the code they just
     * typed.
     */
    expect(backupCodeScreen).toMatch(/field:\s*\{\s*backupCode:\s*true,?\s*\}/);
    expect(backupCodeScreen).toContain('backupCode: data["backupCode"]');
  });

  test("it re-submits the email and password, because there is no session yet", () => {
    /*
     * /login answered the password step with a list of factors and NOTHING
     * else -- no cookie, no token. The server re-checks the password and the
     * email verification before it will look at the code, so dropping the
     * spread turns every recovery attempt into "Email and password are
     * required." on a screen with no email or password field on it.
     */
    expect(backupCodeScreen).toContain("...initialValues");

    /*
     * And the spread comes FIRST. Spreading after the explicit key would let a
     * stale `backupCode` left in `initialValues` overwrite the one the user
     * just typed -- the object literal takes the last writer.
     */
    const spreadIndex: number = backupCodeScreen.indexOf("...initialValues");
    const codeIndex: number = backupCodeScreen.indexOf(
      'backupCode: data["backupCode"]',
    );

    expect(spreadIndex).toBeGreaterThan(-1);
    expect(codeIndex).toBeGreaterThan(-1);
    expect(spreadIndex).toBeLessThan(codeIndex);
  });

  test("an error response is not mistaken for a signed-in user", () => {
    /*
     * `API.post` RESOLVES an HTTPErrorResponse rather than rejecting on a
     * non-2xx. Without the instanceof check, a refused code falls through to
     * `User.fromJSON` on an error body and `login()` is called with a user
     * that has no id -- the page navigates to a dashboard the server never
     * authorised and the user lands on a 401 with no explanation.
     */
    expect(backupCodeScreen).toMatch(
      /if \(result instanceof HTTPErrorResponse\)\s*\{\s*throw result;\s*\}/,
    );

    const guardIndex: number = backupCodeScreen.indexOf(
      "result instanceof HTTPErrorResponse",
    );
    const loginIndex: number = backupCodeScreen.indexOf(
      "login(user, miscData)",
    );

    expect(guardIndex).toBeGreaterThan(-1);
    expect(loginIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(loginIndex);
  });
});

describe("the 'use a backup code' link is gated on there being codes", () => {
  test("the link is rendered only when backupCodeCount > 0", () => {
    /*
     * Offering the recovery route to somebody with no codes sends them to a
     * form whose only possible answer is "Invalid backup code." -- at the one
     * moment they are least able to absorb it. The gate is the whole control:
     * the link has no other guard.
     */
    expect(backupCodeLinkBlock).toContain('t("login.twoFactor.useBackupCode")');

    /*
     * Exactly once in the whole page, so the assertion above is not satisfied
     * by a gated copy while an ungated one renders somewhere else.
     */
    expect(
      countOccurrences(loginSource, 't("login.twoFactor.useBackupCode")'),
    ).toBe(1);
  });

  test("clicking it opens the recovery form and clears the previous error", () => {
    /*
     * The error string is shared by all three challenge screens. Carrying "You
     * have entered an invalid code." over from the authenticator attempt would
     * greet the user with a failure they have not had yet.
     */
    expect(backupCodeLinkBlock).toContain("setIsUsingBackupCode(true)");
    expect(backupCodeLinkBlock).toContain('setTwoFactorAuthError("")');
  });

  test("the count starts at zero and is only ever set from the /login response", () => {
    /*
     * The other half of the gate. A default of anything but 0 would render the
     * link for every account on the first paint, before the server has said
     * whether there is anything to spend -- including accounts that have never
     * generated a code.
     */
    expect(loginSource).toContain(
      "const [backupCodeCount, setBackupCodeCount] = React.useState<number>(0);",
    );

    expect(loginSource).toMatch(
      /setBackupCodeCount\(\s*Number\([\s\S]{0,120}?\["backupCodeCount"\]/,
    );

    /* One writer, so there is no second path that can turn the link on. */
    expect(countOccurrences(loginSource, "setBackupCodeCount(")).toBe(1);
  });

  test("the picker offers a way back out of the recovery form", () => {
    /*
     * `isUsingBackupCode` hides the method picker while it is true, so the
     * "select a different method" link has to clear it as well as the two
     * selections. Without that, somebody who opened this form by mistake
     * clicks "go back" and watches nothing happen.
     */
    expect(loginSource).toContain("setIsUsingBackupCode(false)");
    expect(loginSource).toMatch(
      /selectedTotpAuth \|\| selectedWebAuthn \|\| isUsingBackupCode \?/,
    );
  });
});

describe("the four new translations", () => {
  test("the source asks for exactly the four keys this feature added", () => {
    expect(backupCodeTranslationKeys()).toEqual(NEW_KEYS);
  });

  test.each(NEW_KEYS)("%s exists in en.json", (key: string): void => {
    const value: unknown = lookUpKeyInLocale({
      locale: readLocale("en"),
      key: key,
    });

    expect(value).toEqual(expect.any(String));
    expect((value as string).trim().length).toBeGreaterThan(0);
  });

  test("every locale carries all four, so no language falls back to a raw key", () => {
    /*
     * i18next renders the dotted path itself when a key resolves nowhere and
     * falls back to English when it resolves only in en.json. Both are silent.
     * The first captions the recovery field with
     * `login.twoFactor.backupCodeFieldTitle`; the second shows an English
     * sentence to a user who chose Japanese -- on the page where they are
     * least able to guess what is being asked of them.
     *
     * Collected into a violation list rather than asserted one at a time so a
     * half-finished translation pass reports every file it missed in one run.
     */
    const violations: Array<string> = [];

    for (const code of ALL_LOCALES) {
      const locale: Record<string, unknown> = readLocale(code);

      for (const key of backupCodeTranslationKeys()) {
        const value: unknown = lookUpKeyInLocale({ locale: locale, key: key });

        if (typeof value !== "string") {
          violations.push(`${code}.json: ${key} is missing`);
          continue;
        }

        if (value.trim().length === 0) {
          violations.push(`${code}.json: ${key} is blank`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test("none of the four smuggles in an interpolation placeholder", () => {
    /*
     * These four strings take no options at all -- Login.tsx calls `t(key)`
     * with nothing after it. A `{{count}}` introduced by a translator is
     * rendered LITERALLY by i18next rather than erroring, so the user is shown
     * `{{count}}` in the middle of the instruction telling them how to get
     * back into their account. `{{count}}` specifically is worse still: it is
     * i18next's plural trigger, and would send the lookup after `_one` /
     * `_other` siblings this locale set does not define.
     */
    const violations: Array<string> = [];

    for (const code of ALL_LOCALES) {
      const locale: Record<string, unknown> = readLocale(code);

      for (const key of backupCodeTranslationKeys()) {
        const value: unknown = lookUpKeyInLocale({ locale: locale, key: key });

        if (
          typeof value === "string" &&
          INTERPOLATION_PLACEHOLDER.test(value)
        ) {
          violations.push(`${code}.json: ${key} interpolates something`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test("the four sit under login.twoFactor, beside the keys they belong with", () => {
    /*
     * Not decoration: `login.twoFactor` is the block the challenge screen
     * reads, and a key filed under `login` directly (or under a new
     * `login.backupCode` branch in one locale only) resolves to undefined in
     * that locale while looking perfectly correct in the file.
     */
    const violations: Array<string> = [];

    for (const code of ALL_LOCALES) {
      const branch: unknown = lookUpKeyInLocale({
        locale: readLocale(code),
        key: "login.twoFactor",
      });

      if (typeof branch !== "object" || branch === null) {
        violations.push(`${code}.json: login.twoFactor is not an object`);
        continue;
      }

      for (const key of NEW_KEYS) {
        const leaf: string = key.split(".").pop()!;

        if (!Object.prototype.hasOwnProperty.call(branch, leaf)) {
          violations.push(`${code}.json: login.twoFactor.${leaf} is missing`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

/*
 * A scoped re-implementation of Scripts/I18n/ValidateLocales.js for the
 * Accounts feature set, which had no locale test of any kind before this file.
 * That script is an ESM module and cannot be require()'d from this CommonJS
 * suite, and it runs only in the js-lint CI job -- so adding one key to en.json
 * and forgetting the other fifteen files goes green here and red much later.
 * These assertions make the App suite itself refuse the drift, and they cover
 * the whole directory rather than only the keys this feature added.
 */
describe("Accounts locale files stay in parity with en.json", () => {
  test.each(ALL_LOCALES)("%s.json is valid JSON", (code: string): void => {
    /*
     * Run before the parity checks and separately from them, because a locale
     * file with a trailing comma throws inside `readLocale` -- and a suite
     * whose parity test dies on a parse error reports the wrong problem.
     */
    const raw: string = readLocaleRaw(code);

    expect(() => {
      return JSON.parse(raw);
    }).not.toThrow();

    expect(JSON.parse(raw)).toEqual(expect.any(Object));
  });

  test.each(TRANSLATED_LOCALES)(
    "%s.json has no missing keys",
    (code: string): void => {
      const englishKeys: Set<string> = new Set<string>(localeKeys("en"));
      const localeKeySet: Set<string> = new Set<string>(localeKeys(code));

      const missing: Array<string> = [...englishKeys]
        .filter((key: string): boolean => {
          return !localeKeySet.has(key);
        })
        .sort();

      expect(missing).toEqual([]);
    },
  );

  test.each(TRANSLATED_LOCALES)(
    "%s.json has no extra keys",
    (code: string): void => {
      /*
       * The other direction, and the one people forget. An extra key is dead
       * weight that never renders, but it is also the fingerprint of a rename
       * applied to fifteen files and not to en.json -- in which case the
       * "missing" check above is passing on the OLD name.
       */
      const englishKeys: Set<string> = new Set<string>(localeKeys("en"));

      const extra: Array<string> = localeKeys(code)
        .filter((key: string): boolean => {
          return !englishKeys.has(key);
        })
        .sort();

      expect(extra).toEqual([]);
    },
  );

  test("en.json is not empty, so the sweep above is not vacuous", () => {
    /*
     * Two sets that are both empty are in perfect parity. If the flattener
     * ever stops descending -- a locale shape change, an array introduced at a
     * leaf -- every assertion above would pass over nothing.
     */
    expect(localeKeys("en").length).toBeGreaterThan(50);
    expect(localeKeys("en")).toEqual(expect.arrayContaining(NEW_KEYS));
  });
});
