import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Status Page subscriber screens reuse Common's ModelForm and resource
 * helpers. Their default ModelAPI belongs to the authenticated dashboard: a
 * 401/405 invokes the dashboard logout routine, which clears all browser
 * storage. On a public Status Page that erases `statusPageId`, so the next
 * render replaces the subscribe form with "Status Page ID is required".
 *
 * These tests cover every hand-written Status Page call site. That is useful
 * in addition to the ModelAPI unit tests because a future subscriber channel
 * can compile while silently omitting the page-scoped adapter prop.
 *
 * The per-page lists below are pinned on purpose and enforced complete by
 * the inventory tests: a new page that renders a ModelForm or fetches
 * selectable resources fails the inventory until it is added here — which
 * is what opts it into every boundary assertion in this file.
 */

const STATUS_PAGE_SRC: string = path.join(
  __dirname,
  "../../FeatureSet/StatusPage/src",
);

const SUBSCRIBE_PAGES: ReadonlyArray<string> = [
  "Pages/Subscribe/EmailSubscribe.tsx",
  "Pages/Subscribe/SmsSubscribe.tsx",
  "Pages/Subscribe/SlackSubscribe.tsx",
  "Pages/Subscribe/MicrosoftTeamsSubscribe.tsx",
  "Pages/Subscribe/WebhookSubscribe.tsx",
  "Pages/Subscribe/UpdateSubscription.tsx",
];

const ACCOUNT_FORM_PAGES: ReadonlyArray<string> = [
  "Pages/Accounts/Login.tsx",
  "Pages/Accounts/ForgotPassword.tsx",
  "Pages/Accounts/ResetPassword.tsx",
];

/**
 * The one module allowed to import the dashboard-scoped ModelAPI: the
 * adapter that rebinds it to the Status Page client and headers.
 */
const MODEL_API_ADAPTER: string = "Utils/ModelAPI.ts";

const SOURCE_FILE_PATTERN: RegExp = /\.tsx?$/;
const MODEL_FORM_PATTERN: RegExp = /<ModelForm/;
const DASHBOARD_MODEL_API_IMPORT_PATTERN: RegExp =
  /from\s+"Common\/UI\/Utils\/ModelAPI\/ModelAPI"/;

function readSource(relativePath: string): string {
  return fs
    .readFileSync(path.join(STATUS_PAGE_SRC, relativePath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function occurrences(source: string, expression: RegExp): number {
  return source.match(expression)?.length || 0;
}

/** Every .ts / .tsx source file under StatusPage/src, relative to it. */
function listSourceFiles(relativeDir: string = ""): Array<string> {
  const absoluteDir: string = path.join(STATUS_PAGE_SRC, relativeDir);
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    const relativePath: string = relativeDir
      ? `${relativeDir}/${entry.name}`
      : entry.name;

    if (entry.isDirectory()) {
      files.push(...listSourceFiles(relativePath));
    } else if (SOURCE_FILE_PATTERN.test(entry.name)) {
      files.push(relativePath);
    }
  }

  return files.sort();
}

describe("Status Page model requests stay in the Status Page auth boundary", () => {
  /*
   * Inventory: discover every call site from the source tree and require the
   * pinned lists above to match exactly. This is what keeps the per-page
   * assertions below meaningful over time — a new subscriber channel (or a
   * moved page) fails here first, with instructions, instead of silently
   * shipping unasserted.
   */
  test("every page that renders a ModelForm is in the pinned inventory", () => {
    const discovered: Array<string> = listSourceFiles("Pages").filter(
      (relativePath: string): boolean => {
        return MODEL_FORM_PATTERN.test(readSource(relativePath));
      },
    );

    expect(discovered).toEqual(
      [...SUBSCRIBE_PAGES, ...ACCOUNT_FORM_PAGES].slice().sort(),
    );
  });

  test("every page that fetches selectable resources is in the pinned inventory", () => {
    const discovered: Array<string> = listSourceFiles("Pages").filter(
      (relativePath: string): boolean => {
        return readSource(relativePath).includes(
          "getCategoryCheckboxPropsBasedOnResources",
        );
      },
    );

    expect(discovered).toEqual(SUBSCRIBE_PAGES.slice().sort());
  });

  /*
   * The boundary itself: nothing under StatusPage/src may import the
   * dashboard ModelAPI except the adapter that wraps it. Any other import is
   * a compile-clean path to the dashboard logout routine wiping the page's
   * browser storage on the first 401.
   */
  test("only the adapter imports the dashboard-scoped ModelAPI", () => {
    const offenders: Array<string> = listSourceFiles().filter(
      (relativePath: string): boolean => {
        if (relativePath === MODEL_API_ADAPTER) {
          return false;
        }

        return DASHBOARD_MODEL_API_IMPORT_PATTERN.test(
          readSource(relativePath),
        );
      },
    );

    expect(offenders).toEqual([]);
  });

  test.each([...SUBSCRIBE_PAGES, ...ACCOUNT_FORM_PAGES])(
    "%s gives every ModelForm the page-scoped ModelAPI",
    (relativePath: string) => {
      const source: string = readSource(relativePath);
      const forms: number = occurrences(source, /<ModelForm(?:<[^>]+>)?/g);

      expect(forms).toBeGreaterThan(0);
      expect(occurrences(source, /modelAPI=\{StatusPageModelAPI\}/g)).toBe(
        forms,
      );
      expect(source).toContain(
        'import StatusPageModelAPI from "../../Utils/ModelAPI"',
      );
    },
  );

  test.each(SUBSCRIBE_PAGES)(
    "%s loads selectable resources through the page-scoped ModelAPI",
    (relativePath: string) => {
      const source: string = readSource(relativePath).replace(/\s+/g, " ");

      expect(source).toMatch(
        /getCategoryCheckboxPropsBasedOnResources\([\s\S]*?StatusPageModelAPI,?\s*\)/,
      );
    },
  );

  test.each(SUBSCRIBE_PAGES)(
    "%s does not request resources when resource selection is disabled",
    (relativePath: string) => {
      const source: string = readSource(relativePath).replace(/\s+/g, " ");

      /*
       * The guard may reset UI state (e.g. setIsLoading) before bailing, but
       * it must END in an early return and must never start a resource fetch
       * itself.
       */
      const guard: RegExpMatchArray | null = source.match(
        /if \(!props\.allowSubscribersToChooseResources\) \{([^}]*)\}/,
      );

      expect(guard).not.toBeNull();
      expect(guard![1]!.trim().endsWith("return;")).toBe(true);
      expect(guard![1]).not.toContain("fetch");
      expect(guard![1]).not.toContain("getCategoryCheckbox");

      /*
       * And it must be the FIRST statement of the effect that triggers the
       * fetch — nothing may run before it — with the effect keyed to the
       * prop so toggling resource selection re-evaluates the guard.
       */
      expect(source).toContain(
        "useEffect(() => { if (!props.allowSubscribersToChooseResources) {",
      );
      expect(source).toContain("[props.allowSubscribersToChooseResources]");
    },
  );

  test("the adapter supplies Status Page headers and the Status Page client", () => {
    const source: string = readSource("Utils/ModelAPI.ts");

    expect(source).toContain("extends ModelAPI");
    expect(source).toContain("return API;");
    expect(source).toContain("...API.getDefaultHeaders()");
    expect(source).toContain("...(requestOptions?.requestHeaders || {})");
  });
});
