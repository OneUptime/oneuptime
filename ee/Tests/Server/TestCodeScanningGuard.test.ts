import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import {
  CODE_SCANNING_FIXES,
  CODE_SCANNING_GUARD_OPTIONS,
  CodeScanningFinding,
  findCodeScanningProblems,
  isTestCodeFile,
  listTestCodeFiles,
} from "Common/Tests/Helpers/CodeScanning";
import { REPOSITORY_DIRECTORY } from "Common/Tests/Helpers/TagStripScan";
import { escapeRegExp } from "Common/Utils/RegExpEscape";

/*
 * ee/'s tests write nothing code scanning reports as incomplete escaping or
 * an overly large range, either.
 *
 * packages/Common/Tests/Helpers/TestCodeScanningGuard.test.ts reads every
 * test file of the checkout the way code scanning reads it for
 * js/incomplete-sanitization and js/overly-large-range, and fails on what it
 * would report - a pattern built from text with only its dots escaped, an
 * escape that leaves a backslash in the text, a replace of the first
 * meta-character only, a character range wider than it looks - and on a
 * copy of the shared regular expression escape (escapeRegExp,
 * Common/Utils/RegExpEscape). It walks the whole checkout, but the Common
 * Test job removes ee/ before it runs (core passes without the Enterprise
 * Edition), so in CI it never reads one of ee/'s. This suite runs the same
 * reading (Common/Tests/Helpers/CodeScanning), with the same options, over
 * ee/'s test files, from ee's own jest run: the Enterprise Edition Test job,
 * the only one with ee/ checked out.
 *
 * ee/'s test files are what the walk of the whole checkout reads under ee/:
 * every file of code under ee/Tests - the server and UI suites, their
 * helpers and fixtures - any *.test.* or *.spec.* file elsewhere in ee/, and
 * a template in those folders, outside node_modules, builds and hidden
 * folders. Nothing is excused.
 */

const EE_DIR: string = path.resolve(__dirname, "..", "..");
const REPOSITORY_ROOT: string = path.resolve(EE_DIR, "..");

// Lines of code, as a file.
const code: (...lines: Array<string>) => string = (
  ...lines: Array<string>
): string => {
  return lines.join("\n");
};

// A finding as the guard prints it: where, what, and what to use instead.
const reportedAs: (finding: CodeScanningFinding) => string = (
  finding: CodeScanningFinding,
): string => {
  return `${finding.file}:${finding.line} [${finding.rule}] ${finding.message} ${finding.code} -> ${CODE_SCANNING_FIXES[finding.rule]}`;
};

/*
 * What code scanning would report in ee/'s test files under a checkout's
 * root: what this suite runs over this checkout, and over the one a negative
 * control writes.
 */
const findingsInEe: (root: string) => Array<string> = (
  root: string,
): Array<string> => {
  const findings: Array<string> = [];

  for (const file of listTestCodeFiles(root, ["ee"])) {
    for (const finding of findCodeScanningProblems(
      file,
      fs.readFileSync(path.join(root, file), "utf8"),
      CODE_SCANNING_GUARD_OPTIONS,
    )) {
      findings.push(reportedAs(finding));
    }
  }

  return findings;
};

const DOES_NOT_ESCAPE_BACKSLASHES: string =
  "This does not escape backslash characters in the input.";

describe("ee/'s tests write nothing code scanning reports", () => {
  const eeTestFiles: Array<string> = listTestCodeFiles(REPOSITORY_ROOT, ["ee"]);

  test("the shared reading reads this checkout", () => {
    /*
     * The reading finds the repository from its own place in it. Were that
     * ever another checkout, a walk named from it would name no ee/ file of
     * this one.
     */
    expect(REPOSITORY_DIRECTORY).toBe(REPOSITORY_ROOT);
  });

  test("the walk reads every test file of ee/, helpers and fixtures included", () => {
    /*
     * Guards the guard: a moved folder or a broken walk would otherwise
     * leave the scan below passing over nothing.
     */
    expect(eeTestFiles.length).toBeGreaterThan(50);
    expect(eeTestFiles).toEqual(
      expect.arrayContaining([
        "ee/Tests/Server/TestCodeScanningGuard.test.ts",
        "ee/Tests/Server/ProductCodeScanningGuard.test.ts",
        // Helpers and fixtures, which are no *.test.* files.
        "ee/Tests/Server/License/Helpers/LicenseTestKit.ts",
        "ee/Tests/UI/TeamCompliance/ComplianceFixtures.ts",
        // The UI suite's screens, written in TSX.
        "ee/Tests/UI/Identity/ScimForms.test.tsx",
        // The suite that carried a copy of the escape.
        "ee/Tests/UI/Health/HealthPluginWiring.test.ts",
      ]),
    );

    for (const file of eeTestFiles) {
      expect([
        file,
        file.startsWith("ee/") &&
          isTestCodeFile(file) &&
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
      listTestCodeFiles(REPOSITORY_ROOT).filter((file: string): boolean => {
        return file.startsWith("ee/");
      }),
    );
  });

  test("finds no ee/ test file that escapes incompletely, replaces a first occurrence only, holds an overly large range or copies escapeRegExp", () => {
    // The strings ARE the message: a failure names every file, line and fix.
    expect(findingsInEe(REPOSITORY_ROOT)).toEqual([]);
  }, 120000);

  test("what the findings ask for works from ee/'s tests", () => {
    expect(CODE_SCANNING_FIXES["own regular expression escape"]).toContain(
      "escapeRegExp from Common/Utils/RegExpEscape",
    );

    // It resolves through the "Common/..." specifier ee/'s tests import with.
    const specifier: string = "@oneuptime/ee-dashboard/Health/Plugin.tsx";
    const pattern: RegExp = new RegExp(`^${escapeRegExp(specifier)}$`);

    expect(pattern.test(specifier)).toBe(true);
    expect(pattern.test("@oneuptime/ee-dashboard/Health/PluginXtsx")).toBe(
      false,
    );
  });
});

describe("negative controls: the same reading catches an ee/ test that escapes incompletely", () => {
  // What an ee/ test would copy: the escapes code scanning reported in core's.
  const DOTS_ONLY: string = String.raw`const pattern: RegExp = new RegExp(host.replace(/\./g, "\\."));`;
  const FIRST_AMPERSAND: string =
    'const html: string = text.replace("&", "&amp;");';
  const WIDE_RANGE: string = "const LETTER: RegExp = /[A-z]/;";
  const ESCAPE_COPY: string =
    "const quote = (text: string): string => { return text.replace(/[.*+?^$" +
    '{}()|[\\]\\\\]/g, "\\\\$&"); };';

  test("a dots-only escape in an ee/ server test is found, with its line and code scanning's words", () => {
    expect(
      findCodeScanningProblems(
        "ee/Tests/Server/License/LicenseHost.test.ts",
        code('import { expect, test } from "@jest/globals";', "", DOTS_ONLY),
        CODE_SCANNING_GUARD_OPTIONS,
      ).map((finding: CodeScanningFinding): [number, string, string] => {
        return [finding.line, finding.rule, finding.message];
      }),
    ).toEqual([[3, "js/incomplete-sanitization", DOES_NOT_ESCAPE_BACKSLASHES]]);
  });

  describe("ee/ test files planted in a checkout", () => {
    /*
     * The reading above, run over a checkout written here: ee/ with tests
     * that escape incompletely - in its server and UI suites, a helper, and
     * one beside the screen it tests - one that escapes with the shared
     * escape, product code, the folders a walk passes over, and a core test
     * beside ee/, which is core's guard's to read, not this suite's.
     */
    const PLANTED: Record<string, string> = {
      "ee/Tests/Server/License/LicenseHost.test.ts": code(
        'import { expect, test } from "@jest/globals";',
        "",
        DOTS_ONLY,
      ),
      "ee/Tests/UI/License/LicenseBanner.test.tsx": code(
        "const view = <LicenseBanner text={text} />;",
        FIRST_AMPERSAND,
      ),
      "ee/Tests/UI/License/Helpers/Letters.ts": WIDE_RANGE,
      "ee/Dashboard/License/LicenseCard.test.tsx": ESCAPE_COPY,
      "ee/Tests/Server/License/Clean.test.ts": code(
        'import { escapeRegExp } from "Common/Utils/RegExpEscape";',
        "const pattern: RegExp = new RegExp(escapeRegExp(host));",
      ),
      "ee/Server/License/Render.ts": DOTS_ONLY,
      "ee/node_modules/some-package/Tests/escape.test.js": DOTS_ONLY,
      "ee/build/Tests/Server/License/LicenseHost.test.js": DOTS_ONLY,
      "ee/.cache/Tests/License/LicenseHost.test.ts": DOTS_ONLY,
      "packages/Common/Tests/Planted.test.ts": DOTS_ONLY,
    };

    let root: string = "";

    beforeAll(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), "ee-test-code-scanning-"));

      for (const [file, text] of Object.entries(PLANTED)) {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), text);
      }
    });

    afterAll(() => {
      fs.rmSync(root, { recursive: true, force: true });
    });

    test("reads ee/'s test files and nothing else", () => {
      expect(listTestCodeFiles(root, ["ee"])).toEqual([
        "ee/Dashboard/License/LicenseCard.test.tsx",
        "ee/Tests/Server/License/Clean.test.ts",
        "ee/Tests/Server/License/LicenseHost.test.ts",
        "ee/Tests/UI/License/Helpers/Letters.ts",
        "ee/Tests/UI/License/LicenseBanner.test.tsx",
      ]);
    });

    test("reports each one by its ee/ path and line, with the fix", () => {
      const findings: Array<string> = findingsInEe(root);

      expect(
        findings.map((finding: string): string => {
          return finding.slice(0, finding.indexOf("]") + 1);
        }),
      ).toEqual([
        "ee/Dashboard/License/LicenseCard.test.tsx:1 [own regular expression escape]",
        "ee/Tests/Server/License/LicenseHost.test.ts:3 [js/incomplete-sanitization]",
        "ee/Tests/UI/License/Helpers/Letters.ts:1 [js/overly-large-range]",
        "ee/Tests/UI/License/LicenseBanner.test.tsx:2 [js/incomplete-sanitization]",
      ]);
      expect(findings[1]).toContain(
        CODE_SCANNING_FIXES["js/incomplete-sanitization"],
      );
      expect(findings[3]).toContain(
        'This replaces only the first occurrence of "&".',
      );
    });
  });
});
