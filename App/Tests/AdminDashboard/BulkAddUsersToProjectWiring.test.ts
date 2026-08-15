import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";

/*
 * The Users table's "Add to Project" bulk action is four hand-written files
 * that agree with each other only by convention: a pure loop that builds the
 * memberships, a modal that collects a project and a team, the project-scoped
 * team picker that modal renders, and the page that registers the action and
 * wires the modal to the table's bulk progress modal. Nothing at runtime ties
 * them together, and each of the invariants below fails silently rather than
 * loudly:
 *
 *  - a `t("pages.users.bulkAddToProjectX")` whose key is missing from en.json
 *    renders the raw key as the modal's title, its step names or its button
 *    label;
 *  - a key present in en.json but missing from one of the other fifteen locale
 *    files falls back to English, so a French admin gets an English modal and
 *    no error anywhere;
 *  - dropping `teamMember.projectId` produces a request a master admin's own
 *    session cannot repair, because a master admin sends no tenant header, so
 *    every create 400s and the failure looks like a server problem;
 *  - calling `onBulkActionStart` from the action's onClick puts an empty
 *    progress modal on screen behind the picker before anything is created;
 *  - letting `addSelectedUsersToProject` return without reaching
 *    `onBulkActionEnd` leaves the progress modal's Close button disabled with
 *    no way out but a page reload;
 *  - and leaving a stale team id in the picker's form value after the admin
 *    switches project writes a membership whose team belongs to a different
 *    project than its projectId, which no server-side check rejects.
 *
 * Source text rather than imports: these files render React and pull in
 * Common/UI, and the wirings they hold are invariants no runtime value
 * exposes. `npm run i18n:validate` proves the 16 locale files agree with each
 * other; nothing else proves they contain what these files ask for.
 *
 * Same helper shape as App/Tests/AdminDashboard/UserProjectsPageWiring.test.ts
 * - these helpers are copy-pasted per file in this repo by convention.
 */

const ADMIN_DASHBOARD_SRC: string = nodePath.join(
  __dirname,
  "../../FeatureSet/AdminDashboard/src",
);

/*
 * Comments are stripped first so a file that explains a pattern in prose
 * cannot satisfy an assertion about the code. That matters more here than
 * usual: BulkAddUsersToProject.ts carries a comment that names `projectId` and
 * the tenant header, and the page carries one that names `onBulkActionStart`,
 * which are the two things asserted on below.
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
const bulkAddModalSource: string = readSource(
  "Components/User/BulkAddUsersToProjectModal.tsx",
);
const bulkAddSource: string = readSource(
  "Components/User/BulkAddUsersToProject.ts",
);

/*
 * The picker the modal's team step renders. Read here because the same
 * component also backs the single-user "Add to Project" form and the Global
 * SSO / OIDC attach forms, so the stale-selection guard asserted on below is a
 * four-call-site invariant rather than a detail of this modal.
 */
const teamsPickerSource: string = readSource(
  "Components/GlobalProvider/ProjectScopedTeamsPicker.tsx",
);

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

function lookUpLocaleKey(key: string): unknown {
  let node: unknown = englishLocale;

  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) {
      return undefined;
    }

    node = (node as Record<string, unknown>)[part];
  }

  return node;
}

/* The same walk, against a locale file other than en.json. */
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

/*
 * Every `t("...")` the flow asks for. Both files are read, because the action's
 * label lives on the page and everything the modal renders lives in the modal -
 * a key missing from either one shows up as a raw key on screen.
 */
function translationKeysUsedByFlow(): Array<string> {
  const keys: Set<string> = new Set<string>();
  const pattern: RegExp = /\bt\(\s*"([^"]+)"/g;
  const source: string = `${usersPageSource}\n${bulkAddModalSource}`;

  let match: RegExpExecArray | null = pattern.exec(source);

  while (match) {
    keys.add(match[1]!);
    match = pattern.exec(source);
  }

  return [...keys];
}

const BULK_ADD_KEY_PREFIX: string = "pages.users.bulkAddToProject";

/* i18next's plural-lookup trigger, which the description must not spell. */
const COUNT_PLACEHOLDER: RegExp = /\{\{\s*count\s*\}\}/;

function bulkAddTranslationKeys(): Array<string> {
  return translationKeysUsedByFlow().filter((key: string) => {
    return key.startsWith(BULK_ADD_KEY_PREFIX);
  });
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
 * one function or one JSX prop, so that "the add-to-project action does not
 * call onBulkActionStart" cannot be satisfied by the three sibling actions on
 * the same page that all legitimately do call it.
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
 * The body of the arrow function that follows `marker`. `blockAfter` cannot be
 * used where the callback's parameter carries an inline object type -
 * `.then((result: { data: Array<Team> }) => {` - because the first brace after
 * the marker there opens the annotation, not the handler, and the assertion
 * would end up bounded to `{ data: Array<Team> }`.
 */
function arrowBodyAfter(source: string, marker: string): string {
  const markerIndex: number = source.indexOf(marker);

  if (markerIndex === -1) {
    throw new Error(`Marker not found in source: ${marker}`);
  }

  const arrowIndex: number = source.indexOf("=> {", markerIndex);

  if (arrowIndex === -1) {
    throw new Error(`No arrow function body follows marker: ${marker}`);
  }

  return balancedBlockAt(source, arrowIndex + "=> ".length, marker);
}

/*
 * Used where "the call happens here" is only half the guarantee and "the call
 * happens nowhere else in this body" is the other half.
 */
function countOccurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

describe("Bulk add users to project translations", () => {
  test("the flow asks for translations at all", () => {
    /*
     * A guard on the extraction below: a regex that matched nothing would make
     * every assertion in this block vacuously pass.
     *
     * The named keys guard the other half of that: `translationKeysUsedByFlow`
     * concatenates two files, so a wrong path or a renamed component that left
     * one of them empty would still clear the count on the strength of the
     * other file alone. One key from each file is spelled out.
     */
    const keys: Array<string> = translationKeysUsedByFlow();

    expect(keys.length).toBeGreaterThan(10);
    expect(keys).toContain("pages.users.bulkAddToProject");
    expect(keys).toContain("pages.users.bulkAddToProjectTitle");
  });

  test("every key the page and the modal ask for exists in en.json", () => {
    const missing: Array<string> = translationKeysUsedByFlow().filter(
      (key: string) => {
        return typeof lookUpLocaleKey(key) !== "string";
      },
    );

    expect(missing).toEqual([]);
  });

  test("no key the page and the modal ask for is blank in en.json", () => {
    /*
     * An empty string is a string, so the assertion above passes for a key that
     * was added to en.json and never filled in - which renders as a modal with
     * no title and an unlabelled submit button.
     */
    const blank: Array<string> = translationKeysUsedByFlow().filter(
      (key: string) => {
        return String(lookUpLocaleKey(key)).trim().length === 0;
      },
    );

    expect(blank).toEqual([]);
  });

  test("this flow contributes its own keys, not just the page's existing ones", () => {
    /* Guard on the prefix filter the next two tests narrow with. */
    expect(bulkAddTranslationKeys().length).toBeGreaterThan(10);
  });

  test("all sixteen locale files are being looked at", () => {
    /*
     * The loops below prove nothing if the directory read comes back short.
     * i18next's fallbackLng is "en", so a locale file that simply lacks these
     * keys renders an English modal with no error to notice.
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

  test("every bulk-add key is translated in every locale", () => {
    const keys: Array<string> = bulkAddTranslationKeys();
    const missing: Array<string> = [];

    for (const fileName of localeFileNames) {
      const locale: Record<string, unknown> = readLocale(fileName);

      for (const key of keys) {
        const value: unknown = lookUpKeyInLocale(locale, key);

        if (typeof value !== "string" || value.trim().length === 0) {
          missing.push(`${fileName}: ${key}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  test("every key either file asks for is translated in every locale", () => {
    /*
     * The test above is filtered to the `bulkAddToProject` prefix, so the rest
     * of what this flow renders - the page title, the two breadcrumbs, the card
     * heading and the empty-table message - is only ever checked against
     * en.json. Those are on screen behind the picker for the same admin, and
     * i18next's fallbackLng is "en", so a locale missing one of them shows a
     * half-translated page and reports nothing.
     *
     * A superset of the prefixed test rather than a replacement for it: this
     * one goes stale the moment a key is renamed out of the prefix, and the
     * prefixed test is what keeps the flow's own keys pinned by name.
     */
    const keys: Array<string> = translationKeysUsedByFlow();
    const missing: Array<string> = [];

    for (const fileName of localeFileNames) {
      const locale: Record<string, unknown> = readLocale(fileName);

      for (const key of keys) {
        const value: unknown = lookUpKeyInLocale(locale, key);

        if (typeof value !== "string" || value.trim().length === 0) {
          missing.push(`${fileName}: ${key}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  test("the description keeps its user count in every locale", () => {
    /*
     * The selected-user count is interpolated into the modal's description. A
     * translation that drops {{userCount}} tells the admin they are about to
     * add "selected user(s)" with no number - the one figure that tells them
     * the selection is the one they meant.
     */
    const withoutPlaceholder: Array<string> = [];

    for (const fileName of localeFileNames) {
      const locale: Record<string, unknown> = readLocale(fileName);
      const description: unknown = lookUpKeyInLocale(
        locale,
        `${BULK_ADD_KEY_PREFIX}Description`,
      );

      if (
        typeof description !== "string" ||
        !description.includes("{{userCount}}")
      ) {
        withoutPlaceholder.push(fileName);
      }
    }

    expect(withoutPlaceholder).toEqual([]);
  });

  test("the description interpolates userCount rather than count", () => {
    /*
     * i18next reads a `count` option as a request for plural key lookup and
     * goes looking for `..._one` / `..._other` siblings. This locale set spells
     * plurals out as separate keys and defines no such siblings, so a
     * translation renamed to {{count}} would resolve to the raw key rather than
     * to the sentence.
     */
    const usingCount: Array<string> = [];

    for (const fileName of localeFileNames) {
      const locale: Record<string, unknown> = readLocale(fileName);
      const description: unknown = lookUpKeyInLocale(
        locale,
        `${BULK_ADD_KEY_PREFIX}Description`,
      );

      if (
        typeof description === "string" &&
        COUNT_PLACEHOLDER.test(description)
      ) {
        usingCount.push(fileName);
      }
    }

    expect(usingCount).toEqual([]);

    /* And the caller passes the option under the same name. */
    expect(bulkAddModalSource).toContain("userCount: props.users.length");
    expect(bulkAddModalSource).not.toMatch(/\bcount:\s*props\.users\.length/);
  });
});

describe("Bulk add users to project memberships", () => {
  test("every membership names the project it belongs to", () => {
    /*
     * A master admin sends no tenant header, so nothing on the way to the
     * server can fill the project column in. Dropping this one line is
     * invisible in review and turns every create into a 400 that reads like a
     * server fault rather than a missing assignment.
     */
    expect(bulkAddSource).toMatch(
      /teamMember\.projectId\s*=\s*options\.projectId\s*;/,
    );
  });

  test("every membership names its user and its team", () => {
    /*
     * The other two columns that have no default. Without userId the create is
     * rejected; without teamId every selected user would land on whatever team
     * the server picked, which is none.
     */
    expect(bulkAddSource).toMatch(/teamMember\.userId\s*=\s*user\.id\s*;/);
    expect(bulkAddSource).toMatch(
      /teamMember\.teamId\s*=\s*options\.teamId\s*;/,
    );
  });

  test("the memberships are actually written, through the admin ModelAPI", () => {
    /*
     * Every unit test of this loop injects `createTeamMember`, so the writer
     * the admin dashboard actually runs is the only part of the file no test
     * executes. It is also the part that carries the two facts the server
     * needs: `AdminModelAPI` (the admin-scoped client, which is what sends the
     * master-admin credentials instead of a project tenant header) and
     * `modelType: TeamMember` (which picks the route the request is posted to -
     * a wrong model type here is a 404 or, worse, a create against the wrong
     * table, and TypeScript would still be happy if `model` were widened).
     */
    const defaultWriter: string = blockAfter(
      bulkAddSource,
      "const createTeamMemberWithModelAPI",
    );

    expect(defaultWriter).toContain("AdminModelAPI.create<TeamMember>(");
    expect(defaultWriter).toContain("modelType: TeamMember");
    expect(defaultWriter).toContain("model: teamMember");

    /*
     * The body in one match, so the three assertions above cannot be satisfied
     * by a create that never runs or whose rejection never surfaces: the writer
     * is the whole of this function, it is awaited, and it is not wrapped in a
     * condition. Dropping the `await` is the quiet one - the loop's try/catch
     * would see a resolved promise and report every user as added while the
     * creates rejected behind it.
     */
    expect(defaultWriter).toMatch(
      /^\{\s*await AdminModelAPI\.create<TeamMember>\(\{\s*model: teamMember,\s*modelType: TeamMember,\s*\}\);\s*\}$/,
    );

    /*
     * And that this writer is the default rather than dead code: without the
     * fallback, an omitted `createTeamMember` option would make the loop report
     * every user as succeeded while creating nothing at all.
     */
    expect(bulkAddSource).toMatch(
      /options\.createTeamMember\s*\|\|\s*createTeamMemberWithModelAPI/,
    );
  });
});

describe("Bulk add users to project team picker", () => {
  test("a selection that is not a team of this project is dropped", () => {
    /*
     * Switching project in the modal's first step leaves the previous project's
     * team id in the form's `team` value. The dropdown stops showing it - it
     * renders `options.filter(...)` against the newly fetched teams - so the
     * box looks empty, while required-field validation reads the form value and
     * passes. Nothing downstream catches it: TeamMemberService checks that the
     * team exists and that the user is not already on it, never that the team
     * belongs to the project being written. The result is a membership whose
     * teamId is in a different project than its projectId, created here for
     * every user in the selection at once.
     *
     * This picker also backs the single-user "Add to Project" form and the
     * Global SSO and OIDC attach forms, so losing this guard is a four
     * call-site bug, not one.
     */
    const successHandler: string = arrowBodyAfter(teamsPickerSource, ".then(");

    /* The allowed set is the fetch's own result, not some cached list. */
    expect(successHandler).toMatch(/new Set<string>\(\s*fetchedOptions\.map\(/);

    /* The current selection is filtered against it... */
    expect(successHandler).toMatch(/props\.selectedTeamIds\.filter\(/);
    expect(successHandler).toMatch(/availableTeamIds\.has\(teamId\)/);

    /* ...and the survivors are pushed back into the form value. */
    expect(successHandler).toMatch(/props\.onChange\(stillSelectableTeamIds\)/);

    /*
     * Reported only when something was actually dropped. Calling `onChange`
     * after every fetch would rewrite the form value on each project load,
     * which marks a form the admin has not touched as dirty.
     */
    expect(successHandler).toMatch(
      /stillSelectableTeamIds\.length\s*!==\s*props\.selectedTeamIds\.length/,
    );

    /*
     * The whole statement in one match, because each assertion above is
     * satisfied by text that never runs. `if (false && stillSelectableTeamIds
     * .length !== props.selectedTeamIds.length)` still contains the comparison
     * and still contains the `onChange` call, and disables the guard
     * completely - as would `===`, or an extra `&& isMultiSelect`. Pinning the
     * condition as nothing but the length comparison is what makes "a stale
     * selection is dropped" an assertion about behaviour rather than about
     * which identifiers appear in the file.
     */
    expect(successHandler).toMatch(
      /\bif \(\s*stillSelectableTeamIds\.length\s*!==\s*props\.selectedTeamIds\.length\s*\)\s*\{\s*props\.onChange\(stillSelectableTeamIds\);\s*\}/,
    );

    /*
     * And nothing bails out of the handler before it gets there. A bare
     * `return;` after `setOptions` leaves the dropdown correctly repopulated
     * and the stale id still in the form value, which is exactly the bug -
     * visible nowhere, submits fine.
     */
    const setOptionsToClearing: string = successHandler.slice(
      successHandler.indexOf("setOptions(fetchedOptions)"),
      successHandler.indexOf("props.onChange("),
    );

    expect(setOptionsToClearing.length).toBeGreaterThan(0);
    expect(setOptionsToClearing).not.toMatch(/\breturn\s*;/);
  });

  test("nothing is dropped while the teams are still unknown", () => {
    /*
     * The counterpart to the test above, and the reason the clearing sits in
     * `.then` rather than at the top of the effect or in `.finally`: until the
     * fetch succeeds the picker has no idea which teams the project has, so
     * every selected id looks unavailable. Clearing there would wipe a valid
     * selection whenever the request failed, was slow, or was still in flight -
     * and on a failed fetch the admin sees the error message with no way to
     * tell that their pick went with it.
     */
    const errorHandler: string = arrowBodyAfter(teamsPickerSource, ".catch(");
    const settledHandler: string = arrowBodyAfter(
      teamsPickerSource,
      ".finally(",
    );

    expect(errorHandler).not.toContain("props.onChange");
    expect(settledHandler).not.toContain("props.onChange");

    /*
     * Nor before the request goes out - the effect's early return for "no
     * project chosen yet" runs on the first render of the modal's team step,
     * before any project has been picked at all.
     */
    const effectBody: string = arrowBodyAfter(teamsPickerSource, "useEffect(");
    const beforeFetch: string = effectBody.slice(
      0,
      effectBody.indexOf("AdminModelAPI.getList"),
    );

    expect(beforeFetch.length).toBeGreaterThan(0);
    expect(beforeFetch).not.toContain("props.onChange");

    /*
     * Which leaves exactly one `props.onChange` in the whole fetch effect: the
     * success handler's. The other one in this file is the Dropdown's own
     * onChange prop, which is the admin typing, not the picker clearing.
     */
    expect(countOccurrences(effectBody, "props.onChange(")).toBe(1);
  });
});

describe("Bulk add users to project action registration", () => {
  test("the action is offered alongside the other bulk actions", () => {
    /*
     * The action is only reachable from the table's Bulk Actions menu. Writing
     * the whole flow and never listing the button leaves it dead code, and
     * every other test in this file still passes.
     */
    const bulkActions: string = blockAfter(usersPageSource, "bulkActions=");

    expect(bulkActions).toContain("getBulkAddToProjectAction()");
    expect(bulkActions).toContain("getBulkSetBlockedAction(true)");
    expect(bulkActions).toContain("getBulkSetBlockedAction(false)");
    expect(bulkActions).toContain("getBulkDeleteAction()");
  });

  test("the action's onClick only captures the click, and starts nothing", () => {
    /*
     * Nothing is created until the picker is submitted, so the click must not
     * open the shared bulk progress modal: `onBulkActionStart` here would put
     * an empty progress modal on screen behind the picker, and - because the
     * run has not started - nothing would call `onBulkActionEnd` if the admin
     * then cancelled, leaving a modal whose Close button stays disabled
     * forever.
     *
     * Bounded to this action's own body, because the three sibling actions on
     * the same page all call `onBulkActionStart` correctly.
     */
    const onClick: string = blockAfter(
      usersPageSource,
      "const getBulkAddToProjectAction",
    );

    expect(onClick).toContain("setAddToProjectProps(onClickProps)");
    expect(onClick).not.toContain("onBulkActionStart");
    expect(onClick).not.toContain("onBulkActionEnd");
    expect(onClick).not.toContain("onProgressInfo");
  });

  test("the page still starts and ends the run once the picker is submitted", () => {
    /*
     * Guards the assertion above against a rename: if `onBulkActionStart` were
     * spelled some other way, "the onClick does not contain it" would pass for
     * the wrong reason. The run itself is where both callbacks belong, and the
     * table only clears the selection and refetches when the progress modal is
     * closed, which stays disabled until `onBulkActionEnd` is reached.
     */
    const runBody: string = blockAfter(
      usersPageSource,
      "const addSelectedUsersToProject",
    );

    expect(runBody).toContain("onBulkActionStart()");
    expect(runBody).toContain("onBulkActionEnd()");
    expect(runBody).toContain("bulkAddUsersToProject(");
  });

  test("a run that breaks outright still ends the bulk action", () => {
    /*
     * bulkAddUsersToProject turns a per-user failure into a row in the progress
     * modal, so a rejected promise means the run itself broke. If that path
     * skips `onBulkActionEnd` the progress modal's Close button stays disabled,
     * the selection is never cleared and the table never refetches - the
     * admin's only way out is a page reload.
     *
     * `finally`, not a call at the end of the happy path and a second one in
     * the catch: the two-call shape ends the action twice as soon as someone
     * adds an early `return`, and misses it entirely on any path neither of
     * them covers. So the assertion is that exactly one `onBulkActionEnd()`
     * exists in this function and that it sits in the `finally`, which is what
     * makes "every exit from this function ends the action" true by
     * construction rather than by inspection.
     *
     * Bounded to the run's own body. The page has three sibling bulk actions
     * that each call `onBulkActionEnd` at the end of their own handler, so an
     * unbounded search would pass on their calls no matter what this one does.
     */
    const runBody: string = blockAfter(
      usersPageSource,
      "const addSelectedUsersToProject",
    );

    const finallyBlock: string = blockAfter(runBody, "} finally");

    expect(finallyBlock).toContain("onBulkActionEnd()");
    expect(countOccurrences(runBody, "onBulkActionEnd()")).toBe(1);

    /*
     * The finally block is that call and nothing else. A condition around it -
     * even one that reads as always true - puts the progress modal back in the
     * state this `finally` exists to prevent, and would satisfy both assertions
     * above.
     */
    expect(finallyBlock).toMatch(/^\{\s*onBulkActionEnd\(\);\s*\}$/);

    /*
     * And the thing that can throw is inside the guarded region: a `finally`
     * that only wraps the bookkeeping would satisfy the assertions above while
     * a rejected bulkAddUsersToProject still escaped it.
     */
    const tryBlock: string = blockAfter(runBody, "try {");

    expect(tryBlock).toContain("bulkAddUsersToProject(");
    expect(runBody.indexOf("bulkAddUsersToProject(")).toBeLessThan(
      runBody.indexOf("} finally"),
    );
  });

  test("a mid-run break reports only the users it never attempted", () => {
    /*
     * The recovery path had a choice: report the whole selection as failed, or
     * keep what the progress callback last said and fail only the remainder.
     * Reporting the whole selection tells an admin that nothing was added when
     * some users were - so they re-run the action, and the users already added
     * come back as "already invited" failures the admin did not cause.
     *
     * Pinned as: the recovery report reuses the last progress' succeeded list
     * and turns its not-yet-attempted list into the new failures, rather than
     * naming `items` (the full selection) anywhere in the catch.
     */
    const runBody: string = blockAfter(
      usersPageSource,
      "const addSelectedUsersToProject",
    );

    const catchBlock: string = blockAfter(runBody, "} catch (err)");

    expect(catchBlock).toContain("succeededUsers: lastProgress.succeededUsers");
    expect(catchBlock).toContain("lastProgress.inProgressUsers.map(");
    expect(catchBlock).toContain("...lastProgress.failedUsers,");
    expect(catchBlock).toContain("inProgressUsers: []");
    expect(catchBlock).not.toMatch(/\bsucceededUsers:\s*\[\]/);
    expect(catchBlock).not.toMatch(/:\s*items\b/);
  });

  test("the call site cannot raise an unhandled rejection", () => {
    /*
     * The run ends the action in its own `finally`, so this `.catch` is not
     * where the recovery lives - it exists because `addSelectedUsersToProject`
     * is called for its effects and never awaited. An async function called
     * without a handler turns a throw from `onBulkActionStart` itself into an
     * unhandled rejection, which in the admin dashboard is a blank error
     * overlay rather than a logged warning.
     *
     * Bounded to the modal's onSubmit prop so a `.catch` anywhere else on this
     * page cannot stand in for it.
     */
    const onSubmit: string = blockAfter(
      usersPageSource,
      "onSubmit={(selection",
    );

    expect(onSubmit).toMatch(/addSelectedUsersToProject\([^)]*\)\s*\.catch\(/);
  });

  test("the picker is closed before the memberships are created", () => {
    /*
     * Otherwise the shared bulk progress modal opens stacked behind the picker
     * and the admin watches a modal they cannot see.
     */
    const onSubmit: string = blockAfter(
      usersPageSource,
      "onSubmit={(selection",
    );

    expect(onSubmit.indexOf("setAddToProjectProps(null)")).toBeGreaterThan(-1);
    expect(onSubmit.indexOf("setAddToProjectProps(null)")).toBeLessThan(
      onSubmit.indexOf("addSelectedUsersToProject("),
    );
  });
});
