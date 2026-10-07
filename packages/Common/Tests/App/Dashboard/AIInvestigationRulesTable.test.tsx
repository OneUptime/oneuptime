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
 * Incidents (or Alerts) → Settings → AI → More settings → Investigation
 * rules: which new incidents OneUptime AI investigates on its own. With no
 * rule, every one is; with rules, only the ones that match at least one. A
 * rule is a name and its conditions - the same conditions, read the same
 * way, as an auto remediation rule's.
 *
 * Only the props the table hands to ModelTable are under test, so the table
 * is captured instead of rendered.
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

import AIInvestigationRulesTable, {
  AI_LANE_INVESTIGATION_RULE_TRIGGER,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/AIInvestigationRulesTable";
import AutoRemediationRulesTable from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/AutoRemediationRulesTable";
import {
  AI_LANE_INVESTIGATION_RULES_TABLE_ID,
  AI_LANE_REMEDIATION_RULES_TABLE_ID,
  AI_LANE_RULES_COPY,
  AiLane,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import AIInvestigationRule from "../../../Models/DatabaseModels/AIInvestigationRule";
import AIInvestigationRuleTriggerEntity from "../../../Types/AI/AIInvestigationRuleTriggerEntity";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";

interface CapturedField {
  field?: Record<string, unknown>;
  title?: string;
  stepId?: string;
  fieldType?: FormFieldSchemaType;
  required?: boolean;
  doNotShowWhenCreating?: boolean;
  dropdownModal?: { type?: unknown };
}

function captured(element: React.ReactElement): Record<string, unknown> {
  render(element);

  return mockCapturedTableProps[mockCapturedTableProps.length - 1] || {};
}

function tableFor(lane: AiLane): Record<string, unknown> {
  return captured(<AIInvestigationRulesTable lane={lane} />);
}

function fieldsOf(props: Record<string, unknown>): Array<CapturedField> {
  return (props["formFields"] || []) as Array<CapturedField>;
}

function keyOf(field: CapturedField): string {
  return Object.keys(field.field || {})[0] || "";
}

async function fetchAndSettle(props: Record<string, unknown>): Promise<void> {
  (props["onFetchSuccess"] as (data: Array<unknown>, n: number) => void)([], 7);
  await new Promise((resolve: (value: unknown) => void) => {
    setTimeout(resolve, 0);
  });
}

beforeEach(() => {
  mockCapturedTableProps.length = 0;
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe.each([
  [AiLane.Incident, AIInvestigationRuleTriggerEntity.Incident, "incident"],
  [AiLane.Alert, AIInvestigationRuleTriggerEntity.Alert, "alert"],
])(
  "the %s investigation rules table",
  (lane: AiLane, trigger: AIInvestigationRuleTriggerEntity, noun: string) => {
    test("is a table of investigation rules of its own kind", async () => {
      const props: Record<string, unknown> = tableFor(lane);

      expect(props["modelType"]).toBe(AIInvestigationRule);
      expect(AI_LANE_INVESTIGATION_RULE_TRIGGER[lane]).toBe(trigger);
      expect(props["query"]).toEqual({ triggerEntityType: trigger });

      const created: AIInvestigationRule = await (
        props["onBeforeCreate"] as (
          item: AIInvestigationRule,
        ) => Promise<AIInvestigationRule>
      )(new AIInvestigationRule());

      expect(created.triggerEntityType).toBe(trigger);
    });

    test("says what having no rule means", () => {
      const props: Record<string, unknown> = tableFor(lane);

      expect(props["cardProps"]).toEqual({
        title: "Investigation rules",
        description: AI_LANE_RULES_COPY[lane].investigationRulesDescription,
      });
      expect(AI_LANE_RULES_COPY[lane].investigationRulesDescription).toBe(
        `With no rule, OneUptime AI investigates every new ${noun}. Add rules to investigate only the ${noun}s that match one of them.`,
      );
      expect(props["noItemsMessage"]).toBe(
        `No rules. Every new ${noun} is investigated.`,
      );
    });

    test("keeps its own id and preferences, apart from the remediation rules", () => {
      const props: Record<string, unknown> = tableFor(lane);

      expect(props["id"]).toBe(AI_LANE_INVESTIGATION_RULES_TABLE_ID[lane]);
      expect(props["userPreferencesKey"]).toBe(
        AI_LANE_INVESTIGATION_RULES_TABLE_ID[lane],
      );
      expect(AI_LANE_INVESTIGATION_RULES_TABLE_ID[lane]).not.toBe(
        AI_LANE_REMEDIATION_RULES_TABLE_ID[lane],
      );
    });

    test("a rule is a name and its conditions", () => {
      const props: Record<string, unknown> = tableFor(lane);

      expect(props["formSteps"]).toEqual([
        { title: "Rule", id: "basic-info" },
        { title: "Conditions", id: "match-criteria" },
      ]);
      expect(
        fieldsOf(props).map((field: CapturedField): [string, string] => {
          return [keyOf(field), field.stepId || ""];
        }),
      ).toEqual([
        ["name", "basic-info"],
        ["isEnabled", "basic-info"],
        ["monitors", "match-criteria"],
        [
          lane === AiLane.Incident ? "incidentSeverities" : "alertSeverities",
          "match-criteria",
        ],
        ["labels", "match-criteria"],
        ["monitorLabels", "match-criteria"],
        ["titlePattern", "match-criteria"],
        ["descriptionPattern", "match-criteria"],
      ]);
    });

    test("its name is required, and a new rule starts on", () => {
      const fields: Array<CapturedField> = fieldsOf(tableFor(lane));

      expect(fields[0]!.required).toBe(true);
      expect(fields[1]!.fieldType).toBe(FormFieldSchemaType.Toggle);
      expect(fields[1]!.doNotShowWhenCreating).toBe(true);
    });

    test("its conditions are the auto remediation rules' conditions", () => {
      const investigation: Array<CapturedField> = fieldsOf(
        tableFor(lane),
      ).filter((field: CapturedField): boolean => {
        return field.stepId === "match-criteria";
      });
      const remediation: Array<CapturedField> = fieldsOf(
        captured(<AutoRemediationRulesTable lane={lane} />),
      ).filter((field: CapturedField): boolean => {
        return field.stepId === "match-criteria";
      });

      expect(
        investigation.map((field: CapturedField) => {
          return [keyOf(field), field.title, field.fieldType];
        }),
      ).toEqual(
        remediation.map((field: CapturedField) => {
          return [keyOf(field), field.title, field.fieldType];
        }),
      );
    });

    test("after every read, reports how many of its rules are enabled", async () => {
      const count: jest.SpiedFunction<typeof ModelAPI.count> = jest
        .spyOn(ModelAPI, "count")
        .mockResolvedValue(2 as never);
      const reported: Array<number> = [];

      await fetchAndSettle(
        captured(
          <AIInvestigationRulesTable
            lane={lane}
            onRulesLoaded={(rules: number) => {
              reported.push(rules);
            }}
          />,
        ),
      );

      expect(count).toHaveBeenCalledWith({
        modelType: AIInvestigationRule,
        query: { triggerEntityType: trigger, isEnabled: true },
      });
      expect(reported).toEqual([2]);
    });

    test("a page that does not listen is never counted for", async () => {
      const count: jest.SpiedFunction<typeof ModelAPI.count> = jest
        .spyOn(ModelAPI, "count")
        .mockResolvedValue(2 as never);

      await fetchAndSettle(tableFor(lane));

      expect(count).not.toHaveBeenCalled();
    });

    test("says nothing about its rules when it cannot count them", async () => {
      jest
        .spyOn(ModelAPI, "count")
        .mockRejectedValue(new Error("offline") as never);
      const reported: Array<number> = [];

      await fetchAndSettle(
        captured(
          <AIInvestigationRulesTable
            lane={lane}
            onRulesLoaded={(rules: number) => {
              reported.push(rules);
            }}
          />,
        ),
      );

      expect(reported).toEqual([]);
    });
  },
);
