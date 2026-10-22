import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";

/*
 * Incidents (or Alerts) → Settings → AI → More settings → Auto remediation
 * rules: which new incidents are fixed while "Fix new incidents
 * automatically" is on.
 *
 * The maintainer, on the rule's Fix step: "Why should I pick between
 * OneUptime AI and Runbook? Can OneUptime AI do things by default, and I can
 * whitelist some Runbook for AI to pick and run? If I do not whitelist any
 * Runbook, it can basically run any Runbook by default. ... In the auto
 * remediation rule, you could ask which runner we should use to run the
 * remediation. ... all of these should be in a more option. They should not
 * be visible by default."
 *
 * So a rule asks its conditions and one question about the fix - whether it
 * waits for approval - and OneUptime AI fixes. Folded under More fields: the
 * runbooks OneUptime AI may run (none picked: any), "Run them every time"
 * (what a rule saved with Fix With set to Runbooks keeps doing), the Runner
 * OneUptime AI runs the rule's Bash commands on (the project's default for a
 * new rule, or none - never "AI agent on the cluster or host", which is not a
 * Runner), the MCP servers and code repositories it may use (none picked:
 * all), and the two pull requests an investigation of a match can open -
 * "Both of these toggles should be inside of Remediation Rule, inside of
 * More, and they should be checked by default". The same for alerts.
 *
 * The table names a rule's fix in one Fix column: whether it asks first
 * and, in a quiet line, how it fixes - only for a rule that does not fix
 * the way every new rule does. A rule saved before rules were simplified
 * says what it still does at the top of its Fix step, hides what does
 * nothing for it, and offers "Fix like a new rule".
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
  AutoRemediationFixWith,
  doesAutoRemediationRuleAskFirst,
  getAutoRemediationFixWith,
  prepareAutoRemediationRuleSave,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/AutoRemediationRulesTable";
import {
  AUTO_REMEDIATION_APPROVAL_FIELD_COPY,
  AUTO_REMEDIATION_FIX_WITH_TEXT,
  AUTO_REMEDIATION_MORE_FIELDS_COPY,
  AUTO_REMEDIATION_MORE_FIELDS_SUMMARIES,
  AUTO_REMEDIATION_OLDER_RULE_COPY,
  getAutoRemediationFixWithText,
  getAutoRemediationMoreFieldsSummary,
  getEditedRuleFixKind,
  getOlderAutoRemediationRuleText,
  getValuesFixingLikeANewRule,
  hasRuleRunbooks,
  hasRuleRunner,
  isOlderAutoRemediationRule,
  isRunbooksEveryTime,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/AutoRemediationRuleCopy";
import { AUTO_REMEDIATION_OLDER_RULE_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/AutoRemediationRuleFields";
import { RULE_CODE_REPOSITORIES_FIELD_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/RuleCodeRepositoriesCopy";
import {
  RuleCodeRepositoriesFieldHint,
  RuleCodeRepositoriesPicker,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/RuleCodeRepositoriesField";
import RunnerChoicesLoader from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/RunnerChoices";
import RunnerLiveStatus from "../../../Types/Runner/RunnerLiveStatus";
import ProjectUtil from "../../../UI/Utils/Project";
import { AutoRemediationFixKind } from "../../../Types/AutoRemediation/AutoRemediationFix";
import {
  AI_LANE_REMEDIATION_RULES_TABLE_ID,
  AI_LANE_RULES_COPY,
  AiLane,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import ExternalMcpServer from "../../../Models/DatabaseModels/ExternalMcpServer";
import AutoRemediationAction from "../../../Types/AutoRemediation/AutoRemediationAction";
import AutoRemediationExecutionMode from "../../../Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationTriggerEntity from "../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import ObjectID from "../../../Types/ObjectID";
import { CardSelectOption } from "../../../UI/Components/CardSelect/CardSelect";
import {
  CustomElementProps,
  FormFieldCollapsibleSection,
} from "../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import {
  ADVANCED_FORM_SECTION_ID,
  MORE_FIELDS_SECTION_TITLE,
} from "../../../UI/Components/Forms/Utils/AdvancedFormSection";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import {
  RULE_LLM_PROVIDER_FIELD_COPY,
  RuleLlmProviderWork,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/RuleLlmProviderCopy";
import {
  OPUS_PROVIDER,
  mockRuleLlmProviders,
  projectProvidersAnswer,
} from "./RuleLlmProviderFixtures";

// ModelAPI.count spied on, as jest-mock's spyOn types it.
type CountSpy = SpyInstance<
  (
    ...args: Parameters<typeof ModelAPI.count>
  ) => ReturnType<typeof ModelAPI.count>
>;

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
  required?: boolean | ((values: Values) => boolean);
  showIf?: (values: Values) => boolean;
  defaultValue?: unknown;
  doNotShowWhenCreating?: boolean;
  hideOptionalLabel?: boolean;
  customElementDrawsOwnLabel?: boolean;
  placeholder?: string;
  dropdownModal?: { type?: unknown };
  cardSelectOptions?: Array<CardSelectOption>;
  cardSelectSingleColumn?: boolean;
  collapsibleSection?: FormFieldCollapsibleSection<AutoRemediationRule>;
  getFoldedValue?: (values: Values) => string | null;
  isListedWhileFolded?: (values: Values) => boolean;
  onChange?: (
    value: unknown,
    currentValues: Values,
    setNewFormValues: (values: Values) => void,
  ) => void;
  getCustomElement?: (
    values: Values,
    props: CustomElementProps,
  ) => React.ReactElement;
  getFooterElement?: () => React.ReactElement;
  hideColumnDescription?: boolean;
}

interface CapturedColumn {
  field?: Record<string, unknown>;
  title?: string;
  getElement?: (item: AutoRemediationRule) => React.ReactElement;
}

const RUNNER_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";
const RUNBOOK_ID: string = "bbbbbbbb-0000-4000-8000-000000000001";

function tableFor(lane: AiLane): Record<string, unknown> {
  render(<AutoRemediationRulesTable lane={lane} />);

  return mockCapturedTableProps[mockCapturedTableProps.length - 1] || {};
}

function fieldsOf(props: Record<string, unknown>): Array<CapturedField> {
  return (props["formFields"] || []) as Array<CapturedField>;
}

// The form value a field holds: its own key, or its column's.
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

function values(fields: Record<string, unknown>): Values {
  return fields as unknown as Values;
}

const EVERY_TIME: Values = values({
  remediationAction: AutoRemediationAction.Runbooks,
});

// Rules saved before rules were simplified, as an edit form loads them.
const OLDER_COMMANDS: Values = values({
  remediationAction: AutoRemediationAction.OneUptimeAI,
  aiComposesCommands: true,
  aiSelectsRunbook: false,
  executionMode: AutoRemediationExecutionMode.FullAuto,
  runnerId: RUNNER_ID,
});

const OLDER_PICKS: Values = values({
  remediationAction: AutoRemediationAction.OneUptimeAI,
  aiComposesCommands: false,
  aiSelectsRunbook: true,
  executionMode: AutoRemediationExecutionMode.FullAuto,
});

// A runbook as the dropdown holds it while the form is open.
const PICKED_RUNBOOKS: Array<unknown> = [
  { value: RUNBOOK_ID, label: "Restart API" },
];

beforeEach(() => {
  mockCapturedTableProps.length = 0;
  // The LLM Provider field's providers: not answered unless a test says so.
  mockRuleLlmProviders();
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
    test("reads and creates only its own kind of rule, always saying OneUptime AI fixes it", async () => {
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
      // Sent, so a rule naming runbooks is never read as running them every time.
      expect(created.remediationAction).toBe(AutoRemediationAction.OneUptimeAI);
    });

    test("an edit saves what the form says the same way", async () => {
      const onBeforeUpdate: (
        item: AutoRemediationRule,
      ) => Promise<AutoRemediationRule> = tableFor(lane)["onBeforeUpdate"] as (
        item: AutoRemediationRule,
      ) => Promise<AutoRemediationRule>;

      const everyTime: AutoRemediationRule = await onBeforeUpdate(
        rule({
          remediationAction: AutoRemediationAction.Runbooks,
          runnerId: new ObjectID(RUNNER_ID),
        }),
      );
      expect(everyTime.remediationAction).toBe(AutoRemediationAction.Runbooks);
      expect(everyTime.runnerId).toBeNull();

      const ai: AutoRemediationRule = await onBeforeUpdate(
        rule({ runnerId: new ObjectID(RUNNER_ID) }),
      );
      expect(ai.remediationAction).toBe(AutoRemediationAction.OneUptimeAI);
      expect(String(ai.runnerId)).toBe(RUNNER_ID);
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
      expect(AI_LANE_RULES_COPY[lane].remediationRulesDescription).toBe(
        `With no rule, OneUptime AI fixes every new ${subject.toLowerCase()} while fixing is on, pull requests included. Add rules to fix only the ${subject.toLowerCase()}s that match one, to ask first, or to choose what it may use.`,
      );
      expect(props["noItemsMessage"]).toBe(
        `No rules. Every new ${subject.toLowerCase()} is fixed while fixing is on.`,
      );
    });

    test("asks for the rule, its conditions, and whether a fix waits for approval; the rest is folded", () => {
      const props: Record<string, unknown> = tableFor(lane);

      expect(props["formSteps"]).toEqual([
        { title: "Rule", id: "basic-info" },
        { title: "Conditions", id: "match-criteria" },
        { title: "Fix", id: "remediation" },
      ]);
      expect(
        fieldsOf(props).map(
          (field: CapturedField): [string, string, string] => {
            return [
              keyOf(field),
              field.stepId || "",
              field.collapsibleSection?.title || "",
            ];
          },
        ),
      ).toEqual([
        ["name", "basic-info", ""],
        ["isEnabled", "basic-info", ""],
        ["monitors", "match-criteria", ""],
        [
          lane === AiLane.Incident ? "incidentSeverities" : "alertSeverities",
          "match-criteria",
          "",
        ],
        ["labels", "match-criteria", ""],
        ["monitorLabels", "match-criteria", ""],
        ["titlePattern", "match-criteria", ""],
        ["descriptionPattern", "match-criteria", ""],
        // An older rule's two flags, never drawn, and its note.
        ["aiComposesCommands", "remediation", ""],
        ["aiSelectsRunbook", "remediation", ""],
        ["olderRuleNote", "remediation", ""],
        // The Fix step's one question, then More fields, folded.
        ["executionMode", "remediation", ""],
        ["runbooks", "remediation", MORE_FIELDS_SECTION_TITLE],
        ["remediationAction", "remediation", MORE_FIELDS_SECTION_TITLE],
        /*
         * After the switch that turns AI off, never first: the fold keeps
         * its place by its first field, and this one comes and goes.
         */
        ["llmProviderId", "remediation", MORE_FIELDS_SECTION_TITLE],
        ["runnerId", "remediation", MORE_FIELDS_SECTION_TITLE],
        ["externalMcpServers", "remediation", MORE_FIELDS_SECTION_TITLE],
        ["codeRepositories", "remediation", MORE_FIELDS_SECTION_TITLE],
        ["openCodeFixPullRequests", "remediation", MORE_FIELDS_SECTION_TITLE],
        ["openTelemetryPullRequests", "remediation", MORE_FIELDS_SECTION_TITLE],
      ]);
    });

    test("More fields is one section, folded, with a line on what its defaults do", () => {
      const props: Record<string, unknown> = tableFor(lane);
      const folded: Array<CapturedField> = [
        "runbooks",
        "remediationAction",
        "llmProviderId",
        "runnerId",
        "externalMcpServers",
        "codeRepositories",
        "openCodeFixPullRequests",
        "openTelemetryPullRequests",
      ].map((key: string): CapturedField => {
        return fieldNamed(props, key);
      });
      const section: FormFieldCollapsibleSection<AutoRemediationRule> =
        folded[0]!.collapsibleSection!;

      for (const field of folded) {
        expect(field.collapsibleSection).toBe(section);
      }
      expect(section.id).toBe(ADVANCED_FORM_SECTION_ID);
      expect(section.title).toBe("More fields");

      // Before the providers are read: what the rest's defaults do, alone.
      for (const each of [values({}), EVERY_TIME, OLDER_COMMANDS]) {
        expect(section.getSummary!(each)).toEqual(
          getAutoRemediationMoreFieldsSummary(each),
        );
      }
    });

    /*
     * The LLM provider OneUptime AI fixes with - its runbook picks, its
     * commands, its MCP fixes and the rule's pull requests
     * (Common/Types/AI/LlmProviderChoice): under More fields, after the
     * switch that turns AI off; empty is the default provider, which the
     * folded line names first.
     */
    test("the LLM provider is under More fields, saying what it does for a fix", () => {
      const field: CapturedField = fieldNamed(tableFor(lane), "llmProviderId");

      expect(field.title).toBe("LLM Provider");
      expect(field.description).toBe(
        RULE_LLM_PROVIDER_FIELD_COPY.descriptions[RuleLlmProviderWork.Fix],
      );
      expect(field.fieldType).toBe(FormFieldSchemaType.CustomComponent);
      expect(field.hideOptionalLabel).toBe(true);
      expect(field.hideColumnDescription).toBe(true);
      expect(field.showIf!(values({}))).toBe(true);
      expect(field.showIf!(OLDER_PICKS)).toBe(true);
    });

    test("a rule that runs its runbooks every time uses no AI: no provider to pick, none named", async () => {
      mockRuleLlmProviders(projectProvidersAnswer());

      await act(async () => {
        tableFor(lane);
      });

      const props: Record<string, unknown> =
        mockCapturedTableProps[mockCapturedTableProps.length - 1]!;
      const field: CapturedField = fieldNamed(props, "llmProviderId");

      expect(field.showIf!(EVERY_TIME)).toBe(false);
      expect(field.collapsibleSection!.getSummary!(EVERY_TIME)).toEqual(
        getAutoRemediationMoreFieldsSummary(EVERY_TIME),
      );
    });

    test("folded, the line names the provider: the project's default first, or the rule's pick", async () => {
      mockRuleLlmProviders(projectProvidersAnswer());

      await act(async () => {
        tableFor(lane);
      });

      const props: Record<string, unknown> =
        mockCapturedTableProps[mockCapturedTableProps.length - 1]!;
      const field: CapturedField = fieldNamed(props, "llmProviderId");
      const section: FormFieldCollapsibleSection<AutoRemediationRule> =
        field.collapsibleSection!;

      expect(section.getSummary!(values({}))).toEqual([
        "The rule uses the project's default LLM provider, Azure GPT-4o.",
        ...(getAutoRemediationMoreFieldsSummary(values({})) || []),
      ]);

      const picking: Values = values({ llmProviderId: OPUS_PROVIDER.id });

      expect(section.getSummary!(picking)).toEqual(
        getAutoRemediationMoreFieldsSummary(picking),
      );
      expect(field.getFoldedValue!(picking)).toBe("Claude Opus");
    });

    test("no longer asks Fix With, nor anything else a rule does not need", () => {
      const props: Record<string, unknown> = tableFor(lane);
      const keys: Array<string> = fieldsOf(props).map(keyOf);

      for (const retired of [
        "description",
        "commandAllowlist",
        "commandRunners",
        "verificationWindowMinutes",
        "autoResolveOnVerifiedRecovery",
      ]) {
        expect(keys).not.toContain(retired);
      }

      /*
       * The older rules' two flags are registered only so an edit reads
       * them: never drawn, never asked.
       */
      for (const flag of ["aiComposesCommands", "aiSelectsRunbook"]) {
        const registered: CapturedField = fieldNamed(props, flag);

        expect(registered.showIf!(values({}))).toBe(false);
        expect(registered.showIf!(OLDER_COMMANDS)).toBe(false);
        expect(registered.showIf!(OLDER_PICKS)).toBe(false);
        expect(registered.required).toBe(false);
        expect(registered.collapsibleSection).toBeUndefined();
      }

      // remediationAction is a folded switch now, never a choice of two cards.
      const everyTime: CapturedField = fieldNamed(props, "remediationAction");
      expect(everyTime.title).not.toBe("Fix With");
      expect(everyTime.fieldType).toBe(FormFieldSchemaType.CustomComponent);
      expect(
        fieldsOf(props)
          .filter((field: CapturedField): boolean => {
            return field.fieldType === FormFieldSchemaType.CardSelect;
          })
          .map(keyOf),
      ).toEqual(["executionMode"]);
    });

    test("a rule starts on: its switch is on the edit form only", () => {
      const enabled: CapturedField = fieldNamed(tableFor(lane), "isEnabled");

      expect(enabled.doNotShowWhenCreating).toBe(true);
      expect(enabled.fieldType).toBe(FormFieldSchemaType.Toggle);
    });

    test("Approval asks first unless the rule says otherwise, and says OneUptime AI works out the fix", () => {
      const approval: CapturedField = fieldNamed(
        tableFor(lane),
        "executionMode",
      );

      expect(approval.title).toBe("Approval");
      expect(approval.description).toBe(
        "OneUptime AI works out each fix. Choose whether it waits for someone to approve it.",
      );
      expect(approval.description).toBe(
        AUTO_REMEDIATION_APPROVAL_FIELD_COPY.description,
      );
      expect(approval.fieldType).toBe(FormFieldSchemaType.CardSelect);
      expect(approval.required).toBe(true);
      expect(approval.defaultValue).toBe(AutoRemediationExecutionMode.Suggest);
      expect(approval.collapsibleSection).toBeUndefined();
      expect(approval.cardSelectOptions).toBe(
        AUTO_REMEDIATION_APPROVAL_OPTIONS,
      );

      // Asked of every rule but an older one that picks a runbook: it always asks.
      expect(approval.showIf!(values({}))).toBe(true);
      expect(approval.showIf!(EVERY_TIME)).toBe(true);
      expect(approval.showIf!(OLDER_COMMANDS)).toBe(true);
      expect(approval.showIf!(OLDER_PICKS)).toBe(false);
    });

    test("Runbooks: none picked is any runbook, and some are needed only to run them every time", () => {
      const runbooks: CapturedField = fieldNamed(tableFor(lane), "runbooks");
      const required: (values: Values) => boolean = runbooks.required as (
        values: Values,
      ) => boolean;

      expect(runbooks.title).toBe("Runbooks");
      expect(runbooks.description).toBe(
        "OneUptime AI may run any of your runbooks. Pick some to let it run only those.",
      );
      expect(runbooks.placeholder).toBe("Any runbook");
      // Empty is an answer of its own, not "(Optional)".
      expect(runbooks.hideOptionalLabel).toBe(true);
      expect(runbooks.fieldType).toBe(FormFieldSchemaType.MultiSelectDropdown);
      expect(runbooks.dropdownModal?.type).toBe(Runbook);
      /*
       * There to pick from once More fields is open - but for an older rule
       * that composes commands, which runs no runbook.
       */
      expect(runbooks.showIf!(values({}))).toBe(true);
      expect(runbooks.showIf!(EVERY_TIME)).toBe(true);
      expect(runbooks.showIf!(OLDER_PICKS)).toBe(true);
      expect(runbooks.showIf!(OLDER_COMMANDS)).toBe(false);

      expect(required(EVERY_TIME)).toBe(true);
      for (const other of [
        values({ remediationAction: AutoRemediationAction.OneUptimeAI }),
        values({}),
      ]) {
        expect(required(other)).toBe(false);
      }
    });

    test("Run them every time: a switch shown once the rule names runbooks, or runs them", () => {
      const everyTime: CapturedField = fieldNamed(
        tableFor(lane),
        "remediationAction",
      );

      expect(everyTime.title).toBe("Run them every time");
      // The switch draws its own title and line, beside it.
      expect(everyTime.customElementDrawsOwnLabel).toBe(true);
      expect(everyTime.required).toBe(false);
      expect(everyTime.defaultValue).toBe(AutoRemediationAction.OneUptimeAI);

      expect(everyTime.showIf!(values({}))).toBe(false);
      expect(everyTime.showIf!(values({ runbooks: [] }))).toBe(false);
      expect(everyTime.showIf!(values({ runbooks: PICKED_RUNBOOKS }))).toBe(
        true,
      );
      // A rule saved running its runbooks keeps the switch that says so.
      expect(everyTime.showIf!(EVERY_TIME)).toBe(true);
      // An older rule does what its note says until it fixes like a new one.
      expect(
        everyTime.showIf!(
          values({
            ...(OLDER_PICKS as Record<string, unknown>),
            runbooks: PICKED_RUNBOOKS,
          }),
        ),
      ).toBe(false);

      // Folded, the line says it is on; off is the default and says nothing.
      expect(everyTime.getFoldedValue!(EVERY_TIME)).toBe("On");
      expect(
        everyTime.getFoldedValue!(
          values({ remediationAction: AutoRemediationAction.OneUptimeAI }),
        ),
      ).toBeNull();
      // And off, the line does not name it: named unset, it read as on.
      expect(everyTime.isListedWhileFolded!(EVERY_TIME)).toBe(true);
      expect(
        everyTime.isListedWhileFolded!(
          values({
            remediationAction: AutoRemediationAction.OneUptimeAI,
            runbooks: PICKED_RUNBOOKS,
          }),
        ),
      ).toBe(false);
    });

    test("Runner: none is no Runner, the field says the AI agent is used anyway, and a rule that runs its runbooks every time has none", () => {
      const runner: CapturedField = fieldNamed(tableFor(lane), "runnerId");

      expect(runner.title).toBe("Runner");
      /*
       * The one line that says the AI agent on the affected cluster or host
       * is not a Runner choice: it is used whatever the rule picks.
       */
      expect(runner.description).toBe(
        "Where OneUptime AI runs Bash commands for this rule, inside your network. Commands on the affected cluster or host go through its AI agent.",
      );
      expect(runner.description).not.toContain(
        "AI agent on the cluster or host",
      );
      expect(runner.fieldType).toBe(FormFieldSchemaType.CustomComponent);
      expect(runner.required).toBe(false);
      expect(runner.hideOptionalLabel).toBe(true);
      expect(runner.hideColumnDescription).toBe(true);
      // With no project default Runner read, a new rule starts on none.
      expect(runner.defaultValue).toBeUndefined();

      expect(runner.showIf!(values({}))).toBe(true);
      expect(runner.showIf!(values({ runbooks: PICKED_RUNBOOKS }))).toBe(true);
      expect(runner.showIf!(EVERY_TIME)).toBe(false);
      // An older rule's commands run on its Runner; one that picks a runbook has none.
      expect(runner.showIf!(OLDER_COMMANDS)).toBe(true);
      expect(runner.showIf!(OLDER_PICKS)).toBe(false);
    });

    test("MCP servers: none picked is all of them, and only a rule OneUptime AI fixes for has them", () => {
      const servers: CapturedField = fieldNamed(
        tableFor(lane),
        "externalMcpServers",
      );

      expect(servers.title).toBe("MCP Servers");
      // Parallel to Runbooks above it; the Approval card says what picking does.
      expect(servers.description).toBe(
        "OneUptime AI may use all of your MCP servers to fix. Pick some to let it use only those.",
      );
      expect(servers.fieldType).toBe(FormFieldSchemaType.MultiSelectDropdown);
      expect(servers.dropdownModal?.type).toBe(ExternalMcpServer);
      expect(servers.required).toBe(false);
      expect(servers.hideOptionalLabel).toBe(true);
      expect(servers.placeholder).toBe("All MCP servers");

      expect(servers.showIf!(values({}))).toBe(true);
      expect(servers.showIf!(values({ runbooks: PICKED_RUNBOOKS }))).toBe(true);
      // Fixes that do not go through OneUptime AI's own work use none.
      expect(servers.showIf!(EVERY_TIME)).toBe(false);
      expect(servers.showIf!(OLDER_COMMANDS)).toBe(false);
      expect(servers.showIf!(OLDER_PICKS)).toBe(false);
    });

    test("a new rule starts on the project's default Runner, once the Runners are read", async () => {
      jest
        .spyOn(ProjectUtil, "getCurrentProjectId")
        .mockReturnValue(new ObjectID("dddddddd-0000-4000-8000-000000000001"));
      jest.spyOn(RunnerChoicesLoader, "loadForRemediation").mockResolvedValue({
        projectRunners: [
          {
            id: "aaaaaaaa-0000-4000-8000-000000000002",
            name: "office-runner",
            liveStatus: RunnerLiveStatus.Disconnected,
          },
          {
            id: RUNNER_ID,
            name: "prod-runner",
            liveStatus: RunnerLiveStatus.Connected,
            isProjectDefault: true,
          },
        ],
        globalRunners: [],
        projectUsesGlobalRunners: true,
      } as never);

      await act(async () => {
        render(<AutoRemediationRulesTable lane={lane} />);
      });

      const props: Record<string, unknown> =
        mockCapturedTableProps[mockCapturedTableProps.length - 1] || {};

      expect(fieldNamed(props, "runnerId").defaultValue).toBe(RUNNER_ID);
    });

    /*
     * Folded, the line names the Runner a rule picks - the project's default
     * a new rule starts on included - as a runbook step's line does: where
     * the rule's Bash commands run is never hidden by the fold.
     */
    test("folded, the line names the Runner the rule picks, and says nothing of none", async () => {
      const OFFICE_RUNNER_ID: string = "aaaaaaaa-0000-4000-8000-000000000002";

      jest
        .spyOn(ProjectUtil, "getCurrentProjectId")
        .mockReturnValue(new ObjectID("dddddddd-0000-4000-8000-000000000001"));
      jest.spyOn(RunnerChoicesLoader, "loadForRemediation").mockResolvedValue({
        projectRunners: [
          {
            id: OFFICE_RUNNER_ID,
            name: "office-runner",
            liveStatus: RunnerLiveStatus.NeverConnected,
          },
          {
            id: RUNNER_ID,
            name: "prod-runner",
            liveStatus: RunnerLiveStatus.Connected,
            isProjectDefault: true,
          },
        ],
        globalRunners: [],
        projectUsesGlobalRunners: true,
      } as never);

      await act(async () => {
        render(<AutoRemediationRulesTable lane={lane} />);
      });

      const runner: CapturedField = fieldNamed(
        mockCapturedTableProps[mockCapturedTableProps.length - 1] || {},
        "runnerId",
      );
      const folded: (formValues: Values) => string | null =
        runner.getFoldedValue!;

      // The default a new rule starts on is named: it is where commands run.
      expect(folded(values({ runnerId: runner.defaultValue }))).toBe(
        "prod-runner",
      );
      // A pick as the form holds it: an id, or an ObjectID read from the rule.
      expect(folded(values({ runnerId: new ObjectID(RUNNER_ID) }))).toBe(
        "prod-runner",
      );
      // One not connected says so, as the picker does.
      expect(folded(values({ runnerId: OFFICE_RUNNER_ID }))).toBe(
        "office-runner · Never connected",
      );
      // No Runner is the field's empty answer: named, never as set.
      expect(folded(values({}))).toBeNull();
      expect(folded(values({ runnerId: null }))).toBeNull();
      // One the reader was not shown is never an id.
      expect(
        folded(values({ runnerId: "aaaaaaaa-0000-4000-8000-0000000000ff" })),
      ).toBe("A Runner you do not have access to");
    });

    test("folded, a Runner picked before the Runners are read is not named yet", () => {
      const runner: CapturedField = fieldNamed(tableFor(lane), "runnerId");

      expect(
        runner.getFoldedValue!(values({ runnerId: RUNNER_ID })),
      ).toBeNull();
    });

    test("a project with no default Runner starts a new rule on none", async () => {
      jest
        .spyOn(ProjectUtil, "getCurrentProjectId")
        .mockReturnValue(new ObjectID("dddddddd-0000-4000-8000-000000000001"));
      jest.spyOn(RunnerChoicesLoader, "loadForRemediation").mockResolvedValue({
        projectRunners: [
          {
            id: RUNNER_ID,
            name: "prod-runner",
            liveStatus: RunnerLiveStatus.Connected,
          },
        ],
        globalRunners: [],
        projectUsesGlobalRunners: true,
      } as never);

      await act(async () => {
        render(<AutoRemediationRulesTable lane={lane} />);
      });

      const props: Record<string, unknown> =
        mockCapturedTableProps[mockCapturedTableProps.length - 1] || {};

      expect(fieldNamed(props, "runnerId").defaultValue).toBeUndefined();
    });

    test("Code Repositories: none picked is every connected one, for every kind of rule", () => {
      const repositories: CapturedField = fieldNamed(
        tableFor(lane),
        "codeRepositories",
      );

      expect(repositories.title).toBe("Code Repositories");
      expect(repositories.title).toBe(RULE_CODE_REPOSITORIES_FIELD_COPY.title);
      expect(repositories.description).toBe(
        "OneUptime AI may read all of your connected repositories, and open pull requests in them. Pick some to let it use only those.",
      );
      expect(repositories.fieldType).toBe(FormFieldSchemaType.CustomComponent);
      expect(repositories.required).toBe(false);
      // Empty is an answer of its own - all of them - not "(Optional)".
      expect(repositories.hideOptionalLabel).toBe(true);
      expect(repositories.hideColumnDescription).toBe(true);
      // The pull requests below go to them, whatever the rule fixes with.
      expect(repositories.showIf).toBeUndefined();

      // Folded, the line says how many it names; none is the default.
      expect(repositories.getFoldedValue!(values({}))).toBeNull();
      expect(
        repositories.getFoldedValue!(
          values({
            codeRepositories: [
              "c1111111-1111-4111-8111-111111111111",
              { _id: "c2222222-2222-4222-8222-222222222222" },
            ],
          }),
        ),
      ).toBe("2");

      const onChange: Mock<(value: unknown) => void> = jest.fn();
      const element: React.ReactElement = repositories.getCustomElement!(
        values({ codeRepositories: ["c1111111-1111-4111-8111-111111111111"] }),
        { onChange, ariaLabelledby: "label-id" },
      );

      expect(element.type).toBe(RuleCodeRepositoriesPicker);
      expect(element.props["value"]).toEqual([
        "c1111111-1111-4111-8111-111111111111",
      ]);
      expect(element.props["ariaLabelledby"]).toBe("label-id");

      // What the picker hands back is what the form holds: ids.
      (element.props["onChange"] as (ids: Array<string>) => void)([
        "c2222222-2222-4222-8222-222222222222",
      ]);
      expect(onChange).toHaveBeenCalledWith([
        "c2222222-2222-4222-8222-222222222222",
      ]);

      expect(repositories.getFooterElement!().type).toBe(
        RuleCodeRepositoriesFieldHint,
      );
    });

    test.each([
      [
        "openCodeFixPullRequests",
        "Fix pull requests",
        "When an investigation finds the cause in your code, OneUptime AI opens a pull request with the fix for review. Nothing is merged.",
      ],
      [
        "openTelemetryPullRequests",
        "Telemetry pull requests",
        "When missing logs, traces or metrics stop an investigation, OneUptime AI opens a pull request that adds them, for review.",
      ],
    ])(
      "%s is a switch under More fields, on by default, on every kind of rule",
      (column: string, title: string, description: string) => {
        const pullRequests: CapturedField = fieldNamed(tableFor(lane), column);

        expect(pullRequests.title).toBe(title);
        expect(pullRequests.description).toBe(description);
        expect(pullRequests.fieldType).toBe(FormFieldSchemaType.Toggle);
        expect(pullRequests.required).toBe(false);
        expect(pullRequests.hideColumnDescription).toBe(true);
        expect(pullRequests.showIf).toBeUndefined();
        // On by default: the column's own default fills the create form.
        expect(
          new AutoRemediationRule().getTableColumnMetadata(column).defaultValue,
        ).toBe(true);
      },
    );

    test("an older rule's note: first on the Fix step, only for an older rule", () => {
      const note: CapturedField = fieldNamed(tableFor(lane), "olderRuleNote");

      // Drives the form, sends nothing, and is offered to who may change the flags.
      expect(note.formOnly).toBe(true);
      expect(note.overrideField).toEqual({ aiComposesCommands: true });
      expect(note.stepId).toBe("remediation");
      expect(note.fieldType).toBe(FormFieldSchemaType.CustomComponent);
      expect(note.customElementDrawsOwnLabel).toBe(true);
      expect(note.required).toBe(false);
      expect(note.collapsibleSection).toBeUndefined();

      expect(note.showIf!(OLDER_COMMANDS)).toBe(true);
      expect(note.showIf!(OLDER_PICKS)).toBe(true);
      for (const other of [
        values({}),
        EVERY_TIME,
        values({ runbooks: PICKED_RUNBOOKS, runnerId: RUNNER_ID }),
        // Running its runbooks every time wins over an older flag.
        values({
          remediationAction: AutoRemediationAction.Runbooks,
          aiSelectsRunbook: true,
        }),
      ]) {
        expect(note.showIf!(other)).toBe(false);
      }
    });

    test.each([
      [OLDER_COMMANDS, AUTO_REMEDIATION_OLDER_RULE_COPY.commandsOnRunners],
      [OLDER_PICKS, AUTO_REMEDIATION_OLDER_RULE_COPY.picksRunbook],
    ])(
      "the note says what the rule still does, and Fix like a new rule asks the form to switch it (%#)",
      (rule: Values, text: string) => {
        const note: CapturedField = fieldNamed(tableFor(lane), "olderRuleNote");
        const changes: Array<unknown> = [];

        cleanup();
        render(
          note.getCustomElement!(rule, {
            onChange: (value: unknown): void => {
              changes.push(value);
            },
          }),
        );

        expect(
          screen.getByTestId(AUTO_REMEDIATION_OLDER_RULE_TEST_ID),
        ).toHaveTextContent(text);
        fireEvent.click(
          screen.getByRole("button", {
            name: AUTO_REMEDIATION_OLDER_RULE_COPY.fixLikeANewRule,
          }),
        );
        expect(changes).toEqual([true]);
      },
    );

    test("Fix like a new rule clears the older flags and asks first, keeping the rest", () => {
      const note: CapturedField = fieldNamed(tableFor(lane), "olderRuleNote");
      const written: Array<Values> = [];
      const current: Values = values({
        ...(OLDER_COMMANDS as Record<string, unknown>),
        name: "Commands on the bastion",
        runbooks: PICKED_RUNBOOKS,
      });

      note.onChange!(true, current, (next: Values): void => {
        written.push(next);
      });

      expect(written).toEqual([
        values({
          ...(current as Record<string, unknown>),
          aiComposesCommands: false,
          aiSelectsRunbook: false,
          executionMode: AutoRemediationExecutionMode.Suggest,
        }),
      ]);
      // And the form then reads as a new rule's: every field back.
      expect(isOlderAutoRemediationRule(written[0]!)).toBe(false);
    });

    test("a new rule's Fix step draws no note", () => {
      const note: CapturedField = fieldNamed(tableFor(lane), "olderRuleNote");

      cleanup();
      const { container } = render(note.getCustomElement!(values({}), {}));

      expect(container).toBeEmptyDOMElement();
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
      const count: CountSpy = jest
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

    test("names each rule's fix in one Fix column, between its conditions and its status", () => {
      const columns: Array<CapturedColumn> = (tableFor(lane)["columns"] ||
        []) as Array<CapturedColumn>;

      expect(
        columns.map((column: CapturedColumn): string => {
          return column.title || "";
        }),
      ).toEqual(["Name", "Fix", "Status"]);
      expect(columnTitled(tableFor(lane), "Fix").field).toEqual({
        executionMode: true,
      });
    });

    test.each([
      [
        { executionMode: AutoRemediationExecutionMode.Suggest },
        "Asks first",
        null,
      ],
      [
        { executionMode: AutoRemediationExecutionMode.FullAuto },
        "Without asking",
        null,
      ],
      [
        {
          remediationAction: AutoRemediationAction.Runbooks,
          executionMode: AutoRemediationExecutionMode.FullAuto,
        },
        "Without asking",
        "Its runbooks, every time",
      ],
      [
        {
          remediationAction: AutoRemediationAction.OneUptimeAI,
          executionMode: AutoRemediationExecutionMode.Suggest,
          aiComposesCommands: true,
        },
        "Asks first",
        "OneUptime AI: commands on Runners",
      ],
      [
        // A runbook such a rule picks is always proposed, whatever it says.
        {
          remediationAction: AutoRemediationAction.OneUptimeAI,
          executionMode: AutoRemediationExecutionMode.FullAuto,
          aiSelectsRunbook: true,
        },
        "Asks first",
        "OneUptime AI: picks a runbook",
      ],
    ])(
      "the Fix column names %j as %s, and how it fixes only when it is not OneUptime AI's way",
      (
        fields: Partial<AutoRemediationRule>,
        approval: string,
        fixedWith: string | null,
      ) => {
        const column: CapturedColumn = columnTitled(tableFor(lane), "Fix");

        cleanup();
        render(column.getElement!(rule(fields)));

        expect(screen.getByText(approval)).toBeInTheDocument();

        const line: HTMLElement | null = screen.queryByTestId(
          "auto-remediation-rule-fixed-with",
        );

        if (fixedWith) {
          expect(line).toHaveTextContent(fixedWith);
          // A quiet line that wraps, never a second pill that widens the table.
          expect(line).toHaveClass("whitespace-normal");
        } else {
          expect(line).toBeNull();
          expect(screen.queryByText("OneUptime AI")).toBeNull();
        }
      },
    );
  },
);

describe("what a rule saves", () => {
  test("a rule is OneUptime AI's unless it runs its runbooks every time", () => {
    for (const remediationAction of [
      undefined,
      AutoRemediationAction.OneUptimeAI,
      "something-else",
    ]) {
      expect(
        prepareAutoRemediationRuleSave(
          rule({
            remediationAction: remediationAction as AutoRemediationAction,
          }),
        ).remediationAction,
      ).toBe(AutoRemediationAction.OneUptimeAI);
    }
  });

  test("a rule that runs its runbooks every time picks no Runner", () => {
    const saved: AutoRemediationRule = prepareAutoRemediationRuleSave(
      rule({
        remediationAction: AutoRemediationAction.Runbooks,
        runnerId: new ObjectID(RUNNER_ID),
      }),
    );

    expect(saved.remediationAction).toBe(AutoRemediationAction.Runbooks);
    // Cleared, not left out: an edit takes the rule's Runner away.
    expect(saved.runnerId).toBeNull();
  });

  test("an OneUptime AI rule keeps its Runner, and a rule with none sends none", () => {
    expect(
      String(
        prepareAutoRemediationRuleSave(
          rule({ runnerId: new ObjectID(RUNNER_ID) }),
        ).runnerId,
      ),
    ).toBe(RUNNER_ID);
    expect(prepareAutoRemediationRuleSave(rule({})).runnerId).toBeUndefined();
  });
});

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

  test("a runbook a rule saved before has OneUptime AI pick always waits for approval", () => {
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

  test("the form knows when a rule runs its runbooks every time", () => {
    expect(isRunbooksEveryTime(EVERY_TIME)).toBe(true);
    expect(
      isRunbooksEveryTime(
        values({ remediationAction: AutoRemediationAction.OneUptimeAI }),
      ),
    ).toBe(false);
    expect(isRunbooksEveryTime(values({ remediationAction: "runbooks" }))).toBe(
      false,
    );
  });

  test("the form knows when a rule names runbooks, as rows, ids or options", () => {
    expect(hasRuleRunbooks(values({}))).toBe(false);
    expect(hasRuleRunbooks(values({ runbooks: [] }))).toBe(false);
    expect(hasRuleRunbooks(values({ runbooks: "x" }))).toBe(false);
    expect(hasRuleRunbooks(values({ runbooks: PICKED_RUNBOOKS }))).toBe(true);
    expect(hasRuleRunbooks(values({ runbooks: [RUNBOOK_ID] }))).toBe(true);
  });

  test("the form knows when a rule picks a Runner", () => {
    expect(hasRuleRunner(values({}))).toBe(false);
    expect(hasRuleRunner(values({ runnerId: null }))).toBe(false);
    expect(hasRuleRunner(values({ runnerId: "" }))).toBe(false);
    expect(hasRuleRunner(values({ runnerId: RUNNER_ID }))).toBe(true);
    expect(hasRuleRunner(values({ runnerId: new ObjectID(RUNNER_ID) }))).toBe(
      true,
    );
  });
});

describe("the line under More fields, folded", () => {
  /*
   * A new rule keeps every default, and that is one sentence - not one
   * per field, each starting "OneUptime AI may".
   */
  const EVERYTHING_AND_PULL_REQUESTS: string =
    "OneUptime AI may use any of your runbooks, MCP servers and connected repositories, and open pull requests in them.";
  const EVERYTHING: string =
    "OneUptime AI may use any of your runbooks, MCP servers and connected repositories.";
  const ALL_MCP_SERVERS: string =
    "OneUptime AI may use all of your MCP servers.";
  const ALL_REPOSITORIES_AND_PULL_REQUESTS: string =
    "OneUptime AI may read all connected repositories, and open pull requests in them.";
  const ALL_REPOSITORIES: string =
    "OneUptime AI may read all connected repositories.";
  const PICKED_MCP_SERVERS: Array<unknown> = [
    { value: "bbbbbbbb-0000-4000-8000-000000000001", label: "AWS" },
  ];
  const PICKED_REPOSITORIES: Array<string> = [
    "c1111111-1111-4111-8111-111111111111",
  ];

  test("a new rule keeps every default, said in one sentence", () => {
    expect(getAutoRemediationMoreFieldsSummary(values({}))).toEqual([
      EVERYTHING_AND_PULL_REQUESTS,
    ]);
    expect(
      AUTO_REMEDIATION_MORE_FIELDS_SUMMARIES.everythingAndPullRequests,
    ).toBe(EVERYTHING_AND_PULL_REQUESTS);
    expect(AUTO_REMEDIATION_MORE_FIELDS_SUMMARIES.everything).toBe(EVERYTHING);
  });

  test("once some are set, names each default left: any runbook, every MCP server, every repository and its pull requests", () => {
    expect(
      getAutoRemediationMoreFieldsSummary(
        values({ runbooks: PICKED_RUNBOOKS }),
      ),
    ).toEqual([ALL_MCP_SERVERS, ALL_REPOSITORIES_AND_PULL_REQUESTS]);
    expect(
      getAutoRemediationMoreFieldsSummary(
        values({ externalMcpServers: PICKED_MCP_SERVERS }),
      ),
    ).toEqual([
      AUTO_REMEDIATION_MORE_FIELDS_SUMMARIES.anyRunbook,
      ALL_REPOSITORIES_AND_PULL_REQUESTS,
    ]);
    expect(
      getAutoRemediationMoreFieldsSummary(
        values({ codeRepositories: PICKED_REPOSITORIES }),
      ),
    ).toEqual([
      AUTO_REMEDIATION_MORE_FIELDS_SUMMARIES.anyRunbook,
      ALL_MCP_SERVERS,
    ]);
  });

  test("never names the AI agent, and a Runner picked changes nothing it says", () => {
    for (const formValues of [values({}), values({ runnerId: RUNNER_ID })]) {
      for (const sentence of getAutoRemediationMoreFieldsSummary(formValues) ||
        []) {
        expect(sentence).not.toContain("AI agent");
      }
    }

    expect(
      getAutoRemediationMoreFieldsSummary(values({ runnerId: RUNNER_ID })),
    ).toEqual(getAutoRemediationMoreFieldsSummary(values({})));
  });

  test("with both pull requests off, it says the repositories are read only", () => {
    expect(
      getAutoRemediationMoreFieldsSummary(
        values({
          openCodeFixPullRequests: false,
          openTelemetryPullRequests: false,
        }),
      ),
    ).toEqual([EVERYTHING]);
    expect(
      getAutoRemediationMoreFieldsSummary(
        values({
          runbooks: PICKED_RUNBOOKS,
          openCodeFixPullRequests: false,
          openTelemetryPullRequests: false,
        }),
      ),
    ).toEqual([ALL_MCP_SERVERS, ALL_REPOSITORIES]);
    // One still on still opens pull requests.
    expect(
      getAutoRemediationMoreFieldsSummary(
        values({ openCodeFixPullRequests: false }),
      ),
    ).toEqual([EVERYTHING_AND_PULL_REQUESTS]);
    expect(
      getAutoRemediationMoreFieldsSummary(
        values({ runbooks: PICKED_RUNBOOKS, openCodeFixPullRequests: false }),
      ),
    ).toContain(ALL_REPOSITORIES_AND_PULL_REQUESTS);
    expect(ALL_REPOSITORIES).toBe(
      RULE_CODE_REPOSITORIES_FIELD_COPY.allRepositoriesSummary,
    );
  });

  test("an older rule, or one that runs its runbooks, has only the repositories' default to describe", () => {
    for (const formValues of [
      OLDER_COMMANDS,
      OLDER_PICKS,
      values({
        remediationAction: AutoRemediationAction.Runbooks,
        runbooks: PICKED_RUNBOOKS,
      }),
    ]) {
      expect(getAutoRemediationMoreFieldsSummary(formValues)).toEqual([
        ALL_REPOSITORIES_AND_PULL_REQUESTS,
      ]);
    }
  });

  test("says nothing once everything it describes is set - the line names them", () => {
    expect(
      getAutoRemediationMoreFieldsSummary(
        values({
          runbooks: PICKED_RUNBOOKS,
          runnerId: RUNNER_ID,
          externalMcpServers: PICKED_MCP_SERVERS,
          codeRepositories: PICKED_REPOSITORIES,
        }),
      ),
    ).toBeUndefined();
    expect(
      getAutoRemediationMoreFieldsSummary(
        values({
          remediationAction: AutoRemediationAction.Runbooks,
          runbooks: PICKED_RUNBOOKS,
          codeRepositories: PICKED_REPOSITORIES,
        }),
      ),
    ).toBeUndefined();
  });
});

describe("the choices", () => {
  test("Approval: ask first, then fix without asking", () => {
    expect(
      AUTO_REMEDIATION_APPROVAL_OPTIONS.map((option: CardSelectOption) => {
        return [option.value, option.title];
      }),
    ).toEqual([
      [AutoRemediationExecutionMode.Suggest, "Ask before fixing"],
      [AutoRemediationExecutionMode.FullAuto, "Fix without asking"],
    ]);
    expect(AUTO_REMEDIATION_APPROVAL_OPTIONS[0]!.description).toBe(
      "Nothing runs until someone approves the fix with one click.",
    );
    /*
     * An AI agent set to ask still asks: the rule never overrides it. And a
     * runbook starts, or a change goes through an MCP server, on its own
     * only when the rule names it - said whatever More fields holds, so a
     * rule that names none is not read as starting any runbook or making
     * any change through an MCP server without asking.
     */
    expect(AUTO_REMEDIATION_APPROVAL_OPTIONS[1]!.description).toBe(
      "OneUptime AI fixes on its own where the AI agent's settings allow it, and with the runbooks and MCP servers you pick under More fields.",
    );
    expect(AUTO_REMEDIATION_APPROVAL_OPTIONS[1]!.description).not.toContain(
      "the runbooks you picked",
    );
  });

  test("every choice has an icon of its own", () => {
    const icons: Array<unknown> = AUTO_REMEDIATION_APPROVAL_OPTIONS.map(
      (option: CardSelectOption) => {
        return option.icon;
      },
    );

    expect(icons.every(Boolean)).toBe(true);
    expect(new Set(icons).size).toBe(AUTO_REMEDIATION_APPROVAL_OPTIONS.length);
  });

  test("More fields says what each of its fields does", () => {
    expect(AUTO_REMEDIATION_MORE_FIELDS_COPY).toEqual({
      runbooksTitle: "Runbooks",
      runbooksDescription:
        "OneUptime AI may run any of your runbooks. Pick some to let it run only those.",
      runbooksPlaceholder: "Any runbook",
      everyTimeTitle: "Run them every time",
      everyTimeDescription:
        "Start every runbook above for every match, instead of OneUptime AI deciding.",
      runnerTitle: "Runner",
      runnerDescription:
        "Where OneUptime AI runs Bash commands for this rule, inside your network. Commands on the affected cluster or host go through its AI agent.",
      codeFixTitle: "Fix pull requests",
      codeFixDescription:
        "When an investigation finds the cause in your code, OneUptime AI opens a pull request with the fix for review. Nothing is merged.",
      telemetryTitle: "Telemetry pull requests",
      telemetryDescription:
        "When missing logs, traces or metrics stop an investigation, OneUptime AI opens a pull request that adds them, for review.",
    });
  });
});

describe("an older rule, read from the form", () => {
  test("reads a rule's fix from the form the way the engine reads a saved one", () => {
    expect(getEditedRuleFixKind(values({}))).toBe(
      AutoRemediationFixKind.OneUptimeAi,
    );
    expect(getEditedRuleFixKind(EVERY_TIME)).toBe(
      AutoRemediationFixKind.RunbooksEveryTime,
    );
    expect(getEditedRuleFixKind(OLDER_COMMANDS)).toBe(
      AutoRemediationFixKind.CommandsOnRunners,
    );
    expect(getEditedRuleFixKind(OLDER_PICKS)).toBe(
      AutoRemediationFixKind.AiPicksRunbook,
    );
    // Both flags: composing commands wins, as it always has.
    expect(
      getEditedRuleFixKind(
        values({ aiComposesCommands: true, aiSelectsRunbook: true }),
      ),
    ).toBe(AutoRemediationFixKind.CommandsOnRunners);
    // A flag that is not a real true is no older rule.
    expect(
      getEditedRuleFixKind(
        values({ aiComposesCommands: "true", aiSelectsRunbook: 1 }),
      ),
    ).toBe(AutoRemediationFixKind.OneUptimeAi);
  });

  test("says what an older rule does, and nothing for any other", () => {
    expect(getOlderAutoRemediationRuleText(OLDER_COMMANDS)).toBe(
      "This older rule only has OneUptime AI run commands on its Runners.",
    );
    expect(getOlderAutoRemediationRuleText(OLDER_PICKS)).toBe(
      "This older rule only has OneUptime AI pick one of its runbooks, and always asks first.",
    );
    expect(getOlderAutoRemediationRuleText(values({}))).toBeNull();
    expect(getOlderAutoRemediationRuleText(EVERY_TIME)).toBeNull();
    expect(AUTO_REMEDIATION_OLDER_RULE_COPY.fixLikeANewRule).toBe(
      "Fix like a new rule",
    );
  });

  test("fixing like a new rule asks first even for a rule that fixed without asking", () => {
    const next: Record<string, unknown> = getValuesFixingLikeANewRule(
      OLDER_COMMANDS,
    ) as Record<string, unknown>;

    expect(next["aiComposesCommands"]).toBe(false);
    expect(next["aiSelectsRunbook"]).toBe(false);
    expect(next["executionMode"]).toBe(AutoRemediationExecutionMode.Suggest);
    // Its Runner stays: commands run there now as for any new rule.
    expect(next["runnerId"]).toBe(RUNNER_ID);
    expect(getEditedRuleFixKind(next as Values)).toBe(
      AutoRemediationFixKind.OneUptimeAi,
    );
  });

  test("the Fix column's line names only the rules that do not fix OneUptime AI's way", () => {
    expect(getAutoRemediationFixWithText({})).toBeNull();
    expect(
      getAutoRemediationFixWithText({
        remediationAction: AutoRemediationAction.Runbooks,
      }),
    ).toBe(AUTO_REMEDIATION_FIX_WITH_TEXT.runbooks);
    expect(getAutoRemediationFixWithText({ aiComposesCommands: true })).toBe(
      AUTO_REMEDIATION_FIX_WITH_TEXT.runnerCommands,
    );
    expect(getAutoRemediationFixWithText({ aiSelectsRunbook: true })).toBe(
      AUTO_REMEDIATION_FIX_WITH_TEXT.aiPickedRunbook,
    );
    // No "OneUptime AI" for a rule that fixes the way every new rule does.
    expect(Object.values(AUTO_REMEDIATION_FIX_WITH_TEXT)).not.toContain(
      "OneUptime AI",
    );
  });
});
