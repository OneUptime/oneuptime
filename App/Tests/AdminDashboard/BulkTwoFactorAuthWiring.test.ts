import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";

/*
 * The Users table's bulk "Require Two Factor Auth" / "Do Not Require Two Factor
 * Auth" actions are a single hand-written schema object handed to
 * Common/UI/Components/BulkUpdate/BulkUpdateForm. Nothing at runtime checks that
 * the object is shaped the way the bulk bar needs, and every way of getting it
 * wrong fails silently rather than loudly:
 *
 *  - omitting `confirmMessage` (or `confirmTitle`) makes BulkUpdateForm skip the
 *    confirmation entirely - `triggerButtonClick` only builds a ConfirmModal
 *    when `button.confirmMessage` is set - so a menu click would sign every
 *    selected user out with no prompt at all;
 *  - a DANGER `buttonStyleType` moves the item out of `safeButtons` and into
 *    `dangerButtons`, which renders below the divider at the bottom of the bulk
 *    menu next to Delete - the destructive corner of a menu these two are not
 *    destructive members of;
 *  - writing `enableTwoFactorAuth` through `AdminModelAPI.updateById` would
 *    succeed and skip the endpoint's session revocation, so a bulk "require two
 *    factor auth" would quietly do nothing for everyone already signed in;
 *  - `await API.post(...)` without an `instanceof HTTPErrorResponse` check
 *    resolves an error response rather than rejecting, so every failure would be
 *    reported to the admin as a success;
 *  - a `throw` in the per-user catch, a `Promise.all` in place of the loop, or a
 *    missing `onBulkActionEnd()` each leave the shared progress modal's Close
 *    button disabled forever, with the table selection never cleared and no way
 *    out but a page reload;
 *  - and a confirm string interpolated under `count` rather than `userCount`
 *    makes i18next treat the lookup as a PLURAL-KEY lookup and go looking for
 *    `..._one` / `..._other` siblings this locale set does not define, so the
 *    admin is shown the raw key instead of the sentence.
 *
 * Source text rather than imports: this page renders React and pulls in
 * Common/UI, and the wirings it holds are invariants no runtime value exposes.
 * `npm run i18n:validate` proves the 16 locale files agree with each other;
 * nothing else proves they contain what this action asks for.
 *
 * Same helper shape as App/Tests/AdminDashboard/BulkAddUsersToProjectWiring
 * .test.ts - these helpers are copy-pasted per file in this repo by convention.
 */

const ADMIN_DASHBOARD_SRC: string = nodePath.join(
  __dirname,
  "../../FeatureSet/AdminDashboard/src",
);

/*
 * Comments are stripped first so a file that explains a pattern in prose cannot
 * satisfy an assertion about the code. That matters more here than usual: the
 * action carries a long comment that names `AdminModelAPI.updateById`, spells
 * out "There is no bulk RESET", and explains why the style is NORMAL rather
 * than DANGER - which are three of the things asserted on below.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function readSource(relativePath: string): string {
  return stripComments(
    fs.readFileSync(nodePath.join(ADMIN_DASHBOARD_SRC, relativePath), "utf8"),
  );
}

const usersPageSource: string = readSource("Pages/Users/Index.tsx");

const LOCALES_DIR: string = nodePath.join(ADMIN_DASHBOARD_SRC, "Locales");

const localeFileNames: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((fileName: string) => {
    return fileName.endsWith(".json");
  })
  .sort();

function readLocale(fileName: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(nodePath.join(LOCALES_DIR, fileName), "utf8"),
  );
}

const englishLocale: Record<string, unknown> = readLocale("en.json");

/* Walks a dotted key against one locale file. */
function lookUpKeyInLocale(
  locale: Record<string, unknown>,
  key: string,
): unknown {
  let node: unknown = locale;

  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) {
      return undefined;
    }

    node = (node as Record<string, unknown>)[part];
  }

  return node;
}

function lookUpLocaleKey(key: string): unknown {
  return lookUpKeyInLocale(englishLocale, key);
}

/*
 * Walks braces from `blockStart` (which must be a `{`) to its match. `marker`
 * is carried only so the failure names what the caller was looking for.
 */
function balancedBlockAt(
  source: string,
  blockStart: number,
  marker: string,
): string {
  let depth: number = 0;

  for (let index: number = blockStart; index < source.length; index++) {
    const character: string = source[index]!;

    if (character === "{") {
      depth++;
    }

    if (character === "}") {
      depth--;

      if (depth === 0) {
        return source.slice(blockStart, index + 1);
      }
    }
  }

  throw new Error(`Unbalanced braces after marker: ${marker}`);
}

/*
 * The balanced-brace block that follows `marker`. Used to bound an assertion to
 * one function or one JSX prop, so that "the two factor action does not call
 * AdminModelAPI" cannot be satisfied - or defeated - by the three sibling bulk
 * actions on the same page, two of which legitimately do call it.
 */
function blockAfter(source: string, marker: string): string {
  const markerIndex: number = source.indexOf(marker);

  if (markerIndex === -1) {
    throw new Error(`Marker not found in source: ${marker}`);
  }

  const blockStart: number = source.indexOf("{", markerIndex);

  if (blockStart === -1) {
    throw new Error(`No block follows marker: ${marker}`);
  }

  return balancedBlockAt(source, blockStart, marker);
}

/*
 * Used where "the call happens here" is only half the guarantee and "the call
 * happens nowhere else in this body" is the other half.
 */
function countOccurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

/*
 * The index one past the end of the balanced block that follows `marker`, so a
 * caller can assert that some other statement sits after the whole of it.
 * `indexOf(block)` is searched from the marker rather than from zero because
 * the loop body's `try`/`catch` shapes repeat verbatim in the sibling actions.
 */
function endIndexOfBlockAfter(source: string, marker: string): number {
  const markerIndex: number = source.indexOf(marker);

  if (markerIndex === -1) {
    throw new Error(`Marker not found in source: ${marker}`);
  }

  const block: string = blockAfter(source, marker);

  return source.indexOf(block, markerIndex) + block.length;
}

/* The declaration, not either of the two call sites in the bulkActions array. */
const ACTION_MARKER: string = "const getBulkSetTwoFactorAuthRequiredAction";

const actionBlock: string = blockAfter(usersPageSource, ACTION_MARKER);
const onClickBody: string = blockAfter(actionBlock, "onClick: async (");
const loopBlock: string = blockAfter(
  onClickBody,
  "for (const user of totalItems)",
);
const tryBlock: string = blockAfter(loopBlock, "try {");
const catchBlock: string = blockAfter(loopBlock, "} catch (err)");
const bulkActionsBlock: string = blockAfter(usersPageSource, "bulkActions=");
const routeBuilderBlock: string = blockAfter(
  usersPageSource,
  "const setTwoFactorAuthRequiredRoute",
);

/* i18next's plural-lookup trigger, which none of these strings must spell. */
const COUNT_PLACEHOLDER: RegExp = /\{\{\s*count\s*\}\}/;

/* Every `t("pages.users.bulk...TwoFactorAuth...")` the action asks for. */
function twoFactorTranslationKeys(): Array<string> {
  const keys: Set<string> = new Set<string>();
  const pattern: RegExp = /\bt\(\s*"(pages\.users\.bulk\w*TwoFactorAuth\w*)"/g;

  let match: RegExpExecArray | null = pattern.exec(actionBlock);

  while (match) {
    keys.add(match[1]!);
    match = pattern.exec(actionBlock);
  }

  return [...keys].sort();
}

/*
 * The keys the action passes a `userCount` option to - derived from the source
 * rather than listed here, so that a key which stops being interpolated stops
 * being checked for a placeholder and a new interpolated key starts being
 * checked without this file being edited.
 */
function interpolatedTranslationKeys(): Array<string> {
  const keys: Set<string> = new Set<string>();
  const pattern: RegExp =
    /\bt\(\s*"(pages\.users\.bulk\w*TwoFactorAuth\w*)",\s*\{\s*userCount:/g;

  let match: RegExpExecArray | null = pattern.exec(actionBlock);

  while (match) {
    keys.add(match[1]!);
    match = pattern.exec(actionBlock);
  }

  return [...keys].sort();
}

/* The `{{name}}` set of one translation, order-independent. */
function placeholdersIn(value: string): Array<string> {
  return [...value.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)]
    .map((match: RegExpMatchArray): string => {
      return match[1]!;
    })
    .sort();
}

describe("Bulk two factor auth action extraction", () => {
  /*
   * Every assertion in this file is bounded by one of the blocks pulled out
   * above. A marker that stopped matching would throw at module load rather
   * than pass vacuously, but a marker that matched the WRONG thing - a sibling
   * action's `onClick`, or the `bulkActions` prop of some other table - would
   * not. These tests pin each extraction to text only the intended block
   * contains, so a rename fails here and names the extractor that broke instead
   * of scattering confusing failures through the rest of the file.
   */
  test("the two factor bulk action block was located at all", () => {
    expect(usersPageSource.indexOf(ACTION_MARKER)).toBeGreaterThan(-1);
    expect(actionBlock.length).toBeGreaterThan(200);

    /*
     * `actionBlock` is the builder's arrow BODY, so the schema type sits in the
     * declaration above it rather than inside the block. Both are pinned: the
     * declaration is what makes the returned object a bulk action at all, and
     * the body is what every assertion below is bounded to.
     */
    expect(usersPageSource).toMatch(
      /const getBulkSetTwoFactorAuthRequiredAction:[\s\S]{0,200}BulkActionButtonSchema<User>/,
    );
    expect(actionBlock).toContain("buttonStyleType:");
    expect(actionBlock).toContain("onClick:");
    expect(actionBlock).toContain("isRequired");
  });

  test("the onClick body, its loop and the loop's try/catch were located", () => {
    expect(onClickBody.length).toBeGreaterThan(100);
    expect(onClickBody).toContain("onClickProps");
    expect(loopBlock.length).toBeGreaterThan(100);
    expect(loopBlock).toContain("API.post");
    expect(tryBlock).toContain("API.post");
    expect(catchBlock).toContain("failedItems.push(");

    /* The loop is inside the onClick, not something found further down the file. */
    expect(onClickBody).toContain(loopBlock);
    expect(loopBlock).toContain(tryBlock);
    expect(loopBlock).toContain(catchBlock);
  });

  test("the bulkActions array and the route builder were located", () => {
    expect(bulkActionsBlock).toContain("buttons:");
    expect(bulkActionsBlock).toContain("getBulkDeleteAction()");
    expect(routeBuilderBlock).toContain("addRoute(");
  });

  test("the translation-key extractors found something", () => {
    /*
     * Paired with the extractors below: a regex that stopped matching would
     * make "every key is translated in every locale" pass over an empty list.
     *
     * Both counts are EXACT rather than a floor. A floor only catches the
     * extractor breaking completely, and the way these extractors actually
     * break is partially: `interpolatedTranslationKeys` matches the options
     * object literally, so hoisting one call's options into a
     * `const options: JSONObject = { userCount: items.length };` - a
     * reformatting nobody would think twice about, which changes no
     * behaviour - drops that key out of the returned list while the other
     * three still match. "en.json keeps {{userCount}} in every interpolated
     * string" then quietly stops checking that key, and the confirmation
     * heading it feeds can lose its {{userCount}} with nothing going red.
     * Four is the number of `t(key, { userCount })` calls the action makes:
     * a confirm title and a confirm message on each branch of `isRequired`.
     */
    expect(twoFactorTranslationKeys().length).toBe(6);
    expect(interpolatedTranslationKeys().length).toBe(4);
  });

  test("all sixteen locale files are being looked at", () => {
    /*
     * The locale loops prove nothing if the directory read comes back short.
     * i18next's fallbackLng is "en", so a locale file that simply lacks these
     * keys renders an English confirmation with no error to notice.
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
  });
});

describe("Bulk two factor auth action registration", () => {
  test("both directions are offered in the bulk menu", () => {
    /*
     * The action is only reachable from the table's Bulk Actions menu, and the
     * schema builder takes the direction as an argument - so registering it
     * once leaves whichever direction was left out as dead code that no test
     * of the builder itself would notice.
     */
    expect(bulkActionsBlock).toContain(
      "getBulkSetTwoFactorAuthRequiredAction(true)",
    );
    expect(bulkActionsBlock).toContain(
      "getBulkSetTwoFactorAuthRequiredAction(false)",
    );

    /*
     * Exactly twice: a third registration would put a duplicate item in the
     * menu, and `true, true` would register the same direction twice while
     * still satisfying a bare "is it referenced" check.
     */
    expect(
      countOccurrences(
        bulkActionsBlock,
        "getBulkSetTwoFactorAuthRequiredAction(",
      ),
    ).toBe(2);
  });

  test("both sit above Delete in the menu", () => {
    /*
     * BulkUpdateForm renders `safeButtons` in array order, then a divider, then
     * `dangerButtons`. Delete is the only DANGER item on this page, so it is
     * already pushed below the divider whatever the array says - but the array
     * order is what a reader edits, and listing a two-factor action after the
     * delete action is how it ends up next to Delete the moment Delete's style
     * changes or a second danger action is added.
     */
    const requireIndex: number = bulkActionsBlock.indexOf(
      "getBulkSetTwoFactorAuthRequiredAction(true)",
    );
    const doNotRequireIndex: number = bulkActionsBlock.indexOf(
      "getBulkSetTwoFactorAuthRequiredAction(false)",
    );
    const deleteIndex: number = bulkActionsBlock.indexOf(
      "getBulkDeleteAction()",
    );

    /*
     * All three are floored before they are ordered. A registration that
     * disappeared would come back as -1, which sorts before every real index
     * and would let this test report the menu order as correct precisely when
     * the item is not in the menu at all.
     */
    expect(requireIndex).toBeGreaterThan(-1);
    expect(doNotRequireIndex).toBeGreaterThan(-1);
    expect(deleteIndex).toBeGreaterThan(-1);

    expect(requireIndex).toBeLessThan(deleteIndex);
    expect(doNotRequireIndex).toBeLessThan(deleteIndex);
    expect(requireIndex).toBeLessThan(doNotRequireIndex);
  });

  test("the menu item is NORMAL, not DANGER", () => {
    /*
     * `isDangerStyle` in BulkUpdateForm routes DANGER, DANGER_OUTLINE and
     * HOVER_DANGER_OUTLINE into `dangerButtons`, which renders in red below the
     * divider at the bottom of the menu - the corner reserved for Delete.
     * Requiring two factor auth is a policy change, not a destructive one, and
     * putting it under the divider both mis-signals that and moves it away from
     * the block-and-unblock actions it belongs beside.
     */
    expect(actionBlock).toContain("buttonStyleType: ButtonStyleType.NORMAL");
    expect(actionBlock).not.toMatch(/ButtonStyleType\.DANGER/);
  });

  test("the click is confirmed before anything happens", () => {
    /*
     * BulkUpdateForm's `triggerButtonClick` builds a ConfirmModal only when
     * `button.confirmMessage` is set, and falls straight through to
     * `button.onClick(...)` when it is not. So dropping `confirmMessage` does
     * not degrade the confirmation - it removes it, and a stray click in the
     * bulk menu signs every selected user out of every session with no prompt.
     *
     * `confirmTitle` is the softer half: without it the modal is headed with
     * the literal string "Confirm", which tells the admin nothing about how
     * many people they are about to lock out.
     */
    expect(actionBlock).toMatch(/confirmTitle:\s*\(items: Array<User>\)/);
    expect(actionBlock).toMatch(/confirmMessage:\s*\(items: Array<User>\)/);
  });
});

describe("Bulk two factor auth action run", () => {
  test("the run opens the progress modal before it does anything else", () => {
    /*
     * `onBulkActionStart` is what puts the shared progress modal on screen and
     * flips `actionInProgress`. Calling it late - after the first request, or
     * from inside the loop - means the admin watches an unresponsive menu while
     * users are already being signed out, and calling it inside the loop resets
     * the progress report to "nothing done yet" on every iteration.
     *
     * Bounded to this action's own onClick, because the three sibling bulk
     * actions on this page all call it correctly at the top of theirs.
     */
    expect(countOccurrences(onClickBody, "onBulkActionStart()")).toBe(1);

    /*
     * And it is the first statement, after the one destructure that has to
     * precede it because it is where the callback comes from.
     */
    expect(onClickBody).toMatch(
      /^\{\s*const \{[^}]*\}\s*=\s*onClickProps;\s*onBulkActionStart\(\);/,
    );

    expect(onClickBody.indexOf("onBulkActionStart()")).toBeLessThan(
      onClickBody.indexOf("for (const user of totalItems)"),
    );
  });

  test("the run ends the bulk action even when every user fails", () => {
    /*
     * Until `onBulkActionEnd` runs, BulkUpdateForm leaves `actionInProgress`
     * true: the progress modal keeps showing the spinner copy, its Close button
     * stays disabled, and because the table only clears the selection and
     * refetches when that modal is closed, the admin's only way out is a page
     * reload.
     *
     * The failure path is the one that matters. A per-user failure must not be
     * able to skip this call, so the assertions are: exactly one call exists in
     * this body, it sits after the whole loop rather than inside it, and it is
     * an unconditional statement rather than something guarded by a "did
     * everything succeed" test.
     */
    expect(countOccurrences(onClickBody, "onBulkActionEnd()")).toBe(1);

    const afterLoop: string = onClickBody.slice(
      endIndexOfBlockAfter(onClickBody, "for (const user of totalItems)"),
    );

    expect(afterLoop).toMatch(/^\s*onBulkActionEnd\(\);\s*\}$/);

    /*
     * The other half of "reachable on failure": nothing in the per-user catch
     * leaves the loop. A `throw` or a `return` there would abandon the run at
     * the first user whose request failed, with the progress modal stuck open
     * and the remaining users neither attempted nor reported.
     */
    expect(catchBlock).not.toMatch(/\bthrow\b/);
    expect(catchBlock).not.toMatch(/\breturn\b/);
    expect(catchBlock).not.toMatch(/\bbreak\b/);
  });

  test("the users are handled one at a time", () => {
    /*
     * Sequential on purpose. Each POST revokes the user's sessions and writes
     * the requirement, and firing a two-hundred-user selection at the API at
     * once is a self-inflicted burst that the rate limiter answers with
     * failures the admin then has to sort out by hand. It is also what makes
     * the progress report meaningful: the counts below are read straight off
     * the arrays this loop mutates in order.
     */
    expect(onClickBody).toContain("for (const user of totalItems)");
    expect(onClickBody).toContain("await API.post<JSONObject>(");
    expect(onClickBody).not.toMatch(/Promise\s*\.\s*all/);
    expect(onClickBody).not.toMatch(/Promise\s*\.\s*allSettled/);
    expect(onClickBody).not.toMatch(/\.map\(/);
  });

  test("the user leaves the in-progress list before the request goes out", () => {
    /*
     * `inProgressItems` is what the progress bar reads as "still queued". Doing
     * the splice after the await would leave the user the admin is watching
     * counted as queued for the whole round trip, and - on the last user - the
     * run would finish with one name still sitting in the in-progress list.
     */
    const spliceIndex: number = loopBlock.indexOf("inProgressItems.splice(");
    const postIndex: number = loopBlock.indexOf("API.post");

    expect(spliceIndex).toBeGreaterThan(-1);
    expect(postIndex).toBeGreaterThan(-1);
    expect(spliceIndex).toBeLessThan(postIndex);
  });

  test("progress is reported once per user, after the failure is recorded", () => {
    /*
     * The report has to sit after the catch, not inside the try: reporting from
     * the try means a user whose request failed never advances the progress
     * bar, so a selection where every request fails shows a bar frozen at zero
     * until the run ends and then jumps straight to a list of failures.
     *
     * Once per iteration, too. A second call inside the try would report the
     * same user twice, and the progress bar counts successes plus failures
     * against the total.
     */
    expect(countOccurrences(loopBlock, "onProgressInfo(")).toBe(1);
    expect(tryBlock).not.toContain("onProgressInfo");
    expect(catchBlock).not.toContain("onProgressInfo");

    expect(loopBlock.indexOf("onProgressInfo(")).toBeGreaterThan(
      endIndexOfBlockAfter(loopBlock, "} catch (err)"),
    );

    /* And it reports the four arrays the loop actually maintains. */
    expect(loopBlock).toContain("totalItems: totalItems");
    expect(loopBlock).toContain("failed: failedItems");
    expect(loopBlock).toContain("successItems: successItems");
    expect(loopBlock).toContain("inProgressItems: inProgressItems");
  });

  test("a failed user is collected and named, not thrown", () => {
    /*
     * An admin who selected two hundred users needs to be told WHICH ones did
     * not take. Rethrowing abandons the run at the first failure and tells them
     * nothing about the rest; pushing a row with the friendly message is what
     * puts the user's name and the reason in the progress modal's failure list.
     */
    expect(catchBlock).toMatch(
      /failedItems\.push\(\s*\{\s*item:\s*user,\s*failedMessage:\s*API\.getFriendlyMessage\(err\),\s*\}\s*\);/,
    );

    /* The catch is that push and nothing else - no swallow, no early exit. */
    expect(catchBlock).toMatch(
      /^\{\s*failedItems\.push\(\s*\{\s*item:\s*user,\s*failedMessage:\s*API\.getFriendlyMessage\(err\),\s*\}\s*\);\s*\}$/,
    );
  });
});

describe("Bulk two factor auth action endpoint", () => {
  test("the requirement is set through the master-admin endpoint", () => {
    /*
     * The endpoint does two things: it writes `enableTwoFactorAuth` AND revokes
     * the user's sessions. A CRUD write through `AdminModelAPI.updateById`
     * would set the column and skip the revocation, so a bulk "require two
     * factor auth" would quietly do nothing for everybody already signed in -
     * which is everybody the action was aimed at. It would also look completely
     * correct in review and pass any test that only checked the column.
     *
     * Bounded to this action's own block, because the sibling block/unblock and
     * delete actions on this page legitimately do go through AdminModelAPI.
     */
    expect(actionBlock).toContain("await API.post<JSONObject>(");
    expect(actionBlock).toContain(
      "url: setTwoFactorAuthRequiredRoute(user.id)",
    );
    expect(actionBlock).toMatch(/data:\s*\{\s*isRequired:\s*isRequired,\s*\}/);

    expect(actionBlock).not.toContain("AdminModelAPI");
    expect(actionBlock).not.toContain("updateById");
    expect(actionBlock).not.toContain("enableTwoFactorAuth");
  });

  test("the route the action posts to is the set-two-factor-auth-required one", () => {
    /*
     * The half of the endpoint contract the action's own block cannot show: the
     * builder it calls. A route that resolved to some other path would satisfy
     * every assertion above and 404 - or, worse, hit a neighbouring user route
     * that happens to accept the same body.
     */
    expect(routeBuilderBlock).toContain("set-two-factor-auth-required");
    expect(routeBuilderBlock).toMatch(
      /`\/user\/\$\{userId\.toString\(\)\}\/set-two-factor-auth-required`/,
    );

    /* Against the API host, not a relative path off the dashboard's own origin. */
    expect(routeBuilderBlock).toContain("APP_API_URL");
  });

  test("an error response is not counted as a success", () => {
    /*
     * `API.post` RESOLVES an `HTTPErrorResponse` rather than rejecting on a
     * non-2xx. A bare `await` therefore falls straight through to
     * `successItems.push(user)`, and the admin is shown a progress modal
     * reporting every user as done while the server rejected all of them -
     * the worst possible outcome for a security control, because it is
     * indistinguishable from success.
     */
    expect(actionBlock).toMatch(
      /if \(response instanceof HTTPErrorResponse\)\s*\{\s*throw response;\s*\}/,
    );

    /*
     * The check is before the success is recorded, not after it.
     *
     * Both needles are floored at -1 first. `indexOf` answers -1 for a string
     * that is not there, and -1 is less than every real index, so an ordering
     * comparison on a needle that has GONE is satisfied by its absence - the
     * exact shape this test exists to reject.
     */
    expect(
      tryBlock.indexOf("response instanceof HTTPErrorResponse"),
    ).toBeGreaterThan(-1);
    expect(tryBlock.indexOf("successItems.push(user)")).toBeGreaterThan(-1);
    expect(
      tryBlock.indexOf("response instanceof HTTPErrorResponse"),
    ).toBeLessThan(tryBlock.indexOf("successItems.push(user)"));
  });

  test("there is no bulk reset", () => {
    /*
     * Deliberate omission, asserted so nobody adds it back as an obvious
     * symmetry. Resetting wipes every authenticator the user has enrolled; done
     * across a selection it has no undo and no partial recovery, and a
     * mis-click on a two-hundred-row selection locks out an entire company at
     * once. The reset lives per-user on Pages/Users/View/Authentication.tsx,
     * where the operator is looking at the one person who lost their phone.
     */
    expect(usersPageSource).not.toContain("reset-two-factor-auth");
    expect(usersPageSource).not.toContain("resetTwoFactorAuth");
    expect(bulkActionsBlock).not.toMatch(/[Rr]eset/);
  });
});

describe("Bulk two factor auth translations", () => {
  test("every string on screen comes from the locale files", () => {
    /*
     * The title, the confirm heading and the confirm body, in both directions -
     * six keys. A hard-coded English string here is invisible to
     * `npm run i18n:validate` and renders as English inside an otherwise
     * translated menu for the other fifteen locales.
     */
    expect(twoFactorTranslationKeys()).toEqual([
      "pages.users.bulkDoNotRequireTwoFactorAuth",
      "pages.users.bulkDoNotRequireTwoFactorAuthDescription",
      "pages.users.bulkDoNotRequireTwoFactorAuthTitle",
      "pages.users.bulkRequireTwoFactorAuth",
      "pages.users.bulkRequireTwoFactorAuthDescription",
      "pages.users.bulkRequireTwoFactorAuthTitle",
    ]);

    /*
     * And they are wired to the three props that render, rather than sitting in
     * the file unused: each of `title`, `confirmTitle` and `confirmMessage`
     * resolves through `t(` on both branches of `isRequired`.
     */
    expect(actionBlock).toMatch(
      /title:\s*isRequired\s*\?\s*t\("pages\.users\.bulkRequireTwoFactorAuth"\)\s*:\s*t\("pages\.users\.bulkDoNotRequireTwoFactorAuth"\)/,
    );
    expect(countOccurrences(actionBlock, 't("pages.users.bulk')).toBe(6);
  });

  test("the confirm strings interpolate userCount, never count", () => {
    /*
     * i18next reads a `count` option as a request for plural key lookup and
     * goes looking for `..._one` / `..._other` siblings. This locale set spells
     * plurals out inside single strings - "{{userCount}} User(s)" - and defines
     * no such siblings, so renaming the option to `count` would resolve to the
     * raw key and put `pages.users.bulkRequireTwoFactorAuthTitle` on screen as
     * the heading of a confirmation to sign two hundred people out.
     */
    expect(actionBlock).not.toMatch(/\{\s*count:/);
    expect(countOccurrences(actionBlock, "userCount: items.length")).toBe(4);

    /* Nor does any translation spell it, which would trigger the same lookup. */
    const usingCount: Array<string> = [];

    for (const fileName of localeFileNames) {
      const locale: Record<string, unknown> = readLocale(fileName);

      for (const key of twoFactorTranslationKeys()) {
        const value: unknown = lookUpKeyInLocale(locale, key);

        if (typeof value === "string" && COUNT_PLACEHOLDER.test(value)) {
          usingCount.push(`${fileName}: ${key}`);
        }
      }
    }

    expect(usingCount).toEqual([]);
  });

  test("en.json keeps {{userCount}} in every interpolated string", () => {
    /*
     * The counterpart to the assertion above: the option is passed, so the
     * placeholder has to be there to receive it. A translation edited down to
     * "Require Two Factor Auth for the selected users" drops the one figure
     * that tells the admin the selection is the one they meant - and drops it
     * silently, because i18next simply renders the sentence without it.
     */
    const withoutPlaceholder: Array<string> = interpolatedTranslationKeys()
      .filter((key: string) => {
        const value: unknown = lookUpLocaleKey(key);

        return typeof value !== "string" || !value.includes("{{userCount}}");
      })
      .sort();

    expect(withoutPlaceholder).toEqual([]);
  });

  test("all six keys are translated in all sixteen locales", () => {
    /*
     * i18next's fallbackLng is "en", so a locale file missing one of these
     * renders an English menu item or an English confirmation inside an
     * otherwise translated dashboard, and reports nothing anywhere. A key
     * present but blank is worse: an unlabelled menu item, or a confirmation
     * with no body text at all.
     */
    const violations: Array<string> = [];

    for (const fileName of localeFileNames) {
      const locale: Record<string, unknown> = readLocale(fileName);

      for (const key of twoFactorTranslationKeys()) {
        const value: unknown = lookUpKeyInLocale(locale, key);

        if (typeof value !== "string") {
          violations.push(`${fileName}: ${key} is missing`);
          continue;
        }

        if (value.trim().length === 0) {
          violations.push(`${fileName}: ${key} is blank`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test("every locale interpolates exactly what en.json interpolates", () => {
    /*
     * The stricter version of the {{userCount}} check, and the one that catches
     * the other direction: a translator who introduces a placeholder en.json
     * does not have - {{count}}, {{name}}, a typo like {{usercount}} - gets a
     * literal `{{usercount}}` rendered into the confirmation, because i18next
     * leaves an unmatched interpolation in place rather than erroring.
     *
     * Compared as sets so a language whose word order puts the number first is
     * not treated as a violation.
     */
    const violations: Array<string> = [];

    for (const key of twoFactorTranslationKeys()) {
      const englishValue: unknown = lookUpLocaleKey(key);

      if (typeof englishValue !== "string") {
        violations.push(`en.json: ${key} is missing`);
        continue;
      }

      const expectedPlaceholders: Array<string> = placeholdersIn(englishValue);

      for (const fileName of localeFileNames) {
        const locale: Record<string, unknown> = readLocale(fileName);
        const value: unknown = lookUpKeyInLocale(locale, key);

        if (typeof value !== "string") {
          continue;
        }

        const actualPlaceholders: Array<string> = placeholdersIn(value);

        if (actualPlaceholders.join(",") !== expectedPlaceholders.join(",")) {
          violations.push(
            `${fileName}: ${key} interpolates [${actualPlaceholders.join(
              ", ",
            )}] but en.json interpolates [${expectedPlaceholders.join(", ")}]`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
