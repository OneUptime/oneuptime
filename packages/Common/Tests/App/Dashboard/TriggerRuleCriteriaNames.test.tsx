import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";

/*
 * Runbook rules and auto-remediation rules are one table each, shown on the
 * incident, alert (and, for runbooks, scheduled maintenance) settings. Their
 * criteria names are built from the kind of record the table matches, so the
 * same condition reads "Incident Title" on an incident rule and "Alert Title"
 * on an alert rule - the words the other rules of each product use - and never
 * the bare "Title Pattern" they had.
 */
const mockCapturedTableProps: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): null => {
      mockCapturedTableProps.push(props);
      return null;
    },
  };
});

import AutoRemediationRulesTable from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/AutoRemediationRulesTable";
import RunbookRulesTable, {
  getRunbookRuleCriteriaSubject,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/RunbookRulesTable";
import AutoRemediationTriggerEntity from "../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import RunbookRuleTriggerEntity from "../../../Types/Runbook/RunbookRuleTriggerEntity";

interface CapturedField {
  field?: Record<string, unknown>;
  title?: string;
  stepId?: string;
}

function criteriaTitles(): Array<string> {
  const props: Record<string, unknown> | undefined =
    mockCapturedTableProps[mockCapturedTableProps.length - 1];
  const fields: Array<CapturedField> = (props?.["formFields"] ||
    []) as Array<CapturedField>;

  return fields
    .filter((field: CapturedField): boolean => {
      return field.stepId === "match-criteria";
    })
    .map((field: CapturedField): string => {
      return field.title || "";
    });
}

beforeEach(() => {
  mockCapturedTableProps.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("runbook rule criteria", () => {
  test.each([
    [RunbookRuleTriggerEntity.Incident, "incident", "Incident"],
    [RunbookRuleTriggerEntity.Alert, "alert", "Alert"],
    [
      RunbookRuleTriggerEntity.ScheduledMaintenance,
      "scheduled maintenance event",
      "Event",
    ],
  ])(
    "%s rules name the title and description after the %s",
    (
      triggerEntityType: RunbookRuleTriggerEntity,
      entityLabel: string,
      subject: string,
    ) => {
      expect(getRunbookRuleCriteriaSubject(triggerEntityType)).toBe(subject);

      render(
        <RunbookRulesTable
          triggerEntityType={triggerEntityType}
          entityLabel={entityLabel}
        />,
      );

      expect(criteriaTitles()).toEqual([
        `${subject} Title`,
        `${subject} Description`,
      ]);
    },
  );
});

describe("auto-remediation rule criteria", () => {
  test.each([
    [AutoRemediationTriggerEntity.Incident, "incident", "Incident"],
    [AutoRemediationTriggerEntity.Alert, "alert", "Alert"],
  ])(
    "%s rules name their criteria like the other %s rules",
    (
      triggerEntityType: AutoRemediationTriggerEntity,
      entityLabel: string,
      subject: string,
    ) => {
      render(
        <AutoRemediationRulesTable
          triggerEntityType={triggerEntityType}
          entityLabel={entityLabel}
        />,
      );

      expect(criteriaTitles()).toEqual([
        "Monitors",
        `${subject} Severities`,
        `${subject} Labels`,
        "Monitor Labels",
        `${subject} Title`,
        `${subject} Description`,
      ]);
    },
  );
});
