import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

/*
 * A rule's Match Criteria cell and its page say what the rule applies to.
 * With no conditions that is the form's own answer - "All incidents" - so it
 * reads in the reader's language, as the form does. The translation hook
 * here wraps what it is handed in «», so a looked-up string shows it.
 * Conditions are the page's own field names and the values people typed:
 * they are drawn as they are.
 */

jest.mock("../../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      const wrap: (value: string | undefined) => string | undefined = (
        value: string | undefined,
      ): string | undefined => {
        return value ? `«${value}»` : value;
      };

      return {
        translateString: wrap,
        translateValue: (value: unknown): unknown => {
          return typeof value === "string" ? wrap(value) : value;
        },
      };
    },
  };
});

import FilterCondition from "../../../../Types/Filter/FilterCondition";
import RuleCriteria, {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../../Types/Rules/RuleCriteria";
import { RuleCriteriaSubject } from "../../../../Types/Rules/RuleCriteriaSubject";
import IncidentOnCallRule from "../../../../Models/DatabaseModels/IncidentOnCallRule";
import StatusPageMonitorRule from "../../../../Models/DatabaseModels/StatusPageMonitorRule";
import AutoRemediationRule from "../../../../Models/DatabaseModels/AutoRemediationRule";
import Field from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import RuleCriteriaSummary from "../../../../UI/Components/RuleCriteria/RuleCriteriaSummary";

const FIELDS: Array<Field<IncidentOnCallRule>> = [
  {
    field: { incidentTitlePattern: true },
    title: "Incident Title",
    stepId: "match-criteria",
    fieldType: FormFieldSchemaType.Text,
  },
];

function criteria(filters: RuleCriteria["filters"]): RuleCriteria {
  return {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition: FilterCondition.All,
    filters: filters,
  };
}

afterEach(() => {
  cleanup();
});

describe("a rule's Match Criteria summary", () => {
  test("a rule with no conditions reads the form's own answer, translated", () => {
    const rule: IncidentOnCallRule = new IncidentOnCallRule();
    rule.criteria = criteria([]);

    render(<RuleCriteriaSummary fields={FIELDS} item={rule} />);

    const summary: HTMLElement = screen.getByTestId("rule-criteria-summary");
    expect(summary).toHaveTextContent(/^«All incidents»$/);
    // The full text on hover, the same words.
    expect(summary).toHaveAttribute("title", "«All incidents»");
  });

  test("a table of several kinds of record names the ones it lists", () => {
    const rule: AutoRemediationRule = new AutoRemediationRule();
    rule.criteria = criteria([]);

    render(
      <RuleCriteriaSummary
        fields={[]}
        item={rule}
        subject={RuleCriteriaSubject.Alerts}
      />,
    );

    expect(screen.getByTestId("rule-criteria-summary")).toHaveTextContent(
      /^«All alerts»$/,
    );
  });

  test("conditions are drawn as the page names them and as they were typed", () => {
    const rule: IncidentOnCallRule = new IncidentOnCallRule();
    rule.criteria = criteria([
      {
        field: "incidentTitlePattern",
        operator: RuleCriteriaOperator.Contains,
        value: "database",
      },
    ]);

    render(<RuleCriteriaSummary fields={FIELDS} item={rule} />);

    expect(screen.getByTestId("rule-criteria-summary")).toHaveTextContent(
      /^Incident Title contains “database”$/,
    );
  });

  test("a rule kind that needs a condition says it matches nothing without one", () => {
    render(
      <RuleCriteriaSummary fields={[]} item={new StatusPageMonitorRule()} />,
    );

    const summary: HTMLElement = screen.getByTestId("rule-criteria-summary");
    expect(summary).toHaveTextContent("Matches nothing (no conditions)");
    expect(summary).not.toHaveTextContent("All monitors");
  });
});
