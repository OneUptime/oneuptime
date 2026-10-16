import CriteriaFilterUiUtil from "../../../FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import {
  TRANSLATED_LANGUAGES,
  listPages,
  readPage,
} from "./DocsContentSupport";
import {
  BOLD_ONLY_CONDITIONS,
  DRAWN_CONDITIONS,
  EnglishCondition,
  LONGER_NAMES,
  NameFound,
  englishConditionsOn,
  expectedConditionName,
  namesInLine,
  proseLines,
  withoutInlineCode,
} from "./DocsCriteriaConditions";
import {
  dashboardLabel,
  drawnDashboardLabel,
  isDashboardLabel,
} from "./DocsDashboardLabels";
import { readCommonSource, readDashboardSource } from "./DocsDashboardMenus";
import { prose } from "./DocsTranslationChecks";
import { CheckOn, FilterType } from "Common/Types/Monitor/CriteriaFilter";
import { describe, expect, it } from "@jest/globals";

/*
 * EVERY TRANSLATED DOCS PAGE NAMES A CRITERIA CONDITION AS ITS LANGUAGE'S
 * DASHBOARD DRAWS IT.
 *
 * adc8421a1b gave the criteria conditions (Greater Than, Equal To, Starts
 * With, Is Empty...) keys in every Dashboard locale, and the criteria form
 * draws them through its translator, so a German Dashboard says "Größer
 * als". 32 docs pages in 16 languages still said "Greater Than" and turned
 * eleven translation suites red; those suites read only the bold labels of
 * their own pages, one name at a time. This suite reads every page of every
 * language for the conditions, in bold and in prose, outside code
 * (DocsCriteriaConditions says what it reads), so a page cannot name one in
 * English again where its language's Dashboard draws it otherwise - nor a
 * condition a locale keys tomorrow.
 */

// The comparisons adc8421a1b keyed, and the three conditions keyed before it.
const KEYED_IN_ADC8421A1B: ReadonlyArray<string> = [
  FilterType.EqualTo,
  FilterType.NotEqualTo,
  FilterType.GreaterThan,
  FilterType.LessThan,
  FilterType.GreaterThanOrEqualTo,
  FilterType.LessThanOrEqualTo,
  FilterType.NotContains,
  FilterType.StartsWith,
  FilterType.EndsWith,
  FilterType.IsEmpty,
  FilterType.IsNotEmpty,
];
const KEYED_BEFORE: ReadonlyArray<string> = [
  FilterType.Contains,
  FilterType.True,
  FilterType.False,
];

// The criteria form's option for a condition, as a Dropdown draws it.
const DRAWN_OPTION: string = "{tx(option.label) ?? option.label}";
const CONDITION_DROPDOWN: string = "options={filterTypeOptions}";

// A finding, as a failure prints it: where, what, and what the page should say.
function described(page: string, finding: EnglishCondition): string {
  return `${page}:${finding.line}: ${finding.bold ? "**" : ""}${finding.condition}${
    finding.bold ? "**" : ""
  } -> ${finding.drawn}`;
}

function conditionsOn(
  language: string,
  page: string,
  markdown: string,
): Array<string> {
  return englishConditionsOn(language, page, markdown).map(
    (finding: EnglishCondition): string => {
      return described(page, finding);
    },
  );
}

function nonEmptyLines(lines: Array<string>): Array<string> {
  return lines.filter((line: string): boolean => {
    return line.trim().length > 0;
  });
}

describe("the conditions this suite reads", () => {
  it("are every condition the Dashboard has a key for, the ones adc8421a1b keyed among them", () => {
    expect([...DRAWN_CONDITIONS].sort()).toEqual(
      [...KEYED_IN_ADC8421A1B, ...KEYED_BEFORE].sort(),
    );

    // Every other condition has no key, and is read as a longer name only.
    for (const condition of Object.values(FilterType)) {
      expect({
        condition,
        drawn: DRAWN_CONDITIONS.includes(condition),
        longerName: LONGER_NAMES.includes(condition),
      }).toEqual({
        condition,
        drawn: isDashboardLabel(condition),
        longerName: !isDashboardLabel(condition),
      });
    }
  });

  it("are drawn in every docs language in that language's own words", () => {
    for (const language of TRANSLATED_LANGUAGES) {
      for (const condition of DRAWN_CONDITIONS) {
        expect({
          language,
          condition,
          translated: drawnDashboardLabel(language, condition) !== condition,
        }).toEqual({ language, condition, translated: true });
      }
    }
  });

  it("are the criteria form's own options, which its Dropdown draws through the translator", () => {
    // The form lists a filter's conditions as options labelled with the English value...
    const responseTime: Array<{ value: unknown; label: string }> =
      CriteriaFilterUiUtil.getFilterTypeOptionsByCheckOn(CheckOn.ResponseTime);

    expect(
      responseTime.map((option: { value: unknown; label: string }): string => {
        return option.label;
      }),
    ).toEqual(
      responseTime.map((option: { value: unknown; label: string }): string => {
        return String(option.value);
      }),
    );
    expect(
      responseTime.map((option: { value: unknown; label: string }): string => {
        return option.label;
      }),
    ).toEqual(
      expect.arrayContaining([
        FilterType.GreaterThan,
        FilterType.LessThanOrEqualTo,
      ]),
    );

    // ...in a Dropdown, which draws each option's label through the translator.
    expect(
      readDashboardSource("Components/Form/Monitor/CriteriaFilter.tsx"),
    ).toContain(CONDITION_DROPDOWN);
    expect(readCommonSource("UI/Components/Dropdown/Dropdown.tsx")).toContain(
      DRAWN_OPTION,
    );
  });

  it("include the ones read in bold only, and longer names that are not a condition", () => {
    for (const condition of BOLD_ONLY_CONDITIONS) {
      expect(DRAWN_CONDITIONS).toContain(condition);
    }

    expect(LONGER_NAMES).toEqual(
      expect.arrayContaining([
        FilterType.EvaluatesToTrue,
        "Contains Any",
        "Contains All",
      ]),
    );

    // Contains Any and Contains All are labels of their own, drawn whole.
    expect(isDashboardLabel("Contains Any")).toBe(true);
    expect(isDashboardLabel("Contains All")).toBe(true);
  });
});

describe.each(TRANSLATED_LANGUAGES)("every %s page", (language: string) => {
  it("names every criteria condition as this language's Dashboard draws it, in bold and in prose", () => {
    const found: Array<string> = listPages(language).flatMap(
      (page: string): Array<string> => {
        return conditionsOn(language, page, readPage(language, page));
      },
    );

    expect(found).toEqual([]);
  });
});

describe("the Persian incident pages", () => {
  const settings: string = readPage("fa", "incidents/settings");

  it("keep the Dashboard's English names, as dashboardLabel reads them", () => {
    expect(expectedConditionName("fa", "incidents/settings", "Contains")).toBe(
      dashboardLabel("fa", "Contains"),
    );
    expect(dashboardLabel("fa", "Contains")).toBe("Contains");
    expect(settings).toContain("**Contains**");
    expect(conditionsOn("fa", "incidents/settings", settings)).toEqual([]);
  });

  it("are the only pages that may: the same words on any other page are found", () => {
    expect(
      conditionsOn("fa", "monitor/criteria-and-statuses", settings),
    ).toContainEqual(
      expect.stringContaining(
        `**Contains** -> ${drawnDashboardLabel("fa", "Contains")}`,
      ),
    );
    // Every other language's incident pages draw it.
    expect(expectedConditionName("de", "incidents/settings", "Contains")).toBe(
      drawnDashboardLabel("de", "Contains"),
    );
    expect(drawnDashboardLabel("de", "Contains")).not.toBe("Contains");
  });
});

describe("the reader, on the shapes the pages have", () => {
  const greaterThan: string = drawnDashboardLabel("de", FilterType.GreaterThan);
  const lessThan: string = drawnDashboardLabel("de", FilterType.LessThan);

  it("finds a bold condition in English, with its line and the name the page should give", () => {
    const markdown: string = [
      "# Seite",
      "",
      "Setzen Sie die Bedingung auf **Greater Than** und den Wert auf `5`.",
    ].join("\n");

    expect(englishConditionsOn("de", "monitor/page", markdown)).toEqual([
      {
        line: 3,
        condition: FilterType.GreaterThan,
        drawn: greaterThan,
        bold: true,
      },
    ]);
  });

  it("finds a condition in prose: a table of conditions, a sentence, and inside a longer bold span", () => {
    const markdown: string = [
      "| Filter | Bedingungen |",
      "| --- | --- |",
      "| **CPU** | Greater Than, Less Than |",
      "Starts With und Ends With treffen auf Text zu.",
      "Kriterien mit **Equal To 0** lösen aus.",
    ].join("\n");

    expect(conditionsOn("de", "monitor/page", markdown)).toEqual([
      `monitor/page:3: Greater Than -> ${greaterThan}`,
      `monitor/page:3: Less Than -> ${lessThan}`,
      `monitor/page:4: Starts With -> ${drawnDashboardLabel("de", FilterType.StartsWith)}`,
      `monitor/page:4: Ends With -> ${drawnDashboardLabel("de", FilterType.EndsWith)}`,
      `monitor/page:5: Equal To -> ${drawnDashboardLabel("de", FilterType.EqualTo)}`,
    ]);
  });

  it("reads the longest name where names overlap", () => {
    const markdown: string =
      "**Greater Than Or Equal To**, **Not Equal To**, Not Contains, Is Not Empty";

    expect(
      englishConditionsOn("de", "monitor/page", markdown).map(
        (finding: EnglishCondition): string => {
          return finding.condition;
        },
      ),
    ).toEqual([
      FilterType.GreaterThanOrEqualTo,
      FilterType.NotEqualTo,
      FilterType.NotContains,
      FilterType.IsNotEmpty,
    ]);
  });

  it("leaves code alone, inline and fenced, and keeps the page's line numbers past a code block", () => {
    const markdown: string = [
      'Set `filter_type = "Greater Than"` in Terraform.',
      "```hcl",
      'filter_type = "Less Than"',
      "Is Empty",
      "```",
      "Danach **Greater Than**.",
    ].join("\n");

    expect(conditionsOn("de", "monitor/page", markdown)).toEqual([
      `monitor/page:6: **Greater Than** -> ${greaterThan}`,
    ]);
  });

  it("does not take a longer name for the condition inside it", () => {
    const markdown: string = [
      "**Contains Any** und **Contains All** sind eigene Bezeichnungen.",
      "**Evaluates To True** und **Not Recieved In Minutes** haben keinen Schlüssel.",
    ].join("\n");

    expect(conditionsOn("de", "monitor/page", markdown)).toEqual([]);
  });

  it("reads True and False in bold only, where they are the condition", () => {
    const markdown: string = [
      "| True Positive | Ein echter Angriff |",
      "| False Positive | Ein Fehlalarm |",
      "Wählen Sie **False**.",
    ].join("\n");

    expect(conditionsOn("de", "telemetry/page", markdown)).toEqual([
      `telemetry/page:3: **False** -> ${drawnDashboardLabel("de", FilterType.False)}`,
    ]);
  });

  it("reads whole words only", () => {
    const markdown: string =
      "Greater Thanks, ContainsAll, NotContains, Is Emptying and Equal Tones are no conditions.";

    expect(conditionsOn("de", "monitor/page", markdown)).toEqual([]);
  });

  it("passes a page that names every condition as drawn, and every English page", () => {
    const drawnPage: string = [
      `Setzen Sie **${greaterThan}** und dann ${lessThan}.`,
      `| **CPU** | ${greaterThan}, ${lessThan} |`,
    ].join("\n");
    const englishPage: string =
      "Set **Greater Than**, then Less Than, Is Empty and **True**.";

    expect(conditionsOn("de", "monitor/page", drawnPage)).toEqual([]);
    expect(conditionsOn("en", "monitor/page", englishPage)).toEqual([]);
  });

  it("finds the names of a line by position, whole words, the longest first", () => {
    const line: string = "Less Than Or Equal To, Equal To, Unequal To";
    const found: Array<NameFound> = namesInLine(line, [
      FilterType.EqualTo,
      FilterType.LessThan,
      FilterType.LessThanOrEqualTo,
    ]);

    expect(found).toEqual([
      { start: 0, end: 21, name: FilterType.LessThanOrEqualTo },
      { start: 23, end: 31, name: FilterType.EqualTo },
    ]);
  });

  it("blanks inline code without moving what follows it", () => {
    const code: string = "`Greater Than`";
    const line: string = `A ${code} B`;

    expect(withoutInlineCode(line)).toHaveLength(line.length);
    expect(withoutInlineCode(line)).toBe(`A ${" ".repeat(code.length)} B`);
    expect(namesInLine(withoutInlineCode(line), DRAWN_CONDITIONS)).toEqual([]);
  });

  it("reads as prose exactly the lines prose() keeps, on every English page", () => {
    for (const page of listPages("en")) {
      const markdown: string = readPage("en", page);

      expect({ page, lines: nonEmptyLines(proseLines(markdown)) }).toEqual({
        page,
        lines: nonEmptyLines(prose(markdown).split("\n")),
      });
      expect(proseLines(markdown)).toHaveLength(markdown.split("\n").length);
    }
  });
});
