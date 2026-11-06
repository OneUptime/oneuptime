import {
  ExtractedString,
  scanSourceText,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import { markupAsSpaces } from "Common/Tests/Helpers/HtmlText";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * PERSIAN DIGITS IN DATA SECURITY'S PERSIAN COPY AND DOCS.
 *
 * The Persian pages draw every number they format in Persian digits
 * (Intl.NumberFormat("fa"): ۱۲٬۳۴۵, ۶۰٪), and most of the Persian copy
 * writes the numbers of its sentences the same way ("۶ ساعت گذشته",
 * "۲۴ ساعت", "۱۵ نویسه"). Data Security's Persian strings and docs wrote
 * theirs in Latin digits ("90 روز", "از 0 تا 100") beside the scores and
 * counts its pages drew in Persian ones. The rule, for the copy and the
 * docs alike:
 *
 * - a quantity, a duration, a score, a limit or a year in a Persian
 *   sentence is written in Persian digits, with the Persian thousands
 *   separator and percent sign;
 * - what a reader copies or reads as a name stays as written: code,
 *   placeholders, link targets and addresses, versions and clause numbers
 *   (TLS 1.2, A.5.12, 164.308(a)(4)), names with digits (S3, SOC 2,
 *   ISO 27001, PBKDF2, IPv4, ICD-10, mod-97), English designations
 *   (Art. 30, Sec. 8(5)), Markdown list numbers and quoted English.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../..");
const DASHBOARD: string = path.join(
  REPOSITORY_ROOT,
  "packages/App/FeatureSet/Dashboard",
);
const DOCS: string = path.join(
  REPOSITORY_ROOT,
  "packages/App/FeatureSet/Docs/Content/fa/data-security",
);

/*
 * Spans never read: code, placeholders, link targets, URLs and quoted
 * English. Tags are taken out before, by the shared markup walk.
 */
const PROTECTED: RegExp =
  /`[^`]*`|\{\{[^}]*\}\}|\]\([^)]*\)|https?:\/\/\S+|«[^»]*[A-Za-z][^»]*»|"[^"]*[A-Za-z]{3,}[^"]*"/g;
const NUMBER: RegExp = /\d+(?:[.,:/]\d+)*%?/g;
const LETTER_BEFORE: RegExp = /[A-Za-z\\]-?$/;
const LETTER_AFTER: RegExp = /^[A-Za-z]/;
const PART_OF_A_CODE_AFTER: RegExp = /^-\d/;
const PART_OF_A_CODE_BEFORE: RegExp = /\d-$/;
const DESIGNATION_BEFORE: RegExp =
  /(?:SOC|ISO|ISO\/IEC|NIST|TLS|Art\.|Arts\.|Sec\.|v|PCI DSS v|HTTP|IPv|Requirement|mod)\s?$/;
const CLAUSE_PART_BEFORE: RegExp = /[A-Za-z0-9)]\($/;
const CLAUSE_PART_AFTER: RegExp = /^\([A-Za-z0-9]/;
const LIST_MARKER_AFTER: RegExp = /^\.\s/;
const CODE_SEPARATORS: RegExp = /[.:/]/;
const SOURCE_FILE: RegExp = /\.tsx?$/;

// Whether a Latin-digit run is a name or an identifier, written as it is.
function isAName(text: string, start: number, run: string): boolean {
  const before: string = text.slice(0, start);
  const after: string = text.slice(start + run.length);
  const lineBefore: string = before.slice(before.lastIndexOf("\n") + 1);

  return (
    CODE_SEPARATORS.test(run) ||
    LETTER_BEFORE.test(before) ||
    LETTER_AFTER.test(after) ||
    PART_OF_A_CODE_AFTER.test(after) ||
    PART_OF_A_CODE_BEFORE.test(before) ||
    DESIGNATION_BEFORE.test(before) ||
    CLAUSE_PART_BEFORE.test(before) ||
    CLAUSE_PART_AFTER.test(after) ||
    (lineBefore.trim() === "" && LIST_MARKER_AFTER.test(after))
  );
}

// The Latin-digit runs of a Persian text that count something: each should be Persian.
function latinNumbersInProse(text: string): Array<string> {
  const plain: string = markupAsSpaces(text).replace(
    PROTECTED,
    (span: string): string => {
      return " ".repeat(span.length);
    },
  );
  const found: Array<string> = [];

  for (const match of plain.matchAll(NUMBER)) {
    if (!isAName(plain, match.index as number, match[0])) {
      found.push(match[0]);
    }
  }

  return found;
}

function dataSecuritySources(): Array<string> {
  const files: Array<string> = [];
  const walk: (dir: string, inside: boolean) => void = (
    dir: string,
    inside: boolean,
  ): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full: string = path.join(dir, entry.name);
      const isDataSecurity: boolean =
        inside || entry.name.includes("DataSecurity");

      if (entry.isDirectory()) {
        walk(full, isDataSecurity);
      } else if (isDataSecurity && SOURCE_FILE.test(entry.name)) {
        files.push(full);
      }
    }
  };

  walk(path.join(DASHBOARD, "src"), false);
  walk(path.join(REPOSITORY_ROOT, "packages/Common/Types"), false);

  return files.sort();
}

// The keys Data Security's files say.
function dataSecurityKeys(): Array<string> {
  const keys: Set<string> = new Set<string>();

  for (const file of dataSecuritySources()) {
    const relative: string = path.relative(REPOSITORY_ROOT, file);

    for (const entry of scanSourceText(
      relative,
      fs.readFileSync(file, "utf8"),
      {
        kind: "ui",
      },
    ).strings as Array<ExtractedString>) {
      keys.add(entry.text);
    }
  }

  return Array.from(keys);
}

function docsLines(): Array<{ where: string; line: string }> {
  const lines: Array<{ where: string; line: string }> = [];

  for (const page of fs.readdirSync(DOCS).sort()) {
    if (!page.endsWith(".md")) {
      continue;
    }

    let inFence: boolean = false;
    const text: Array<string> = fs
      .readFileSync(path.join(DOCS, page), "utf8")
      .split("\n");

    text.forEach((line: string, index: number): void => {
      if (line.startsWith("```")) {
        inFence = !inFence;
        return;
      }
      // Headings keep their words: their anchors are what links open.
      if (!inFence && !line.startsWith("#")) {
        lines.push({ where: `${page}:${index + 1}`, line });
      }
    });
  }

  return lines;
}

describe("the rule's two sides", () => {
  test.each([
    ["TLS 1.2", []],
    ["SOC 2 و ISO 27001", []],
    ["یک باکت S3 و PBKDF2", []],
    ["Art. 5(1)(c) و 164.308(a)(4)", []],
    ["کد ICD-10 یا بررسی mod-97 یا mod 97", []],
    ["0.0.0.0/0 را مجاز می‌کند", []],
    ["1. **کشف**", []],
    ["«Data Security: 2 new issues on orders-db»", []],
    ["`top 10` و {{count}} مورد", []],
    ['<img src="score.png" width="640"> و <h2>', []],
    ["۷۵ + ۱۰ + ۵ + ۴ = ۹۴", []],
    ["90 روز", ["90"]],
    ["از 0 تا 100", ["0", "100"]],
    ["حداکثر 2,000 یافته", ["2,000"]],
    ["60% یا بیشتر", ["60%"]],
    ["از سال 2018", ["2018"]],
  ])("%s", (text: string, numbers: Array<string>) => {
    expect(latinNumbersInProse(text)).toEqual(numbers);
  });
});

describe("Data Security in Persian writes its numbers in Persian digits", () => {
  test("its strings", () => {
    const english: Record<string, unknown> = JSON.parse(
      fs.readFileSync(path.join(DASHBOARD, "src/Locales/en.json"), "utf8"),
    ) as Record<string, unknown>;
    const persian: Record<string, unknown> = JSON.parse(
      fs.readFileSync(path.join(DASHBOARD, "src/Locales/fa.json"), "utf8"),
    ) as Record<string, unknown>;
    const keys: Array<string> = dataSecurityKeys();
    const latin: Array<string> = keys
      .filter((key: string): boolean => {
        const value: unknown = persian[key];

        return (
          typeof value === "string" &&
          value !== english[key] &&
          latinNumbersInProse(value).length > 0
        );
      })
      .map((key: string): string => {
        return `${key} -> ${String(persian[key])}`;
      });

    // The files say many strings: a lookup that read none would pass otherwise.
    expect(keys.length).toBeGreaterThan(500);
    expect(latin).toEqual([]);
  });

  test("its docs pages", () => {
    const lines: Array<{ where: string; line: string }> = docsLines();
    const latin: Array<string> = lines
      .filter((entry: { where: string; line: string }): boolean => {
        return latinNumbersInProse(entry.line).length > 0;
      })
      .map((entry: { where: string; line: string }): string => {
        return `${entry.where}: ${latinNumbersInProse(entry.line).join(", ")}`;
      });

    expect(lines.length).toBeGreaterThan(500);
    expect(latin).toEqual([]);
  });

  test("and keeps names and identifiers as written", () => {
    const compliance: string = fs.readFileSync(
      path.join(DOCS, "compliance.md"),
      "utf8",
    );
    const checks: string = fs.readFileSync(
      path.join(DOCS, "checks-and-issues.md"),
      "utf8",
    );

    expect(compliance).toContain("| Art. 5(1)(c) |");
    expect(compliance).toContain("| 164.308(a)(4) |");
    expect(compliance).toContain("ISO/IEC 27001:2022");
    expect(checks).toContain("0.0.0.0/0");
    expect(checks).toContain("TLS 1.2");
    // A score's sum reads in Persian digits.
    expect(checks).toContain("۷۵ + ۱۰ + ۵ + ۴ = ۹۴");
  });
});
