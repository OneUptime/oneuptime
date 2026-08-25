import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";
import API from "Common/Utils/API";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import URL from "Common/Types/API/URL";

/*
 * ---------------------------------------------------------------------------
 * THE OTHER END OF THE BACKUP CODE FEATURE: the "Backup Codes" card on User
 * Profile > Two Factor Authentication, which is the only place a user can ever
 * mint a set.
 *
 * THE CODES ARE SHOWN EXACTLY ONCE. Only keyed digests are stored, so once the
 * modal closes nobody -- not the user, not a master admin, not somebody holding
 * a database dump -- can produce them again. That single fact is what makes
 * every wiring below load-bearing, and it is why all of them fail SILENTLY:
 *
 *  - the card not being mounted at all. BackupCodes.tsx compiles, lints and
 *    tests perfectly well while being imported by nobody. The feature then
 *    exists entirely on the server, the login screen's "use a backup code"
 *    link never appears (backupCodeCount is always 0), and there is no error
 *    anywhere to notice;
 *  - regeneration on a GET. Generating REPLACES the whole set, so a GET that
 *    voids a printed list is a lockout with no user action behind it -- a
 *    browser prefetch, a link preview, a crawler behind an authenticated
 *    session. The server refuses it (the route is registered with
 *    `router.post`), but a page that issued one would surface that refusal as
 *    a generic error on a button the user is pressing on purpose;
 *  - the acknowledgement being escapable. Modal renders its X, its Cancel
 *    button, its Escape handler AND its backdrop-click handler only when
 *    `onClose` is passed -- so passing one does not "add a close button", it
 *    reopens four separate reflex routes out of the one dialog in this product
 *    that cannot be reopened. Ten codes gone, with no way to tell afterwards
 *    that they were ever seen;
 *  - the confirmation disappearing. Without it, the button next to "8 of 10
 *    remaining" silently invalidates the eight;
 *  - and copy or download going missing. A user offered only one of the two
 *    frequently saves neither -- copy alone leaves the codes on a clipboard
 *    that the next copy overwrites.
 *
 * WHAT IS MOCKED: nothing. Two of these files are read off disk as text,
 * because the App jest suite is testEnvironment "node" with no React renderer
 * and both files are components that pull in Common/UI -- the wirings they hold
 * are invariants no runtime value exposes. The one runtime import is
 * Common/Utils/API, and it is deliberately NOT mocked: the last describe block
 * below calls the real static through the real argument path, because the
 * calling convention it pins is the subject of a live defect (see that block).
 *
 * ADJACENT GROUND, DELIBERATELY NOT REPEATED HERE:
 *
 *  - App/Tests/Accounts/BackupCodeLoginWiring.test.ts owns the sign-in half --
 *    the verify route, the `backupCode` field name and the Accounts locales;
 *  - Common/Tests/Server/Utils/TwoFactorBackupCode.test.ts owns generation,
 *    the alphabet and the HMAC, so nothing here asserts what a code looks like;
 *  - Common/Tests/Server/API/UserTwoFactorBackupCodeAPI.test.ts owns the two
 *    routes this card calls -- their verbs, their auth and their response
 *    bodies -- so nothing below asserts anything about what the server does
 *    once a request arrives;
 *  - App/Tests/AdminDashboard/UserTwoFactorAuthPageWiring.test.ts owns the
 *    operator-facing reset on the Admin Dashboard.
 *
 * There are no locale assertions in this file: the Dashboard's Two Factor
 * Authentication page and this card are written in plain English literals
 * rather than through `t(...)`, in line with the rest of User Profile. The
 * Dashboard locale parity sweep lives in
 * App/Tests/Dashboard/RunnerVersionLabel.test.ts.
 *
 * Comments are stripped before every assertion, which matters unusually much
 * here: BackupCodes.tsx explains in prose that no `onClose` is passed, that
 * generation is a POST because it is destructive, and that copy and download
 * are both offered -- three of the things asserted on below.
 * ---------------------------------------------------------------------------
 */

const DASHBOARD_SRC: string = nodePath.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const BACKUP_CODES_COMPONENT: Array<string> = [
  "Components",
  "TwoFactorAuth",
  "BackupCodes.tsx",
];

const TWO_FACTOR_AUTH_PAGE: Array<string> = [
  "Pages",
  "Global",
  "UserProfile",
  "TwoFactorAuth.tsx",
];

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
 * Assertions run against whitespace-collapsed text so that prettier re-wrapping
 * a long JSX prop list cannot turn a real regression check into a red herring.
 */
const squash: SquashFunction = (source: string): string => {
  return source.replace(/\s+/g, " ");
};

type ReadCodeFunction = (parts: Array<string>) => string;

const readCode: ReadCodeFunction = (parts: Array<string>): string => {
  return squash(
    stripComments(
      fs.readFileSync(nodePath.join(DASHBOARD_SRC, ...parts), "utf8"),
    ),
  );
};

const backupCodesSource: string = readCode(BACKUP_CODES_COMPONENT);
const twoFactorPageSource: string = readCode(TWO_FACTOR_AUTH_PAGE);

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
  marker: string;
}) => string;

/* Walks braces from `startIndex` (which must be a `{`) to its match. */
const balancedBraceBlockAt: BalancedBlockFunction = (data: {
  source: string;
  startIndex: number;
  marker: string;
}): string => {
  let depth: number = 0;

  for (
    let index: number = data.startIndex;
    index < data.source.length;
    index++
  ) {
    const character: string = data.source[index]!;

    if (character === "{") {
      depth++;
    }

    if (character === "}") {
      depth--;

      if (depth === 0) {
        return data.source.slice(data.startIndex, index + 1);
      }
    }
  }

  throw new Error(`Unbalanced braces after marker: ${data.marker}`);
};

type BlockAfterFunction = (source: string, marker: string) => string;

/*
 * The balanced-brace block that follows `marker`. Used to bound an assertion to
 * one callback, so that "the click asks for confirmation" cannot be satisfied
 * by the ConfirmModal's own onSubmit further down the same file.
 */
const blockAfter: BlockAfterFunction = (
  source: string,
  marker: string,
): string => {
  const markerIndex: number = source.indexOf(marker);

  if (markerIndex === -1) {
    throw new Error(`Marker not found in source: ${marker}`);
  }

  const blockStart: number = source.indexOf("{", markerIndex);

  if (blockStart === -1) {
    throw new Error(`No block follows marker: ${marker}`);
  }

  return balancedBraceBlockAt({
    source: source,
    startIndex: blockStart,
    marker: marker,
  });
};

type OpeningTagFunction = (source: string, tagName: string) => string;

/*
 * Just the props of one JSX element -- from `<Tag` to the `>` that closes the
 * opening tag, tracking brace depth so a `=>` inside a callback prop is not
 * mistaken for the end of the tag.
 *
 * This is what makes "Modal is passed NO onClose" a meaningful assertion. The
 * file is full of `onClose`: the ConfirmModal above legitimately has one, and
 * an unbounded `not.toContain("onClose")` would either fail on that or, if
 * somebody deleted it, pass for entirely the wrong reason.
 */
const openingTagOf: OpeningTagFunction = (
  source: string,
  tagName: string,
): string => {
  const startIndex: number = source.indexOf(`<${tagName}`);

  if (startIndex === -1) {
    throw new Error(`Element not found in source: <${tagName}`);
  }

  let depth: number = 0;

  for (let index: number = startIndex; index < source.length; index++) {
    const character: string = source[index]!;

    if (character === "{") {
      depth++;
      continue;
    }

    if (character === "}") {
      depth--;
      continue;
    }

    if (character === ">" && depth === 0 && index > startIndex) {
      return source.slice(startIndex, index + 1);
    }
  }

  throw new Error(`Unterminated opening tag: <${tagName}`);
};

/*
 * `<Modal` does not match `<ConfirmModal`, so these two are genuinely separate
 * elements rather than one found twice.
 */
const codesModalTag: string = openingTagOf(backupCodesSource, "Modal");
const confirmModalTag: string = openingTagOf(backupCodesSource, "ConfirmModal");
const cardTag: string = openingTagOf(backupCodesSource, "Card");

/* Everything between the codes modal's opening tag and its close. */
const codesModalBody: string = backupCodesSource.slice(
  backupCodesSource.indexOf("<Modal"),
  backupCodesSource.indexOf("</Modal>"),
);

/* The Card button's click handler, which is where the confirmation is chosen. */
const cardButtonClickBody: string = blockAfter(
  backupCodesSource,
  "onClick: () =>",
);

/* The one mount effect, which must fetch the count and mint nothing. */
const mountEffectBody: string = blockAfter(
  backupCodesSource,
  "useAsyncEffect(async () =>",
);

/*
 * The two request bodies, pulled out so a failure prints the eight lines that
 * are wrong rather than the whole component.
 */
const loadStatusBody: string = blockAfter(
  backupCodesSource,
  "const loadStatus: LoadStatusFunction",
);

const generateBody: string = blockAfter(
  backupCodesSource,
  "const generate: GenerateFunction",
);

/*
 * Tolerant of both calling conventions on purpose. These two patterns pin WHICH
 * endpoint each verb is aimed at, and they must keep passing after the argument
 * shape is corrected (see the last describe block) -- otherwise fixing that
 * defect would turn this file red for an unrelated reason.
 */
const STATUS_GET_CALL: RegExp =
  /API\.get<JSONObject>\(\s*\{?\s*(?:url:\s*)?BACKUP_CODE_STATUS_API_URL\b/;
const GENERATE_POST_CALL: RegExp =
  /API\.post<JSONObject>\(\s*\{?\s*(?:url:\s*)?BACKUP_CODE_GENERATE_API_URL\b/;

describe("the pieces of the card were located", () => {
  /*
   * A marker that stopped matching throws at module load rather than passing
   * vacuously -- but a marker that matched the WRONG element would not. These
   * pin each extraction to text only the intended element contains, so a
   * rename fails here and names the extractor that broke instead of scattering
   * confusing failures through the rest of the file.
   */
  test("the two modals, the card and the two callbacks were all found", () => {
    expect(codesModalTag).toContain('title="Your backup codes"');
    expect(confirmModalTag).toContain('title="Regenerate backup codes?"');
    expect(cardTag).toContain('title="Backup Codes"');

    expect(cardButtonClickBody).toContain("setGenerateError");
    expect(mountEffectBody).toContain("loadStatus");
    expect(loadStatusBody).toContain("API.get<JSONObject>(");
    expect(generateBody).toContain("API.post<JSONObject>(");

    /* And the two modal tags really are two different elements. */
    expect(codesModalTag).not.toContain("ConfirmModal");
    expect(confirmModalTag).not.toContain('"Your backup codes"');
    expect(codesModalBody.length).toBeGreaterThan(codesModalTag.length);
  });
});

describe("the card is actually mounted on the profile page", () => {
  test("TwoFactorAuth.tsx imports it", () => {
    /*
     * The failure this catches is the quietest one in the whole feature: the
     * component compiles, lints and is covered by every assertion below while
     * being imported by nobody, and the only symptom is that a user can never
     * generate a code -- which nobody notices until the day they need one.
     */
    expect(twoFactorPageSource).toContain(
      'import BackupCodes from "../../../Components/TwoFactorAuth/BackupCodes";',
    );
  });

  test("the import path resolves to the component this file is testing", () => {
    /*
     * The string above proves an import exists; this proves it points at the
     * file. A component moved into a different folder leaves the old specifier
     * failing only at bundle time, in a job that is not this one.
     */
    const specifier: RegExpMatchArray | null = twoFactorPageSource.match(
      /import BackupCodes from "([^"]+)";/,
    );

    expect(specifier).not.toBeNull();

    const resolved: string = nodePath.resolve(
      nodePath.dirname(nodePath.join(DASHBOARD_SRC, ...TWO_FACTOR_AUTH_PAGE)),
      `${specifier![1]!}.tsx`,
    );

    expect(resolved).toBe(
      nodePath.join(DASHBOARD_SRC, ...BACKUP_CODES_COMPONENT),
    );
    expect(fs.existsSync(resolved)).toBe(true);
  });

  test("it is rendered, exactly once", () => {
    /*
     * Importing is not mounting. An unused import is a lint warning at worst
     * and, in a file this size, an easy thing to leave behind after a revert.
     */
    expect(twoFactorPageSource).toContain("<BackupCodes />");
    expect(countOccurrences(twoFactorPageSource, "<BackupCodes")).toBe(1);
  });

  test("it sits after the two factor methods it is the fallback for", () => {
    /*
     * Position, not decoration: the card answers "what happens when one of
     * those stops working", and it only reads that way once the reader has
     * seen the authenticator and security key tables. Rendered above them it
     * reads as a third method -- which is exactly the misconception the server
     * side goes out of its way to avoid (backup codes are deliberately not
     * counted as a verified factor).
     *
     * All three indices are floored first: `indexOf` answers -1 for something
     * that is not there, and -1 sorts before every real index, so an ordering
     * comparison on a missing needle is satisfied by its absence.
     */
    const totpIndex: number = twoFactorPageSource.indexOf(
      'id="totp-auth-table"',
    );
    const webAuthnIndex: number = twoFactorPageSource.indexOf(
      'id="webauthn-table"',
    );
    const backupCodesIndex: number =
      twoFactorPageSource.indexOf("<BackupCodes />");

    expect(totpIndex).toBeGreaterThan(-1);
    expect(webAuthnIndex).toBeGreaterThan(-1);
    expect(backupCodesIndex).toBeGreaterThan(-1);

    expect(backupCodesIndex).toBeGreaterThan(totpIndex);
    expect(backupCodesIndex).toBeGreaterThan(webAuthnIndex);
  });
});

describe("the card talks to the two real endpoints", () => {
  test("both URLs are built off APP_API_URL, on the CRUD path the API registers", () => {
    /*
     * `UserTwoFactorBackupCodeAPI` hangs both routes off the model's CRUD path,
     * `/user-two-factor-backup-code`, and both sit behind
     * `UserMiddleware.getUserMiddleware` -- so they are APP_API_URL routes,
     * unlike the sign-in half of this feature, which is on the identity
     * service. A trailing-slash or singular/plural slip here reaches the user
     * as the SPA's 404 body arriving where JSON was expected.
     */
    expect(backupCodesSource).toMatch(
      /const BACKUP_CODE_STATUS_API_URL: URL = URL\.fromString\(\s*APP_API_URL\.toString\(\),?\s*\)\.addRoute\("\/user-two-factor-backup-code\/status"\);/,
    );

    expect(backupCodesSource).toMatch(
      /const BACKUP_CODE_GENERATE_API_URL: URL = URL\.fromString\(\s*APP_API_URL\.toString\(\),?\s*\)\.addRoute\("\/user-two-factor-backup-code\/generate"\);/,
    );
  });

  test("the status endpoint is read with a GET", () => {
    expect(loadStatusBody).toMatch(STATUS_GET_CALL);

    /*
     * Exactly one GET in the file, so the assertion above covers every read
     * the card makes rather than one of several. Counted on `API.get<` rather
     * than `API.get`, which is also a prefix of `API.getFriendlyErrorMessage`.
     */
    expect(countOccurrences(backupCodesSource, "API.get<")).toBe(1);
  });

  test("the generate endpoint is called with a POST", () => {
    expect(generateBody).toMatch(GENERATE_POST_CALL);
    expect(countOccurrences(backupCodesSource, "API.post<")).toBe(1);
  });

  test("the card reads only these two endpoints", () => {
    /*
     * The CRUD routes on this model are all but read-denied on purpose --
     * create, update and delete are empty for every permission -- so a page
     * that reached for ModelAPI here would be writing against doors the model
     * has bolted, and would get a permissions error rather than a feature.
     */
    expect(backupCodesSource).not.toContain("ModelAPI");
    expect(backupCodesSource).not.toContain("API.delete");
    expect(backupCodesSource).not.toContain("API.put");

    /*
     * And nothing on this page ever asks for the digest. `codeHash` denies
     * read to EVERYONE on the model -- owner and master admin alike -- so a
     * select for it would be refused; the point of asserting it is that the
     * plaintext genuinely exists only in the generate response.
     */
    expect(backupCodesSource).not.toContain("codeHash");
  });
});

describe("regeneration is a POST, never a GET", () => {
  test("the generate URL is never handed to a read verb", () => {
    /*
     * THE LOCKOUT WITH NO USER ACTION BEHIND IT. Generating REPLACES the whole
     * set, so anything that can issue a GET without a person deciding to --
     * a browser prefetch, a link preview, a favicon-style speculative fetch,
     * a crawler riding an authenticated session -- would void a list the user
     * has already printed. The server refuses it (the route is registered with
     * `router.post`), which is the backstop; this is the part under the
     * dashboard's own control.
     */
    expect(backupCodesSource).not.toMatch(
      /API\.get<JSONObject>\(\s*\{?\s*(?:url:\s*)?BACKUP_CODE_GENERATE_API_URL/,
    );
    expect(backupCodesSource).not.toMatch(
      /url:\s*BACKUP_CODE_GENERATE_API_URL[\s\S]{0,80}HTTPMethod\.GET/,
    );
  });

  test("the generate URL appears exactly twice: its declaration and one call", () => {
    /*
     * A third mention is the shape every accidental prefetch takes -- an
     * `href`, a `<Link to=...>`, a preload hint, a second call added to a
     * refresh handler. The count is what makes "never a GET" cover the whole
     * file rather than the one call site inspected above.
     */
    expect(
      countOccurrences(backupCodesSource, "BACKUP_CODE_GENERATE_API_URL"),
    ).toBe(2);
  });

  test("nothing mints codes on mount", () => {
    /*
     * The card fetches the COUNT when it renders and nothing else. A
     * `generate()` reachable from the mount effect would replace the user's
     * codes every time they opened their profile page -- and would do it
     * before the confirmation and the acknowledgement modal exist to say so.
     */
    expect(mountEffectBody).toContain("await loadStatus();");
    expect(mountEffectBody).not.toContain("generate(");
    expect(countOccurrences(backupCodesSource, "useAsyncEffect(")).toBe(1);
  });

  test("the status read is the one that is safe to repeat", () => {
    /*
     * The pairing that makes the split above meaningful: `loadStatus` is
     * called again straight after a successful generate, so it has to be the
     * idempotent one. If the two URLs were ever swapped, this refresh would
     * regenerate the codes the user is at that moment reading off the screen.
     */
    expect(backupCodesSource).toMatch(STATUS_GET_CALL);
    expect(countOccurrences(backupCodesSource, "loadStatus()")).toBe(2);
  });
});

describe("the 'shown once' modal cannot be dismissed without acknowledging", () => {
  test("Done is disabled until the checkbox is ticked", () => {
    /*
     * The acknowledgement is a checkbox rather than a "Done" button on its
     * own, because a lone Done is exactly the control people click reflexively
     * to make a dialog go away. Losing `disableSubmitButton` does not weaken
     * that -- it removes it.
     */
    expect(codesModalTag).toContain("disableSubmitButton={!hasSavedCodes}");
    expect(codesModalTag).toContain('submitButtonText="Done"');
  });

  test("NO onClose is passed, which is what removes the X, Escape and backdrop", () => {
    /*
     * Modal renders its X button, its Cancel button, its Escape handler and
     * its backdrop-click handler ONLY when `props.onClose` is set -- four
     * separate `props.onClose &&` gates inside Common/UI/Components/Modal/
     * Modal.tsx. So adding an onClose here does not "add a close button": it
     * reopens four reflex routes out of the one dialog in this product whose
     * contents cannot be recovered. Ten codes gone, and nothing afterwards can
     * tell the user they were ever shown.
     */
    expect(codesModalTag).not.toContain("onClose");

    /*
     * And the negative is not vacuous. The confirmation modal above SHOULD
     * have an onClose -- backing out of "are you sure?" must be free -- so if
     * `onClose` had simply disappeared from the file, the assertion above
     * would pass for entirely the wrong reason.
     */
    expect(confirmModalTag).toContain("onClose={");
  });

  test("the backdrop is bolted shut a second time", () => {
    /*
     * Belt and braces for whoever adds an `onClose` here later without reading
     * the comment: with this set, the backdrop click stays inert even then.
     */
    expect(codesModalTag).toContain("disableCloseOnBackdropClick={true}");
  });

  test("the checkbox starts unticked and is the only thing that arms Done", () => {
    /*
     * `hasSavedCodes` defaulting to true would disable nothing, and the modal
     * would be a Done button with a decorative tick next to it.
     */
    expect(backupCodesSource).toContain(
      "const [hasSavedCodes, setHasSavedCodes] = React.useState<boolean>(false);",
    );
    expect(codesModalBody).toContain('type="checkbox"');
    expect(codesModalBody).toContain("checked={hasSavedCodes}");
    expect(codesModalBody).toContain("setHasSavedCodes(event.target.checked)");
  });

  test("a fresh set re-arms the acknowledgement", () => {
    /*
     * Regenerating twice in a row must not inherit the first set's tick.
     * `setHasSavedCodes(false)` is set alongside the new codes, and again when
     * the modal is submitted, so the second modal opens with Done disabled
     * exactly as the first one did.
     */
    expect(backupCodesSource).toMatch(
      /setShowConfirmModal\(false\);\s*setHasSavedCodes\(false\);\s*setGeneratedCodes\(codes\);/,
    );
    expect(codesModalTag).toMatch(
      /onSubmit=\{\(\) => \{\s*setGeneratedCodes\(null\);\s*setHasSavedCodes\(false\);\s*\}\}/,
    );
  });

  test("the modal says, on screen, that this is the only viewing", () => {
    /*
     * The mechanical guards above stop an accidental dismissal; this is what
     * stops a deliberate one made in ignorance. It is a WARNING alert rather
     * than body copy because the user has to read it before they decide the
     * dialog is finished with them.
     */
    expect(codesModalBody).toContain("AlertType.WARNING");
    expect(codesModalBody).toContain(
      'strongTitle="This is the only time these codes will be shown."',
    );
  });
});

describe("a confirmation guards regeneration when codes already exist", () => {
  test("an existing set opens the confirmation instead of generating", () => {
    /*
     * The button sits next to "8 of 10 backup codes remaining". Without this
     * branch, pressing it invalidates those eight -- including any the user
     * has printed -- with no prompt and no undo.
     */
    expect(cardButtonClickBody).toMatch(
      /if \(!isKnownToHaveNoCodes\)\s*\{\s*setShowConfirmModal\(true\);\s*return;\s*\}/,
    );

    /*
     * The `return` is what makes it a branch rather than an extra dialog:
     * without it, control falls through and the codes are replaced while the
     * confirmation asking permission is still on screen.
     */
    const guardIndex: number = cardButtonClickBody.indexOf(
      "setShowConfirmModal(true)",
    );
    const generateIndex: number = cardButtonClickBody.indexOf("generate()");

    expect(guardIndex).toBeGreaterThan(-1);
    expect(generateIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(generateIndex);
  });

  test("'do they have codes' is read from the fetched status, not assumed", () => {
    /*
     * Derived from the same object the card renders its count from, so the
     * prompt and the number above it cannot disagree.
     *
     * The direction of the test matters and is covered in full by "the
     * destructive path cannot be reached by accident" above: the flag records
     * that we KNOW there are none, so the unknown case -- a status fetch that
     * has not landed, or one that failed -- falls on the side that asks first.
     */
    expect(backupCodesSource).toContain(
      "const isKnownToHaveNoCodes: boolean = Boolean(status && status.total === 0);",
    );
    expect(cardTag).toContain("disabled: isStatusLoading || isGenerating");
  });

  test("the confirmation is destructive, and says what it destroys", () => {
    /*
     * DANGER rather than PRIMARY, and the description spells out that printed
     * and written-down codes stop working too -- which is the half users do
     * not infer, because it is the half that is not on their screen.
     */
    expect(confirmModalTag).toContain(
      "submitButtonType={ButtonStyleType.DANGER}",
    );
    expect(confirmModalTag).toMatch(
      /description="[^"]*written down or printed[^"]*"/,
    );
    expect(confirmModalTag).toContain('submitButtonText="Regenerate"');
  });

  test("the confirmation is what calls generate, and it is mounted on its own flag", () => {
    expect(backupCodesSource).toContain("{showConfirmModal && ( <ConfirmModal");
    expect(confirmModalTag).toMatch(/onSubmit=\{\(\) => \{\s*generate\(\)/);

    /*
     * Two call sites and no more: the first-time path in the click handler,
     * and this one. A third would be a path that skipped one guard or the
     * other.
     */
    expect(countOccurrences(backupCodesSource, "generate()")).toBe(2);
  });

  test("a first-time user is not asked to confirm nothing", () => {
    /*
     * The other direction, and the reason the branch is conditional rather
     * than unconditional: somebody with no codes has nothing to invalidate, so
     * "are you sure?" would be a dialog with exactly one sensible answer -- and
     * a dialog people learn to dismiss without reading is how the modal that
     * genuinely matters gets dismissed without reading.
     */
    expect(cardTag).toMatch(
      /title: isKnownToHaveNoCodes\s*\?\s*"Generate Backup Codes"\s*:\s*"Regenerate Backup Codes"/,
    );
  });
});

describe("the codes can be both copied and downloaded", () => {
  test("copy is offered, over the whole set", () => {
    /*
     * Both, not either. A user given only copy pastes the codes into whatever
     * is in front of them and loses the clipboard to the next copy; a user
     * given only download ends up with a file they never open in a Downloads
     * folder they never tidy. The two failure modes are different people, so
     * the two controls are both needed.
     */
    expect(codesModalBody).toContain("<CopyTextButton");
    expect(codesModalBody).toContain(
      'textToBeCopied={generatedCodes.join("\\n")}',
    );
  });

  test("download is offered, and writes a real file", () => {
    expect(codesModalBody).toContain("onClick={downloadCodes}");
    expect(codesModalBody).toContain("icon={IconProp.Download}");

    /*
     * The handler is the other half. A button wired to a no-op would satisfy
     * the assertion above and hand the user nothing.
     */
    expect(backupCodesSource).toContain(
      "const downloadCodes: DownloadCodesFunction",
    );
    expect(backupCodesSource).toContain(
      'anchor.download = "oneuptime-backup-codes.txt"',
    );
    expect(backupCodesSource).toContain("...generatedCodes,");
  });

  test("the download revokes its object URL", () => {
    /*
     * Not tidiness -- a blob URL that is never revoked keeps the codes
     * reachable at a stable URL for the lifetime of the document, which is the
     * one thing a page built around "shown exactly once" should not leave
     * lying around.
     */
    expect(backupCodesSource).toContain("window.URL.revokeObjectURL(url)");
  });

  test("both controls live inside the modal, where the codes exist", () => {
    /*
     * `generatedCodes` is null everywhere else, so a copy button rendered on
     * the card itself would silently copy an empty string -- and the user
     * would have no way to tell until the day they tried to use it.
     */
    const copyIndex: number = backupCodesSource.indexOf("<CopyTextButton");
    const downloadIndex: number = backupCodesSource.indexOf(
      "onClick={downloadCodes}",
    );
    const modalStart: number = backupCodesSource.indexOf("<Modal");
    const modalEnd: number = backupCodesSource.indexOf("</Modal>");

    expect(copyIndex).toBeGreaterThan(modalStart);
    expect(copyIndex).toBeLessThan(modalEnd);
    expect(downloadIndex).toBeGreaterThan(modalStart);
    expect(downloadIndex).toBeLessThan(modalEnd);
  });
});

/*
 * ---------------------------------------------------------------------------
 * THE THREE WAYS THIS CARD CAN DESTROY CODES OR HIDE A FAILURE.
 *
 * All three were found in review of the first draft, and none of them is
 * visible from a screenshot of the happy path -- which is why they are pinned
 * in source rather than left to a manual check.
 * ---------------------------------------------------------------------------
 */
describe("the destructive path cannot be reached by accident", () => {
  /*
   * `status` is null in TWO different situations: before the first fetch
   * lands, and after one that FAILED. Deciding "show the confirmation?" from
   * `status && status.total > 0` reads the second as "this user has no codes",
   * so a user whose status request 500'd would press a button labelled
   * "Generate Backup Codes", see no warning at all, and lose ten working
   * codes. The gate therefore has to be the POSITIVE fact -- we know there are
   * none -- and everything else, including not knowing, gets the dialog.
   */
  test("the confirmation is skipped only when the card KNOWS there are no codes", () => {
    expect(backupCodesSource).toMatch(
      /const isKnownToHaveNoCodes:\s*boolean\s*=\s*Boolean\(\s*status && status\.total === 0\s*\)/,
    );

    /*
     * And the click handler must branch on that, negated -- "if we do NOT know
     * there are none, confirm first".
     */
    expect(cardButtonClickBody).toMatch(
      /if \(!isKnownToHaveNoCodes\)\s*\{\s*setShowConfirmModal\(true\);/,
    );
  });

  /*
   * The old shape, spelled out so nobody reintroduces it: any gate that treats
   * "there are codes" as the condition for confirming is treating unknown as
   * safe.
   */
  test("no gate reads a truthy code count as the condition to confirm", () => {
    expect(backupCodesSource).not.toContain("status.total > 0");
  });

  /*
   * `isStatusLoading` is false for the entire duration of the generate
   * request -- the status is not re-read until after it returns -- so it is
   * not, on its own, an in-flight guard. Without `isGenerating` on the button,
   * a second click lands on an ENABLED button and starts a second
   * regeneration; the two interleave their delete-then-insert, and the set the
   * user is shown stops matching the set the database keeps.
   */
  test("the button is disabled while a generation is in flight", () => {
    const buttonBlock: string = backupCodesSource.slice(
      backupCodesSource.indexOf("buttons={["),
      backupCodesSource.indexOf("onClick: () =>"),
    );

    const violations: Array<string> = [];

    if (!/disabled:\s*isStatusLoading \|\| isGenerating/.test(buttonBlock)) {
      violations.push("the button's disabled prop does not include isGenerating");
    }

    if (!/isLoading:\s*isGenerating/.test(buttonBlock)) {
      violations.push("the button does not report isGenerating as isLoading");
    }

    expect(violations).toEqual([]);
  });

  /*
   * Belt to those braces. React batches state updates, so two clicks in one
   * tick both read the pre-click `isGenerating` and both get past a disabled
   * prop. A ref is read synchronously and is the only thing that closes that
   * window.
   */
  test("generate refuses to re-enter while it is already running", () => {
    expect(generateBody).toMatch(
      /if \(isGeneratingRef\.current\)\s*\{\s*return;/,
    );
    expect(generateBody).toContain("isGeneratingRef.current = true;");
    expect(generateBody).toContain("isGeneratingRef.current = false;");
  });
});

describe("a failed generation is visible to the user", () => {
  /*
   * THE FIRST-TIME USER IS THE ONE THIS BREAKS. `generateError` used to have
   * exactly one render site -- the `error` prop of the ConfirmModal -- and a
   * user with no codes never opens that modal, because there is nothing to
   * confirm. So a failed POST set an error string that nothing on screen could
   * show: the card still read "You have no backup codes", the button did
   * nothing visible, and the user pressed it again and again, on the one page
   * in the product where having no backup codes is the thing they came to fix.
   */
  test("generateError is rendered on the card itself, not only in the modal", () => {
    const cardBody: string = backupCodesSource.slice(
      backupCodesSource.indexOf("<Card"),
      backupCodesSource.indexOf("</Card>"),
    );

    // Guard: an empty slice would make the assertion below vacuous.
    expect(cardBody).toContain("renderStatus()");

    expect(cardBody).toMatch(
      /\{generateError && \([\s\S]{0,400}?<ErrorMessage message=\{generateError\} \/>/,
    );
  });

  /*
   * The status fetch has its own error surface, and it must keep it -- the two
   * failures are different (one means "we do not know what you have", the
   * other means "the thing you asked for did not happen") and collapsing them
   * into one string would tell the user the wrong thing about half the time.
   */
  test("statusError keeps its own separate render site", () => {
    expect(backupCodesSource).toMatch(
      /<ErrorMessage message=\{statusError\} \/>/,
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * THE CALLING CONVENTION, pinned because this card was written with it wrong
 * and nothing else in the repository noticed.
 *
 * As first written, BackupCodes.tsx called these statics positionally, which
 * made the whole feature dead on arrival: the status fetch threw on mount and
 * every press of Generate threw the same way, so no user could obtain a backup
 * code through the dashboard at all. It reached review because neither of the
 * two things that should have caught it does:
 *
 *   - `tsc` never sees this file. App/tsconfig.json EXCLUDES
 *     FeatureSet/Dashboard (along with Accounts, AdminDashboard, StatusPage,
 *     PublicDashboard and BrowserRecorder), so `npm run compile` in App is
 *     silent about every line of the browser feature sets. They have their own
 *     tsconfigs and are built by esbuild, which strips types without checking
 *     them;
 *   - and even a type check would have let the `get` call through. A weak-type
 *     mismatch is normally reported -- but `URL` happens to declare a `params`
 *     member, and so does `APIRequestOptions`, so the one shared property name
 *     is enough to make the assignment structurally legal.
 *
 * A source-reading assertion is therefore the only guard available here.
 *
 * `API.get` and `API.post` take a SINGLE `APIRequestOptions` object -- see
 * Common/Utils/API.ts, where the body opens `const { url, data, headers,
 * params, options } = options;` and `url` is a REQUIRED member of the
 * interface. BackupCodes.tsx calls them positionally:
 *
 *     await API.get<JSONObject>(BACKUP_CODE_STATUS_API_URL);
 *     await API.post<JSONObject>(BACKUP_CODE_GENERATE_API_URL, {});
 *
 * A `URL` instance exposes `protocol`, `hostname`, `route` and `params` and has
 * no `url` property at all, so the destructure yields undefined and the call
 * throws `APIException("URL is required for static method")` before any request
 * is made. The UI's `BaseAPI` does not help: it extends this class and
 * overrides only `getHeaders`, `handleError`, `tryRefreshAuth` and
 * `onResponseSuccessHeaders`, inheriting these statics unchanged.
 *
 * Every other API call in App/FeatureSet/Dashboard/src passes the options
 * object.
 * ---------------------------------------------------------------------------
 */
describe("the API calls are shaped the way API.get / API.post read them", () => {
  test("a bare URL argument throws before any request is made", async (): Promise<void> => {
    /*
     * The mechanism, proved against the real static rather than asserted from
     * a comment -- so if either assertion below ever goes red, the reason is
     * one line away rather than in another package. Nothing is mocked; the
     * throw happens in the argument destructure, long before axios is
     * involved, so no network is touched.
     */
    const someUrl: URL = new URL(
      Protocol.HTTP,
      new Hostname("localhost", 3002),
    );

    let thrownMessage: string = "";

    try {
      await (
        API as unknown as { get: (options: unknown) => Promise<unknown> }
      ).get(someUrl);
    } catch (err) {
      thrownMessage = (err as Error).message;
    }

    expect(thrownMessage).toBe("URL is required for static method");
  });

  /*
   * Both assertions are bounded to the one function body that makes the call,
   * so the failure prints the offending line rather than the component.
   */
  test("the status fetch passes an options object", () => {
    expect(loadStatusBody).toMatch(
      /API\.get<JSONObject>\(\s*\{\s*url:\s*BACKUP_CODE_STATUS_API_URL\b/,
    );
  });

  test("the generate call passes an options object", () => {
    expect(generateBody).toMatch(
      /API\.post<JSONObject>\(\s*\{\s*url:\s*BACKUP_CODE_GENERATE_API_URL\b/,
    );
  });
});
