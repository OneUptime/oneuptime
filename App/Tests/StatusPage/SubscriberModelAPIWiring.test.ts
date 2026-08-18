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

function readSource(relativePath: string): string {
  return fs
    .readFileSync(path.join(STATUS_PAGE_SRC, relativePath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function occurrences(source: string, expression: RegExp): number {
  return source.match(expression)?.length || 0;
}

describe("Status Page model requests stay in the Status Page auth boundary", () => {
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
       * it must end in an early return and must never start a resource fetch.
       */
      const guard: RegExpMatchArray | null = source.match(
        /if \(!props\.allowSubscribersToChooseResources\) \{([^}]*)\}/,
      );

      expect(guard).not.toBeNull();
      expect(guard![1]).toContain("return;");
      expect(guard![1]).not.toContain("fetch");
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
