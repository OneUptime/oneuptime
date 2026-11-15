import "@testing-library/jest-dom";
import {
  ISSUE_STATUS_LABELS,
  IssueStatusPill,
  OPEN_STATUS_TERM,
  getIssueStatusLabel,
  getIssueStatusOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityPills";
import DataSecurityIssueStatus, {
  ALL_DATA_SECURITY_ISSUE_STATUSES,
} from "../../../Types/DataSecurity/DataSecurityIssueStatus";
import { getWordOfMeaningKey, MEANING_KEYS } from "../../../Types/MeaningKeys";
import {
  DropdownOption,
  getDropdownOptionText,
} from "../../../UI/Components/Dropdown/Dropdown";
import {
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";
import useTranslateValue from "../../../UI/Utils/Translation";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import * as React from "react";
import { initReactI18next } from "react-i18next";

/*
 * AN OPEN ISSUE IS OPEN, NOT "TO OPEN".
 *
 * "Open" is the Dashboard's key for every Open button, and every language
 * words it as the verb: "Öffnen", "Ouvrir", "Abrir", "打开". An issue's
 * status read from that key told a German reader "Öffnen" beside
 * "Kritisch". So the status is worded from a key of its own, "Open
 * (status)", and an English reader - or one whose language has no wording
 * for it yet - reads "Open", never the verb.
 *
 * The translator reads such a key as its word by itself
 * (Common/Types/MeaningKeys), so the pill and the filter hand it the key
 * and let it look the key up once, where it is drawn. They used to write
 * "Open" by hand where the reader's language had no wording, and handed
 * the filter its words already translated (#8180).
 */

const LOCALES: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

// The languages the pill is drawn in below: English, and right-to-left ones.
const DRAWN_IN: ReadonlyArray<string> = ["en", "de", "es", "ar", "fa"];

// A made-up language whose "Open (status)" is itself a key: "Resolved".
const LOOKED_UP_TWICE: string = "xx";

// A made-up language whose file has no wording of the status yet.
const NOT_WORDED_YET: string = "yy";

function translatorOf(
  language: string,
  words: Record<string, string>,
): Translator {
  return createTranslator((key: string): string | undefined => {
    return words[key];
  }, language);
}

describe("an issue's status, as the pill and the filter hand it over", () => {
  test("each status is its key: the open one its meaning's own, the others their words", () => {
    expect(getIssueStatusLabel(DataSecurityIssueStatus.Open)).toBe(
      "Open (status)",
    );
    expect(OPEN_STATUS_TERM).toBe("Open (status)");
    expect(getIssueStatusLabel(DataSecurityIssueStatus.Accepted)).toBe(
      "Accepted",
    );
    expect(getIssueStatusLabel(DataSecurityIssueStatus.Resolved)).toBe(
      "Resolved",
    );
    expect(getIssueStatusLabel(DataSecurityIssueStatus.NotAnIssue)).toBe(
      "Not an issue",
    );
  });

  test("every status has a key, and the open one's is a key that names its meaning", () => {
    expect(Object.keys(ISSUE_STATUS_LABELS).sort()).toEqual(
      [...ALL_DATA_SECURITY_ISSUE_STATUSES].sort(),
    );
    expect(MEANING_KEYS).toContain(OPEN_STATUS_TERM);
    expect(getWordOfMeaningKey(OPEN_STATUS_TERM)).toBe("Open");
  });

  test("a status a newer server added reads as it is stored", () => {
    expect(getIssueStatusLabel("Snoozed")).toBe("Snoozed");
    expect(getIssueStatusLabel("")).toBe("");
  });

  test("English reads Open, and the others as they are written", () => {
    const english: Translator = translatorOf("en", {});

    expect(
      english.translateText(getIssueStatusLabel(DataSecurityIssueStatus.Open)),
    ).toBe("Open");
    expect(
      english.translateText(
        getIssueStatusLabel(DataSecurityIssueStatus.NotAnIssue),
      ),
    ).toBe("Not an issue");
  });

  test("a language reads the status from its own key, never the Open buttons' verb", () => {
    const german: Translator = translatorOf("de", {
      Open: "Öffnen",
      [OPEN_STATUS_TERM]: "Offen",
      Resolved: "Behoben",
    });

    expect(
      german.translateText(getIssueStatusLabel(DataSecurityIssueStatus.Open)),
    ).toBe("Offen");
    expect(
      german.translateText(
        getIssueStatusLabel(DataSecurityIssueStatus.Resolved),
      ),
    ).toBe("Behoben");
  });

  test("a language with no wording for the status yet reads English, not the verb", () => {
    const untranslated: Translator = translatorOf("ja", { Open: "開く" });

    expect(
      untranslated.translateText(
        getIssueStatusLabel(DataSecurityIssueStatus.Open),
      ),
    ).toBe("Open");
  });

  /*
   * The labels are the statuses' keys, so the filter's menu and its chip
   * look them up alike (getDropdownOptionText), as the pill does: never
   * handed words already translated, and so never marked isUserContent.
   */
  test("the filter offers every status, valued as stored and labelled with the pill's key", () => {
    expect(getIssueStatusOptions(ALL_DATA_SECURITY_ISSUE_STATUSES)).toEqual(
      ALL_DATA_SECURITY_ISSUE_STATUSES.map(
        (status: DataSecurityIssueStatus): DropdownOption => {
          return { value: status, label: getIssueStatusLabel(status) };
        },
      ),
    );

    for (const option of getIssueStatusOptions(
      ALL_DATA_SECURITY_ISSUE_STATUSES,
    )) {
      expect(option.isUserContent).toBeUndefined();
      expect(option.isInPageDirection).toBeUndefined();
    }

    expect(
      getIssueStatusOptions([DataSecurityIssueStatus.Open])[0]!.label,
    ).toBe(OPEN_STATUS_TERM);
  });

  test.each(["en", ...DASHBOARD_LANGUAGES])(
    "%s: the filter's options read as the pill's words, the open one never the verb",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);
      const words: Record<string, string> = readDashboardLocale(language);
      const drawn: Array<string> = getIssueStatusOptions(
        ALL_DATA_SECURITY_ISSUE_STATUSES,
      ).map((option: DropdownOption): string => {
        return getDropdownOptionText(option, translator.translateText);
      });

      expect(drawn).toEqual(
        ALL_DATA_SECURITY_ISSUE_STATUSES.map(
          (status: DataSecurityIssueStatus): string => {
            return translator.translateText(getIssueStatusLabel(status)) || "";
          },
        ),
      );
      expect(drawn[0]).toBe(
        language === "en" ? "Open" : words[OPEN_STATUS_TERM],
      );

      if (language !== "en") {
        expect({ language, open: drawn[0] }).not.toEqual({
          language,
          open: words["Open"],
        });
      }

      expect(drawn.join(" ")).not.toContain("(status)");
    },
  );

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

/*
 * The pill itself, through the Dashboard's own locale files: it hands Pill
 * the status's key, and Pill looks it up once.
 */
describe("an issue's status pill, drawn", () => {
  beforeAll(async () => {
    const resources: Record<string, { translation: Record<string, string> }> =
      {};

    for (const language of DRAWN_IN) {
      resources[language] = { translation: readDashboardLocale(language) };
    }

    resources[LOOKED_UP_TWICE] = {
      translation: {
        ...readDashboardLocale("de"),
        [OPEN_STATUS_TERM]: "Resolved",
      },
    };

    const notWorded: Record<string, string> = {
      ...readDashboardLocale("de"),
    };

    delete notWorded[OPEN_STATUS_TERM];

    resources[NOT_WORDED_YET] = { translation: notWorded };

    await i18next.use(initReactI18next).init({
      lng: "en",
      fallbackLng: "en",
      resources,
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  });

  afterEach(async () => {
    cleanup();
    await i18next.changeLanguage("en");
  });

  afterAll(async () => {
    await i18next.changeLanguage("en");
  });

  // The filter's menu and chip, as Dropdown draws an option.
  const OptionText: React.FunctionComponent<{
    option: DropdownOption;
  }> = (props: { option: DropdownOption }): React.ReactElement => {
    const { translateString } = useTranslateValue();

    return (
      <span data-testid="option">
        {getDropdownOptionText(props.option, translateString)}
      </span>
    );
  };

  async function pillOf(
    language: string,
    status: DataSecurityIssueStatus | string | undefined,
  ): Promise<string> {
    await i18next.changeLanguage(language);
    await act(async () => {
      render(<IssueStatusPill status={status} />);
    });

    const text: string = screen.getByTestId("pill-text").textContent || "";

    cleanup();

    return text;
  }

  async function optionsOf(language: string): Promise<Array<string>> {
    await i18next.changeLanguage(language);
    await act(async () => {
      render(
        <div>
          {getIssueStatusOptions(ALL_DATA_SECURITY_ISSUE_STATUSES).map(
            (option: DropdownOption): React.ReactElement => {
              return <OptionText key={String(option.value)} option={option} />;
            },
          )}
        </div>,
      );
    });

    const texts: Array<string> = screen
      .getAllByTestId("option")
      .map((element: HTMLElement): string => {
        return element.textContent || "";
      });

    cleanup();

    return texts;
  }

  test.each(DRAWN_IN)(
    "%s: an open issue's pill and its filter option read the state, never the verb",
    async (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const open: string =
        language === "en" ? "Open" : words[OPEN_STATUS_TERM]!;

      expect(await pillOf(language, DataSecurityIssueStatus.Open)).toBe(open);
      // No status yet is an open issue.
      expect(await pillOf(language, undefined)).toBe(open);

      if (language !== "en") {
        expect(open).not.toBe(words["Open"]);
      }

      for (const status of [
        DataSecurityIssueStatus.Accepted,
        DataSecurityIssueStatus.Resolved,
        DataSecurityIssueStatus.NotAnIssue,
      ]) {
        expect({
          language,
          status,
          pill: await pillOf(language, status),
        }).toEqual({
          language,
          status,
          pill: language === "en" ? status : words[status] || status,
        });
      }

      const options: Array<string> = await optionsOf(language);

      expect(options[0]).toBe(open);
      expect(options).not.toContain(OPEN_STATUS_TERM);
    },
  );

  test("the words drawn in each language are worded, and differ from English's", () => {
    for (const language of DRAWN_IN.filter((code: string): boolean => {
      return code !== "en";
    })) {
      const words: Record<string, string> = readDashboardLocale(language);

      expect({ language, worded: words[OPEN_STATUS_TERM] !== "Open" }).toEqual({
        language,
        worded: true,
      });
    }

    expect(readDashboardLocale("de")[OPEN_STATUS_TERM]).toBe("Offen");
  });

  test("English never shows the key's own English", async () => {
    expect(await pillOf("en", DataSecurityIssueStatus.Open)).toBe("Open");
    expect(await optionsOf("en")).toEqual([
      "Open",
      "Accepted",
      "Resolved",
      "Not an issue",
    ]);
  });

  test("a language with no wording of the status yet reads Open, never the verb or the key", async () => {
    expect(await pillOf(NOT_WORDED_YET, DataSecurityIssueStatus.Open)).toBe(
      "Open",
    );
    expect((await optionsOf(NOT_WORDED_YET))[0]).toBe("Open");
  });

  test("the pill and the option look the status up once: a wording that is itself a key is drawn as it is", async () => {
    // Looked up twice, "Resolved" would read German's "Behoben".
    expect(readDashboardLocale("de")["Resolved"]).not.toBe("Resolved");
    expect(await pillOf(LOOKED_UP_TWICE, DataSecurityIssueStatus.Open)).toBe(
      "Resolved",
    );
    expect((await optionsOf(LOOKED_UP_TWICE))[0]).toBe("Resolved");
  });

  test("a status a newer server added is drawn as stored", async () => {
    expect(await pillOf("de", "Snoozed")).toBe("Snoozed");
  });
});
