import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { htmlAsText, visibleText } from "Common/Tests/Helpers/HtmlText";
import {
  REPOSITORY_DIRECTORY,
  TAG_STRIP_FIX,
  TagStrip,
  findTagStrips,
  isTestCode,
  listTestFiles,
  reportTagStrips,
} from "Common/Tests/Helpers/TagStripScan";
import { removeHtmlMarkup } from "Common/Types/HtmlMarkup";

/*
 * ee/'s tests read markup through the shared walk too.
 *
 * packages/Common/Tests/Helpers/TestTagStripGuard.test.ts fails any test
 * file that takes markup out of a text with a pattern of its own - a copy of
 * `.replace(/<[^>]+>/g, "")`, which code scanning reports as incomplete
 * multi-character sanitization (js/incomplete-multi-character-sanitization)
 * - instead of reading it through removeHtmlMarkup (Common/Types/HtmlMarkup)
 * or a reading of Common/Tests/Helpers/HtmlText. It walks every test file of
 * the checkout, but the Common Test job removes ee/ before it runs (core
 * passes without the Enterprise Edition), so in CI it never reads one of
 * ee/'s. This suite runs the same detector (Common/Tests/Helpers/
 * TagStripScan) over ee/'s test files, from ee's own jest run: the
 * Enterprise Edition Test job, the only one with ee/ checked out.
 *
 * ee/'s test files are what the walk of the whole checkout reads under ee/:
 * every file of code under ee/Tests - the server and UI suites, their
 * helpers and fixtures - and any *.test.* or *.spec.* file elsewhere in ee/,
 * outside node_modules, builds and hidden folders. Nothing is excused.
 */

const EE_DIR: string = path.resolve(__dirname, "..", "..");
const REPOSITORY_ROOT: string = path.resolve(EE_DIR, "..");

/*
 * The tag strips in ee/'s test files under a checkout's root: what this
 * suite runs over this checkout, and over the one a negative control writes.
 */
const tagStripsInEe: (root: string) => Array<string> = (
  root: string,
): Array<string> => {
  return reportTagStrips(listTestFiles(path.join(root, "ee"), root), root);
};

// Lines of code, as a file.
const code: (...lines: Array<string>) => string = (
  ...lines: Array<string>
): string => {
  return lines.join("\n");
};

describe("ee/'s tests read markup through the shared walk", () => {
  const eeTestFiles: Array<string> = listTestFiles(EE_DIR, REPOSITORY_ROOT);

  test("the shared detector reads this checkout", () => {
    /*
     * The detector finds the repository from its own place in it. Were that
     * ever another checkout, a walk named from it would name no ee/ file of
     * this one.
     */
    expect(REPOSITORY_DIRECTORY).toBe(REPOSITORY_ROOT);
  });

  test("the walk reads every test file of ee/", () => {
    /*
     * Guards the guard: a moved folder or a broken walk would otherwise
     * leave the scan below passing over nothing.
     */
    expect(eeTestFiles.length).toBeGreaterThan(50);
    expect(eeTestFiles).toEqual(
      expect.arrayContaining([
        "ee/Tests/Server/TestTagStripGuard.test.ts",
        "ee/Tests/Server/FrontendRequestsUseRefreshAwareApi.test.ts",
        // Helpers and fixtures, which are no *.test.* files.
        "ee/Tests/Server/License/Helpers/LicenseTestKit.ts",
        "ee/Tests/Server/LicenseServer/LicenseServerTestKit.ts",
        "ee/Tests/UI/TeamCompliance/ComplianceFixtures.ts",
        // The UI suite's screens, written in TSX.
        "ee/Tests/UI/Identity/ScimForms.test.tsx",
      ]),
    );

    for (const file of eeTestFiles) {
      expect([
        file,
        file.startsWith("ee/") &&
          isTestCode(file) &&
          fs.existsSync(path.join(REPOSITORY_ROOT, file)),
      ]).toEqual([file, true]);
    }

    // Nothing of a dependency, a build or a hidden folder.
    expect(
      eeTestFiles.filter((file: string): boolean => {
        return (
          file.includes("/node_modules/") ||
          file.includes("/build/") ||
          file.includes("/dist/") ||
          file.includes("/.")
        );
      }),
    ).toEqual([]);
  });

  test("the walk of ee/ reads exactly the ee/ files the walk of the whole checkout reads", () => {
    expect(eeTestFiles).toEqual(
      listTestFiles(REPOSITORY_ROOT, REPOSITORY_ROOT).filter(
        (file: string): boolean => {
          return file.startsWith("ee/");
        },
      ),
    );
  });

  test("finds no ee/ test file that takes markup out with a pattern of its own", () => {
    /*
     * The strings ARE the message: jest prints the received array, so a
     * failure names every file and line along with the fix.
     */
    expect(tagStripsInEe(REPOSITORY_ROOT)).toEqual([]);
  });

  test("what the findings say to read markup with instead works from ee/'s tests", () => {
    expect(TAG_STRIP_FIX).toContain(
      "removeHtmlMarkup (Common/Types/HtmlMarkup)",
    );
    expect(TAG_STRIP_FIX).toContain("Common/Tests/Helpers/HtmlText");

    // Both resolve through the "Common/..." specifier ee/'s tests import with.
    expect(removeHtmlMarkup("<p>Disk <b>full</b></p>")).toBe("Disk full");
    expect(htmlAsText("<p>Tom &amp; Jerry</p>")).toBe("Tom & Jerry");
    expect(
      visibleText(
        "<style>p { color: red; }</style><table><tr><td>Seats</td><td>12</td></tr></table>",
      ),
    ).toBe("Seats 12");
  });
});

describe("negative controls: the same pipeline catches an ee/ test that takes markup out", () => {
  // What an ee/ test would copy: the single pass code scanning reports.
  const COPIED_STRIP: string =
    'const words: string = html.replace(/<[^>]+>/g, "");';

  const linesOf: (fileName: string, text: string) => Array<number> = (
    fileName: string,
    text: string,
  ): Array<number> => {
    return findTagStrips(fileName, text).map((strip: TagStrip): number => {
      return strip.line;
    });
  };

  test("a copied strip in an ee/ server test is found, with its line", () => {
    expect(
      findTagStrips(
        "ee/Tests/Server/License/LicenseEmail.test.ts",
        code('import { expect, test } from "@jest/globals";', "", COPIED_STRIP),
      ),
    ).toEqual([{ line: 3, code: 'html.replace(/<[^>]+>/g, "")' }]);
  });

  test("a copied strip in an ee/ UI test is found among its JSX", () => {
    expect(
      linesOf(
        "ee/Tests/UI/License/LicenseBanner.test.tsx",
        code(
          "const view = <LicenseBanner text={text} />;",
          'const words: string = container.innerHTML.split(/<[^>]*>/).join(" ");',
          'const again: string = container.innerHTML.replace(/<\\/?[a-z][^>]*>/gi, " ");',
        ),
      ),
    ).toEqual([2, 3]);
  });

  test("a strip held in an ee/ helper's constant is found where it is used", () => {
    expect(
      linesOf(
        "ee/Tests/Server/License/Helpers/EmailText.ts",
        code(
          "const TAG: RegExp = /<[^>]*>/g;",
          "export const emailText = (html: string): string => {",
          '  return html.replace(TAG, " ");',
          "};",
        ),
      ),
    ).toEqual([3]);
  });

  test("an ee/ test reading through the shared walk is passed", () => {
    expect(
      linesOf(
        "ee/Tests/Server/License/LicenseEmail.test.ts",
        code(
          'import { removeHtmlMarkup } from "Common/Types/HtmlMarkup";',
          'import { htmlAsText } from "Common/Tests/Helpers/HtmlText";',
          'const words: string = removeHtmlMarkup(html).replace(/\\s+/g, " ");',
          "const text: string = htmlAsText(html);",
        ),
      ),
    ).toEqual([]);
  });

  describe("an ee/ test file planted in a checkout", () => {
    /*
     * The pipeline above, run over a checkout written here: ee/ with tests
     * that copy the strip - in its server and UI suites, and one beside the
     * screen it tests - one that reads through the shared walk, product code,
     * the folders a walk passes over, and a core test beside ee/, which is
     * core's guard's to read, not this suite's.
     */
    const PLANTED: Record<string, string> = {
      "ee/Tests/Server/License/LicenseEmail.test.ts": code(
        'import { expect, test } from "@jest/globals";',
        "",
        COPIED_STRIP,
      ),
      "ee/Tests/UI/License/LicenseBanner.test.tsx": code(
        "const view = <LicenseBanner text={text} />;",
        'const words: string = container.innerHTML.split(/<[^>]*>/).join(" ");',
      ),
      "ee/Dashboard/License/LicenseCard.test.tsx": COPIED_STRIP,
      "ee/Tests/Server/License/Clean.test.ts": code(
        'import { removeHtmlMarkup } from "Common/Types/HtmlMarkup";',
        'const words: string = removeHtmlMarkup(html).replace(/\\s+/g, " ");',
      ),
      "ee/Server/License/Render.ts": COPIED_STRIP,
      "ee/node_modules/some-package/Tests/strip.test.js": COPIED_STRIP,
      "ee/build/Tests/Server/License/LicenseEmail.test.js": COPIED_STRIP,
      "ee/.cache/Tests/License/LicenseEmail.test.ts": COPIED_STRIP,
      "packages/Common/Tests/Planted.test.ts": COPIED_STRIP,
    };

    let root: string = "";

    beforeAll(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), "ee-tag-strip-guard-"));

      for (const [file, text] of Object.entries(PLANTED)) {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), text);
      }
    });

    afterAll(() => {
      fs.rmSync(root, { recursive: true, force: true });
    });

    test("is reported by its ee/ path and line, with the fix", () => {
      expect(tagStripsInEe(root)).toEqual([
        `ee/Dashboard/License/LicenseCard.test.tsx:1 html.replace(/<[^>]+>/g, "") - ${TAG_STRIP_FIX}`,
        `ee/Tests/Server/License/LicenseEmail.test.ts:3 html.replace(/<[^>]+>/g, "") - ${TAG_STRIP_FIX}`,
        `ee/Tests/UI/License/LicenseBanner.test.tsx:2 container.innerHTML.split(/<[^>]*>/).join(" ") - ${TAG_STRIP_FIX}`,
      ]);
    });
  });
});
