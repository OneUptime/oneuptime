import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";

/*
 * A telemetry product's AI → Settings → More settings → AI rules - the
 * Profiler's first: which services' slow code OneUptime AI works on, and
 * what it does with each, in the shape every AI rule has (Match,
 * Investigate, Fix), on the one AI rule model with the lane's trigger.
 * Only the props the table hands to ModelTable are under test, so the
 * table is captured instead of rendered.
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

import TelemetryAiRulesTable, {
  TelemetryAiRuleDoesCell,
  getTelemetryAiRuleDoesText,
  prepareTelemetryAiRule,
  prepareTelemetryAiRuleUpdate,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryAi/TelemetryAiRulesTable";
import {
  TELEMETRY_AI_LANE_COPY,
  TELEMETRY_AI_RULES_CARD_TITLE,
  TELEMETRY_AI_RUNNER_HINT,
  TELEMETRY_AI_TEST_IDS,
  getTelemetryAiFixOptions,
  getTelemetryAiRulesTableId,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryAi/TelemetryAiCopy";
import {
  AI_RULE_COLUMN_TITLE,
  AI_RULE_FIX_FIELD_COPY,
  AI_RULE_FIX_FIELD_KEY,
  AI_RULE_FIX_TEXT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/AiRuleCopy";
import {
  INVESTIGATION_RULE_TIMING_FIELD_KEY,
  InvestigationRuleTiming,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/InvestigationRuleTiming";
import {
  RULE_CODE_REPOSITORIES_FIELD_COPY,
  RULE_CODE_REPOSITORIES_HINT_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/RuleCodeRepositoriesCopy";
import { RULE_MCP_SERVERS_FIELD_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/ExternalMcpServer/ExternalMcpServerCopy";
import { mockRuleLlmProviders } from "./RuleLlmProviderFixtures";
import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import ExternalMcpServer from "../../../Models/DatabaseModels/ExternalMcpServer";
import Label from "../../../Models/DatabaseModels/Label";
import Service from "../../../Models/DatabaseModels/Service";
import { AiRuleFix } from "../../../Types/AI/AiRule";
import { TelemetryAiLane } from "../../../Types/AI/TelemetryAi";
import AutoRemediationAction from "../../../Types/AutoRemediation/AutoRemediationAction";
import AutoRemediationExecutionMode from "../../../Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationTriggerEntity from "../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import { RuleCriteriaSubject } from "../../../Types/Rules/RuleCriteriaSubject";
import { CardSelectOption } from "../../../UI/Components/CardSelect/CardSelect";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import { Translator } from "../../../UI/Utils/TranslateTemplate";

type Values = FormValues<AutoRemediationRule>;

interface CapturedField {
  field?: Record<string, unknown>;
  overrideField?: Record<string, unknown>;
  overrideFieldKey?: string;
  formOnly?: boolean;
  title?: string;
  description?: string;
  stepId?: string;
  fieldType?: FormFieldSchemaType;
  required?: boolean;
  showIf?: (values: Values) => boolean;
  dropdownModal?: { type?: unknown };
  cardSelectOptions?: Array<CardSelectOption>;
  radioButtonOptions?: Array<{ value: string; title: string }>;
  collapsibleSection?: unknown;
  getDefaultValue?: (values: Values) => unknown;
  customValidation?: (values: Values) => string | null;
  onChange?: (
    value: unknown,
    currentValues: Values,
    setNewFormValues: (values: Values) => void,
  ) => void;
  getFooterElement?: () => React.ReactElement;
}

function tableFor(
  onRulesLoaded?: (count: number) => void,
): Record<string, unknown> {
  render(
    <TelemetryAiRulesTable
      lane={TelemetryAiLane.Profile}
      onRulesLoaded={onRulesLoaded}
    />,
  );

  return mockCapturedTableProps[mockCapturedTableProps.length - 1] || {};
}

function fieldsOf(props: Record<string, unknown>): Array<CapturedField> {
  return (props["formFields"] || []) as Array<CapturedField>;
}

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
    throw new Error(`No ${key} field`);
  }

  return found;
}

function rule(fields: Partial<AutoRemediationRule>): AutoRemediationRule {
  return Object.assign(new AutoRemediationRule(), fields);
}

beforeEach(() => {
  mockCapturedTableProps.length = 0;
  mockRuleLlmProviders();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the profile AI rules table", () => {
  test("reads and creates only the lane's AI rules, about services", () => {
    const props: Record<string, unknown> = tableFor();

    expect(props["modelType"]).toBe(AutoRemediationRule);
    expect(props["query"]).toEqual({
      triggerEntityType: AutoRemediationTriggerEntity.Profile,
    });
    expect(props["ruleCriteriaSubject"]).toBe(RuleCriteriaSubject.Services);
    expect(props["id"]).toBe(
      getTelemetryAiRulesTableId(TelemetryAiLane.Profile),
    );
    expect(props["userPreferencesKey"]).toBe(props["id"]);
    expect(props["cardProps"]).toEqual({
      title: TELEMETRY_AI_RULES_CARD_TITLE,
      description:
        TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Profile].rulesCardDescription,
      /*
       * The card carries the table's id, so the lane switch's "Review the
       * AI rules" opens More settings at it (AiRulesFixNothing).
       */
      id: getTelemetryAiRulesTableId(TelemetryAiLane.Profile),
    });
    expect(props["noItemsMessage"]).toBe(
      TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Profile].noRulesMessage,
    );
  });

  test("asks Match, Investigate and Fix, a step each", () => {
    expect(tableFor()["formSteps"]).toEqual([
      { title: "Match", id: "match-criteria" },
      { title: "Investigate", id: "investigate" },
      { title: "Fix", id: "remediation" },
    ]);
  });

  test("matches by service: the ones picked, their labels, a pattern on their names", () => {
    const props: Record<string, unknown> = tableFor();
    const match: Array<CapturedField> = fieldsOf(props).filter(
      (field: CapturedField): boolean => {
        return field.stepId === "match-criteria";
      },
    );

    expect(match.map(keyOf)).toEqual([
      "services",
      "serviceLabels",
      "serviceNamePattern",
    ]);
    expect(match[0]!.dropdownModal?.type).toBe(Service);
    expect(match[1]!.dropdownModal?.type).toBe(Label);
    expect(match[2]!.fieldType).toBe(FormFieldSchemaType.Text);
  });

  test("investigates right away or only if the slow code is still found after a wait", () => {
    const props: Record<string, unknown> = tableFor();
    const timing: CapturedField = fieldNamed(
      props,
      INVESTIGATION_RULE_TIMING_FIELD_KEY,
    );

    expect(
      timing.radioButtonOptions?.map((option: { title: string }): string => {
        return option.title;
      }),
    ).toEqual(["Right away", "Only if still found after a wait"]);

    const wait: CapturedField = fieldNamed(props, "onlyIfOpenAfterMinutes");

    expect(wait.description).toBe(
      TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Profile].waitDescription,
    );
    // Asked only once a wait is chosen.
    expect(wait.showIf!({ investigates: true } as Values)).toBe(false);
    expect(
      wait.showIf!({
        investigates: true,
        [INVESTIGATION_RULE_TIMING_FIELD_KEY]:
          InvestigationRuleTiming.AfterWait,
      } as unknown as Values),
    ).toBe(true);
    expect(
      wait.customValidation!({
        investigates: true,
        [INVESTIGATION_RULE_TIMING_FIELD_KEY]:
          InvestigationRuleTiming.AfterWait,
        onlyIfOpenAfterMinutes: 0,
      } as unknown as Values),
    ).toBeTruthy();
  });

  /*
   * OneUptime looks for slow code once an hour: a wait starts on one look,
   * found again on the next - not the incidents' 10 minutes, which reads as
   * more than an hourly look can tell apart (the UI review).
   */
  test("a wait starts on an hour, one look of the Profiler's: found again on its next look", () => {
    const props: Record<string, unknown> = tableFor();
    const timing: CapturedField = fieldNamed(
      props,
      INVESTIGATION_RULE_TIMING_FIELD_KEY,
    );

    let written: Values | null = null;
    timing.onChange!(
      InvestigationRuleTiming.AfterWait,
      { investigates: true } as Values,
      (values: Values): void => {
        written = values;
      },
    );

    expect(written).toEqual(
      expect.objectContaining({ onlyIfOpenAfterMinutes: 60 }),
    );

    // A wait already typed is kept.
    timing.onChange!(
      InvestigationRuleTiming.AfterWait,
      { investigates: true, onlyIfOpenAfterMinutes: 180 } as unknown as Values,
      (values: Values): void => {
        written = values;
      },
    );

    expect(written).toEqual(
      expect.objectContaining({ onlyIfOpenAfterMinutes: 180 }),
    );
  });

  test("fixes as a pull request: the one Fix question, in the lane's words, writing both columns", () => {
    const props: Record<string, unknown> = tableFor();
    const fix: CapturedField = fieldNamed(props, AI_RULE_FIX_FIELD_KEY);

    expect(fix.title).toBe(AI_RULE_FIX_FIELD_COPY.title);
    expect(fix.cardSelectOptions).toEqual(
      getTelemetryAiFixOptions(TelemetryAiLane.Profile),
    );
    // A new rule opens on "Ask before fixing", as every AI rule does.
    expect(fix.getDefaultValue!({ investigates: true } as Values)).toBe(
      AiRuleFix.AskFirst,
    );

    let written: Values | null = null;
    fix.onChange!(
      AiRuleFix.WithoutAsking,
      { investigates: true } as Values,
      (values: Values): void => {
        written = values;
      },
    );

    expect(written).toEqual(
      expect.objectContaining({
        [AI_RULE_FIX_FIELD_KEY]: AiRuleFix.WithoutAsking,
        fixes: true,
        executionMode: AutoRemediationExecutionMode.FullAuto,
      }),
    );
  });

  test("names no Runner and no runbooks: the code is changed on the Runner its repository picks", () => {
    const props: Record<string, unknown> = tableFor();
    const keys: Array<string> = fieldsOf(props).map(keyOf);

    for (const absent of [
      "runnerId",
      "runbooks",
      "remediationAction",
      "openCodeFixPullRequests",
      "openTelemetryPullRequests",
      "monitors",
      "incidentSeverities",
      "alertSeverities",
      "labels",
      "monitorLabels",
      "titlePattern",
      "descriptionPattern",
    ]) {
      expect([absent, keys.includes(absent)]).toEqual([absent, false]);
    }

    render(fieldNamed(props, "codeRepositories").getFooterElement!());

    expect(screen.getByText(TELEMETRY_AI_RUNNER_HINT)).toBeInTheDocument();

    /*
     * One line of help under the field, in its size: where repositories
     * are connected, then whose Runner works in them (it was a second,
     * larger line).
     */
    const hint: HTMLElement = screen.getByTestId(
      RULE_CODE_REPOSITORIES_HINT_TEST_ID,
    );

    expect(hint).toContainElement(
      screen.getByTestId(TELEMETRY_AI_TEST_IDS.runnerHint),
    );
    expect(hint).toHaveTextContent(TELEMETRY_AI_RUNNER_HINT);
    expect(hint.className).toContain("text-xs");
  });

  test("folds what most rules never change under More fields, the shared fields first", () => {
    const props: Record<string, unknown> = tableFor();
    const folded: Array<string> = fieldsOf(props)
      .filter((field: CapturedField): boolean => {
        return Boolean(field.collapsibleSection);
      })
      .map(keyOf);

    expect(folded).toEqual([
      "codeRepositories",
      "externalMcpServers",
      "llmProviderId",
      "description",
    ]);
    expect(fieldNamed(props, "codeRepositories").description).toBe(
      RULE_CODE_REPOSITORIES_FIELD_COPY.aiRuleDescription,
    );

    const servers: CapturedField = fieldNamed(props, "externalMcpServers");

    expect(servers.description).toBe(
      RULE_MCP_SERVERS_FIELD_COPY.aiRuleDescription,
    );
    expect(servers.dropdownModal?.type).toBe(ExternalMcpServer);
  });

  test("a new rule investigates, fixes as its answer says, belongs to the lane, and runs nothing on a Runner", () => {
    const created: AutoRemediationRule = prepareTelemetryAiRule(
      rule({
        name: "Checkout services",
        fixes: true,
        executionMode: AutoRemediationExecutionMode.Suggest,
        runnerId: "anything" as never,
      }),
      TelemetryAiLane.Profile,
    );

    expect(created.investigates).toBe(true);
    expect(created.fixes).toBe(true);
    expect(created.executionMode).toBe(AutoRemediationExecutionMode.Suggest);
    expect(created.triggerEntityType).toBe(
      AutoRemediationTriggerEntity.Profile,
    );
    expect(created.remediationAction).toBe(AutoRemediationAction.OneUptimeAI);
    expect((created as unknown as { runnerId: unknown }).runnerId).toBeNull();
  });

  test("an edit writes its Fix answer into both columns", () => {
    const edited: AutoRemediationRule = prepareTelemetryAiRuleUpdate(
      rule({
        fixes: false,
        executionMode: AutoRemediationExecutionMode.FullAuto,
      }),
    );

    expect(edited.fixes).toBe(false);
  });

  test("the table's one column says when a rule looks into slow code, and how it fixes it", () => {
    const props: Record<string, unknown> = tableFor();
    const column: Record<string, unknown> | undefined = (
      props["columns"] as Array<Record<string, unknown>>
    ).find((entry: Record<string, unknown>): boolean => {
      return entry["title"] === AI_RULE_COLUMN_TITLE;
    });

    expect(column).toBeDefined();

    const waits: AutoRemediationRule = rule({
      investigates: true,
      fixes: true,
      executionMode: AutoRemediationExecutionMode.FullAuto,
      onlyIfOpenAfterMinutes: 60,
    });

    render(<TelemetryAiRuleDoesCell rule={waits} />);

    expect(
      screen.getByText("If still found after 60 minutes"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(AI_RULE_FIX_TEXT[AiRuleFix.WithoutAsking]),
    ).toBeInTheDocument();

    const translator: Translator = {
      translateText: (text: string | undefined): string => {
        return text || "";
      },
    } as unknown as Translator;

    expect(
      getTelemetryAiRuleDoesText(
        rule({ investigates: true, fixes: false }),
        translator,
      ),
    ).toBe(`Right away · ${AI_RULE_FIX_TEXT[AiRuleFix.DoNotFix]}`);
  });

  test("tells the page how many enabled rules there are after every read", async () => {
    const onRulesLoaded: ReturnType<typeof jest.fn<(count: number) => void>> =
      jest.fn<(count: number) => void>();
    const props: Record<string, unknown> = tableFor(onRulesLoaded);

    const { default: ModelAPI } = await import(
      "../../../UI/Utils/ModelAPI/ModelAPI"
    );
    const count: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ModelAPI, "count")
      .mockResolvedValue(2 as never);

    await act(async () => {
      (props["onFetchSuccess"] as () => void)();
    });

    expect(onRulesLoaded).toHaveBeenCalledWith(2);
    expect(
      (count.mock.calls[0]![0] as { query: Record<string, unknown> }).query,
    ).toEqual({
      triggerEntityType: AutoRemediationTriggerEntity.Profile,
      isEnabled: true,
    });
  });
});
