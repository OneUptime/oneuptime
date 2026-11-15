// UX rule: Docs/ux/README.md#in-every-language
import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import RuleCriteria, {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../../Types/Rules/RuleCriteria";
import { RuleCriteriaSubject } from "../../../../Types/Rules/RuleCriteriaSubject";
import IncidentOnCallRule from "../../../../Models/DatabaseModels/IncidentOnCallRule";
import NetworkSiteAssignmentRule from "../../../../Models/DatabaseModels/NetworkSiteAssignmentRule";
import StatusPageMonitorRule from "../../../../Models/DatabaseModels/StatusPageMonitorRule";
import AutoRemediationRule from "../../../../Models/DatabaseModels/AutoRemediationRule";
import Field from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import RuleCriteriaSummary, {
  getRuleCriteriaSummaryText,
  RULE_CRITERIA_ADDRESS_RANGE_SENTENCES,
  RULE_CRITERIA_CONDITION_SENTENCES,
  RULE_CRITERIA_LIST_SENTENCES,
  RULE_CRITERIA_MATCH_ALL_SENTENCE,
  RULE_CRITERIA_MATCH_ANY_SENTENCE,
  RULE_CRITERIA_SUMMARY_INVALID,
  RULE_CRITERIA_SUMMARY_MATCHES_NOTHING,
  RULE_CRITERIA_YES_OR_NO_SENTENCES,
} from "../../../../UI/Components/RuleCriteria/RuleCriteriaSummary";
import { RULE_CRITERIA_OPERATOR_LABELS } from "../../../../UI/Components/RuleCriteria/RuleCriteriaFields";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../../Helpers/IsolateMarks";
import {
  translatableTerm,
  Translator,
} from "../../../../UI/Utils/TranslateTemplate";

/*
 * A RULE'S MATCH CRITERIA, ONE SENTENCE PER CONDITION IN THE READER'S
 * LANGUAGE (#7958).
 *
 * Every rule table's Match Criteria column (Network > Settings > Auto
 * Import Rules, site assignment rules, label rules...) and a rule run's
 * details sum a rule's conditions up. The line was glued in English - the
 * field's title, the operator's label lowercased, the value in quotes - so
 * it read `IP Address is in "10.16.0.0/16"` under a German or a Hindi
 * header, and on a Persian page its closing quote jumped to the far side.
 *
 * Each condition is one sentence now: the field is the product's word,
 * looked up with it; the value is what a person typed, set apart as
 * written; the quotes are the sentence's, so a language writes its own.
 * "Match all:" and "Match any:" are sentences of their own around the
 * conditions. With no conditions the rule says what its form says - "All
 * incidents" - or that it matches nothing. English reads exactly as the
 * line did, and the table exports that English.
 *
 * Rendered through i18next with the Dashboard's own locale files.
 */

const INCIDENT_FIELDS: Array<Field<IncidentOnCallRule>> = [
  {
    field: { incidentTitlePattern: true },
    title: "Incident Title",
    stepId: "match-criteria",
    fieldType: FormFieldSchemaType.Text,
  },
];

// A site assignment rule's address range and host name.
const SITE_FIELDS: Array<Field<NetworkSiteAssignmentRule>> = [
  {
    field: { subnetCidr: true },
    title: "IP Address",
    stepId: "match-criteria",
    fieldType: FormFieldSchemaType.Text,
  },
  {
    field: { hostnamePattern: true },
    title: "Hostname",
    stepId: "match-criteria",
    fieldType: FormFieldSchemaType.Text,
  },
];

function criteria(
  filters: RuleCriteria["filters"],
  filterCondition: FilterCondition = FilterCondition.All,
): RuleCriteria {
  return {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition: filterCondition,
    filters: filters,
  };
}

function oneConditionRule(): NetworkSiteAssignmentRule {
  const rule: NetworkSiteAssignmentRule = new NetworkSiteAssignmentRule();
  rule.criteria = criteria([
    {
      field: "subnetCidr",
      operator: RuleCriteriaOperator.MatchesPattern,
      value: "10.16.0.0/16",
    },
  ]);
  return rule;
}

function twoConditionRule(
  filterCondition: FilterCondition,
): NetworkSiteAssignmentRule {
  const rule: NetworkSiteAssignmentRule = new NetworkSiteAssignmentRule();
  rule.criteria = criteria(
    [
      {
        field: "subnetCidr",
        operator: RuleCriteriaOperator.MatchesPattern,
        value: "10.16.0.0/16",
      },
      {
        field: "hostnamePattern",
        operator: RuleCriteriaOperator.StartsWith,
        value: "core-sw",
      },
    ],
    filterCondition,
  );
  return rule;
}

// Every sentence a summary can say, each a key of the locale files.
const SENTENCES: Array<string> = [
  ...(Object.values(RULE_CRITERIA_CONDITION_SENTENCES) as Array<string>),
  ...(Object.values(RULE_CRITERIA_ADDRESS_RANGE_SENTENCES) as Array<string>),
  ...(Object.values(RULE_CRITERIA_YES_OR_NO_SENTENCES) as Array<string>),
  RULE_CRITERIA_MATCH_ALL_SENTENCE,
  RULE_CRITERIA_MATCH_ANY_SENTENCE,
  RULE_CRITERIA_SUMMARY_MATCHES_NOTHING,
  RULE_CRITERIA_SUMMARY_INVALID,
];

// The list sentences, each with its one form.
const LIST_SENTENCES: Array<string> = Object.values(
  RULE_CRITERIA_LIST_SENTENCES,
).flatMap((template: { one: string; other: string }): Array<string> => {
  return [template.other, `${template.other}_one`];
});

const RENDERED: ReadonlyArray<string> = ["en", "de", "hi", "fa", "ar", "ja"];

const languages: Record<string, i18n> = {};

beforeAll(async () => {
  for (const code of RENDERED) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: code,
      fallbackLng: "en",
      resources: { [code]: { translation: readDashboardLocale(code) } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    languages[code] = instance;
  }
});

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("dir");
});

function renderSummary(
  code: string,
  element: React.ReactElement,
): HTMLElement {
  if (code === "fa" || code === "ar") {
    document.documentElement.setAttribute("dir", "rtl");
  }

  render(
    <I18nextProvider i18n={languages[code] as i18n}>
      {element}
    </I18nextProvider>,
  );

  return screen.getByTestId("rule-criteria-summary");
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(
    /\{\{\s*(\w+)\s*\}\}/g,
    (whole: string, name: string): string => {
      return values[name] ?? whole;
    },
  );
}

/*
 * What a language says for the two conditions, as its file words them: the
 * field's word in the sentence's, the value as typed (with the spaces a
 * Japanese sentence closes up beside a term, as every sentence does).
 */
function inLanguage(code: string): {
  isIn: string;
  startsWith: string;
} {
  const translator: Translator = dashboardTranslator(code);

  return {
    isIn: translator.translateTemplate("{{field}} is in “{{value}}”", {
      field: translatableTerm("IP Address"),
      value: "10.16.0.0/16",
    }),
    startsWith: translator.translateTemplate(
      "{{field}} starts with “{{value}}”",
      { field: translatableTerm("Hostname"), value: "core-sw" },
    ),
  };
}

test("the expected sentences are the locale's own (control)", () => {
  expect(inLanguage("de")).toEqual({
    isIn: "IP-Adresse liegt in „10.16.0.0/16“",
    startsWith: "Hostname beginnt mit „core-sw“",
  });
  expect(inLanguage("ja").isIn).toBe("IP アドレスが「10.16.0.0/16」の範囲内");
  expect(inLanguage("fa").isIn).toBe("آدرس IP در محدوده «10.16.0.0/16» است");
});

describe("the sentences a summary says", () => {
  test("every operator says one, in English as the line always read", () => {
    for (const operator of Object.values(RuleCriteriaOperator)) {
      const label: string = RULE_CRITERIA_OPERATOR_LABELS[operator];
      const sentence: string | undefined =
        RULE_CRITERIA_CONDITION_SENTENCES[operator] ||
        (RULE_CRITERIA_LIST_SENTENCES as Record<string, { other: string }>)[
          operator
        ]?.other;

      expect({ operator, sentence: sentence?.includes(` ${label.toLocaleLowerCase()} `) }).toEqual({
        operator,
        sentence: true,
      });
    }
  });

  test("each is a key of the English locale file", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const key of [...SENTENCES, ...LIST_SENTENCES]) {
      expect({ key, inEnglish: english[key] !== undefined }).toEqual({
        key,
        inEnglish: true,
      });
    }
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s words every one of them",
    (language: string) => {
      expect(
        [...SENTENCES, ...LIST_SENTENCES].filter((key: string): boolean => {
          return !isWordedInDashboardLocale(key, language);
        }),
      ).toEqual([]);
    },
  );

  test.each(DASHBOARD_LANGUAGES)(
    "%s keeps the quotes with the value, as its own quotes",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const key of SENTENCES.filter((sentence: string): boolean => {
        return sentence.includes("“{{value}}”");
      })) {
        // A quote mark on each side of the value, whatever marks the language uses.
        expect({
          language,
          key,
          quoted: /[“”„«»「」‘’"]\s?\{\{value\}\}\s?[“”„«»「」‘’"]/u.test(
            words[key] || "",
          ),
        }).toEqual({ language, key, quoted: true });
      }
    },
  );

  test("a sentence put back to English in one locale is caught (control)", () => {
    const words: Record<string, string> = readDashboardLocale("hi");
    const key: string = RULE_CRITERIA_ADDRESS_RANGE_SENTENCES[
      RuleCriteriaOperator.MatchesPattern
    ] as string;
    const worded: string = words[key] as string;

    words[key] = key;

    try {
      expect(
        SENTENCES.filter((sentence: string): boolean => {
          return !isWordedInDashboardLocale(sentence, "hi");
        }),
      ).toEqual([key]);
    } finally {
      words[key] = worded;
    }
  });
});

describe("the summary as text, for the table's export and search", () => {
  test("is English, word for word as it always read", () => {
    expect(getRuleCriteriaSummaryText({ fields: SITE_FIELDS, item: oneConditionRule() })).toBe(
      "IP Address is in “10.16.0.0/16”",
    );
    expect(
      getRuleCriteriaSummaryText({
        fields: SITE_FIELDS,
        item: twoConditionRule(FilterCondition.Any),
      }),
    ).toBe("Match any: IP Address is in “10.16.0.0/16”; Hostname starts with “core-sw”");

    const listRule: IncidentOnCallRule = new IncidentOnCallRule();
    listRule.criteria = criteria([
      {
        field: "monitorLabels",
        operator: RuleCriteriaOperator.HasNoneOf,
        value: ["a", "b"],
      },
      {
        field: "enabled",
        operator: RuleCriteriaOperator.Equals,
        value: true,
      },
    ]);

    expect(getRuleCriteriaSummaryText({ fields: [], item: listRule })).toBe(
      "Match all: Monitor Labels has none of 2 selected values; Enabled equals true",
    );
  });

  test("handed the reader's translator, it is in their language", () => {
    const words: Record<string, string> = readDashboardLocale("de");

    expect(
      getRuleCriteriaSummaryText(
        { fields: SITE_FIELDS, item: twoConditionRule(FilterCondition.All) },
        dashboardTranslator("de"),
      ),
    ).toBe(
      fill(words["Match all: {{conditions}}"]!, {
        conditions: `${inLanguage("de").isIn}; ${inLanguage("de").startsWith}`,
      }),
    );
  });
});

describe("a rule's Match Criteria cell, in the reader's language", () => {
  test("a rule with no conditions reads the form's own answer", () => {
    const rule: IncidentOnCallRule = new IncidentOnCallRule();
    rule.criteria = criteria([]);

    const summary: HTMLElement = renderSummary(
      "de",
      <RuleCriteriaSummary fields={INCIDENT_FIELDS} item={rule} />,
    );

    expect(summary).toHaveTextContent(/^Alle Vorfälle$/);
    expect(summary).toHaveAttribute("title", "Alle Vorfälle");
  });

  test("a table of several kinds of record names the ones it lists", () => {
    const rule: AutoRemediationRule = new AutoRemediationRule();
    rule.criteria = criteria([]);

    expect(
      renderSummary(
        "de",
        <RuleCriteriaSummary
          fields={[]}
          item={rule}
          subject={RuleCriteriaSubject.Alerts}
        />,
      ),
    ).toHaveTextContent(/^Alle Warnungen$/);
  });

  test.each(["en", "de", "hi"])(
    "a rule kind that needs a condition says it matches nothing, in %s",
    (code: string) => {
      const words: Record<string, string> = readDashboardLocale(code);
      const summary: HTMLElement = renderSummary(
        code,
        <RuleCriteriaSummary fields={[]} item={new StatusPageMonitorRule()} />,
      );

      expect(summary).toHaveTextContent(
        words["Matches nothing (no conditions)"]!,
      );
      expect(summary).not.toHaveTextContent("All monitors");
    },
  );

  test("in English a condition reads as it always did", () => {
    const rule: IncidentOnCallRule = new IncidentOnCallRule();
    rule.criteria = criteria([
      {
        field: "incidentTitlePattern",
        operator: RuleCriteriaOperator.Contains,
        value: "database",
      },
    ]);

    const summary: HTMLElement = renderSummary(
      "en",
      <RuleCriteriaSummary fields={INCIDENT_FIELDS} item={rule} />,
    );

    expect(summary).toHaveTextContent(/^Incident Title contains “database”$/);
    expect(summary).toHaveAttribute(
      "title",
      "Incident Title contains “database”",
    );

    cleanup();

    expect(
      renderSummary(
        "en",
        <RuleCriteriaSummary
          fields={SITE_FIELDS}
          item={twoConditionRule(FilterCondition.Any)}
        />,
      ).textContent,
    ).toBe(
      "Match any: IP Address is in “10.16.0.0/16”; Hostname starts with “core-sw”",
    );
  });

  test.each(["de", "hi", "fa", "ar", "ja"])(
    "in %s one condition is the language's sentence, never the English",
    (code: string) => {
      const summary: HTMLElement = renderSummary(
        code,
        <RuleCriteriaSummary fields={SITE_FIELDS} item={oneConditionRule()} />,
      );
      const said: string = withoutIsolateMarks(summary.textContent || "");

      expect(said).toBe(inLanguage(code).isIn);
      expect(said).not.toMatch(/IP Address|\bis in\b/);
      // The whole of it on hover, in the same words.
      expect(withoutIsolateMarks(summary.getAttribute("title") || "")).toBe(
        inLanguage(code).isIn,
      );
    },
  );

  test.each(["de", "hi", "fa", "ar", "ja"])(
    "in %s two conditions are combined in the language's words",
    (code: string) => {
      const words: Record<string, string> = readDashboardLocale(code);
      const { isIn, startsWith } = inLanguage(code);
      const separator: string =
        code === "fa" || code === "ar" ? "؛ " : code === "ja" ? "；" : "; ";

      for (const [condition, key] of [
        [FilterCondition.All, "Match all: {{conditions}}"],
        [FilterCondition.Any, "Match any: {{conditions}}"],
      ] as Array<[FilterCondition, string]>) {
        const said: string = withoutIsolateMarks(
          renderSummary(
            code,
            <RuleCriteriaSummary
              fields={SITE_FIELDS}
              item={twoConditionRule(condition)}
            />,
          ).textContent || "",
        );

        expect(said).toBe(
          fill(words[key]!, {
            conditions: `${isIn}${separator}${startsWith}`,
          }),
        );
        expect(said).not.toMatch(/Match (all|any)|starts with/);

        cleanup();
      }
    },
  );

  test("German writes the value in its own quotes", () => {
    expect(
      renderSummary(
        "de",
        <RuleCriteriaSummary fields={SITE_FIELDS} item={oneConditionRule()} />,
      ),
    ).toHaveTextContent(/^IP-Adresse liegt in „10\.16\.0\.0\/16“$/);
  });

  test.each(["fa", "ar"])(
    "in %s the value is set apart as written, inside the language's quotes",
    (code: string) => {
      const summary: HTMLElement = renderSummary(
        code,
        <RuleCriteriaSummary fields={SITE_FIELDS} item={oneConditionRule()} />,
      );
      const values: Array<HTMLElement> = Array.from(
        summary.querySelectorAll<HTMLElement>("bdi"),
      );

      expect(
        values.map((value: HTMLElement): string => {
          return value.textContent || "";
        }),
      ).toEqual(["10.16.0.0/16"]);

      // Guillemets around the isolate: no quote jumps to the line's far side.
      expect(withoutIsolateMarks(summary.textContent || "")).toContain(
        "«10.16.0.0/16»",
      );
      expect(summary.textContent).not.toContain("“");
    },
  );

  test("a list of records is counted in the reader's plural forms", () => {
    const rule: IncidentOnCallRule = new IncidentOnCallRule();
    rule.criteria = criteria([
      {
        field: "monitorLabels",
        operator: RuleCriteriaOperator.HasAnyOf,
        value: ["a", "b", "c"],
      },
    ]);
    const fields: Array<Field<IncidentOnCallRule>> = [
      {
        field: { monitorLabels: true },
        title: "Monitor Labels",
        stepId: "match-criteria",
        fieldType: FormFieldSchemaType.MultiSelectDropdown,
      },
    ];
    const words: Record<string, string> = readDashboardLocale("fa");

    expect(
      withoutIsolateMarks(
        renderSummary(
          "fa",
          <RuleCriteriaSummary fields={fields} item={rule} />,
        ).textContent || "",
      ),
    ).toBe(
      fill(words["{{field}} has any of {{count}} selected values"]!, {
        field: words["Monitor Labels"]!,
        count: "۳",
      }),
    );
  });

  test("a yes or no is said in the reader's words", () => {
    const rule: IncidentOnCallRule = new IncidentOnCallRule();
    rule.criteria = criteria([
      {
        field: "enabled",
        operator: RuleCriteriaOperator.Equals,
        value: false,
      },
    ]);

    expect(
      renderSummary("de", <RuleCriteriaSummary fields={[]} item={rule} />),
    ).toHaveTextContent(/^Aktiviert ist gleich falsch$/);
  });
});
