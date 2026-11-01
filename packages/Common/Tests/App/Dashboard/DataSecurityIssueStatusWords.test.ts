import {
  OPEN_STATUS_TERM,
  getIssueStatusLabel,
  getIssueStatusOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityPills";
import DataSecurityIssueStatus, {
  ALL_DATA_SECURITY_ISSUE_STATUSES,
} from "../../../Types/DataSecurity/DataSecurityIssueStatus";
import {
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * AN OPEN ISSUE IS OPEN, NOT "TO OPEN".
 *
 * "Open" is the Dashboard's key for every Open button, and every language
 * words it as the verb: "Öffnen", "Ouvrir", "Abrir", "打开". An issue's
 * status read from that key told a German reader "Öffnen" beside
 * "Kritisch". So the status is worded from a key of its own, "Open
 * (status)", and an English reader - or one whose language has no wording
 * for it yet - reads "Open", never the verb.
 */

const LOCALES: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function translatorOf(
  language: string,
  words: Record<string, string>,
): Translator {
  return createTranslator((key: string): string | undefined => {
    return words[key];
  }, language);
}

describe("an issue's status, as the pill and the filter say it", () => {
  test("English reads Open, and the others as they are written", () => {
    const english: Translator = translatorOf("en", {});

    expect(getIssueStatusLabel(english, DataSecurityIssueStatus.Open)).toBe(
      "Open",
    );
    expect(
      getIssueStatusLabel(english, DataSecurityIssueStatus.NotAnIssue),
    ).toBe("Not an issue");
  });

  test("a language reads the status from its own key, never the Open buttons' verb", () => {
    const german: Translator = translatorOf("de", {
      Open: "Öffnen",
      [OPEN_STATUS_TERM]: "Offen",
      Resolved: "Behoben",
    });

    expect(getIssueStatusLabel(german, DataSecurityIssueStatus.Open)).toBe(
      "Offen",
    );
    expect(getIssueStatusLabel(german, DataSecurityIssueStatus.Resolved)).toBe(
      "Behoben",
    );
  });

  test("a language with no wording for the status yet reads English, not the verb", () => {
    const untranslated: Translator = translatorOf("ja", { Open: "開く" });

    expect(
      getIssueStatusLabel(untranslated, DataSecurityIssueStatus.Open),
    ).toBe("Open");
  });

  test("the filter offers every status, valued as stored and labelled as the pill", () => {
    const german: Translator = translatorOf("de", {
      Open: "Öffnen",
      [OPEN_STATUS_TERM]: "Offen",
    });

    expect(
      getIssueStatusOptions(german, ALL_DATA_SECURITY_ISSUE_STATUSES),
    ).toEqual(
      ALL_DATA_SECURITY_ISSUE_STATUSES.map(
        (status: DataSecurityIssueStatus) => {
          return {
            value: status,
            label: getIssueStatusLabel(german, status),
          };
        },
      ),
    );
    expect(
      getIssueStatusOptions(german, [DataSecurityIssueStatus.Open])[0]!.label,
    ).toBe("Offen");
  });

  test("no locale words the status as its Open button", () => {
    const files: Array<string> = fs
      .readdirSync(LOCALES)
      .filter((name: string): boolean => {
        return name.endsWith(".json") && name !== "en.json";
      });

    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const locale: Record<string, unknown> = JSON.parse(
        fs.readFileSync(path.join(LOCALES, file), "utf8"),
      ) as Record<string, unknown>;
      const status: unknown = locale[OPEN_STATUS_TERM];

      expect({ file, hasKey: typeof status === "string" }).toEqual({
        file,
        hasKey: true,
      });

      // Untranslated (still the English key) reads "Open" on screen.
      if (status !== OPEN_STATUS_TERM) {
        expect({ file, status }).not.toEqual({ file, status: locale["Open"] });
        expect({ file, keepsTheNote: String(status).includes("(") }).toEqual({
          file,
          keepsTheNote: false,
        });
      }
    }
  });
});
