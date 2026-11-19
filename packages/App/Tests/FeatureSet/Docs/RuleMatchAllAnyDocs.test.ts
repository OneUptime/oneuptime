import {
  listPages,
  readPage,
  TRANSLATED_LANGUAGES,
} from "./DocsContentSupport";
import { drawnDashboardLabel, isDashboardLabel } from "./DocsDashboardLabels";
import { readCommonSource } from "./DocsDashboardMenus";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import RuleCriteria, {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaFilter,
  RuleCriteriaOperator,
} from "Common/Types/Rules/RuleCriteria";
import { RuleCriteriaMatcher } from "Common/Utils/Rules/RuleCriteriaMatcher";
import { RuleCriteriaCopy } from "Common/UI/Components/RuleCriteria/RuleCriteriaFields";
import { describe, expect, it } from "@jest/globals";

/*
 * A RULE WITH TWO OR MORE CONDITIONS MATCHES ALL OF THEM OR ANY ONE, AND THE
 * DOCS SAY SO.
 *
 * Every rule's Match step is the one condition builder (RuleCriteriaBuilder):
 * with two or more conditions it asks "Match all", where a rule starts, or
 * "Match any", and the rule engines honour the answer (RuleCriteriaMatcher).
 * The Scheduled Maintenance settings page went on describing the form the
 * builder replaced - a table of fixed conditions, where "every condition you
 * fill in" had to hold - and a reader setting a rule to Match any was told
 * the opposite of what it does (#9026).
 *
 * The pages that say how a rule's conditions combine name both answers as
 * the builder draws them, in every docs language as that language's
 * Dashboard draws them, as often as the English page does. No English page
 * says a rule matches only when every condition filled in holds. Markdown is
 * not compiled, so nothing else notices a page left behind.
 */

/*
 * The pages that describe how a rule's conditions are combined: the rule
 * forms walked step by step, and the settings pages that sum them up.
 */
const PAGES: ReadonlyArray<string> = [
  "configuration/label-and-owner-rules",
  "slo/label-and-owner-rules",
  "slo/monitor-rules",
  "runbooks/rules",
  "incidents/settings",
  "alerts/settings",
  "scheduled-maintenance/settings",
];

/*
 * What the pages said of the form before the builder: conditions that are
 * fields, each skipped when empty, all of which had to hold. Read without
 * regard to case or bold.
 */
const RETIRED_WORDINGS: ReadonlyArray<string> = [
  "every condition you fill in",
  "every condition you filled in",
  "a condition left empty is skipped",
  "only when all specified criteria pass",
];

// The two answers, in English, as the builder draws them.
const ANSWERS: ReadonlyArray<string> = [
  RuleCriteriaCopy.matchAll,
  RuleCriteriaCopy.matchAny,
];

function boldCount(markdown: string, label: string): number {
  return markdown.split(`**${label}**`).length - 1;
}

// A page's words without bold, lowered, so a wording is found however set.
function plainWords(markdown: string): string {
  return markdown.split("**").join("").toLowerCase();
}

// Matches a rule's criteria as the engines do, with one filter that holds.
function matches(
  filterCondition: FilterCondition,
  filters: Array<RuleCriteriaFilter>,
  holds: RuleCriteriaFilter,
): boolean {
  const criteria: RuleCriteria = {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition: filterCondition,
    filters: filters,
  };

  return RuleCriteriaMatcher.matchesSync({
    criteria: criteria,
    emptyResult: true,
    matchesFilter: (filter: RuleCriteriaFilter): boolean => {
      return filter === holds;
    },
  });
}

describe("the builder's two answers", () => {
  const builder: string = readCommonSource(
    "UI/Components/RuleCriteria/RuleCriteriaBuilder.tsx",
  );

  it("are Match all and Match any, the Dashboard's own labels", () => {
    expect(ANSWERS).toEqual(["Match all", "Match any"]);

    for (const answer of ANSWERS) {
      expect({ answer, label: isDashboardLabel(answer) }).toEqual({
        answer,
        label: true,
      });
    }
  });

  it("are offered once there are two conditions, a new rule starting on Match all", () => {
    expect(builder).toContain("[FilterCondition.All, FilterCondition.Any]");
    expect(builder).toContain(
      "next.filterCondition || criteria.filterCondition || FilterCondition.All,",
    );
    expect(builder).toContain(
      "{isFilterConditionNeeded(criteria.filters) && (",
    );
  });

  it("decide the match: every condition under Match all, one under Match any", () => {
    const holds: RuleCriteriaFilter = {
      field: "titlePattern",
      operator: RuleCriteriaOperator.Contains,
      value: "database",
    };
    const fails: RuleCriteriaFilter = {
      field: "descriptionPattern",
      operator: RuleCriteriaOperator.Contains,
      value: "network",
    };

    expect(matches(FilterCondition.All, [holds, fails], holds)).toBe(false);
    expect(matches(FilterCondition.All, [holds], holds)).toBe(true);
    expect(matches(FilterCondition.Any, [fails, holds], holds)).toBe(true);
    expect(matches(FilterCondition.Any, [fails], holds)).toBe(false);
  });
});

describe.each(
  PAGES.map((page: string): [string] => {
    return [page];
  }),
)("%s", (page: string) => {
  const english: string = readPage("en", page);

  it("names both answers, as the builder draws them", () => {
    for (const answer of ANSWERS) {
      expect({ answer, named: boldCount(english, answer) > 0 }).toEqual({
        answer,
        named: true,
      });
    }
  });

  it.each(TRANSLATED_LANGUAGES)(
    "names them in %s as its Dashboard draws them, as often as the English page",
    (language: string) => {
      const translated: string = readPage(language, page);

      for (const answer of ANSWERS) {
        const local: string = drawnDashboardLabel(language, answer);

        expect({
          answer,
          local,
          count: boldCount(translated, local),
        }).toEqual({ answer, local, count: boldCount(english, answer) });
      }
    },
  );
});

describe("every English docs page", () => {
  it("lists the pages above among its pages", () => {
    const pages: Array<string> = listPages("en");

    for (const page of PAGES) {
      expect({ page, listed: pages.includes(page) }).toEqual({
        page,
        listed: true,
      });
    }
  });

  it("no longer says a rule matches only when every condition filled in holds", () => {
    const found: Array<string> = [];

    for (const page of listPages("en")) {
      const words: string = plainWords(readPage("en", page));

      for (const wording of RETIRED_WORDINGS) {
        if (words.includes(wording)) {
          found.push(`${page}: ${wording}`);
        }
      }
    }

    expect(found).toEqual([]);
  });
});

describe("the reader", () => {
  it("finds a retired wording in bold or not, whatever its case", () => {
    expect(
      plainWords("Check that **Every condition you fill in** holds."),
    ).toContain(RETIRED_WORDINGS[0]);
    expect(plainWords("A Condition Left Empty Is Skipped.")).toContain(
      RETIRED_WORDINGS[2],
    );
  });

  it("counts a bold answer, not the same words unbolded", () => {
    expect(
      boldCount(
        "Choose **Match all** or **Match any**; Match all starts.",
        "Match all",
      ),
    ).toBe(1);
  });
});
