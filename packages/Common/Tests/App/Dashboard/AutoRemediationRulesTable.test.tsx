import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";

/*
 * Incidents (or Alerts) → Settings → AI → More settings → Auto remediation
 * rules: which new incidents are fixed, and how, while "Fix new incidents
 * automatically" is on.
 *
 * A rule used to be five steps of fourteen fields - runbooks, "let AI pick
 * the runbook", "let AI compose commands", a command allowlist, command
 * Runners, an execution mode, a verification window, auto-resolve. Now it
 * asks three questions: which incidents (its conditions), who fixes them
 * (OneUptime AI, or the runbooks it names) and whether a fix waits for
 * someone to approve it. What a rule saved before still holds is kept: the
 * form never sends the old fields, and the table names those rules for
 * what they still do.
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

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

import AutoRemediationRulesTable, {
  AI_LANE_REMEDIATION_RULE_TRIGGER,
  AUTO_REMEDIATION_APPROVAL_OPTIONS,
  AUTO_REMEDIATION_FIX_WITH_OPTIONS,
  AutoRemediationFixWith,
  doesAutoRemediationRuleAskFirst,
  getAutoRemediationFixWith,
  isRunbooksFixWith,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/AutoRemediationRulesTable";
import {
  AI_LANE_REMEDIATION_RULES_TABLE_ID,
  AI_LANE_RULES_COPY,
  AiLane,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import AutoRemediationAction from "../../../Types/AutoRemediation/AutoRemediationAction";
import AutoRemediationExecutionMode from "../../../Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationTriggerEntity from "../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import { CardSelectOption } from "../../../UI/Components/CardSelect/CardSelect";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";

interface CapturedField {
  field?: Record<string, unknown>;
  title?: string;
  stepId?: string;
  fieldType?: FormFieldSchemaType;
  required?: boolean | ((values: FormValues<AutoRemediationRule>) => boolean);
  showIf?: (values: FormValues<AutoRemediationRule>) => boolean;
  defaultValue?: unknown;
  doNotShowWhenCreating?: boolean;
  cardSelectOptions?: Array<CardSelectOption>;
  cardSelectSingleColumn?: boolean;
}

interface CapturedColumn {
  field?: Record<string, unknown>;
  title?: string;
  getElement?: (item: AutoRemediationRule) => React.ReactElement;
}

function tableFor(lane: AiLane): Record<string, unknown> {
  render(<AutoRemediationRulesTable lane={lane} />);

  return mockCapturedTableProps[mockCapturedTableProps.length - 1] || {};
}

function fieldsOf(props: Record<string, unknown>): Array<CapturedField> {
  return (props["formFields"] || []) as Array<CapturedField>;
}

function keyOf(field: CapturedField): string {
  return Object.keys(field.field || {})[0] || "";
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
    throw new Error(`No ${key} field`);
  }

  return found;
}

function columnTitled(
  props: Record<string, unknown>,
  title: string,
): CapturedColumn {
  const found: CapturedColumn | undefined = (
    (props["columns"] || []) as Array<CapturedColumn>
  ).find((column: CapturedColumn): boolean => {
    return column.title === title;
  });

  if (!found) {
    throw new Error(`No ${title} column`);
  }

  return found;
}

function rule(values: Partial<AutoRemediationRule>): AutoRemediationRule {
  return Object.assign(new AutoRemediationRule(), values);
}

function values(remediationAction: unknown): FormValues<AutoRemediationRule> {
  return { remediationAction } as unknown as FormValues<AutoRemediationRule>;
}

beforeEach(() => {
  mockCapturedTableProps.length = 0;
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe.each([
  [AiLane.Incident, AutoRemediationTriggerEntity.Incident, "Incident"],
  [AiLane.Alert, AutoRemediationTriggerEntity.Alert, "Alert"],
])(
  "the %s auto remediation rules table",
  (lane: AiLane, trigger: AutoRemediationTriggerEntity, subject: string) => {
    test("reads and creates only its own kind of rule", async () => {
      const props: Record<string, unknown> = tableFor(lane);

      expect(AI_LANE_REMEDIATION_RULE_TRIGGER[lane]).toBe(trigger);
      expect(props["query"]).toEqual({ triggerEntityType: trigger });

      const onBeforeCreate: (
        item: AutoRemediationRule,
      ) => Promise<AutoRemediationRule> = props["onBeforeCreate"] as (
        item: AutoRemediationRule,
      ) => Promise<AutoRemediationRule>;
      const created: AutoRemediationRule = await onBeforeCreate(
        new AutoRemediationRule(),
      );

      expect(created.triggerEntityType).toBe(trigger);
    });

    test("is named for what it holds, and keeps its own preferences", () => {
      const props: Record<string, unknown> = tableFor(lane);

      expect(props["id"]).toBe(AI_LANE_REMEDIATION_RULES_TABLE_ID[lane]);
      expect(props["userPreferencesKey"]).toBe(
        AI_LANE_REMEDIATION_RULES_TABLE_ID[lane],
      );
      expect(props["cardProps"]).toEqual({
        title: "Auto remediation rules",
        description: AI_LANE_RULES_COPY[lane].remediationRulesDescription,
      });
      expect(AI_LANE_RULES_COPY[lane].remediationRulesDescription).toContain(
        `With no rule, OneUptime AI fixes every new ${subject.toLowerCase()} while fixing is on.`,
      );
      expect(props["noItemsMessage"]).toBe(
        `No rules. Every new ${subject.toLowerCase()} is fixed while fixing is on.`,
      );
    });

    test("asks three questions: the rule, its conditions, the fix", () => {
      const props: Record<string, unknown> = tableFor(lane);

      expect(props["formSteps"]).toEqual([
        { title: "Rule", id: "basic-info" },
        { title: "Conditions", id: "match-criteria" },
        { title: "Fix", id: "remediation" },
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
        ["remediationAction", "remediation"],
        ["runbooks", "remediation"],
        ["executionMode", "remediation"],
      ]);
    });

    test("no longer asks for anything a rule does not need", () => {
      const keys: Array<string> = fieldsOf(tableFor(lane)).map(keyOf);

      for (const retired of [
        "description",
        "aiSelectsRunbook",
        "aiComposesCommands",
        "commandAllowlist",
        "commandRunners",
        "verificationWindowMinutes",
        "autoResolveOnVerifiedRecovery",
      ]) {
        expect(keys).not.toContain(retired);
      }
    });

    test("a rule starts on: its switch is on the edit form only", () => {
      const enabled: CapturedField = fieldNamed(tableFor(lane), "isEnabled");

      expect(enabled.doNotShowWhenCreating).toBe(true);
      expect(enabled.fieldType).toBe(FormFieldSchemaType.Toggle);
    });

    test("Fix With is OneUptime AI unless the rule picks Runbooks", () => {
      const fixWith: CapturedField = fieldNamed(
        tableFor(lane),
        "remediationAction",
      );

      expect(fixWith.title).toBe("Fix With");
      expect(fixWith.fieldType).toBe(FormFieldSchemaType.CardSelect);
      expect(fixWith.cardSelectSingleColumn).toBe(true);
      expect(fixWith.required).toBe(true);
      expect(fixWith.defaultValue).toBe(AutoRemediationAction.OneUptimeAI);
      expect(fixWith.cardSelectOptions).toBe(AUTO_REMEDIATION_FIX_WITH_OPTIONS);
    });

    test("Runbooks are asked for, and required, only when the rule runs runbooks", () => {
      const runbooks: CapturedField = fieldNamed(tableFor(lane), "runbooks");
      const required: (values: FormValues<AutoRemediationRule>) => boolean =
        runbooks.required as (
          values: FormValues<AutoRemediationRule>,
        ) => boolean;

      expect(runbooks.showIf!(values(AutoRemediationAction.Runbooks))).toBe(
        true,
      );
      expect(required(values(AutoRemediationAction.Runbooks))).toBe(true);

      for (const other of [AutoRemediationAction.OneUptimeAI, undefined]) {
        expect(runbooks.showIf!(values(other))).toBe(false);
        expect(required(values(other))).toBe(false);
      }
    });

    test("Approval asks first unless the rule says otherwise", () => {
      const approval: CapturedField = fieldNamed(
        tableFor(lane),
        "executionMode",
      );

      expect(approval.title).toBe("Approval");
      expect(approval.fieldType).toBe(FormFieldSchemaType.CardSelect);
      expect(approval.required).toBe(true);
      expect(approval.defaultValue).toBe(AutoRemediationExecutionMode.Suggest);
      expect(approval.cardSelectOptions).toBe(
        AUTO_REMEDIATION_APPROVAL_OPTIONS,
      );
    });

    test("reads what it needs to name each rule's fix", () => {
      expect(tableFor(lane)["selectMoreFields"]).toEqual({
        isEnabled: true,
        remediationAction: true,
        aiSelectsRunbook: true,
        aiComposesCommands: true,
      });
    });

    test("after every read, reports how many of its rules are enabled", async () => {
      const count: jest.SpiedFunction<typeof ModelAPI.count> = jest
        .spyOn(ModelAPI, "count")
        .mockResolvedValue(4 as never);
      const reported: Array<number> = [];

      render(
        <AutoRemediationRulesTable
          lane={lane}
          onRulesLoaded={(rules: number) => {
            reported.push(rules);
          }}
        />,
      );

      const props: Record<string, unknown> =
        mockCapturedTableProps[mockCapturedTableProps.length - 1]!;
      (props["onFetchSuccess"] as (data: Array<unknown>, n: number) => void)(
        [],
        9,
      );
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 0);
      });

      expect(count).toHaveBeenCalledWith({
        modelType: AutoRemediationRule,
        query: { triggerEntityType: trigger, isEnabled: true },
      });
      // The enabled rules, not the rows the table's filters let through.
      expect(reported).toEqual([4]);
    });

    test("says nothing about its rules when it cannot count them", async () => {
      jest
        .spyOn(ModelAPI, "count")
        .mockRejectedValue(new Error("offline") as never);
      const reported: Array<number> = [];

      render(
        <AutoRemediationRulesTable
          lane={lane}
          onRulesLoaded={(rules: number) => {
            reported.push(rules);
          }}
        />,
      );

      const props: Record<string, unknown> =
        mockCapturedTableProps[mockCapturedTableProps.length - 1]!;
      (props["onFetchSuccess"] as (data: Array<unknown>, n: number) => void)(
        [],
        0,
      );
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 0);
      });

      expect(reported).toEqual([]);
    });

    test.each([
      [
        { remediationAction: AutoRemediationAction.OneUptimeAI },
        "OneUptime AI",
      ],
      [{ remediationAction: AutoRemediationAction.Runbooks }, "Runbooks"],
      [
        {
          remediationAction: AutoRemediationAction.OneUptimeAI,
          aiComposesCommands: true,
        },
        "OneUptime AI: commands on Runners",
      ],
      [
        {
          remediationAction: AutoRemediationAction.OneUptimeAI,
          aiSelectsRunbook: true,
        },
        "OneUptime AI: picks a runbook",
      ],
    ])(
      "the Fix With column names %j as %s",
      (values: Partial<AutoRemediationRule>, text: string) => {
        const column: CapturedColumn = columnTitled(tableFor(lane), "Fix With");

        cleanup();
        render(column.getElement!(rule(values)));

        expect(screen.getByText(text)).toBeInTheDocument();
      },
    );

    test.each([
      [{ executionMode: AutoRemediationExecutionMode.Suggest }, "Asks first"],
      [
        { executionMode: AutoRemediationExecutionMode.FullAuto },
        "Without asking",
      ],
      [
        {
          executionMode: AutoRemediationExecutionMode.FullAuto,
          aiSelectsRunbook: true,
        },
        "Asks first",
      ],
    ])(
      "the Approval column names %j as %s",
      (values: Partial<AutoRemediationRule>, text: string) => {
        const column: CapturedColumn = columnTitled(tableFor(lane), "Approval");

        cleanup();
        render(column.getElement!(rule(values)));

        expect(screen.getByText(text)).toBeInTheDocument();
      },
    );
  },
);

describe("what a rule fixes with", () => {
  test("Runbooks wins over a flag a rule saved before", () => {
    expect(
      getAutoRemediationFixWith({
        remediationAction: AutoRemediationAction.Runbooks,
        aiComposesCommands: true,
        aiSelectsRunbook: true,
      }),
    ).toBe(AutoRemediationFixWith.Runbooks);
  });

  test("a rule saved with AI commands or AI runbook picking keeps doing that", () => {
    expect(
      getAutoRemediationFixWith({
        remediationAction: AutoRemediationAction.OneUptimeAI,
        aiComposesCommands: true,
        aiSelectsRunbook: true,
      }),
    ).toBe(AutoRemediationFixWith.RunnerCommands);
    expect(
      getAutoRemediationFixWith({
        remediationAction: AutoRemediationAction.OneUptimeAI,
        aiSelectsRunbook: true,
      }),
    ).toBe(AutoRemediationFixWith.AiPickedRunbook);
  });

  test("a rule without the column reads as OneUptime AI, its default", () => {
    expect(getAutoRemediationFixWith({})).toBe(
      AutoRemediationFixWith.OneUptimeAi,
    );
  });

  test("a runbook OneUptime AI picks always waits for approval", () => {
    expect(
      doesAutoRemediationRuleAskFirst({
        executionMode: AutoRemediationExecutionMode.FullAuto,
        aiSelectsRunbook: true,
      }),
    ).toBe(true);
    expect(
      doesAutoRemediationRuleAskFirst({
        executionMode: AutoRemediationExecutionMode.FullAuto,
      }),
    ).toBe(false);
    // A rule that never said reads as asking: the column's default.
    expect(doesAutoRemediationRuleAskFirst({})).toBe(true);
  });

  test("the form knows when a rule runs runbooks", () => {
    expect(isRunbooksFixWith(values(AutoRemediationAction.Runbooks))).toBe(
      true,
    );
    expect(isRunbooksFixWith(values(AutoRemediationAction.OneUptimeAI))).toBe(
      false,
    );
    expect(isRunbooksFixWith(values("runbooks"))).toBe(false);
  });
});

describe("the choices", () => {
  test("Fix With: OneUptime AI, then Runbooks, each saying what it does", () => {
    expect(
      AUTO_REMEDIATION_FIX_WITH_OPTIONS.map((option: CardSelectOption) => {
        return [option.value, option.title];
      }),
    ).toEqual([
      [AutoRemediationAction.OneUptimeAI, "OneUptime AI"],
      [AutoRemediationAction.Runbooks, "Runbooks"],
    ]);
    expect(AUTO_REMEDIATION_FIX_WITH_OPTIONS[0]!.description).toContain(
      "AI agent",
    );
    expect(AUTO_REMEDIATION_FIX_WITH_OPTIONS[1]!.description).toContain(
      "runbooks you choose",
    );
  });

  test("Approval: ask first, then fix without asking", () => {
    expect(
      AUTO_REMEDIATION_APPROVAL_OPTIONS.map((option: CardSelectOption) => {
        return [option.value, option.title];
      }),
    ).toEqual([
      [AutoRemediationExecutionMode.Suggest, "Ask before fixing"],
      [AutoRemediationExecutionMode.FullAuto, "Fix without asking"],
    ]);
    expect(AUTO_REMEDIATION_APPROVAL_OPTIONS[0]!.description).toContain(
      "Nothing runs until someone approves",
    );
    // An AI agent set to ask still asks: the rule never overrides it.
    expect(AUTO_REMEDIATION_APPROVAL_OPTIONS[1]!.description).toContain(
      "wherever the AI agent's settings allow it",
    );
  });

  test("every choice has an icon of its own", () => {
    for (const options of [
      AUTO_REMEDIATION_FIX_WITH_OPTIONS,
      AUTO_REMEDIATION_APPROVAL_OPTIONS,
    ]) {
      const icons: Array<unknown> = options.map((option: CardSelectOption) => {
        return option.icon;
      });

      expect(new Set(icons).size).toBe(options.length);
    }
  });
});
