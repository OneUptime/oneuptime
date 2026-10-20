import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";

/*
 * Incidents (or Alerts) → Settings → AI → More settings → Investigation
 * rules: which new incidents OneUptime AI investigates on its own, and when.
 * With no rule, every one is, right away; with rules, only the ones that
 * match at least one. A rule asks Match - the same conditions, read the
 * same way, as an auto remediation rule's - then Investigate: right away,
 * or only if still open after a wait (issue #5074), and its name.
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
import {
  INVESTIGATION_RULE_TIMING_FIELD_KEY,
  InvestigationRuleTiming,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/InvestigationRuleTiming";
import {
  RULE_ENABLED_DESCRIPTION,
  RULE_NAME_MAX_LENGTH,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/ResourceRuleForm";

// ModelAPI.count spied on, as jest-mock's spyOn types it.
type CountSpy = SpyInstance<
  (
    ...args: Parameters<typeof ModelAPI.count>
  ) => ReturnType<typeof ModelAPI.count>
>;

interface CapturedField {
  field?: Record<string, unknown>;
  overrideField?: Record<string, unknown>;
  overrideFieldKey?: string;
  formOnly?: boolean;
  title?: string;
  description?: string;
  placeholder?: string;
  stepId?: string;
  fieldType?: FormFieldSchemaType;
  required?: boolean;
  hideOptionalLabel?: boolean;
  hideColumnDescription?: boolean;
  doNotShowWhenCreating?: boolean;
  dropdownModal?: { type?: unknown };
  radioButtonOptions?: Array<{
    value: string;
    title: string;
    description?: string;
  }>;
  validation?: { minLength?: number; maxLength?: number };
  collapsibleSection?: { id?: string; title?: string };
  showIf?: (values: Record<string, unknown>) => boolean;
  customValidation?: (values: Record<string, unknown>) => string | null;
  getDefaultValue?: (values: Record<string, unknown>) => unknown;
  onChange?: (
    value: unknown,
    currentValues: Record<string, unknown>,
    setNewFormValues: (values: Record<string, unknown>) => void,
  ) => void;
}

interface CapturedColumn {
  field?: Record<string, unknown>;
  title?: string;
  disableSort?: boolean;
  getElement?: (item: AIInvestigationRule) => React.ReactElement;
  getExportValue?: (item: AIInvestigationRule) => string;
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

// A field's column, or the form value of a form-only field.
function keyOf(field: CapturedField): string {
  return field.overrideFieldKey || Object.keys(field.field || {})[0] || "";
}

function fieldNamed(
  props: Record<string, unknown>,
  key: string,
): CapturedField {
  const found: CapturedField | undefined = fieldsOf(props).find(
    (field: CapturedField): boolean => {
      return keyOf(field) === key;
    },
  );

  if (!found) {
    throw new Error(`No field ${key}`);
  }

  return found;
}

function columnsOf(props: Record<string, unknown>): Array<CapturedColumn> {
  return (props["columns"] || []) as Array<CapturedColumn>;
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
        `With no rule, OneUptime AI investigates every new ${noun} right away. Add rules to investigate only the ${noun}s that match one of them, or only those still open after a wait.`,
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

    test("a rule asks Match, then Investigate: when, and its name", () => {
      const props: Record<string, unknown> = tableFor(lane);

      expect(props["formSteps"]).toEqual([
        { title: "Match", id: "match-criteria" },
        { title: "Investigate", id: "investigate" },
      ]);
      expect(
        fieldsOf(props).map((field: CapturedField): [string, string] => {
          return [keyOf(field), field.stepId || ""];
        }),
      ).toEqual([
        ["monitors", "match-criteria"],
        [
          lane === AiLane.Incident ? "incidentSeverities" : "alertSeverities",
          "match-criteria",
        ],
        ["labels", "match-criteria"],
        ["monitorLabels", "match-criteria"],
        ["titlePattern", "match-criteria"],
        ["descriptionPattern", "match-criteria"],
        [INVESTIGATION_RULE_TIMING_FIELD_KEY, "investigate"],
        ["onlyIfOpenAfterMinutes", "investigate"],
        ["name", "investigate"],
        ["isEnabled", "investigate"],
        ["description", "investigate"],
      ]);
    });

    test("its name is required and held to a rule name's length, and a new rule starts on", () => {
      const props: Record<string, unknown> = tableFor(lane);
      const name: CapturedField = fieldNamed(props, "name");
      const enabled: CapturedField = fieldNamed(props, "isEnabled");

      expect(name.required).toBe(true);
      expect(name.validation).toEqual({
        minLength: 2,
        maxLength: RULE_NAME_MAX_LENGTH,
      });
      expect(name.placeholder).toBe(`Investigate production ${noun}s`);
      expect(enabled.fieldType).toBe(FormFieldSchemaType.Toggle);
      expect(enabled.doNotShowWhenCreating).toBe(true);
      expect(enabled.description).toBe(RULE_ENABLED_DESCRIPTION);
    });

    test("what most rules leave alone - the description - is folded under More fields", () => {
      const description: CapturedField = fieldNamed(
        tableFor(lane),
        "description",
      );

      expect(description.fieldType).toBe(FormFieldSchemaType.LongText);
      expect(description.required).toBe(false);
      expect(description.collapsibleSection?.title).toBe("More fields");
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

    test("when to investigate: right away, the default, or only if still open after a wait", () => {
      const timing: CapturedField = fieldNamed(
        tableFor(lane),
        INVESTIGATION_RULE_TIMING_FIELD_KEY,
      );

      expect(timing.formOnly).toBe(true);
      expect(timing.overrideField).toEqual({ onlyIfOpenAfterMinutes: true });
      expect(timing.fieldType).toBe(FormFieldSchemaType.RadioButton);
      expect(timing.title).toBe("When to investigate");
      expect(timing.required).toBe(true);
      expect(timing.hideColumnDescription).toBe(true);
      expect(timing.radioButtonOptions).toEqual([
        {
          value: InvestigationRuleTiming.RightAway,
          title: "Right away",
          description: `OneUptime AI starts as soon as the ${noun} is ${lane === AiLane.Incident ? "declared" : "created"}.`,
        },
        {
          value: InvestigationRuleTiming.AfterWait,
          title: "Only if still open after a wait",
          description: `${noun === "incident" ? "Incidents" : "Alerts"} resolved during the wait are not investigated.`,
        },
      ]);
    });

    test("the choice starts on what the rule's wait makes: right away for a new rule and a rule with none", () => {
      const timing: CapturedField = fieldNamed(
        tableFor(lane),
        INVESTIGATION_RULE_TIMING_FIELD_KEY,
      );

      expect(timing.getDefaultValue!({})).toBe(
        InvestigationRuleTiming.RightAway,
      );
      expect(timing.getDefaultValue!({ onlyIfOpenAfterMinutes: null })).toBe(
        InvestigationRuleTiming.RightAway,
      );
      expect(timing.getDefaultValue!({ onlyIfOpenAfterMinutes: 0 })).toBe(
        InvestigationRuleTiming.RightAway,
      );
      expect(timing.getDefaultValue!({ onlyIfOpenAfterMinutes: 30 })).toBe(
        InvestigationRuleTiming.AfterWait,
      );
    });

    test("picking writes the rule's wait: a wait starts on 10 minutes, right away clears it", () => {
      const timing: CapturedField = fieldNamed(
        tableFor(lane),
        INVESTIGATION_RULE_TIMING_FIELD_KEY,
      );
      const written: Array<Record<string, unknown>> = [];
      const write: (values: Record<string, unknown>) => void = (
        values: Record<string, unknown>,
      ): void => {
        written.push(values);
      };

      timing.onChange!(
        InvestigationRuleTiming.AfterWait,
        { name: "Prod" },
        write,
      );
      timing.onChange!(
        InvestigationRuleTiming.AfterWait,
        { name: "Prod", onlyIfOpenAfterMinutes: 30 },
        write,
      );
      timing.onChange!(
        InvestigationRuleTiming.RightAway,
        { name: "Prod", onlyIfOpenAfterMinutes: 30 },
        write,
      );
      timing.onChange!("something else", { name: "Prod" }, write);

      expect(written).toEqual([
        {
          name: "Prod",
          [INVESTIGATION_RULE_TIMING_FIELD_KEY]:
            InvestigationRuleTiming.AfterWait,
          onlyIfOpenAfterMinutes: 10,
        },
        {
          name: "Prod",
          [INVESTIGATION_RULE_TIMING_FIELD_KEY]:
            InvestigationRuleTiming.AfterWait,
          onlyIfOpenAfterMinutes: 30,
        },
        {
          name: "Prod",
          [INVESTIGATION_RULE_TIMING_FIELD_KEY]:
            InvestigationRuleTiming.RightAway,
          onlyIfOpenAfterMinutes: null,
        },
      ]);
    });

    test("the wait is asked only with a wait, as a whole number of minutes from 1 to 1440", () => {
      const wait: CapturedField = fieldNamed(
        tableFor(lane),
        "onlyIfOpenAfterMinutes",
      );

      expect(wait.title).toBe("Wait (Minutes)");
      expect(wait.fieldType).toBe(FormFieldSchemaType.Number);
      expect(wait.description).toBe(
        `Counted from when the ${noun} is ${lane === AiLane.Incident ? "declared" : "created"}. When several rules match, the shortest wait decides. At most 1440 (a day).`,
      );
      expect(wait.hideOptionalLabel).toBe(true);

      expect(wait.showIf!({})).toBe(false);
      expect(wait.showIf!({ onlyIfOpenAfterMinutes: 15 })).toBe(true);
      expect(
        wait.showIf!({
          [INVESTIGATION_RULE_TIMING_FIELD_KEY]:
            InvestigationRuleTiming.RightAway,
          onlyIfOpenAfterMinutes: 15,
        }),
      ).toBe(false);
      expect(
        wait.showIf!({
          [INVESTIGATION_RULE_TIMING_FIELD_KEY]:
            InvestigationRuleTiming.AfterWait,
        }),
      ).toBe(true);

      const afterWait: Record<string, unknown> = {
        [INVESTIGATION_RULE_TIMING_FIELD_KEY]:
          InvestigationRuleTiming.AfterWait,
      };
      const notWhole: string =
        "Enter a whole number of minutes, from 1 to 1440.";

      expect(
        wait.customValidation!({ ...afterWait, onlyIfOpenAfterMinutes: "10" }),
      ).toBeNull();
      expect(
        wait.customValidation!({ ...afterWait, onlyIfOpenAfterMinutes: 1440 }),
      ).toBeNull();
      for (const value of [null, "", "0", 0, "1441", "10.5", "-3"]) {
        expect(
          wait.customValidation!({
            ...afterWait,
            onlyIfOpenAfterMinutes: value,
          }),
        ).toBe(notWhole);
      }

      // Right away asks nothing of it.
      expect(
        wait.customValidation!({
          [INVESTIGATION_RULE_TIMING_FIELD_KEY]:
            InvestigationRuleTiming.RightAway,
          onlyIfOpenAfterMinutes: null,
        }),
      ).toBeNull();
    });

    test("the table says when each rule investigates", () => {
      const props: Record<string, unknown> = tableFor(lane);
      const column: CapturedColumn | undefined = columnsOf(props).find(
        (candidate: CapturedColumn): boolean => {
          return candidate.title === "Investigates";
        },
      );

      expect(column).toBeDefined();
      expect(column!.field).toEqual({ onlyIfOpenAfterMinutes: true });
      expect(column!.disableSort).toBe(true);
      expect(
        column!.getExportValue!(
          Object.assign(new AIInvestigationRule(), {
            onlyIfOpenAfterMinutes: 30,
          }),
        ),
      ).toBe("If still open after 30 minutes");
      expect(
        column!.getExportValue!(
          Object.assign(new AIInvestigationRule(), {
            onlyIfOpenAfterMinutes: 1,
          }),
        ),
      ).toBe("If still open after 1 minute");
      expect(column!.getExportValue!(new AIInvestigationRule())).toBe(
        "Right away",
      );

      const { getByTestId } = render(
        column!.getElement!(
          Object.assign(new AIInvestigationRule(), {
            onlyIfOpenAfterMinutes: 10,
          }),
        ),
      );
      expect(getByTestId("investigation-rule-timing").textContent).toBe(
        "If still open after 10 minutes",
      );
      // Between the name and the status, as the table lists them.
      expect(
        columnsOf(props).map((candidate: CapturedColumn) => {
          return candidate.title;
        }),
      ).toEqual(["Name", "Investigates", "Status"]);
    });

    test("after every read, reports how many of its rules are enabled", async () => {
      const count: CountSpy = jest
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
      const count: CountSpy = jest
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
