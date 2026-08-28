import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";

/*
 * ---------------------------------------------------------------------------
 * THE RECOVERY PATH ON THE SIGN-IN SCREEN.
 *
 * Everybody who ever reaches this form is ALREADY locked out. Their phone is
 * gone, their security key is in a taxi, and whatever is in their hand is the
 * last thing standing between them and a support ticket.
 *
 * THE BUG THIS FILE WAS REWRITTEN FOR (OneUptime/oneuptime#3382)
 *
 * Single-use backup codes shipped, and the sign-in page still showed a locked
 * out user one row saying "Authenticator App" and nothing else. Two things
 * were wrong at once and each hid the other:
 *
 *  - nothing in the product ever MINTED codes except a button on the profile
 *    page that a user had to go and find, so `backupCodeCount` was 0 for very
 *    nearly every account; and
 *  - the only recovery affordance on the page was gated on
 *    `backupCodeCount > 0`, so it rendered for very nearly nobody.
 *
 * A gate on a counter that is always zero is indistinguishable, from the
 * outside, from a feature that was never shipped -- which is exactly what the
 * reporter saw. Worse, the link lived inside the METHOD PICKER only, so even
 * an account that did have codes never saw it on the code-entry screen, which
 * is the screen the issue actually named.
 *
 * So the assertions below deliberately pin the OPPOSITE of what the previous
 * version of this file pinned. The old file asserted that the link was gated
 * on `backupCodeCount > 0` and that it appeared exactly once; both of those
 * assertions were descriptions of the bug, and both had to be inverted rather
 * than deleted.
 *
 * THE SILENT FAILURE MODES, WHICH IS WHY EACH ASSERTION EXISTS
 *
 *  - THE LINK'S GUARD. If any part of the recovery affordance is ever put back
 *    behind `backupCodeCount`, it disappears again for the whole population
 *    the issue was about, and the page still renders, still 200s, and still
 *    looks correct to whoever made the change (their own test account has
 *    codes). `lostAccessGuard` is derived FROM THE SOURCE rather than matched
 *    against a hardcoded string, so the assertion is about what the condition
 *    contains, not about how it happens to be spelled today;
 *  - THE EMPTY SCREEN. Once the link is ungated, a user with no codes can
 *    reach a branch that used to render only a code entry form. Without the
 *    `backupCodeCount === 0` branch they would click "Lost access to your
 *    authenticator?" and land on a blank card -- a worse dead end than the one
 *    being fixed, and one that throws nothing;
 *  - THE FIELD NAME. Login.tsx declares `field: { backupCode: true }` and
 *    posts `backupCode: data["backupCode"]`; Authentication.ts reads
 *    `data["backupCode"]` and CredentialGuard.assertPresent then answers
 *    "Backup code is required". A rename on EITHER side turns a correctly
 *    typed code into that message, and the user -- reasonably -- concludes
 *    their printed codes have stopped working;
 *  - THE HOST, TWICE OVER, AND IN OPPOSITE DIRECTIONS.
 *    VERIFY_BACKUP_CODE_API_URL must hang off IDENTITY_URL because there is no
 *    session yet; GENERATE_BACKUP_CODES_API_URL must hang off APP_API_URL
 *    because it is authenticated by the session cookie the login just set.
 *    They sit four lines apart in the same file. Swapping either one produces
 *    a URL that resolves and then 401s or 404s, only for somebody who is
 *    already having the worst day of their account's life;
 *  - THE CREDENTIALS. There is NO SESSION on the challenge screens -- /login
 *    answered the password step with a list of factors and nothing else -- so
 *    those requests have to re-submit email and password out of
 *    `initialValues`. Dropping the spread leaves the server with "Email and
 *    password are required.";
 *  - THE DISCARDED MISC BAG. The forced-enrolment handler used to finish with
 *    a literal `{}` in place of the response's misc data. The server now mints
 *    a set of recovery codes behind that enrolment and returns the PLAINTEXT
 *    in exactly that bag, exactly once, forever. A literal `{}` there signs
 *    the user in with ten codes on their account that no human has ever seen
 *    -- silently, and unrecoverably;
 *  - THE UNTICKED BOX. The show-once screen is the only place those codes will
 *    ever exist. Continue has to be disabled until the user says they have
 *    saved them, because continuing without saving is the one mistake on that
 *    screen that trying again cannot fix;
 *  - THE LOCALE KEYS, now thirty-three of them across two blocks. i18next's
 *    fallbackLng is "en", so a locale file missing a key renders English
 *    inside an otherwise translated page -- or, for a key missing from en.json
 *    too, renders the raw dotted path as the label of the field somebody is
 *    trying to type a recovery code into.
 *
 * WHY A LOCALE SWEEP LIVES HERE AT ALL
 *
 * There was no locale parity test for the Accounts feature set before this
 * file. Scripts/I18n/ValidateLocales.js does cover
 * App/FeatureSet/Accounts/src/Locales, but it is an ESM module that this
 * CommonJS suite cannot require() and it runs only in the js-lint CI job. So
 * adding a key to en.json and forgetting the other fifteen files goes GREEN in
 * the App suite and red much later, in a different job, to a different person.
 * The sweep at the bottom closes that gap for the whole directory, not just
 * for the keys this feature added -- and this feature added a whole new
 * `login.backupCodes` block of sixteen.
 *
 * NOTHING IS MOCKED, AND NOTHING IS IMPORTED. The App jest suite is
 * testEnvironment "node" with no React renderer, and Login.tsx is a component
 * that pulls in Common/UI; ApiPaths.ts resolves IDENTITY_URL out of
 * Common/UI/Config at module load. What is being asserted on is which literals
 * and which CONDITIONS these files contain, and no runtime value in this
 * environment exposes either -- so the files are read off disk as text,
 * exactly as App/Tests/AdminDashboard/BulkTwoFactorAuthWiring.test.ts and
 * App/Tests/AdminDashboard/AutoAcceptInvitationWiring.test.ts do. The parity
 * sweep is modelled on App/Tests/Dashboard/RunnerVersionLabel.test.ts.
 *
 * Blocks are located by CONTENT (a form id, a data-testid) and their guarding
 * condition is then read back out of the source, rather than by matching the
 * condition itself. That is deliberate: an assertion that a block is guarded
 * by the literal string it was found with proves nothing, and the previous
 * version of this file broke at module load the moment the guard was
 * reworded. Extraction is lazy and memoized for the same reason -- a marker
 * that stops matching should fail as the assertion it belongs to, naming what
 * it could not find, rather than as an unloadable suite that hides the other
 * thirty checks.
 *
 * ADJACENT GROUND, DELIBERATELY NOT REPEATED HERE:
 *
 *  - Common/Tests/Server/Utils/TwoFactorBackupCode.test.ts owns generation,
 *    the alphabet, the HMAC construction and normalization -- which is why
 *    nothing below asserts anything about the SHAPE of a code;
 *  - Common/Tests/Server/API/UserTwoFactorBackupCodeAPI.test.ts owns the
 *    generate route itself, including that it answers with `codes`;
 *  - App/Tests/FeatureSet/Identity/BackupCodeLoginVerification.test.ts owns
 *    the server end of the verify request: the order of the gates in front of
 *    the code check, single use, and what the route refuses. Nothing here
 *    re-states any of it -- this file only pins that the browser sends what
 *    that handler reads;
 *  - App/Tests/FeatureSet/Identity/TotpForcedEnrolment.test.ts and
 *    TotpLoginVerification.test.ts own the rest of the login state machine,
 *    including the minting the enrolment response now carries;
 *  - App/Tests/Dashboard/BackupCodesCardWiring.test.ts owns the other end of
 *    the feature, the profile card.
 *
 * Comments are stripped before every assertion. That matters more than usual
 * here: Login.tsx and ApiPaths.ts both explain in prose that the requests
 * re-submit the password, that one route is an identity route and the other is
 * not, and that the misc bag used to be discarded -- which is four of the
 * things asserted below.
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
 * prettier re-wrapping a long `t(...)` call or a five-clause JSX guard cannot
 * turn a real regression check into a red herring. The guards in this file are
 * long enough that prettier splits most of them over four lines.
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
 * happens nowhere else" is the other half.
 */
const countOccurrences: CountOccurrencesFunction = (
  source: string,
  needle: string,
): number => {
  return source.split(needle).length - 1;
};

type BalancedBlockOrNullFunction = (data: {
  source: string;
  startIndex: number;
  open: string;
  close: string;
}) => string | null;

/*
 * Walks delimiters from `startIndex` (which must be an `open`) to its match,
 * or answers null if the file runs out first.
 *
 * Null rather than a throw because the guard walker below probes candidate
 * positions speculatively: a candidate that does not balance is simply not the
 * block being looked for, and turning that into an exception would mean
 * wrapping the probe in a try/catch that swallows real failures too.
 */
const balancedBlockOrNull: BalancedBlockOrNullFunction = (data: {
  source: string;
  startIndex: number;
  open: string;
  close: string;
}): string | null => {
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

  return null;
};

type BalancedBlockFunction = (data: {
  source: string;
  startIndex: number;
  open: string;
  close: string;
  marker: string;
}) => string;

/*
 * The same walk, for callers that have already established the block is there.
 * `marker` is carried only so the failure names what was being looked for
 * rather than reporting a bare index.
 */
const balancedBlockAt: BalancedBlockFunction = (data: {
  source: string;
  startIndex: number;
  open: string;
  close: string;
  marker: string;
}): string => {
  const block: string | null = balancedBlockOrNull({
    source: data.source,
    startIndex: data.startIndex,
    open: data.open,
    close: data.close,
  });

  if (block === null) {
    throw new Error(
      `Unbalanced ${data.open}${data.close} after marker: ${data.marker}`,
    );
  }

  return block;
};

type GuardedBlock = {
  /* The condition chain, e.g. `!pendingLogin && showTwoFactorAuth`. */
  guard: string;

  /* Everything the condition renders, `(` to matching `)`. */
  block: string;
};

/*
 * A JSX expression container that opens a conditional render:
 * `{<some && chain && (`. `(` is excluded from the condition class so that a
 * call expression (`{t("...")}`, `{foo.map(`) can never be mistaken for one,
 * and `<` so the walk cannot wander across an element boundary.
 */
const GUARD_OPENER: RegExp = /^\{([^<{()]*?)&&\s*\(/;

/* Long enough for the five-clause guards in this file, short enough to bound
 * the regex. The longest real one is under 100 characters. */
const GUARD_WINDOW: number = 400;

type GuardedBlockFunction = (needle: string) => GuardedBlock;

const guardedBlockCache: Map<string, GuardedBlock> = new Map<
  string,
  GuardedBlock
>();

/*
 * The innermost `{ ... && ( ... )}` render branch that CONTAINS `needle`,
 * together with the condition that decides whether it renders at all.
 *
 * Blocks are found by something only that block contains -- a form id, a
 * data-testid, a translation key -- and the guard is then read back out of the
 * file. Searching for the guard text instead would make every assertion about
 * the guard circular, and would break the whole suite at module load every
 * time somebody added a clause. Which is precisely what happened to the
 * previous version of this file.
 */
const guardedBlockFor: GuardedBlockFunction = (
  needle: string,
): GuardedBlock => {
  const cached: GuardedBlock | undefined = guardedBlockCache.get(needle);

  if (cached) {
    return cached;
  }

  const needleIndex: number = loginSource.indexOf(needle);

  if (needleIndex === -1) {
    throw new Error(`Login.tsx no longer contains: ${needle}`);
  }

  for (let index: number = needleIndex; index >= 0; index--) {
    if (loginSource[index] !== "{") {
      continue;
    }

    const opener: RegExpExecArray | null = GUARD_OPENER.exec(
      loginSource.slice(index, index + GUARD_WINDOW),
    );

    if (!opener) {
      continue;
    }

    const container: string | null = balancedBlockOrNull({
      source: loginSource,
      startIndex: index,
      open: "{",
      close: "}",
    });

    /* A sibling branch that closes before the needle is not its guard. */
    if (container === null || index + container.length <= needleIndex) {
      continue;
    }

    const found: GuardedBlock = {
      guard: opener[1]!.trim(),
      block: balancedBlockAt({
        source: loginSource,
        startIndex: index + opener[0].length - 1,
        open: "(",
        close: ")",
        marker: needle,
      }),
    };

    guardedBlockCache.set(needle, found);

    return found;
  }

  throw new Error(`No JSX render branch guards: ${needle}`);
};

/*
 * The five screens this file has an opinion about, named by something only
 * each one contains.
 */
const METHOD_PICKER: string = 't("login.twoFactor.authenticatorApp")';
const NO_CODES_SCREEN: string = 'data-testid="no-backup-codes"';
const RECOVERY_FORM: string = 'id="two-factor-backup-code-form"';
const SHOW_CODES_SCREEN: string = 'data-testid="backup-codes-list"';
const OFFER_CODES_SCREEN: string = 'dataTestId="generate-backup-codes"';
const LOST_ACCESS_LINK: string = 't("login.twoFactor.lostAccess")';
const REGISTER_LINK: string = 't("login.registerLink")';
const PASSWORD_FORM: string = 'id="login-form"';
const TOTP_FORM: string = 'id="two-factor-auth-form"';
const ENROLMENT_FORM: string = 'id="two-factor-enrolment-form"';

/*
 * `login(` but not `LoginUtil.login(`, which is the one legitimate call inside
 * the `login` helper itself. Used to prove that the second-factor handlers
 * hand off to `completeTwoFactorLogin` instead of redirecting straight past
 * the screen that shows the freshly minted codes.
 */
const DIRECT_LOGIN_CALL: RegExp = /(^|[^.\w])login\(/;

type DeclarationAfterFunction = (source: string, marker: string) => string;

/*
 * ApiPaths.ts is a flat list of `export const X: URL = ...;` statements, so a
 * declaration is bounded by the next semicolon. Bounding matters: the file
 * mentions APP_API_URL for two neighbouring constants and IDENTITY_URL for a
 * dozen, and an unbounded "does not use APP_API_URL" would fail on somebody
 * else's line instead of on this one.
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

/*
 * i18next's interpolation marker. None of these strings is passed an options
 * object, so a placeholder appearing in one is rendered literally at a user
 * who is already locked out.
 */
const INTERPOLATION_PLACEHOLDER: RegExp = /\{\{\s*[\w.]+\s*\}\}/;

type TranslationKeysFunction = (branch: string) => Array<string>;

/*
 * Every `t("login.<branch>.<key>")` the page asks for, derived from the source
 * rather than listed here -- so a key that is renamed stops being looked up
 * under its old name and starts being checked under its new one without this
 * file being edited, and the locale loops below cannot drift into checking
 * keys that nothing renders.
 *
 * Both branches matter now. `login.twoFactor` gained the recovery copy and
 * `login.backupCodes` is an entirely new block of sixteen strings, every one
 * of which is shown to somebody in the middle of signing in.
 */
const translationKeysUsed: TranslationKeysFunction = (
  branch: string,
): Array<string> => {
  const keys: Set<string> = new Set<string>();
  const pattern: RegExp = new RegExp(
    `\\bt\\(\\s*"(login\\.${branch}\\.[A-Za-z0-9]+)"`,
    "g",
  );

  let match: RegExpExecArray | null = pattern.exec(loginSource);

  while (match) {
    keys.add(match[1]!);
    match = pattern.exec(loginSource);
  }

  return [...keys].sort();
};

type AllUsedKeysFunction = () => Array<string>;

const allUsedKeys: AllUsedKeysFunction = (): Array<string> => {
  return [
    ...translationKeysUsed("twoFactor"),
    ...translationKeysUsed("backupCodes"),
  ].sort();
};

/*
 * The recovery strings under `login.twoFactor`.
 *
 * Held as a constant AS WELL AS extracted, because the two catch opposite
 * mistakes: the extractor catches a key renamed in the source, and this list
 * catches a key silently DELETED from the source -- which the extractor alone
 * would report as "nothing to check" and pass. Deleting
 * `noBackupCodesInstruction` is exactly how the dead end comes back.
 */
const RECOVERY_KEYS: Array<string> = [
  "login.twoFactor.backupCodeFieldDescription",
  "login.twoFactor.backupCodeFieldTitle",
  "login.twoFactor.backupCodeInstruction",
  "login.twoFactor.confirmSubtitle",
  "login.twoFactor.lostAccess",
  "login.twoFactor.noBackupCodes",
  "login.twoFactor.noBackupCodesInstruction",
  "login.twoFactor.noBackupCodesStrong",
  "login.twoFactor.recoverySubtitle",
];

/*
 * The whole `login.backupCodes` block, which is new. Asserted as an EXACT list
 * rather than a subset: this block exists only to be rendered by Login.tsx, so
 * a key in the locales that the page never asks for is dead copy and a key the
 * page asks for that is not here is a hole in the check below.
 */
const SAVE_CODE_KEYS: Array<string> = [
  "login.backupCodes.continue",
  "login.backupCodes.download",
  "login.backupCodes.fileHeading",
  "login.backupCodes.fileInstruction",
  "login.backupCodes.generate",
  "login.backupCodes.generateFailed",
  "login.backupCodes.none",
  "login.backupCodes.noneStrong",
  "login.backupCodes.savedConfirmation",
  "login.backupCodes.setUpSubtitle",
  "login.backupCodes.setUpTitle",
  "login.backupCodes.showOnce",
  "login.backupCodes.showOnceStrong",
  "login.backupCodes.skip",
  "login.backupCodes.subtitle",
  "login.backupCodes.title",
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
 * every string under `login.backupCodes` a perfect match.
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

describe("every screen this file asserts on was located in Login.tsx", () => {
  /*
   * The extraction above is content-addressed and lazy, so a branch that has
   * been renamed or removed fails here with the thing it could not find rather
   * than reporting a misleading assertion failure twenty tests later. These
   * also pin each extraction to the RIGHT branch: the four two-factor screens
   * are JSX siblings inside one component with near-identical shapes, and a
   * walker that latched onto the wrong one would make several checks below
   * pass for the wrong reason.
   */
  test("the five recovery-related branches are each found exactly once", () => {
    expect(guardedBlockFor(METHOD_PICKER).block).toContain(
      't("login.twoFactor.securityKey")',
    );
    expect(guardedBlockFor(NO_CODES_SCREEN).block).toContain(
      't("login.twoFactor.noBackupCodesStrong")',
    );
    expect(guardedBlockFor(RECOVERY_FORM).block).toContain("API.post");
    expect(guardedBlockFor(SHOW_CODES_SCREEN).block).toContain(
      'data-testid="backup-code-value"',
    );
    expect(guardedBlockFor(OFFER_CODES_SCREEN).block).toContain(
      't("login.backupCodes.skip")',
    );

    /* One of each, so "this block does not contain X" is a real negative. */
    expect(countOccurrences(loginSource, NO_CODES_SCREEN)).toBe(1);
    expect(countOccurrences(loginSource, RECOVERY_FORM)).toBe(1);
    expect(countOccurrences(loginSource, SHOW_CODES_SCREEN)).toBe(1);
    expect(countOccurrences(loginSource, OFFER_CODES_SCREEN)).toBe(1);
  });

  test("the translation-key extractor found both blocks", () => {
    /*
     * Paired with the locale loops below: a regex that stopped matching would
     * make "every key is translated in every locale" pass over an empty list.
     */
    expect(translationKeysUsed("twoFactor").length).toBeGreaterThanOrEqual(
      RECOVERY_KEYS.length,
    );
    expect(translationKeysUsed("backupCodes").length).toBe(
      SAVE_CODE_KEYS.length,
    );
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
    expect(
      declarationAfter(
        apiPathsSource,
        "export const VERIFY_BACKUP_CODE_API_URL",
      ),
    ).toMatch(
      /export const VERIFY_BACKUP_CODE_API_URL: URL = URL\.fromURL\(\s*IDENTITY_URL,?\s*\)\.addRoute\(new Route\("\/verify-backup-code"\)\);/,
    );

    expect(
      declarationAfter(
        apiPathsSource,
        "export const VERIFY_BACKUP_CODE_API_URL",
      ),
    ).not.toContain("APP_API_URL");
  });

  test("the path is exactly the route Authentication.ts registers", () => {
    /*
     * `/verify-backup-code`, not `/verify-backup-codes` and not
     * `/backup-code`. Express answers a near miss with the SPA's 404, which
     * arrives at the page as an unparseable response rather than as a message
     * anybody can act on.
     */
    expect(countOccurrences(apiPathsSource, '"/verify-backup-code"')).toBe(1);
  });

  test("the negative above is not vacuous - APP_API_URL is still used in this file", () => {
    /*
     * Two of its neighbours genuinely are APP_API_URL calls. If the import
     * were dropped, "the backup code URL does not use APP_API_URL" would start
     * passing for the wrong reason.
     */
    expect(apiPathsSource).toContain("GENERATE_WEBAUTHN_AUTH_OPTIONS_API_URL");
    expect(apiPathsSource).toContain(
      'import { IDENTITY_URL, APP_API_URL } from "Common/UI/Config";',
    );
  });
});

describe("GENERATE_BACKUP_CODES_API_URL is the one route here that needs a session", () => {
  /*
   * The mirror image of the block above, and the reason both are worth
   * asserting: these constants sit four lines apart and one must be built on
   * IDENTITY_URL while the other must be built on APP_API_URL.
   *
   * Minting codes is authenticated by the session cookie `finalizeUserLogin`
   * has just set, which is exactly why the offer can only be made AFTER the
   * second factor has been proved. Moving it to IDENTITY_URL would 404; moving
   * the OFFER to the challenge screen would hand recovery codes to whoever is
   * holding the password, which is the thing a second factor exists to stop.
   */
  test("it is declared in Utils/ApiPaths.ts and built on APP_API_URL", () => {
    const declaration: string = declarationAfter(
      apiPathsSource,
      "export const GENERATE_BACKUP_CODES_API_URL",
    );

    expect(declaration).toMatch(
      /export const GENERATE_BACKUP_CODES_API_URL: URL = URL\.fromURL\(\s*APP_API_URL,?\s*\)\.addRoute\(new Route\("\/user-two-factor-backup-code\/generate"\)\);/,
    );

    expect(declaration).not.toContain("IDENTITY_URL");
  });

  test("the path is the same route the profile card already mints through", () => {
    expect(
      countOccurrences(
        apiPathsSource,
        '"/user-two-factor-backup-code/generate"',
      ),
    ).toBe(1);
  });

  test("Login.tsx imports it from ApiPaths and posts to it exactly once", () => {
    /*
     * Twice in the file: the import and the single call site. Constructing the
     * URL inline instead would put an APP_API_URL literal in a page that
     * otherwise talks only to the identity service -- which is how the two
     * hosts got confused in the first place.
     */
    expect(loginSource).toMatch(
      /import \{[^}]*GENERATE_BACKUP_CODES_API_URL[^}]*\} from "\.\.\/Utils\/ApiPaths";/,
    );
    expect(countOccurrences(loginSource, "GENERATE_BACKUP_CODES_API_URL")).toBe(
      2,
    );
    expect(loginSource).toMatch(
      /await API\.post<JSONObject>\(\{\s*url: GENERATE_BACKUP_CODES_API_URL,/,
    );
  });

  test("the generated set is read off the key the route answers with", () => {
    /*
     * Common/Server/API/UserTwoFactorBackupCodeAPI.ts answers
     * `{ codes: [...] }`. Reading any other key yields an empty array, which
     * the page reports as "no backup codes were returned" -- a failure message
     * for a request that succeeded and DID mint a set, leaving the user with
     * ten live codes they have never seen.
     */
    expect(loginSource).toContain('response.data["codes"]');
  });
});

describe("the recovery form posts what the server reads", () => {
  test("it posts to the backup code route and to nothing else", () => {
    const form: string = guardedBlockFor(RECOVERY_FORM).block;

    expect(form).toMatch(
      /await API\.post\(\{\s*url: VERIFY_BACKUP_CODE_API_URL,/,
    );

    /*
     * And not to any sibling. All of them are imported into this file and all
     * accept the same `...initialValues` body, so a copy-paste that left the
     * TOTP URL behind would send a recovery code to a route that ignores it
     * and answers "Invalid two factor auth id."
     */
    expect(form).not.toContain("VERIFY_TOTP_AUTH_API_URL");
    expect(form).not.toContain("VERIFY_TOTP_ENROLMENT_API_URL");
    expect(form).not.toContain("VERIFY_WEBAUTHN_AUTH_API_URL");
    expect(form).not.toContain("GENERATE_BACKUP_CODES_API_URL");
    expect(countOccurrences(form, "API.post")).toBe(1);
    expect(countOccurrences(loginSource, "VERIFY_BACKUP_CODE_API_URL")).toBe(2);
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
    const form: string = guardedBlockFor(RECOVERY_FORM).block;

    expect(form).toMatch(/field:\s*\{\s*backupCode:\s*true,?\s*\}/);
    expect(form).toContain('backupCode: data["backupCode"]');
  });

  test("it re-submits the email and password, because there is no session yet", () => {
    /*
     * /login answered the password step with a list of factors and NOTHING
     * else -- no cookie, no token. The server re-checks the password and the
     * email verification before it will look at the code, so dropping the
     * spread turns every recovery attempt into "Email and password are
     * required." on a screen with no email or password field on it.
     */
    const form: string = guardedBlockFor(RECOVERY_FORM).block;

    expect(form).toContain("...initialValues");

    /*
     * And the spread comes FIRST. Spreading after the explicit key would let a
     * stale `backupCode` left in `initialValues` overwrite the one the user
     * just typed -- the object literal takes the last writer.
     */
    const spreadIndex: number = form.indexOf("...initialValues");
    const codeIndex: number = form.indexOf('backupCode: data["backupCode"]');

    expect(spreadIndex).toBeGreaterThan(-1);
    expect(codeIndex).toBeGreaterThan(-1);
    expect(spreadIndex).toBeLessThan(codeIndex);
  });

  test("an error response is not mistaken for a signed-in user", () => {
    /*
     * `API.post` RESOLVES an HTTPErrorResponse rather than rejecting on a
     * non-2xx. Without the instanceof check, a refused code falls through to
     * `User.fromJSON` on an error body and the sign-in completes with a user
     * that has no id -- the page navigates to a dashboard the server never
     * authorised and the user lands on a 401 with no explanation.
     */
    const form: string = guardedBlockFor(RECOVERY_FORM).block;

    expect(form).toMatch(
      /if \(result instanceof HTTPErrorResponse\)\s*\{\s*throw result;\s*\}/,
    );

    const guardIndex: number = form.indexOf(
      "result instanceof HTTPErrorResponse",
    );
    const completeIndex: number = form.indexOf("completeTwoFactorLogin(");

    expect(guardIndex).toBeGreaterThan(-1);
    expect(completeIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(completeIndex);
  });
});

describe("the recovery link is offered to everyone, not only to accounts that have codes", () => {
  test("its guard does not mention backupCodeCount at all", () => {
    /*
     * THE BUG, PINNED. `backupCodeCount` arrives from /login and, for as long
     * as nothing minted codes at setup time, was 0 for essentially every
     * account -- so a link gated on it rendered for essentially nobody, and
     * the reporter's two-factor screen offered one unusable method and no way
     * out. It is now allowed to decide what the recovery screen SAYS and
     * nothing else.
     *
     * The guard is read out of the source rather than compared to a string, so
     * this fails on ANY reintroduction of the count into the condition, not
     * just on the exact spelling it had before.
     */
    const guard: string = guardedBlockFor(LOST_ACCESS_LINK).guard;

    expect(guard).not.toContain("backupCodeCount");
    expect(guard).toContain("showTwoFactorAuth");
  });

  test("it is on the code-entry and security-key screens too, not just the picker", () => {
    /*
     * The screen the issue named is the code entry one: a box asking for a
     * code the user cannot produce. The link used to live INSIDE the method
     * picker, so that screen carried nothing but "select a different method",
     * which returns the user to a list of the methods they have already said
     * they cannot use.
     *
     * Naming either selection in the guard is how it gets confined to one
     * screen again, so both are excluded; `!isUsingBackupCode` is required
     * because the link must disappear on the screen it opens.
     */
    const guard: string = guardedBlockFor(LOST_ACCESS_LINK).guard;

    expect(guard).not.toContain("selectedTotpAuth");
    expect(guard).not.toContain("selectedWebAuthn");
    expect(guard).toContain("!isUsingBackupCode");

    /* One link, and it is not the picker's -- so the guard above is the only
     * thing deciding whether any user ever sees it. */
    expect(countOccurrences(loginSource, LOST_ACCESS_LINK)).toBe(1);
    expect(guardedBlockFor(METHOD_PICKER).block).not.toContain(
      LOST_ACCESS_LINK,
    );
  });

  test("clicking it opens the recovery screen and clears the previous error", () => {
    /*
     * The error string is shared by all three challenge screens. Carrying "You
     * have entered an invalid code." over from the authenticator attempt would
     * greet the user with a failure they have not had yet.
     */
    const block: string = guardedBlockFor(LOST_ACCESS_LINK).block;

    expect(block).toContain("<Link");
    expect(block).toContain("setIsUsingBackupCode(true)");
    expect(block).toContain('setTwoFactorAuthError("")');
  });

  test("the register prompt no longer competes with it", () => {
    /*
     * "Don't have an account? Register." was, until this link existed, the
     * only other thing on the screen for somebody who had just lost their
     * phone -- and it is nonsense there, because they demonstrably have an
     * account. Without `!showTwoFactorAuth` the two sit one above the other.
     */
    expect(guardedBlockFor(REGISTER_LINK).guard).toContain(
      "!showTwoFactorAuth",
    );
  });

  test("the count starts UNKNOWN and is only ever set from the /login response", () => {
    /*
     * `null`, not `0`, and the difference is a sentence the page says out
     * loud. Zero is a claim -- it renders "you have no backup codes, ask an
     * administrator to reset two factor authentication" -- and the server now
     * OMITS the count when it could not read it. Defaulting to zero would put
     * that claim in front of a user holding ten printed codes the moment a
     * transient database fault made them uncountable, and send them to find an
     * administrator instead of typing one in. Unknown has to behave like
     * "there may be codes".
     */
    expect(loginSource).toContain(
      "const [backupCodeCount, setBackupCodeCount] = React.useState<number | null>( null, );",
    );

    /* Only a real number is believed; anything else stays unknown. */
    expect(loginSource).toMatch(
      /setBackupCodeCount\(\s*typeof reportedBackupCodeCount === "number"\s*\? reportedBackupCodeCount\s*: null,?\s*\)/,
    );

    expect(loginSource).toMatch(
      /reportedBackupCodeCount[\s\S]{0,120}?\["backupCodeCount"\]/,
    );

    /*
     * And exactly one derivation decides "we KNOW there are none", so the two
     * recovery branches cannot drift apart from each other.
     */
    expect(loginSource).toContain(
      "const isKnownToHaveNoBackupCodes: boolean = backupCodeCount === 0;",
    );

    /* One writer, so there is no second path that can move it. */
    expect(countOccurrences(loginSource, "setBackupCodeCount(")).toBe(1);
  });

  test("there is a way back out of the recovery screen", () => {
    /*
     * `isUsingBackupCode` hides the method picker while it is true, so the
     * "select a different method" link has to clear it as well as the two
     * selections. Without that, somebody who opened this screen by mistake
     * clicks "go back" and watches nothing happen.
     */
    expect(loginSource).toContain("setIsUsingBackupCode(false)");
    expect(loginSource).toMatch(
      /\(selectedTotpAuth \|\| selectedWebAuthn \|\| isUsingBackupCode\) \?/,
    );

    /*
     * The clear and the two selections happen together, in the one handler.
     * Clearing only the selections leaves `isUsingBackupCode` true, the picker
     * hidden, and the recovery screen still on screen.
     */
    expect(loginSource).toMatch(
      /setSelectedTotpAuth\(undefined\); setSelectedWebAuthn\(undefined\); setIsUsingBackupCode\(false\);/,
    );
  });
});

describe("a user with no backup codes is told what to do instead", () => {
  test("the zero branch renders the copy naming the administrator reset", () => {
    /*
     * THE OTHER HALF OF THE FIX. Ungating the link is only an improvement if
     * there is something behind it for the account that has no codes -- and
     * that account is the overwhelming majority. Without this branch the link
     * leads to a card with nothing in it: a blank dead end, rendered without
     * an error, which is strictly worse than the dead end being replaced.
     *
     * The instruction string is the one that carries the actual answer (ask an
     * administrator to reset two factor auth), so its absence is the failure
     * that matters most and it is asserted by name.
     */
    const screen: GuardedBlock = guardedBlockFor(NO_CODES_SCREEN);

    expect(screen.guard).toContain("isKnownToHaveNoBackupCodes");
    expect(screen.guard).toContain("isUsingBackupCode");
    expect(screen.block).toContain('t("login.twoFactor.noBackupCodesStrong")');
    expect(screen.block).toContain('t("login.twoFactor.noBackupCodes")');
    expect(screen.block).toContain(
      't("login.twoFactor.noBackupCodesInstruction")',
    );
  });

  test("the two recovery branches partition the count, so the screen is never blank", () => {
    /*
     * One derived boolean and its exact negation, under otherwise identical
     * conditions. Anything else -- a second clause on one side, a different
     * comparison rebuilt inline on the other -- leaves a state in which the
     * user has clicked "Lost access to your authenticator?" and been shown an
     * empty card. Note which side "unknown" falls on: NOT the guidance, so a
     * count the server could not read still offers the form.
     */
    const zeroGuard: string = guardedBlockFor(NO_CODES_SCREEN).guard;
    const positiveGuard: string = guardedBlockFor(RECOVERY_FORM).guard;

    expect(zeroGuard).toMatch(/&&\s*isKnownToHaveNoBackupCodes$/);
    expect(positiveGuard).toMatch(/&&\s*!isKnownToHaveNoBackupCodes$/);

    const withoutCount: (guard: string) => string = (guard: string): string => {
      return guard.replace(/&&\s*!?isKnownToHaveNoBackupCodes$/, "").trim();
    };

    expect(withoutCount(zeroGuard)).toBe(withoutCount(positiveGuard));
    expect(withoutCount(zeroGuard).length).toBeGreaterThan(0);
  });

  test("the recovery screen gets its own subtitle", () => {
    /*
     * "Select two factor authentication method" was printed over all four
     * two-factor screens. On the recovery screen it tells somebody who has
     * just said they cannot use their method to go and pick one, and on the
     * commonest account there is -- a single factor -- nothing is being
     * selected at all. Wrong copy on the one screen where the user is least
     * able to guess what is being asked of them.
     */
    const heading: string = guardedBlockFor(
      't("login.twoFactor.recoverySubtitle")',
    ).block;

    expect(heading).toMatch(
      /isUsingBackupCode \? t\("login\.twoFactor\.recoverySubtitle"\)/,
    );
    expect(heading).toContain('t("login.twoFactor.confirmSubtitle")');
  });
});

describe("codes the server mints are shown once, before anything redirects", () => {
  test("the enrolment handler hands the misc bag on instead of discarding it", () => {
    /*
     * THE LITERAL `{}` THAT USED TO BE HERE. A forced enrolment now mints a
     * set of recovery codes server-side and returns the PLAINTEXT in the misc
     * bag of that one response -- the server stores keyed digests, so that
     * array is the only copy of those codes that will ever exist anywhere.
     *
     * Passing `{}` compiles, renders, signs the user in, and leaves ten live
     * codes on their account that no human being has ever seen. Nothing
     * anywhere reports it.
     */
    const enrolment: string = guardedBlockFor(ENROLMENT_FORM).block;

    expect(enrolment).toContain(
      "const enrolmentMiscData: JSONObject = getMiscData(result);",
    );
    expect(enrolment).toMatch(
      /completeTwoFactorLogin\(\s*user,\s*enrolmentMiscData,/,
    );
    expect(enrolment).not.toMatch(
      /completeTwoFactorLogin\(\s*user\s*,\s*\{\s*\}\s*\)/,
    );
    expect(enrolment).not.toMatch(DIRECT_LOGIN_CALL);
  });

  test("every second-factor handler goes through completeTwoFactorLogin", () => {
    /*
     * Four call sites: the TOTP challenge, the security key, the backup code
     * and the enrolment. Any one of them calling `login` directly skips the
     * show-once screen for its path -- and for the enrolment path that means
     * navigating away from the only copy of the codes.
     */
    expect(countOccurrences(loginSource, "completeTwoFactorLogin(")).toBe(4);
    expect(guardedBlockFor(TOTP_FORM).block).toContain(
      "completeTwoFactorLogin(",
    );
    expect(guardedBlockFor(TOTP_FORM).block).not.toMatch(DIRECT_LOGIN_CALL);
    expect(guardedBlockFor(RECOVERY_FORM).block).not.toMatch(DIRECT_LOGIN_CALL);

    /* The security key path is an effect rather than a JSX branch. */
    expect(loginSource).toMatch(
      /verifyResult instanceof HTTPErrorResponse[\s\S]{0,400}?completeTwoFactorLogin\(/,
    );
  });

  test("the password-only path still signs in directly", () => {
    /*
     * An account with no two factor auth at all has no recovery codes to be
     * missing, and prompting it for some would be prompting for a credential
     * to a lock it does not have. It is also the path every non-2FA user in
     * the product takes, so a stray prompt here is a prompt for everybody.
     */
    const passwordForm: string = guardedBlockFor(PASSWORD_FORM).block;

    expect(passwordForm).toContain(
      "login(value as User, miscData as JSONObject)",
    );
    expect(passwordForm).not.toContain("completeTwoFactorLogin");
  });

  test("continue is disabled until the user says they have saved the codes", () => {
    /*
     * There is no second showing. Not after a refresh, not from the dashboard,
     * not from a master admin, not from a database dump. The tick box is the
     * only thing between a user and losing ten codes by reflex on the screen
     * whose entire purpose is that they are not lost.
     *
     * The count assertions matter: one Button and one `disabled=` in the
     * block, so the guard cannot be satisfied by a second, ungated button
     * sitting beside the one being checked.
     */
    const screen: GuardedBlock = guardedBlockFor(SHOW_CODES_SCREEN);

    expect(screen.guard).toContain("pendingLogin");
    expect(screen.guard).toContain("codesToSave.length > 0");

    expect(screen.block).toContain('dataTestId="backup-codes-continue"');
    expect(screen.block).toContain("disabled={!hasSavedCodes}");
    expect(countOccurrences(screen.block, "<Button")).toBe(1);
    expect(countOccurrences(screen.block, "disabled={")).toBe(1);

    /* And the box is what moves it, rather than something the page sets. */
    expect(screen.block).toContain('data-testid="backup-codes-saved-checkbox"');
    expect(screen.block).toContain("checked={hasSavedCodes}");
    expect(screen.block).toContain("setHasSavedCodes(event.target.checked)");
  });

  test("the codes are listed and downloadable, and only then is the login finished", () => {
    /*
     * Two ways to keep them because two different people lose them: the one
     * who reads a grid of ten and clicks on without copying any, and the one
     * who saves a file and never opens it.
     *
     * `login(...)` runs from the Continue handler and nowhere else in this
     * block -- putting it anywhere else would redirect out of the screen while
     * the codes are still on it.
     */
    const screen: string = guardedBlockFor(SHOW_CODES_SCREEN).block;

    expect(screen).toContain("codesToSave.map(");
    expect(screen).toContain('data-testid="backup-code-value"');
    expect(screen).toContain('t("login.backupCodes.download")');
    expect(screen).toContain("downloadBackupCodes()");
    expect(screen).toContain("login(finished.user, finished.miscData)");
  });

  test("the offer made to an account with no codes is skippable", () => {
    /*
     * A prompt that could wedge a completed sign-in would be a worse bug than
     * the one being fixed: the user has already proved their password AND
     * their second factor, and the server has already issued the session. So
     * "Skip for now" finishes the login immediately, and the generate button
     * reports its own failure rather than blocking.
     */
    const screen: GuardedBlock = guardedBlockFor(OFFER_CODES_SCREEN);

    expect(screen.guard).toContain("pendingLogin");
    expect(screen.guard).toContain("codesToSave.length === 0");

    expect(screen.block).toContain('t("login.backupCodes.skip")');
    expect(screen.block).toContain("login(finished.user, finished.miscData)");
    expect(screen.block).toContain("generateBackupCodes()");
    expect(screen.block).toContain("generateBackupCodesError");
  });

  test("every pre-existing branch now stands down while a pending login is on screen", () => {
    /*
     * The show-once screen and the offer are drawn into the same card as the
     * login form, the method picker, the two challenge forms and the enrolment
     * form. Six branches had to learn about `pendingLogin`; a branch that did
     * not would render its heading and its form OVER the codes -- which is not
     * a crash, just a user reading "Select two factor authentication method"
     * on top of the only copy of their recovery codes.
     */
    for (const needle of [
      PASSWORD_FORM,
      METHOD_PICKER,
      TOTP_FORM,
      ENROLMENT_FORM,
      NO_CODES_SCREEN,
      RECOVERY_FORM,
    ]) {
      expect(guardedBlockFor(needle).guard).toContain("!pendingLogin");
    }
  });
});

describe("the translations Login.tsx asks for", () => {
  test("the source still asks for every recovery string this feature added", () => {
    /*
     * A subset check for `login.twoFactor`, which holds pre-existing keys too,
     * and an exact one for `login.backupCodes`, which is entirely new: a key
     * defined there and never rendered is dead copy, and a key rendered from
     * there and not listed here is a hole in the locale loops below.
     */
    expect(translationKeysUsed("twoFactor")).toEqual(
      expect.arrayContaining(RECOVERY_KEYS),
    );
    expect(translationKeysUsed("backupCodes")).toEqual(SAVE_CODE_KEYS);
  });

  test.each([...RECOVERY_KEYS, ...SAVE_CODE_KEYS])(
    "%s exists in en.json",
    (key: string): void => {
      const value: unknown = lookUpKeyInLocale({
        locale: readLocale("en"),
        key: key,
      });

      expect(value).toEqual(expect.any(String));
      expect((value as string).trim().length).toBeGreaterThan(0);
    },
  );

  test("every locale carries every key the page renders", () => {
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

      for (const key of allUsedKeys()) {
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

  test("none of them smuggles in an interpolation placeholder", () => {
    /*
     * Every one of these strings takes no options at all -- Login.tsx calls
     * `t(key)` with nothing after it. A `{{count}}` introduced by a translator
     * is rendered LITERALLY by i18next rather than erroring, so the user is
     * shown `{{count}}` in the middle of the instruction telling them how to
     * get back into their account. `{{count}}` specifically is worse still: it
     * is i18next's plural trigger, and would send the lookup after `_one` /
     * `_other` siblings this locale set does not define.
     */
    const violations: Array<string> = [];

    for (const code of ALL_LOCALES) {
      const locale: Record<string, unknown> = readLocale(code);

      for (const key of allUsedKeys()) {
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

  test("they sit under the two branches the page reads, in every locale", () => {
    /*
     * Not decoration: `login.twoFactor` and `login.backupCodes` are the blocks
     * these lookups walk, and a key filed one level up (or under a
     * `login.backupCode` singular typo in one locale only) resolves to
     * undefined in that locale while looking perfectly correct in the file.
     */
    const violations: Array<string> = [];

    for (const code of ALL_LOCALES) {
      for (const branch of ["login.twoFactor", "login.backupCodes"]) {
        const node: unknown = lookUpKeyInLocale({
          locale: readLocale(code),
          key: branch,
        });

        if (typeof node !== "object" || node === null) {
          violations.push(`${code}.json: ${branch} is not an object`);
          continue;
        }

        for (const key of [...RECOVERY_KEYS, ...SAVE_CODE_KEYS]) {
          if (!key.startsWith(`${branch}.`)) {
            continue;
          }

          const leaf: string = key.slice(branch.length + 1);

          if (!Object.prototype.hasOwnProperty.call(node, leaf)) {
            violations.push(`${code}.json: ${branch}.${leaf} is missing`);
          }
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
    expect(localeKeys("en")).toEqual(
      expect.arrayContaining([...RECOVERY_KEYS, ...SAVE_CODE_KEYS]),
    );
  });
});
