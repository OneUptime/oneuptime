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
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";

/*
 * Incidents (or Alerts) → Settings → AI → More settings → AI rules: which
 * new incidents OneUptime AI works on, and what it does with each.
 *
 * Investigation rules and auto remediation rules were two tables of rules
 * with the same conditions. The maintainer: "Should incident investigation
 * rule and remediation rule be the same entity - we can call it Incident AI
 * rules ... Since its not possible to remediate without investigation." So
 * one rule asks, a step each:
 *
 *   - Match: its conditions, drawn as one builder on "All incidents";
 *   - Investigate: right away, or only if still open after a wait (#5074) -
 *     or, for a rule that only fixes (an auto remediation rule from before
 *     the merge), a note saying so and "Investigate too";
 *   - Fix: don't fix, ask before fixing, or fix without asking - and its
 *     name. Folded under More fields: the code repositories and MCP servers
 *     OneUptime AI may use, the LLM provider, the rule's AI context (notes
 *     OneUptime AI reads after the project's, #5198), the runbooks it may
 *     run (none picked: any) and "Run them every time", the Runner its Bash
 *     commands run on, the two pull requests, and the description.
 *
 * The table names each rule's timing in an Investigates column and its fix
 * in a Fix column. A rule saved before auto remediation rules were
 * simplified says what it still does at the top of its Fix step, hides what
 * does nothing for it, and offers "Fix like a new rule".
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

import AiRulesTable, {
  AI_LANE_AI_RULE_TRIGGER,
  doesRuleUseAi,
  prepareAiRuleSave,
  prepareNewAiRule,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/AiRulesTable";
import {
  AI_RULE_COLUMN_TITLE,
  AI_RULE_DOES_NOTHING_TEXT,
  AI_RULE_FIX_FIELD_COPY,
  AI_RULE_FIX_FIELD_KEY,
  AI_RULE_FIX_OPTIONS,
  AI_RULE_ONLY_FIXES_COPY,
  AI_RULE_TEST_IDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/AiRuleCopy";
import {
  AUTO_REMEDIATION_FIX_WITH_TEXT,
  AUTO_REMEDIATION_MORE_FIELDS_COPY,
  AUTO_REMEDIATION_MORE_FIELDS_SUMMARIES,
  AUTO_REMEDIATION_OLDER_RULE_COPY,
  AutoRemediationFixWith,
  getAutoRemediationFixWith,
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
import {
  AUTO_REMEDIATION_OLDER_RULE_TEST_ID,
  AutoRemediationRunnerPicker,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/AutoRemediationRuleFields";
import { getInvestigationRuleMoreFieldsSummary } from "../../../../App/FeatureSet/Dashboard/src/Components/ExternalMcpServer/ExternalMcpServerCopy";
import { RULE_CODE_REPOSITORIES_FIELD_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/RuleCodeRepositoriesCopy";
import {
  RuleCodeRepositoriesFieldHint,
  RuleCodeRepositoriesPicker,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/RuleCodeRepositoriesField";
import RunnerChoicesLoader from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/RunnerChoices";
import {
  AI_LANE_AI_RULES_TABLE_ID,
  AI_LANE_RULE_CRITERIA_SUBJECTS,
  AI_LANE_RULES_COPY,
  AiLane,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import {
  INVESTIGATION_RULE_NAME_COLUMN_CLASS_NAME,
  INVESTIGATION_RULE_TIMING_COLUMN_CLASS_NAME,
  INVESTIGATION_RULE_TIMING_COLUMN_FLOOR_CLASS_NAME,
  INVESTIGATION_RULE_TIMING_FIELD_KEY,
  InvestigationRuleTiming,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/InvestigationRuleTiming";
import {
  RULE_ENABLED_DESCRIPTION,
  RULE_NAME_MAX_LENGTH,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/ResourceRuleForm";
import { RULE_LLM_PROVIDER_FIELD_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/AI/RuleLlmProviderCopy";
import {
  ONEUPTIME_AI_PROVIDER,
  OPUS_PROVIDER,
  mockRuleLlmProviders,
  projectProvidersAnswer,
  providersAnswer,
} from "./RuleLlmProviderFixtures";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import ExternalMcpServer from "../../../Models/DatabaseModels/ExternalMcpServer";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import { AiRuleFix } from "../../../Types/AI/AiRule";
import AutoRemediationAction from "../../../Types/AutoRemediation/AutoRemediationAction";
import AutoRemediationExecutionMode from "../../../Types/AutoRemediation/AutoRemediationExecutionMode";
import { AutoRemediationFixKind } from "../../../Types/AutoRemediation/AutoRemediationFix";
import AutoRemediationTriggerEntity from "../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import ObjectID from "../../../Types/ObjectID";
import RunnerLiveStatus from "../../../Types/Runner/RunnerLiveStatus";
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
import ProjectUtil from "../../../UI/Utils/Project";

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
  dataTestId?: string;
  dropdownModal?: { type?: unknown; emptyListText?: string };
  cardSelectOptions?: Array<CardSelectOption>;
  cardSelectSingleColumn?: boolean;
  radioButtonOptions?: Array<{
    value: string;
    title: string;
    description?: string;
  }>;
  validation?: { minLength?: number; maxLength?: number };
  collapsibleSection?: FormFieldCollapsibleSection<AutoRemediationRule>;
  getFoldedValue?: (values: Values) => string | null;
  isListedWhileFolded?: (values: Values) => boolean;
  getDefaultValue?: (values: Values) => unknown;
  customValidation?: (values: Values) => string | null;
  onChange?: (
    value: unknown,
    currentValues: Values,
    setNewFormValues: (values: Values) => void,
  ) => void;
  getCustomElement?: (
    values: Values,
    props: CustomElementProps,
  ) => React.ReactElement;
  getFooterElement?: (
    values: Values,
    error?: string,
    footer?: { setValue: (value: unknown) => void },
  ) => React.ReactElement | undefined;
  hideColumnDescription?: boolean;
  allowImageUpload?: boolean;
}

interface CapturedColumn {
  field?: Record<string, unknown>;
  title?: string;
  disableSort?: boolean;
  wrapContent?: boolean;
  wrapMaxWidthClassName?: string;
  contentClassName?: string;
  getElement?: (item: AutoRemediationRule) => React.ReactElement;
  getExportValue?: (item: AutoRemediationRule) => string;
}

const RUNNER_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";
const RUNBOOK_ID: string = "bbbbbbbb-0000-4000-8000-000000000001";

function tableFor(
  lane: AiLane,
  onRulesLoaded?: (count: number) => void,
): Record<string, unknown> {
  render(<AiRulesTable lane={lane} onRulesLoaded={onRulesLoaded} />);

  return mockCapturedTableProps[mockCapturedTableProps.length - 1] || {};
}

async function settledTableFor(lane: AiLane): Promise<Record<string, unknown>> {
  await act(async () => {
    render(<AiRulesTable lane={lane} />);
  });

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

function columnsOf(props: Record<string, unknown>): Array<CapturedColumn> {
  return (props["columns"] || []) as Array<CapturedColumn>;
}

function columnTitled(
  props: Record<string, unknown>,
  title: string,
): CapturedColumn {
  const found: CapturedColumn | undefined = columnsOf(props).find(
    (column: CapturedColumn): boolean => {
      return column.title === title;
    },
  );

  if (!found) {
    throw new Error(`No ${title} column`);
  }

  return found;
}

function isRequired(field: CapturedField, formValues: Values): boolean {
  return typeof field.required === "function"
    ? field.required(formValues)
    : Boolean(field.required);
}

function rule(fields: Partial<AutoRemediationRule>): AutoRemediationRule {
  return Object.assign(new AutoRemediationRule(), fields);
}

function values(fields: Record<string, unknown>): Values {
  return fields as unknown as Values;
}

function withValues(base: Values, more: Record<string, unknown>): Values {
  return values({ ...(base as Record<string, unknown>), ...more });
}

// A new rule's form: Investigates starts on, and the rule fixes, asking first.
const NEW_RULE: Values = values({ investigates: true });

// A rule that investigates and posts what it finds: "Don't fix".
const DOES_NOT_FIX: Values = values({ investigates: true, fixes: false });

// An auto remediation rule from before the merge that only fixes.
const ONLY_FIXES: Values = values({ investigates: false, fixes: true });

const EVERY_TIME: Values = values({
  investigates: true,
  remediationAction: AutoRemediationAction.Runbooks,
});

const ONLY_FIXES_EVERY_TIME: Values = values({
  investigates: false,
  remediationAction: AutoRemediationAction.Runbooks,
});

// Rules saved before auto remediation rules were simplified, as an edit loads them.
const OLDER_COMMANDS: Values = values({
  investigates: false,
  remediationAction: AutoRemediationAction.OneUptimeAI,
  aiComposesCommands: true,
  aiSelectsRunbook: false,
  executionMode: AutoRemediationExecutionMode.FullAuto,
  runnerId: RUNNER_ID,
});

const OLDER_PICKS: Values = values({
  investigates: false,
  remediationAction: AutoRemediationAction.OneUptimeAI,
  aiComposesCommands: false,
  aiSelectsRunbook: true,
  executionMode: AutoRemediationExecutionMode.FullAuto,
});

// A runbook as the dropdown holds it while the form is open.
const PICKED_RUNBOOKS: Array<unknown> = [
  { value: RUNBOOK_ID, label: "Restart API" },
];

// Every kind of rule a form can hold.
const EVERY_KIND_OF_RULE: Array<[string, Values]> = [
  ["a new rule", NEW_RULE],
  ["a rule that does not fix", DOES_NOT_FIX],
  ["a rule that only fixes", ONLY_FIXES],
  ["a rule that runs its runbooks every time", EVERY_TIME],
  ["a rule that only runs its runbooks every time", ONLY_FIXES_EVERY_TIME],
  ["an older rule that composes commands", OLDER_COMMANDS],
  ["an older rule that picks a runbook", OLDER_PICKS],
  [
    "an older rule that investigates too",
    withValues(OLDER_PICKS, { investigates: true }),
  ],
  [
    "a rule that does not fix, naming runbooks",
    withValues(DOES_NOT_FIX, {
      runbooks: PICKED_RUNBOOKS,
      remediationAction: AutoRemediationAction.Runbooks,
    }),
  ],
];

const MORE_FIELDS: Array<string> = [
  "codeRepositories",
  "externalMcpServers",
  "llmProviderId",
  "aiContext",
  "runbooks",
  "remediationAction",
  "runnerId",
  "openCodeFixPullRequests",
  "openTelemetryPullRequests",
  "description",
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
  [AiLane.Incident, AutoRemediationTriggerEntity.Incident, "incident"],
  [AiLane.Alert, AutoRemediationTriggerEntity.Alert, "alert"],
])(
  "the %s AI rules table",
  (lane: AiLane, trigger: AutoRemediationTriggerEntity, noun: string) => {
    const nouns: string = `${noun}s`;
    const Nouns: string = noun === "incident" ? "Incidents" : "Alerts";
    const starts: string = lane === AiLane.Incident ? "declared" : "created";

    test("reads and creates only its own kind of rule: a new one investigates, and OneUptime AI fixes it", async () => {
      const props: Record<string, unknown> = tableFor(lane);

      expect(props["modelType"]).toBe(AutoRemediationRule);
      expect(AI_LANE_AI_RULE_TRIGGER[lane]).toBe(trigger);
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
      // There is no fixing without investigating: every rule made here does.
      expect(created.investigates).toBe(true);
      // Sent, so a rule naming runbooks is never read as running them every time.
      expect(created.remediationAction).toBe(AutoRemediationAction.OneUptimeAI);
    });

    test("a new rule that does not fix picks no Runner; one that fixes keeps the one it picked", async () => {
      const onBeforeCreate: (
        item: AutoRemediationRule,
      ) => Promise<AutoRemediationRule> = tableFor(lane)["onBeforeCreate"] as (
        item: AutoRemediationRule,
      ) => Promise<AutoRemediationRule>;

      const investigating: AutoRemediationRule = await onBeforeCreate(
        rule({ fixes: false, runnerId: new ObjectID(RUNNER_ID) }),
      );
      expect(investigating.investigates).toBe(true);
      expect(investigating.fixes).toBe(false);
      expect(investigating.runnerId).toBeNull();

      const fixing: AutoRemediationRule = await onBeforeCreate(
        rule({ fixes: true, runnerId: new ObjectID(RUNNER_ID) }),
      );
      expect(String(fixing.runnerId)).toBe(RUNNER_ID);
    });

    test("an edit saves what the form says the same way, and leaves whether the rule investigates to the rule", async () => {
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

      // A rule that only fixes stays one until "Investigate too" says otherwise.
      const onlyFixes: AutoRemediationRule = await onBeforeUpdate(
        rule({ investigates: false }),
      );
      expect(onlyFixes.investigates).toBe(false);
      expect((await onBeforeUpdate(rule({}))).investigates).toBeUndefined();
    });

    test("is named for what it holds, and keeps its own preferences", () => {
      const props: Record<string, unknown> = tableFor(lane);

      expect(props["id"]).toBe(AI_LANE_AI_RULES_TABLE_ID[lane]);
      expect(AI_LANE_AI_RULES_TABLE_ID[lane]).toBe(
        `ai-rules-table-${lane === AiLane.Incident ? "Incident" : "Alert"}`,
      );
      expect(props["userPreferencesKey"]).toBe(AI_LANE_AI_RULES_TABLE_ID[lane]);
      expect(props["name"]).toBe("Settings > AI > AI Rules");
      expect(props["cardProps"]).toEqual({
        title: "AI rules",
        description: AI_LANE_RULES_COPY[lane].aiRulesDescription,
        /*
         * Its place on the settings page, the More settings item's key: an
         * incident's or alert's folded AI card links to "#AiRules", which
         * opens More settings at this table (AdvancedPageSection).
         */
        id: "AiRules",
      });
      // A rule's three steps, in their order: which, when, and how.
      expect(AI_LANE_RULES_COPY[lane].aiRulesDescription).toBe(
        `With no rule, OneUptime AI investigates every new ${noun} right away, and fixes it while fixing is on, pull requests included. Add rules to choose which ${nouns} it works on, when, and how each is fixed.`,
      );
      expect(props["noItemsMessage"]).toBe(
        `No rules. Every new ${noun} is investigated, and fixed while fixing is on.`,
      );
      expect(props["noItemsMessage"]).toBe(
        AI_LANE_RULES_COPY[lane].noAiRulesMessage,
      );
      // "All incidents" or "Only incidents that match conditions".
      expect(props["ruleCriteriaSubject"]).toBe(
        AI_LANE_RULE_CRITERIA_SUBJECTS[lane],
      );
    });

    test("a rule asks Match, Investigate and Fix; what most rules leave alone is folded", () => {
      const props: Record<string, unknown> = tableFor(lane);

      expect(props["formSteps"]).toEqual([
        { title: "Match", id: "match-criteria" },
        { title: "Investigate", id: "investigate" },
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
        // Whether it investigates, never drawn, and the note of one that does not.
        ["investigates", "investigate", ""],
        ["onlyFixesNote", "investigate", ""],
        [INVESTIGATION_RULE_TIMING_FIELD_KEY, "investigate", ""],
        ["onlyIfOpenAfterMinutes", "investigate", ""],
        // The two columns the Fix answer writes, and an older rule's flags, never drawn.
        ["fixes", "remediation", ""],
        ["executionMode", "remediation", ""],
        ["aiComposesCommands", "remediation", ""],
        ["aiSelectsRunbook", "remediation", ""],
        ["olderRuleNote", "remediation", ""],
        // The Fix step's one question, its name, then More fields, folded.
        [AI_RULE_FIX_FIELD_KEY, "remediation", ""],
        ["name", "remediation", ""],
        ["isEnabled", "remediation", ""],
        ...MORE_FIELDS.map((key: string): [string, string, string] => {
          return [key, "remediation", MORE_FIELDS_SECTION_TITLE];
        }),
      ]);
    });

    test("its conditions: monitors, its own kind's severities, labels, monitor labels, title and description", () => {
      const conditions: Array<CapturedField> = fieldsOf(tableFor(lane)).filter(
        (field: CapturedField): boolean => {
          return field.stepId === "match-criteria";
        },
      );

      expect(
        conditions.map((field: CapturedField) => {
          return [
            keyOf(field),
            field.title,
            field.fieldType,
            field.dropdownModal?.type,
            isRequired(field, NEW_RULE),
          ];
        }),
      ).toEqual([
        [
          "monitors",
          "Monitors",
          FormFieldSchemaType.MultiSelectDropdown,
          Monitor,
          false,
        ],
        lane === AiLane.Incident
          ? [
              "incidentSeverities",
              "Incident Severities",
              FormFieldSchemaType.MultiSelectDropdown,
              IncidentSeverity,
              false,
            ]
          : [
              "alertSeverities",
              "Alert Severities",
              FormFieldSchemaType.MultiSelectDropdown,
              AlertSeverity,
              false,
            ],
        [
          "labels",
          lane === AiLane.Incident ? "Incident Labels" : "Alert Labels",
          FormFieldSchemaType.MultiSelectDropdown,
          Label,
          false,
        ],
        [
          "monitorLabels",
          "Monitor Labels",
          FormFieldSchemaType.MultiSelectDropdown,
          Label,
          false,
        ],
        [
          "titlePattern",
          lane === AiLane.Incident ? "Incident Title" : "Alert Title",
          FormFieldSchemaType.Text,
          undefined,
          false,
        ],
        [
          "descriptionPattern",
          lane === AiLane.Incident
            ? "Incident Description"
            : "Alert Description",
          FormFieldSchemaType.Text,
          undefined,
          false,
        ],
      ]);
    });

    test("whether a rule investigates is never asked: a new rule starts on", () => {
      const investigates: CapturedField = fieldNamed(
        tableFor(lane),
        "investigates",
      );

      expect(investigates.fieldType).toBe(FormFieldSchemaType.Toggle);
      expect(investigates.defaultValue).toBe(true);
      expect(investigates.required).toBe(false);
      expect(investigates.hideColumnDescription).toBe(true);

      for (const [, formValues] of EVERY_KIND_OF_RULE) {
        expect(investigates.showIf!(formValues)).toBe(false);
      }
    });

    test("a rule that only fixes says so where the question would be", () => {
      const note: CapturedField = fieldNamed(tableFor(lane), "onlyFixesNote");

      // Drives the form and sends nothing of its own.
      expect(note.formOnly).toBe(true);
      expect(note.overrideField).toEqual({ investigates: true });
      expect(note.fieldType).toBe(FormFieldSchemaType.CustomComponent);
      expect(note.customElementDrawsOwnLabel).toBe(true);
      expect(note.required).toBe(false);
      expect(note.collapsibleSection).toBeUndefined();

      expect(note.showIf!(ONLY_FIXES)).toBe(true);
      expect(note.showIf!(OLDER_COMMANDS)).toBe(true);
      expect(note.showIf!(NEW_RULE)).toBe(false);
      expect(note.showIf!(DOES_NOT_FIX)).toBe(false);

      const changes: Array<unknown> = [];

      cleanup();
      render(
        note.getCustomElement!(ONLY_FIXES, {
          onChange: (value: unknown): void => {
            changes.push(value);
          },
        }),
      );

      expect(
        screen.getByTestId(AI_RULE_TEST_IDS.onlyFixesNote),
      ).toHaveTextContent(
        `This rule only fixes: it was an auto remediation rule, and does not decide which ${nouns} are investigated.`,
      );
      expect(AI_RULE_ONLY_FIXES_COPY[lane].note).toBe(
        `This rule only fixes: it was an auto remediation rule, and does not decide which ${nouns} are investigated.`,
      );

      const investigateToo: HTMLElement = screen.getByRole("button", {
        name: "Investigate too",
      });

      expect(investigateToo).toHaveAttribute(
        "data-testid",
        AI_RULE_TEST_IDS.investigateToo,
      );
      // A button of its own: never one that submits the dialog.
      expect(investigateToo).toHaveAttribute("type", "button");

      fireEvent.click(investigateToo);
      expect(changes).toEqual([true]);
    });

    test("Investigate too turns investigating on, keeping the rest, and then asks when", () => {
      const props: Record<string, unknown> = tableFor(lane);
      const note: CapturedField = fieldNamed(props, "onlyFixesNote");
      const written: Array<Values> = [];
      const current: Values = withValues(ONLY_FIXES, {
        name: "Restart the API",
        executionMode: AutoRemediationExecutionMode.FullAuto,
      });

      note.onChange!(true, current, (next: Values): void => {
        written.push(next);
      });

      expect(written).toEqual([withValues(current, { investigates: true })]);

      // The note goes, and the question it stood for is asked.
      expect(note.showIf!(written[0]!)).toBe(false);
      expect(
        fieldNamed(props, INVESTIGATION_RULE_TIMING_FIELD_KEY).showIf!(
          written[0]!,
        ),
      ).toBe(true);
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
          description: `OneUptime AI starts as soon as the ${noun} is ${starts}.`,
        },
        {
          value: InvestigationRuleTiming.AfterWait,
          title: "Only if still open after a wait",
          description: `${Nouns} resolved during the wait are not investigated.`,
        },
      ]);

      // Asked of a rule that investigates; one that only fixes has the note.
      expect(timing.showIf!(NEW_RULE)).toBe(true);
      expect(timing.showIf!(DOES_NOT_FIX)).toBe(true);
      expect(timing.showIf!(ONLY_FIXES)).toBe(false);
    });

    test("the choice starts on what the rule's wait makes: right away for a new rule and a rule with none", () => {
      const timing: CapturedField = fieldNamed(
        tableFor(lane),
        INVESTIGATION_RULE_TIMING_FIELD_KEY,
      );

      expect(timing.getDefaultValue!(NEW_RULE)).toBe(
        InvestigationRuleTiming.RightAway,
      );
      expect(
        timing.getDefaultValue!(
          withValues(NEW_RULE, { onlyIfOpenAfterMinutes: null }),
        ),
      ).toBe(InvestigationRuleTiming.RightAway);
      expect(
        timing.getDefaultValue!(
          withValues(NEW_RULE, { onlyIfOpenAfterMinutes: 0 }),
        ),
      ).toBe(InvestigationRuleTiming.RightAway);
      expect(
        timing.getDefaultValue!(
          withValues(NEW_RULE, { onlyIfOpenAfterMinutes: 30 }),
        ),
      ).toBe(InvestigationRuleTiming.AfterWait);
    });

    test("picking writes the rule's wait: a wait starts on 10 minutes, right away clears it", () => {
      const timing: CapturedField = fieldNamed(
        tableFor(lane),
        INVESTIGATION_RULE_TIMING_FIELD_KEY,
      );
      const written: Array<Values> = [];
      const write: (next: Values) => void = (next: Values): void => {
        written.push(next);
      };

      timing.onChange!(
        InvestigationRuleTiming.AfterWait,
        values({ name: "Prod" }),
        write,
      );
      timing.onChange!(
        InvestigationRuleTiming.AfterWait,
        values({ name: "Prod", onlyIfOpenAfterMinutes: 30 }),
        write,
      );
      timing.onChange!(
        InvestigationRuleTiming.RightAway,
        values({ name: "Prod", onlyIfOpenAfterMinutes: 30 }),
        write,
      );
      timing.onChange!("something else", values({ name: "Prod" }), write);

      expect(written).toEqual([
        values({
          name: "Prod",
          [INVESTIGATION_RULE_TIMING_FIELD_KEY]:
            InvestigationRuleTiming.AfterWait,
          onlyIfOpenAfterMinutes: 10,
        }),
        values({
          name: "Prod",
          [INVESTIGATION_RULE_TIMING_FIELD_KEY]:
            InvestigationRuleTiming.AfterWait,
          onlyIfOpenAfterMinutes: 30,
        }),
        values({
          name: "Prod",
          [INVESTIGATION_RULE_TIMING_FIELD_KEY]:
            InvestigationRuleTiming.RightAway,
          onlyIfOpenAfterMinutes: null,
        }),
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
        `Counted from when the ${noun} is ${starts}. When several rules match, the shortest wait decides. At most 1440 (a day).`,
      );
      expect(wait.hideOptionalLabel).toBe(true);

      expect(wait.showIf!(NEW_RULE)).toBe(false);
      expect(
        wait.showIf!(withValues(NEW_RULE, { onlyIfOpenAfterMinutes: 15 })),
      ).toBe(true);
      expect(
        wait.showIf!(
          withValues(NEW_RULE, {
            [INVESTIGATION_RULE_TIMING_FIELD_KEY]:
              InvestigationRuleTiming.RightAway,
            onlyIfOpenAfterMinutes: 15,
          }),
        ),
      ).toBe(false);
      expect(
        wait.showIf!(
          withValues(NEW_RULE, {
            [INVESTIGATION_RULE_TIMING_FIELD_KEY]:
              InvestigationRuleTiming.AfterWait,
          }),
        ),
      ).toBe(true);
      // A rule that only fixes has no wait to ask about.
      expect(
        wait.showIf!(withValues(ONLY_FIXES, { onlyIfOpenAfterMinutes: 15 })),
      ).toBe(false);

      const afterWait: Values = withValues(NEW_RULE, {
        [INVESTIGATION_RULE_TIMING_FIELD_KEY]:
          InvestigationRuleTiming.AfterWait,
      });
      const notWhole: string =
        "Enter a whole number of minutes, from 1 to 1440.";

      expect(
        wait.customValidation!(
          withValues(afterWait, { onlyIfOpenAfterMinutes: "10" }),
        ),
      ).toBeNull();
      expect(
        wait.customValidation!(
          withValues(afterWait, { onlyIfOpenAfterMinutes: 1440 }),
        ),
      ).toBeNull();
      for (const value of [null, "", "0", 0, "1441", "10.5", "-3"]) {
        expect(
          wait.customValidation!(
            withValues(afterWait, { onlyIfOpenAfterMinutes: value }),
          ),
        ).toBe(notWhole);
      }

      // Right away asks nothing of it, nor does a rule that only fixes.
      expect(
        wait.customValidation!(
          withValues(NEW_RULE, {
            [INVESTIGATION_RULE_TIMING_FIELD_KEY]:
              InvestigationRuleTiming.RightAway,
            onlyIfOpenAfterMinutes: null,
          }),
        ),
      ).toBeNull();
      expect(
        wait.customValidation!(
          withValues(ONLY_FIXES, {
            [INVESTIGATION_RULE_TIMING_FIELD_KEY]:
              InvestigationRuleTiming.AfterWait,
            onlyIfOpenAfterMinutes: "0",
          }),
        ),
      ).toBeNull();
    });

    test("Fix: one question with three answers, a new rule asking first", () => {
      const fix: CapturedField = fieldNamed(
        tableFor(lane),
        AI_RULE_FIX_FIELD_KEY,
      );

      expect(fix.formOnly).toBe(true);
      expect(fix.overrideField).toEqual({ fixes: true });
      expect(fix.title).toBe("Fix");
      expect(fix.title).toBe(AI_RULE_FIX_FIELD_COPY.title);
      expect(fix.description).toBe(
        "After it investigates, OneUptime AI can fix what it found. Choose whether it does, and whether a fix waits for approval.",
      );
      expect(fix.fieldType).toBe(FormFieldSchemaType.CardSelect);
      expect(fix.cardSelectSingleColumn).toBe(true);
      expect(fix.cardSelectOptions).toBe(AI_RULE_FIX_OPTIONS);
      expect(fix.required).toBe(true);
      expect(fix.dataTestId).toBe(AI_RULE_TEST_IDS.fixField);
      expect(fix.collapsibleSection).toBeUndefined();

      // It starts on the answer the rule's columns make.
      expect(fix.getDefaultValue!(NEW_RULE)).toBe(AiRuleFix.AskFirst);
      expect(
        fix.getDefaultValue!(
          withValues(NEW_RULE, {
            executionMode: AutoRemediationExecutionMode.Suggest,
          }),
        ),
      ).toBe(AiRuleFix.AskFirst);
      expect(
        fix.getDefaultValue!(
          withValues(NEW_RULE, {
            executionMode: AutoRemediationExecutionMode.FullAuto,
          }),
        ),
      ).toBe(AiRuleFix.WithoutAsking);
      expect(
        fix.getDefaultValue!(
          withValues(DOES_NOT_FIX, {
            executionMode: AutoRemediationExecutionMode.FullAuto,
          }),
        ),
      ).toBe(AiRuleFix.DoNotFix);
      // Once picked, the pick.
      expect(
        fix.getDefaultValue!(
          withValues(NEW_RULE, { [AI_RULE_FIX_FIELD_KEY]: AiRuleFix.DoNotFix }),
        ),
      ).toBe(AiRuleFix.DoNotFix);
    });

    test("Fix is asked of every rule but an older one that fixes by picking a runbook: it always asks first", () => {
      const fix: CapturedField = fieldNamed(
        tableFor(lane),
        AI_RULE_FIX_FIELD_KEY,
      );

      for (const [, formValues] of EVERY_KIND_OF_RULE) {
        const isOlderPicking: boolean =
          getEditedRuleFixKind(formValues) ===
            AutoRemediationFixKind.AiPicksRunbook &&
          (formValues as Record<string, unknown>)["fixes"] !== false;

        expect(fix.showIf!(formValues)).toBe(!isOlderPicking);
      }

      expect(fix.showIf!(OLDER_PICKS)).toBe(false);
      // Not fixing, it has nothing to ask first about: the question is back.
      expect(fix.showIf!(withValues(OLDER_PICKS, { fixes: false }))).toBe(true);
    });

    test("picking an answer writes the two columns the server reads", () => {
      const fix: CapturedField = fieldNamed(
        tableFor(lane),
        AI_RULE_FIX_FIELD_KEY,
      );
      const written: Array<Values> = [];
      const write: (next: Values) => void = (next: Values): void => {
        written.push(next);
      };
      const fullAuto: Values = withValues(NEW_RULE, {
        name: "Prod",
        executionMode: AutoRemediationExecutionMode.FullAuto,
      });

      fix.onChange!(AiRuleFix.DoNotFix, fullAuto, write);
      fix.onChange!(AiRuleFix.AskFirst, fullAuto, write);
      fix.onChange!(AiRuleFix.WithoutAsking, NEW_RULE, write);
      fix.onChange!("something else", NEW_RULE, write);

      expect(written).toEqual([
        // Not fixing keeps how it would ask, for when fixing is back on.
        withValues(fullAuto, {
          [AI_RULE_FIX_FIELD_KEY]: AiRuleFix.DoNotFix,
          fixes: false,
          executionMode: AutoRemediationExecutionMode.FullAuto,
        }),
        withValues(fullAuto, {
          [AI_RULE_FIX_FIELD_KEY]: AiRuleFix.AskFirst,
          fixes: true,
          executionMode: AutoRemediationExecutionMode.Suggest,
        }),
        withValues(NEW_RULE, {
          [AI_RULE_FIX_FIELD_KEY]: AiRuleFix.WithoutAsking,
          fixes: true,
          executionMode: AutoRemediationExecutionMode.FullAuto,
        }),
      ]);
    });

    test("a rule that does not investigate must fix: the Fix question says so", () => {
      const fix: CapturedField = fieldNamed(
        tableFor(lane),
        AI_RULE_FIX_FIELD_KEY,
      );

      expect(
        fix.customValidation!(
          withValues(ONLY_FIXES, {
            [AI_RULE_FIX_FIELD_KEY]: AiRuleFix.DoNotFix,
          }),
        ),
      ).toBe(AI_RULE_DOES_NOTHING_TEXT);
      expect(AI_RULE_DOES_NOTHING_TEXT).toBe(
        "A rule that doesn't investigate must fix. Turn investigating on in the Investigate step first.",
      );
      expect(
        fix.customValidation!(values({ investigates: false, fixes: false })),
      ).toBe(AI_RULE_DOES_NOTHING_TEXT);

      for (const fine of [
        withValues(ONLY_FIXES, { [AI_RULE_FIX_FIELD_KEY]: AiRuleFix.AskFirst }),
        withValues(ONLY_FIXES, {
          [AI_RULE_FIX_FIELD_KEY]: AiRuleFix.WithoutAsking,
        }),
        withValues(NEW_RULE, { [AI_RULE_FIX_FIELD_KEY]: AiRuleFix.DoNotFix }),
        DOES_NOT_FIX,
        NEW_RULE,
      ]) {
        expect(fix.customValidation!(fine)).toBeNull();
      }
    });

    test("the columns behind the questions, and an older rule's flags, are registered so an edit reads them: never drawn", () => {
      const props: Record<string, unknown> = tableFor(lane);

      for (const key of [
        "fixes",
        "executionMode",
        "aiComposesCommands",
        "aiSelectsRunbook",
      ]) {
        const registered: CapturedField = fieldNamed(props, key);

        for (const [, formValues] of EVERY_KIND_OF_RULE) {
          expect(registered.showIf!(formValues)).toBe(false);
        }
        expect(registered.required).toBe(false);
        expect(registered.hideColumnDescription).toBe(true);
        expect(registered.collapsibleSection).toBeUndefined();
      }

      // The two questions are the form's only cards and radio buttons.
      expect(
        fieldsOf(props)
          .filter((field: CapturedField): boolean => {
            return field.fieldType === FormFieldSchemaType.CardSelect;
          })
          .map(keyOf),
      ).toEqual([AI_RULE_FIX_FIELD_KEY]);
      expect(
        fieldsOf(props)
          .filter((field: CapturedField): boolean => {
            return field.fieldType === FormFieldSchemaType.RadioButton;
          })
          .map(keyOf),
      ).toEqual([INVESTIGATION_RULE_TIMING_FIELD_KEY]);
    });

    test("asks nothing a rule does not need", () => {
      const keys: Array<string> = fieldsOf(tableFor(lane)).map(keyOf);

      for (const retired of [
        "commandAllowlist",
        "commandRunners",
        "verificationWindowMinutes",
        "autoResolveOnVerifiedRecovery",
        "triggerEntityType",
      ]) {
        expect(keys).not.toContain(retired);
      }
    });

    test("its name is required and held to a rule name's length, and a rule starts on: its switch is on the edit form only", () => {
      const props: Record<string, unknown> = tableFor(lane);
      const name: CapturedField = fieldNamed(props, "name");
      const enabled: CapturedField = fieldNamed(props, "isEnabled");

      expect(name.required).toBe(true);
      expect(name.validation).toEqual({
        minLength: 2,
        maxLength: RULE_NAME_MAX_LENGTH,
      });
      expect(name.placeholder).toBe(`Production ${nouns}`);
      expect(name.hideColumnDescription).toBe(true);
      expect(enabled.fieldType).toBe(FormFieldSchemaType.Toggle);
      expect(enabled.doNotShowWhenCreating).toBe(true);
      expect(enabled.description).toBe(RULE_ENABLED_DESCRIPTION);
    });

    test("More fields is one section, folded, with a line on what its defaults do", () => {
      const props: Record<string, unknown> = tableFor(lane);
      const folded: Array<CapturedField> = MORE_FIELDS.map(
        (key: string): CapturedField => {
          return fieldNamed(props, key);
        },
      );
      const section: FormFieldCollapsibleSection<AutoRemediationRule> =
        folded[0]!.collapsibleSection!;

      for (const field of folded) {
        expect(field.collapsibleSection).toBe(section);
      }
      expect(section.id).toBe(ADVANCED_FORM_SECTION_ID);
      expect(section.title).toBe("More fields");

      // Before the providers are read: what the rest's defaults do, alone.
      for (const each of [NEW_RULE, EVERY_TIME, OLDER_COMMANDS, ONLY_FIXES]) {
        expect(section.getSummary!(each)).toEqual(
          getAutoRemediationMoreFieldsSummary(each),
        );
      }

      // A rule that does not fix says what an investigation may use.
      expect(section.getSummary!(DOES_NOT_FIX)).toEqual(
        getInvestigationRuleMoreFieldsSummary(DOES_NOT_FIX),
      );
      expect(section.getSummary!(DOES_NOT_FIX)).toEqual([
        "OneUptime AI may use any of your MCP servers and connected repositories.",
      ]);
    });

    /*
     * The form keys a folded section by its first field on screen, so a
     * first field that came and went with the Fix answer above it would
     * close the open fold whenever the answer changed.
     */
    test("More fields starts on a field every rule shows, so the fold stays put while the Fix answer changes", () => {
      const props: Record<string, unknown> = tableFor(lane);

      for (const [, formValues] of EVERY_KIND_OF_RULE) {
        const shown: Array<string> = fieldsOf(props)
          .filter((field: CapturedField): boolean => {
            return (
              Boolean(field.collapsibleSection) &&
              (!field.showIf || field.showIf(formValues))
            );
          })
          .map(keyOf);

        expect(shown[0]).toBe("codeRepositories");
      }

      expect(fieldNamed(props, "codeRepositories").showIf).toBeUndefined();
    });

    /*
     * The LLM provider OneUptime AI uses for everything the rule starts -
     * the investigation, and the fixes it works out (Common/Types/AI/
     * LlmProviderChoice): empty is the default provider, which the folded
     * line names first.
     */
    test("the LLM provider is under More fields, for every rule AI works for", () => {
      const field: CapturedField = fieldNamed(tableFor(lane), "llmProviderId");

      expect(field.title).toBe("LLM Provider");
      expect(field.description).toBe(RULE_LLM_PROVIDER_FIELD_COPY.description);
      expect(field.fieldType).toBe(FormFieldSchemaType.CustomComponent);
      expect(field.required).toBe(false);
      expect(field.hideOptionalLabel).toBe(true);
      expect(field.hideColumnDescription).toBe(true);

      expect(field.showIf!(NEW_RULE)).toBe(true);
      expect(field.showIf!(DOES_NOT_FIX)).toBe(true);
      expect(field.showIf!(ONLY_FIXES)).toBe(true);
      expect(field.showIf!(OLDER_PICKS)).toBe(true);
      // Running its runbooks every time, it still investigates with AI.
      expect(field.showIf!(EVERY_TIME)).toBe(true);
      // Only running its runbooks every time, no AI works for it.
      expect(field.showIf!(ONLY_FIXES_EVERY_TIME)).toBe(false);
    });

    test("a rule that only runs its runbooks every time uses no AI: no provider to pick, none named", async () => {
      mockRuleLlmProviders(projectProvidersAnswer());

      const field: CapturedField = fieldNamed(
        await settledTableFor(lane),
        "llmProviderId",
      );

      expect(field.showIf!(ONLY_FIXES_EVERY_TIME)).toBe(false);
      expect(
        field.collapsibleSection!.getSummary!(ONLY_FIXES_EVERY_TIME),
      ).toEqual(getAutoRemediationMoreFieldsSummary(ONLY_FIXES_EVERY_TIME));
    });

    test("folded, the line names the provider first: the project's default, or the rule's pick", async () => {
      mockRuleLlmProviders(projectProvidersAnswer());

      const field: CapturedField = fieldNamed(
        await settledTableFor(lane),
        "llmProviderId",
      );
      const section: FormFieldCollapsibleSection<AutoRemediationRule> =
        field.collapsibleSection!;
      const DEFAULT_PROVIDER: string =
        "The rule uses the project's default LLM provider, Azure GPT-4o.";

      expect(section.getSummary!(NEW_RULE)).toEqual([
        DEFAULT_PROVIDER,
        ...(getAutoRemediationMoreFieldsSummary(NEW_RULE) || []),
      ]);
      expect(section.getSummary!(DOES_NOT_FIX)).toEqual([
        DEFAULT_PROVIDER,
        "OneUptime AI may use any of your MCP servers and connected repositories.",
      ]);
      // Running its runbooks every time, its investigation still uses one.
      expect(section.getSummary!(EVERY_TIME)).toEqual([
        DEFAULT_PROVIDER,
        ...(getAutoRemediationMoreFieldsSummary(EVERY_TIME) || []),
      ]);

      const picking: Values = withValues(NEW_RULE, {
        llmProviderId: OPUS_PROVIDER.id,
      });

      expect(section.getSummary!(picking)).toEqual(
        getAutoRemediationMoreFieldsSummary(picking),
      );
      expect(field.getFoldedValue!(picking)).toBe("Claude Opus");
    });

    test("folded, the line names the global provider when the project has no default of its own", async () => {
      mockRuleLlmProviders(
        providersAnswer(
          [OPUS_PROVIDER, ONEUPTIME_AI_PROVIDER],
          ONEUPTIME_AI_PROVIDER.id,
        ),
      );

      const field: CapturedField = fieldNamed(
        await settledTableFor(lane),
        "llmProviderId",
      );

      expect(field.collapsibleSection?.getSummary?.(DOES_NOT_FIX)).toEqual([
        "The rule uses the global LLM provider, OneUptime AI.",
        "OneUptime AI may use any of your MCP servers and connected repositories.",
      ]);
    });

    /*
     * The global provider alone - a new OneUptime Cloud project: nothing to
     * pick between, so the line says nothing of it. The open field's box
     * still names it.
     */
    test("folded, with the one provider only, the line says nothing of it", async () => {
      mockRuleLlmProviders(
        providersAnswer([ONEUPTIME_AI_PROVIDER], ONEUPTIME_AI_PROVIDER.id),
      );

      const field: CapturedField = fieldNamed(
        await settledTableFor(lane),
        "llmProviderId",
      );

      expect(field.collapsibleSection?.getSummary?.(DOES_NOT_FIX)).toEqual([
        "OneUptime AI may use any of your MCP servers and connected repositories.",
      ]);
      expect(field.getFoldedValue!(DOES_NOT_FIX)).toBeNull();
    });

    /*
     * The rule's AI context (issue #5198): notes about what the rule
     * matches, read after the project's AI context by the investigation and
     * the fix the rule starts - so asked of every rule OneUptime AI works
     * for, as the LLM provider is, and counted against its 5,000 characters
     * as it is typed.
     */
    test("the AI context is under More fields, after the LLM provider, for every rule AI works for", () => {
      const props: Record<string, unknown> = tableFor(lane);
      const field: CapturedField = fieldNamed(props, "aiContext");
      const keys: Array<string> = fieldsOf(props).map(keyOf);

      expect(keys.indexOf("aiContext")).toBe(keys.indexOf("llmProviderId") + 1);
      expect(field.title).toBe("AI context");
      expect(field.description).toBe(
        "Notes OneUptime AI reads after the project's AI context when it investigates or fixes what this rule matches. Leave secrets out.",
      );
      expect(field.placeholder).toBe(
        "For example: checkout's logs are in Loki under app=checkout, and payments-db is its database.",
      );
      expect(field.fieldType).toBe(FormFieldSchemaType.Markdown);
      expect(field.required).toBe(false);
      // Empty is an answer of its own - the project's notes alone.
      expect(field.hideOptionalLabel).toBe(true);
      // A model is never given an image's bytes.
      expect(field.allowImageUpload).toBe(false);
      expect(field.dataTestId).toBe("auto-remediation-ai-context-field");

      const provider: CapturedField = fieldNamed(props, "llmProviderId");
      for (const [, formValues] of EVERY_KIND_OF_RULE) {
        expect(field.showIf!(formValues)).toBe(provider.showIf!(formValues));
      }
      expect(field.showIf!(NEW_RULE)).toBe(true);
      expect(field.showIf!(DOES_NOT_FIX)).toBe(true);
      expect(field.showIf!(EVERY_TIME)).toBe(true);
      // Only running its runbooks every time, no AI reads anything for it.
      expect(field.showIf!(ONLY_FIXES_EVERY_TIME)).toBe(false);
    });

    test("the AI context is refused past 5,000 characters, saying what to do, and never before", () => {
      const field: CapturedField = fieldNamed(tableFor(lane), "aiContext");

      expect(
        field.customValidation!(
          withValues(NEW_RULE, { aiContext: "a".repeat(5001) }),
        ),
      ).toBe("Use 5,000 characters or fewer.");
      for (const aiContext of [undefined, "", "a".repeat(5000)]) {
        expect(
          field.customValidation!(withValues(NEW_RULE, { aiContext })),
        ).toBeNull();
      }
    });

    test("folded, the AI context is named by its size once written, and not for a rule no AI works for", () => {
      const field: CapturedField = fieldNamed(tableFor(lane), "aiContext");
      const notes: string = "a".repeat(1240);

      expect(field.getFoldedValue!(NEW_RULE)).toBeNull();
      expect(
        field.getFoldedValue!(withValues(NEW_RULE, { aiContext: notes })),
      ).toBe("about 310 tokens");
      expect(
        field.getFoldedValue!(withValues(DOES_NOT_FIX, { aiContext: notes })),
      ).toBe("about 310 tokens");
      expect(
        field.getFoldedValue!(
          withValues(ONLY_FIXES_EVERY_TIME, { aiContext: notes }),
        ),
      ).toBeNull();
    });

    test("under the AI context, its count against 5,000 characters, red past it, and no outline", () => {
      const field: CapturedField = fieldNamed(tableFor(lane), "aiContext");
      const setValue: Mock<(value: unknown) => void> = jest.fn();

      const empty: ReturnType<typeof render> = render(
        field.getFooterElement!(NEW_RULE, undefined, { setValue })!,
      );
      expect(
        within(empty.container).getByTestId("ai-context-length"),
      ).toHaveTextContent("0 of 5,000 characters");
      // A rule's notes start from the rule, not the project's outline.
      expect(
        within(empty.container).queryByTestId("ai-context-outline-button"),
      ).not.toBeInTheDocument();
      empty.unmount();

      const written: ReturnType<typeof render> = render(
        field.getFooterElement!(
          withValues(NEW_RULE, { aiContext: "a".repeat(400) }),
        )!,
      );
      expect(
        within(written.container).getByTestId("ai-context-length"),
      ).toHaveTextContent("400 of 5,000 characters · about 100 tokens");
      expect(
        within(written.container).getByTestId("ai-context-length"),
      ).toHaveClass("text-gray-500");
      written.unmount();

      const tooLong: ReturnType<typeof render> = render(
        field.getFooterElement!(
          withValues(NEW_RULE, { aiContext: "a".repeat(5001) }),
        )!,
      );
      expect(
        within(tooLong.container).getByTestId("ai-context-length"),
      ).toHaveClass("text-red-600");
      expect(setValue).not.toHaveBeenCalled();
    });

    test("Runbooks: none picked is any runbook, only for a rule that fixes, and some are needed only to run them every time", () => {
      const runbooks: CapturedField = fieldNamed(tableFor(lane), "runbooks");

      expect(runbooks.title).toBe("Runbooks");
      expect(runbooks.description).toBe(
        "OneUptime AI may run any of your runbooks. Pick some to let it run only those.",
      );
      expect(runbooks.placeholder).toBe("Any runbook");
      // Empty is an answer of its own, not "(Optional)".
      expect(runbooks.hideOptionalLabel).toBe(true);
      expect(runbooks.fieldType).toBe(FormFieldSchemaType.MultiSelectDropdown);
      expect(runbooks.dropdownModal?.type).toBe(Runbook);
      // Its open list, with none yet, says so.
      expect(runbooks.dropdownModal?.emptyListText).toBe("No runbooks yet.");

      expect(runbooks.showIf!(NEW_RULE)).toBe(true);
      expect(runbooks.showIf!(ONLY_FIXES)).toBe(true);
      expect(runbooks.showIf!(EVERY_TIME)).toBe(true);
      expect(runbooks.showIf!(OLDER_PICKS)).toBe(true);
      // An older rule that composes commands runs no runbook.
      expect(runbooks.showIf!(OLDER_COMMANDS)).toBe(false);
      // A rule that does not fix runs none.
      expect(runbooks.showIf!(DOES_NOT_FIX)).toBe(false);

      expect(isRequired(runbooks, EVERY_TIME)).toBe(true);
      expect(isRequired(runbooks, ONLY_FIXES_EVERY_TIME)).toBe(true);
      for (const other of [
        withValues(NEW_RULE, {
          remediationAction: AutoRemediationAction.OneUptimeAI,
        }),
        NEW_RULE,
        // Not fixing, it runs nothing every time.
        withValues(DOES_NOT_FIX, {
          remediationAction: AutoRemediationAction.Runbooks,
        }),
      ]) {
        expect(isRequired(runbooks, other)).toBe(false);
      }
    });

    test("Run them every time: a switch shown once a fixing rule names runbooks, or runs them", () => {
      const everyTime: CapturedField = fieldNamed(
        tableFor(lane),
        "remediationAction",
      );

      expect(everyTime.title).toBe("Run them every time");
      expect(everyTime.title).not.toBe("Fix With");
      expect(everyTime.fieldType).toBe(FormFieldSchemaType.CustomComponent);
      // The switch draws its own title and line, beside it.
      expect(everyTime.customElementDrawsOwnLabel).toBe(true);
      expect(everyTime.required).toBe(false);
      expect(everyTime.defaultValue).toBe(AutoRemediationAction.OneUptimeAI);

      expect(everyTime.showIf!(NEW_RULE)).toBe(false);
      expect(everyTime.showIf!(withValues(NEW_RULE, { runbooks: [] }))).toBe(
        false,
      );
      expect(
        everyTime.showIf!(withValues(NEW_RULE, { runbooks: PICKED_RUNBOOKS })),
      ).toBe(true);
      // A rule saved running its runbooks keeps the switch that says so.
      expect(everyTime.showIf!(EVERY_TIME)).toBe(true);
      // An older rule does what its note says until it fixes like a new one.
      expect(
        everyTime.showIf!(
          withValues(OLDER_PICKS, { runbooks: PICKED_RUNBOOKS }),
        ),
      ).toBe(false);
      // A rule that does not fix runs nothing.
      expect(
        everyTime.showIf!(
          withValues(DOES_NOT_FIX, {
            runbooks: PICKED_RUNBOOKS,
            remediationAction: AutoRemediationAction.Runbooks,
          }),
        ),
      ).toBe(false);

      // Folded, the line says it is on; off is the default and says nothing.
      expect(everyTime.getFoldedValue!(EVERY_TIME)).toBe("On");
      expect(
        everyTime.getFoldedValue!(
          withValues(NEW_RULE, {
            remediationAction: AutoRemediationAction.OneUptimeAI,
          }),
        ),
      ).toBeNull();
      expect(
        everyTime.getFoldedValue!(
          withValues(DOES_NOT_FIX, {
            remediationAction: AutoRemediationAction.Runbooks,
          }),
        ),
      ).toBeNull();
      // And off, the line does not name it: named unset, it read as on.
      expect(everyTime.isListedWhileFolded!(EVERY_TIME)).toBe(true);
      expect(
        everyTime.isListedWhileFolded!(
          withValues(NEW_RULE, {
            remediationAction: AutoRemediationAction.OneUptimeAI,
            runbooks: PICKED_RUNBOOKS,
          }),
        ),
      ).toBe(false);
      expect(
        everyTime.isListedWhileFolded!(
          withValues(DOES_NOT_FIX, {
            remediationAction: AutoRemediationAction.Runbooks,
          }),
        ),
      ).toBe(false);
    });

    test("Runner: the field says where Bash commands run and that the AI agent is used anyway, and only a rule OneUptime AI fixes for has one", () => {
      const runner: CapturedField = fieldNamed(tableFor(lane), "runnerId");

      expect(runner.title).toBe("Runner");
      /*
       * The one line that says the AI agent on the affected cluster or host
       * is not a Runner choice: it is used whatever the rule picks. Not
       * "inside your network": a rule that picks none shows the Global
       * Runner, on which no Bash command runs.
       */
      expect(runner.description).toBe(
        "Where OneUptime AI runs Bash commands for this rule. Commands on the affected cluster or host go through its AI agent.",
      );
      expect(runner.description).not.toContain("inside your network");
      expect(runner.fieldType).toBe(FormFieldSchemaType.CustomComponent);
      expect(runner.required).toBe(false);
      expect(runner.hideOptionalLabel).toBe(true);
      expect(runner.hideColumnDescription).toBe(true);
      // With no project default Runner read, a new rule starts on none.
      expect(runner.defaultValue).toBeUndefined();

      expect(runner.showIf!(NEW_RULE)).toBe(true);
      expect(runner.showIf!(ONLY_FIXES)).toBe(true);
      expect(
        runner.showIf!(withValues(NEW_RULE, { runbooks: PICKED_RUNBOOKS })),
      ).toBe(true);
      expect(runner.showIf!(EVERY_TIME)).toBe(false);
      // An older rule's commands run on its Runner; one that picks a runbook has none.
      expect(runner.showIf!(OLDER_COMMANDS)).toBe(true);
      expect(runner.showIf!(OLDER_PICKS)).toBe(false);
      // An investigation runs nothing on a Runner.
      expect(runner.showIf!(DOES_NOT_FIX)).toBe(false);
    });

    /*
     * "If there are no runners, it should use the global runner by
     * default" - the maintainer. The field draws the rule's picker, which
     * shows a rule that picks none on the Global Runner - except an older
     * rule that composes commands: it runs them on the Command Runners it
     * names too, so none here reads "No Runner", as it did.
     */
    test("Runner: the picker may show the Global Runner for every rule but an older one that composes commands, and hands back what it picks", () => {
      const runner: CapturedField = fieldNamed(tableFor(lane), "runnerId");
      const onChange: Mock<(value: unknown) => void> = jest.fn();

      const element: React.ReactElement = runner.getCustomElement!(
        withValues(NEW_RULE, { runnerId: RUNNER_ID }),
        { onChange, ariaLabelledby: "runner-label" },
      );

      expect(element.type).toBe(AutoRemediationRunnerPicker);
      expect(element.props["value"]).toBe(RUNNER_ID);
      expect(element.props["ariaLabelledby"]).toBe("runner-label");
      expect(element.props["isGlobalRunnerShown"]).toBe(true);

      // The Global Runner is no Runner of the project's own: none.
      (element.props["onChange"] as (value: string | null) => void)(null);
      expect(onChange).toHaveBeenCalledWith(null);
      (element.props["onChange"] as (value: string | null) => void)(RUNNER_ID);
      expect(onChange).toHaveBeenLastCalledWith(RUNNER_ID);

      for (const [rule, isShown] of [
        [NEW_RULE, true],
        [ONLY_FIXES, true],
        [withValues(NEW_RULE, { runbooks: PICKED_RUNBOOKS }), true],
        [OLDER_COMMANDS, false],
      ] as Array<[Values, boolean]>) {
        expect(
          runner.getCustomElement!(rule, { onChange }).props[
            "isGlobalRunnerShown"
          ],
        ).toBe(isShown);
      }
    });

    test("MCP servers: none picked is all of them, for every rule OneUptime AI investigates or fixes for", () => {
      const servers: CapturedField = fieldNamed(
        tableFor(lane),
        "externalMcpServers",
      );

      expect(servers.title).toBe("MCP Servers");
      // True of a rule that only investigates as of one that fixes.
      expect(servers.description).toBe(
        "OneUptime AI may use all of your MCP servers. Pick some to let it use only those.",
      );
      expect(servers.fieldType).toBe(FormFieldSchemaType.MultiSelectDropdown);
      expect(servers.dropdownModal?.type).toBe(ExternalMcpServer);
      // Its open list, with none added, says so: the line under it says where.
      expect(servers.dropdownModal?.emptyListText).toBe(
        "No MCP servers are added yet.",
      );
      expect(servers.required).toBe(false);
      expect(servers.hideOptionalLabel).toBe(true);
      expect(servers.hideColumnDescription).toBe(true);
      expect(servers.placeholder).toBe("All MCP servers");

      expect(servers.showIf!(NEW_RULE)).toBe(true);
      expect(servers.showIf!(DOES_NOT_FIX)).toBe(true);
      expect(servers.showIf!(ONLY_FIXES)).toBe(true);
      // Investigating, a rule that runs its runbooks every time uses them there.
      expect(servers.showIf!(EVERY_TIME)).toBe(true);
      expect(
        servers.showIf!(withValues(OLDER_COMMANDS, { investigates: true })),
      ).toBe(true);
      // Fixes that do not go through OneUptime AI's own work use none.
      expect(servers.showIf!(ONLY_FIXES_EVERY_TIME)).toBe(false);
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

      expect(
        fieldNamed(await settledTableFor(lane), "runnerId").defaultValue,
      ).toBe(RUNNER_ID);
    });

    /*
     * Folded, the line names the Runner a rule picks - the project's default
     * a new rule starts on included - as a runbook step's line does: where
     * the rule's Bash commands run is never hidden by the fold.
     */
    test("folded, the line names the Runner a fixing rule picks, and says nothing of none", async () => {
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

      const runner: CapturedField = fieldNamed(
        await settledTableFor(lane),
        "runnerId",
      );
      const folded: (formValues: Values) => string | null =
        runner.getFoldedValue!;

      // The default a new rule starts on is named: it is where commands run.
      expect(
        folded(withValues(NEW_RULE, { runnerId: runner.defaultValue })),
      ).toBe("prod-runner");
      // A pick as the form holds it: an id, or an ObjectID read from the rule.
      expect(
        folded(withValues(NEW_RULE, { runnerId: new ObjectID(RUNNER_ID) })),
      ).toBe("prod-runner");
      // One not connected says so, as the picker does.
      expect(folded(withValues(NEW_RULE, { runnerId: OFFICE_RUNNER_ID }))).toBe(
        "office-runner · Never connected",
      );
      // No Runner is the field's empty answer: named, never as set.
      expect(folded(NEW_RULE)).toBeNull();
      expect(folded(withValues(NEW_RULE, { runnerId: null }))).toBeNull();
      // One the reader was not shown is never an id.
      expect(
        folded(
          withValues(NEW_RULE, {
            runnerId: "aaaaaaaa-0000-4000-8000-0000000000ff",
          }),
        ),
      ).toBe("A Runner you do not have access to");
      // A rule that does not fix runs nothing there: nothing to name.
      expect(
        folded(withValues(DOES_NOT_FIX, { runnerId: RUNNER_ID })),
      ).toBeNull();
    });

    test("folded, a Runner picked before the Runners are read is not named yet", () => {
      const runner: CapturedField = fieldNamed(tableFor(lane), "runnerId");

      expect(
        runner.getFoldedValue!(withValues(NEW_RULE, { runnerId: RUNNER_ID })),
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

      expect(
        fieldNamed(await settledTableFor(lane), "runnerId").defaultValue,
      ).toBeUndefined();
    });

    /*
     * "There should be a dropdown here to select the code repo for
     * remediation and also investigation rules, if no code repo is selected
     * - it should be able to read and investigate all the repos that are
     * connected" - the maintainer.
     */
    test("Code Repositories: none picked is every connected one, for every kind of rule", () => {
      const repositories: CapturedField = fieldNamed(
        tableFor(lane),
        "codeRepositories",
      );

      expect(repositories.title).toBe("Code Repositories");
      expect(repositories.title).toBe(RULE_CODE_REPOSITORIES_FIELD_COPY.title);
      /*
       * Not "and open pull requests in them": a Don't fix rule opens none,
       * and on a rule that fixes the pull request switches say so.
       */
      expect(repositories.description).toBe(
        "OneUptime AI may use all of your connected repositories. Pick some to let it use only those.",
      );
      expect(repositories.description).toBe(
        RULE_CODE_REPOSITORIES_FIELD_COPY.aiRuleDescription,
      );
      expect(repositories.fieldType).toBe(FormFieldSchemaType.CustomComponent);
      expect(repositories.required).toBe(false);
      // Empty is an answer of its own - all of them - not "(Optional)".
      expect(repositories.hideOptionalLabel).toBe(true);
      expect(repositories.hideColumnDescription).toBe(true);
      // Read while investigating and fixing, whatever the rule fixes with.
      expect(repositories.showIf).toBeUndefined();

      // Folded, the line says how many it names; none is the default.
      expect(repositories.getFoldedValue!(NEW_RULE)).toBeNull();
      expect(
        repositories.getFoldedValue!(
          withValues(NEW_RULE, {
            codeRepositories: [
              "c1111111-1111-4111-8111-111111111111",
              { _id: "c2222222-2222-4222-8222-222222222222" },
            ],
          }),
        ),
      ).toBe("2");

      const onChange: Mock<(value: unknown) => void> = jest.fn();
      const element: React.ReactElement = repositories.getCustomElement!(
        withValues(NEW_RULE, {
          codeRepositories: ["c1111111-1111-4111-8111-111111111111"],
        }),
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

      expect(repositories.getFooterElement!(NEW_RULE)!.type).toBe(
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
      "%s is a switch under More fields, on by default, for every rule that fixes",
      (column: string, title: string, description: string) => {
        const pullRequests: CapturedField = fieldNamed(tableFor(lane), column);

        expect(pullRequests.title).toBe(title);
        expect(pullRequests.description).toBe(description);
        expect(pullRequests.fieldType).toBe(FormFieldSchemaType.Toggle);
        expect(pullRequests.required).toBe(false);
        expect(pullRequests.hideColumnDescription).toBe(true);

        // A pull request is part of fixing: a rule that does not fix opens none.
        expect(pullRequests.showIf!(NEW_RULE)).toBe(true);
        expect(pullRequests.showIf!(ONLY_FIXES)).toBe(true);
        expect(pullRequests.showIf!(EVERY_TIME)).toBe(true);
        expect(pullRequests.showIf!(OLDER_COMMANDS)).toBe(true);
        expect(pullRequests.showIf!(DOES_NOT_FIX)).toBe(false);

        // On by default: the column's own default fills the create form.
        expect(
          new AutoRemediationRule().getTableColumnMetadata(column).defaultValue,
        ).toBe(true);
      },
    );

    test("the description is the last field under More fields", () => {
      const description: CapturedField = fieldNamed(
        tableFor(lane),
        "description",
      );

      expect(description.fieldType).toBe(FormFieldSchemaType.LongText);
      expect(description.required).toBe(false);
      expect(description.showIf).toBeUndefined();
      expect(description.collapsibleSection?.title).toBe(
        MORE_FIELDS_SECTION_TITLE,
      );
    });

    test("an older rule's note: on the Fix step, only for an older rule that fixes", () => {
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
      expect(
        note.showIf!(withValues(OLDER_PICKS, { investigates: true })),
      ).toBe(true);
      for (const other of [
        NEW_RULE,
        EVERY_TIME,
        withValues(NEW_RULE, {
          runbooks: PICKED_RUNBOOKS,
          runnerId: RUNNER_ID,
        }),
        // Running its runbooks every time wins over an older flag.
        withValues(NEW_RULE, {
          remediationAction: AutoRemediationAction.Runbooks,
          aiSelectsRunbook: true,
        }),
        // Not fixing, what an older rule fixes with does not matter.
        withValues(OLDER_PICKS, { investigates: true, fixes: false }),
      ]) {
        expect(note.showIf!(other)).toBe(false);
      }
    });

    test.each([
      [OLDER_COMMANDS, AUTO_REMEDIATION_OLDER_RULE_COPY.commandsOnRunners],
      [OLDER_PICKS, AUTO_REMEDIATION_OLDER_RULE_COPY.picksRunbook],
    ])(
      "the note says what the rule still does, and Fix like a new rule asks the form to switch it (%#)",
      (older: Values, text: string) => {
        const note: CapturedField = fieldNamed(tableFor(lane), "olderRuleNote");
        const changes: Array<unknown> = [];

        cleanup();
        render(
          note.getCustomElement!(older, {
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
      const current: Values = withValues(OLDER_COMMANDS, {
        name: "Commands on the bastion",
        runbooks: PICKED_RUNBOOKS,
      });

      note.onChange!(true, current, (next: Values): void => {
        written.push(next);
      });

      expect(written).toEqual([
        withValues(current, {
          aiComposesCommands: false,
          aiSelectsRunbook: false,
          executionMode: AutoRemediationExecutionMode.Suggest,
          [AI_RULE_FIX_FIELD_KEY]: AiRuleFix.AskFirst,
        }),
      ]);
      // And the form then reads as a new rule's: every field back.
      expect(isOlderAutoRemediationRule(written[0]!)).toBe(false);
    });

    /*
     * The Fix question is hidden for an older rule that picks a runbook, but
     * kept the answer that rule opened on - without asking, for one saved
     * so. Made new, it asks first: the question says so, and the save does.
     */
    test("Fix like a new rule moves a hidden Fix answer to asking first", () => {
      const note: CapturedField = fieldNamed(tableFor(lane), "olderRuleNote");
      const written: Array<Values> = [];
      const current: Values = withValues(
        {
          remediationAction: AutoRemediationAction.OneUptimeAI,
          aiSelectsRunbook: true,
          executionMode: AutoRemediationExecutionMode.FullAuto,
        },
        { [AI_RULE_FIX_FIELD_KEY]: AiRuleFix.WithoutAsking },
      );

      note.onChange!(true, current, (next: Values): void => {
        written.push(next);
      });

      const next: Record<string, unknown> = written[0] as Record<
        string,
        unknown
      >;

      expect(next[AI_RULE_FIX_FIELD_KEY]).toBe(AiRuleFix.AskFirst);
      expect(next["executionMode"]).toBe(AutoRemediationExecutionMode.Suggest);
    });

    test("a new rule's Fix step draws no note", () => {
      const note: CapturedField = fieldNamed(tableFor(lane), "olderRuleNote");

      cleanup();
      const { container } = render(note.getCustomElement!(NEW_RULE, {}));

      expect(container).toBeEmptyDOMElement();
    });

    test("reads what it needs to name each rule's timing and fix", () => {
      expect(tableFor(lane)["selectMoreFields"]).toEqual({
        isEnabled: true,
        investigates: true,
        fixes: true,
        executionMode: true,
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

      const props: Record<string, unknown> = tableFor(lane, (rules: number) => {
        reported.push(rules);
      });
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

    test("a page that does not listen is never counted for", async () => {
      const count: CountSpy = jest
        .spyOn(ModelAPI, "count")
        .mockResolvedValue(2 as never);

      (
        tableFor(lane)["onFetchSuccess"] as (
          data: Array<unknown>,
          n: number,
        ) => void
      )([], 7);
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 0);
      });

      expect(count).not.toHaveBeenCalled();
    });

    test("says nothing about its rules when it cannot count them", async () => {
      jest
        .spyOn(ModelAPI, "count")
        .mockRejectedValue(new Error("offline") as never);
      const reported: Array<number> = [];

      const props: Record<string, unknown> = tableFor(lane, (rules: number) => {
        reported.push(rules);
      });
      (props["onFetchSuccess"] as (data: Array<unknown>, n: number) => void)(
        [],
        0,
      );
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 0);
      });

      expect(reported).toEqual([]);
    });

    /*
     * One column for what a rule does - when it investigates, and under it
     * whether and how it fixes - between its name and its status: two
     * columns pushed Status under the row's buttons at 1280px beside the
     * side menu (the offline suite measures it, in German too).
     */
    test("names what each rule does in one column, between its name and its status", () => {
      const props: Record<string, unknown> = tableFor(lane);

      expect(AI_RULE_COLUMN_TITLE).toBe("Investigates and fixes");
      expect(
        columnsOf(props).map((column: CapturedColumn): string => {
          return column.title || "";
        }),
      ).toEqual(["Name", AI_RULE_COLUMN_TITLE, "Status"]);
      expect(columnTitled(props, AI_RULE_COLUMN_TITLE).field).toEqual({
        onlyIfOpenAfterMinutes: true,
      });
      expect(columnTitled(props, AI_RULE_COLUMN_TITLE).disableSort).toBe(true);
    });

    test("the column says when each rule investigates, or that it does not, then how it fixes", () => {
      const column: CapturedColumn = columnTitled(
        tableFor(lane),
        AI_RULE_COLUMN_TITLE,
      );

      expect(
        column.getExportValue!(
          rule({ investigates: true, onlyIfOpenAfterMinutes: 30 }),
        ),
      ).toBe("If still open after 30 minutes · Asks before fixing");
      expect(
        column.getExportValue!(
          rule({ investigates: true, onlyIfOpenAfterMinutes: 1 }),
        ),
      ).toBe("If still open after 1 minute · Asks before fixing");
      expect(
        column.getExportValue!(rule({ investigates: true, fixes: false })),
      ).toBe("Right away · Doesn't fix");
      // A rule that only fixes, whatever wait it holds.
      expect(
        column.getExportValue!(
          rule({ investigates: false, onlyIfOpenAfterMinutes: 30 }),
        ),
      ).toBe("Doesn't investigate · Asks before fixing");
      expect(column.getExportValue!(rule({}))).toBe(
        "Doesn't investigate · Asks before fixing",
      );

      cleanup();
      render(
        column.getElement!(
          rule({ investigates: true, onlyIfOpenAfterMinutes: 10 }),
        ),
      );
      expect(
        screen.getByTestId(AI_RULE_TEST_IDS.timingColumn),
      ).toHaveTextContent("If still open after 10 minutes");

      // The fix under the timing, in the order the rule's steps ask them.
      const timing: HTMLElement = screen.getByTestId(
        AI_RULE_TEST_IDS.timingColumn,
      );
      const fix: HTMLElement = screen.getByTestId(AI_RULE_TEST_IDS.fixColumn);
      expect(fix).toHaveTextContent("Asks before fixing");
      expect(
        timing.compareDocumentPosition(fix) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      cleanup();
      render(column.getElement!(rule({ investigates: false })));
      expect(
        screen.getByTestId(AI_RULE_TEST_IDS.timingColumn),
      ).toHaveTextContent("Doesn't investigate");
      // Quieter than a timing: it says what the rule does not do.
      expect(screen.getByTestId(AI_RULE_TEST_IDS.timingColumn)).toHaveClass(
        "text-gray-500",
      );
    });

    test.each([
      [
        { executionMode: AutoRemediationExecutionMode.Suggest },
        "Asks before fixing",
        null,
      ],
      [
        { executionMode: AutoRemediationExecutionMode.FullAuto },
        "Fixes without asking",
        null,
      ],
      [
        {
          fixes: false,
          executionMode: AutoRemediationExecutionMode.FullAuto,
        },
        "Doesn't fix",
        null,
      ],
      [
        // Not fixing, how it would fix is not named.
        {
          fixes: false,
          remediationAction: AutoRemediationAction.Runbooks,
          aiComposesCommands: true,
        },
        "Doesn't fix",
        null,
      ],
      [
        {
          remediationAction: AutoRemediationAction.Runbooks,
          executionMode: AutoRemediationExecutionMode.FullAuto,
        },
        "Fixes without asking",
        "Its runbooks, every time",
      ],
      [
        {
          remediationAction: AutoRemediationAction.OneUptimeAI,
          executionMode: AutoRemediationExecutionMode.Suggest,
          aiComposesCommands: true,
        },
        "Asks before fixing",
        "OneUptime AI: commands on Runners",
      ],
      [
        // A runbook such a rule picks is always proposed, whatever it says.
        {
          remediationAction: AutoRemediationAction.OneUptimeAI,
          executionMode: AutoRemediationExecutionMode.FullAuto,
          aiSelectsRunbook: true,
        },
        "Asks before fixing",
        "OneUptime AI: picks a runbook",
      ],
    ])(
      "the column names %j's fix as %s, and how it fixes only when it is not OneUptime AI's way",
      (
        fields: Partial<AutoRemediationRule>,
        answer: string,
        fixedWith: string | null,
      ) => {
        const column: CapturedColumn = columnTitled(
          tableFor(lane),
          AI_RULE_COLUMN_TITLE,
        );

        // An export of the table says what the pill does, after the timing.
        expect(column.getExportValue!(rule(fields))).toBe(
          `Doesn't investigate · ${answer}`,
        );

        cleanup();
        render(column.getElement!(rule(fields)));

        expect(
          screen.getByTestId(AI_RULE_TEST_IDS.fixColumn),
        ).toHaveTextContent(answer);
        expect(screen.getByText(answer)).toBeInTheDocument();

        const line: HTMLElement | null = screen.queryByTestId(
          AI_RULE_TEST_IDS.fixColumnLine,
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

    test("its columns fit a 1280px screen beside the side menu, in a long language too", () => {
      const props: Record<string, unknown> = tableFor(lane);
      const columns: Array<CapturedColumn> = columnsOf(props);
      const name: CapturedColumn = columnTitled(props, "Name");
      const investigates: CapturedColumn = columnTitled(
        props,
        AI_RULE_COLUMN_TITLE,
      );

      /*
       * A rule's name wraps rather than being cut short, on a floor below a
       * table's 10rem: that is what leaves German's table (wider pills and
       * buttons) inside its card with Status in sight. Measured in the AI
       * settings page's offline suite (AiRules.spec.ts).
       */
      expect(name.wrapContent).toBe(true);
      expect(name.contentClassName).toBe(
        INVESTIGATION_RULE_NAME_COLUMN_CLASS_NAME,
      );
      expect(INVESTIGATION_RULE_NAME_COLUMN_CLASS_NAME).toBe("min-w-[8rem]");

      /*
       * When to investigate wraps too, between a floor that keeps "If
       * still open after 120 minutes" on one line and a cap with room for
       * "If still open after 1,440 minutes" - the cap where a wrapping
       * column takes it, never in contentClassName.
       */
      expect(investigates.wrapContent).toBe(true);
      expect(investigates.wrapMaxWidthClassName).toBe(
        INVESTIGATION_RULE_TIMING_COLUMN_CLASS_NAME,
      );
      expect(INVESTIGATION_RULE_TIMING_COLUMN_CLASS_NAME).toBe("max-w-[14rem]");
      expect(investigates.contentClassName).toBe(
        INVESTIGATION_RULE_TIMING_COLUMN_FLOOR_CLASS_NAME,
      );
      expect(INVESTIGATION_RULE_TIMING_COLUMN_FLOOR_CLASS_NAME).toBe(
        "min-w-[12rem]",
      );

      for (const column of columns) {
        expect(column.contentClassName || "").not.toContain("max-w-");
      }
    });
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
        prepareAiRuleSave(
          rule({
            remediationAction: remediationAction as AutoRemediationAction,
          }),
        ).remediationAction,
      ).toBe(AutoRemediationAction.OneUptimeAI);
    }
  });

  test("a rule that runs its runbooks every time picks no Runner", () => {
    const saved: AutoRemediationRule = prepareAiRuleSave(
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
        prepareAiRuleSave(rule({ runnerId: new ObjectID(RUNNER_ID) })).runnerId,
      ),
    ).toBe(RUNNER_ID);
    expect(prepareAiRuleSave(rule({})).runnerId).toBeUndefined();
  });

  test("an edit never decides whether the rule investigates or fixes", () => {
    for (const fields of [
      {},
      { investigates: false },
      { investigates: true, fixes: false },
    ]) {
      const saved: AutoRemediationRule = prepareAiRuleSave(rule(fields));

      expect(saved.investigates).toBe(
        (fields as { investigates?: boolean }).investigates,
      );
      expect(saved.fixes).toBe((fields as { fixes?: boolean }).fixes);
    }
  });

  test("a new rule always investigates, whatever the form held", () => {
    for (const investigates of [undefined, false, true]) {
      expect(
        prepareNewAiRule(
          rule(investigates === undefined ? {} : { investigates }),
        ).investigates,
      ).toBe(true);
    }
  });

  test("a new rule that does not fix picks no Runner, whatever it fixes with", () => {
    for (const remediationAction of [
      AutoRemediationAction.OneUptimeAI,
      AutoRemediationAction.Runbooks,
    ]) {
      const saved: AutoRemediationRule = prepareNewAiRule(
        rule({
          fixes: false,
          remediationAction,
          runnerId: new ObjectID(RUNNER_ID),
        }),
      );

      expect(saved.runnerId).toBeNull();
      expect(saved.fixes).toBe(false);
    }

    expect(
      String(
        prepareNewAiRule(
          rule({ fixes: true, runnerId: new ObjectID(RUNNER_ID) }),
        ).runnerId,
      ),
    ).toBe(RUNNER_ID);
  });
});

describe("whether AI works for a rule", () => {
  test.each(EVERY_KIND_OF_RULE)("%s", (_title: string, formValues: Values) => {
    const record: Record<string, unknown> = formValues as Record<
      string,
      unknown
    >;
    const investigates: boolean = record["investigates"] === true;
    const fixesWithAi: boolean =
      record["fixes"] !== false &&
      record["remediationAction"] !== AutoRemediationAction.Runbooks;

    expect(doesRuleUseAi(formValues)).toBe(investigates || fixesWithAi);
  });

  test("only a rule that only runs its runbooks every time has no AI", () => {
    expect(doesRuleUseAi(ONLY_FIXES_EVERY_TIME)).toBe(false);
    expect(doesRuleUseAi(EVERY_TIME)).toBe(true);
    expect(doesRuleUseAi(DOES_NOT_FIX)).toBe(true);
    expect(doesRuleUseAi(ONLY_FIXES)).toBe(true);
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

describe("the line under More fields, folded, for a rule that fixes", () => {
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
  test("Fix: don't fix, ask before fixing, then fix without asking", () => {
    expect(
      AI_RULE_FIX_OPTIONS.map((option: CardSelectOption) => {
        return [option.value, option.title];
      }),
    ).toEqual([
      [AiRuleFix.DoNotFix, "Don't fix"],
      [AiRuleFix.AskFirst, "Ask before fixing"],
      [AiRuleFix.WithoutAsking, "Fix without asking"],
    ]);
    expect(AI_RULE_FIX_OPTIONS[0]!.description).toBe(
      "OneUptime AI investigates and posts what it finds. It changes nothing.",
    );
    expect(AI_RULE_FIX_OPTIONS[1]!.description).toBe(
      "Nothing runs until someone approves the fix with one click.",
    );
    /*
     * An AI agent set to ask still asks: the rule never overrides it. And a
     * runbook starts, or a change goes through an MCP server, on its own
     * only when the rule names it - said whatever More fields holds, so a
     * rule that names none is not read as starting any runbook or making
     * any change through an MCP server without asking.
     */
    expect(AI_RULE_FIX_OPTIONS[2]!.description).toBe(
      "OneUptime AI fixes on its own where the AI agent's settings allow it, and with the runbooks and MCP servers you pick under More fields.",
    );
  });

  test("every choice has an icon of its own", () => {
    const icons: Array<unknown> = AI_RULE_FIX_OPTIONS.map(
      (option: CardSelectOption) => {
        return option.icon;
      },
    );

    expect(icons.every(Boolean)).toBe(true);
    expect(new Set(icons).size).toBe(AI_RULE_FIX_OPTIONS.length);
  });

  test("More fields says what each of its fields does", () => {
    expect(AUTO_REMEDIATION_MORE_FIELDS_COPY).toEqual({
      runbooksTitle: "Runbooks",
      runbooksDescription:
        "OneUptime AI may run any of your runbooks. Pick some to let it run only those.",
      runbooksPlaceholder: "Any runbook",
      runbooksEmptyList: "No runbooks yet.",
      everyTimeTitle: "Run them every time",
      everyTimeDescription:
        "Start every runbook above for every match, instead of OneUptime AI deciding.",
      runnerTitle: "Runner",
      runnerDescription:
        "Where OneUptime AI runs Bash commands for this rule. Commands on the affected cluster or host go through its AI agent.",
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

/*
 * What a person reading the table and the form meets (the UI review): the
 * fix pill wraps rather than cut a longer language's words short, the
 * Description field draws no line that only says its title again, and a
 * note whose button takes the note away hands keyboard focus to the
 * question that takes its place - the button is gone, and focus would fall
 * back to the page.
 */
describe("read and used by a person", () => {
  test("the fix pill wraps onto a second line rather than cut its words short", () => {
    const column: CapturedColumn = columnTitled(
      tableFor(AiLane.Incident),
      AI_RULE_COLUMN_TITLE,
    );

    cleanup();
    render(
      column.getElement!(
        rule({
          investigates: true,
          executionMode: AutoRemediationExecutionMode.FullAuto,
        }),
      ),
    );

    const fix: HTMLElement = screen.getByTestId(AI_RULE_TEST_IDS.fixColumn);
    const pillText: HTMLElement = within(fix).getByTestId("pill-text");

    expect(pillText).toHaveTextContent("Fixes without asking");
    // A wrapping pill's words may run on: no ellipsis.
    expect(pillText).toHaveClass("whitespace-normal");
    expect(pillText).not.toHaveClass("truncate");
  });

  test("the Description field draws no line that only says its title again", () => {
    const description: CapturedField = fieldNamed(
      tableFor(AiLane.Incident),
      "description",
    );

    expect(description.title).toBe("Description");
    expect(description.hideColumnDescription).toBe(true);
    expect(description.collapsibleSection).toBeDefined();
  });

  test("the When to investigate answers carry the form's own test id", () => {
    const timing: CapturedField = fieldNamed(
      tableFor(AiLane.Incident),
      INVESTIGATION_RULE_TIMING_FIELD_KEY,
    );

    expect(timing.dataTestId).toBe(AI_RULE_TEST_IDS.timingField);
  });

  test.each([AiLane.Incident, AiLane.Alert])(
    "%s: Investigate too hands keyboard focus to the answer of When to investigate",
    async (lane: AiLane) => {
      const note: CapturedField = fieldNamed(tableFor(lane), "onlyFixesNote");

      // The form, as far as focus goes: the note, then the question for it.
      const Form: () => React.ReactElement = (): React.ReactElement => {
        const [investigates, setInvestigates] = React.useState<boolean>(false);

        return (
          <div>
            <button type="button">Outside the dialog</button>
            <div role="dialog">
              {investigates ? (
                <div
                  role="radiogroup"
                  data-testid={AI_RULE_TEST_IDS.timingField}
                >
                  <input type="radio" name="timing" aria-label="Right away" />
                  <input
                    type="radio"
                    name="timing"
                    aria-label="Only if still open after a wait"
                    defaultChecked={true}
                  />
                </div>
              ) : (
                note.getCustomElement!(ONLY_FIXES, {
                  onChange: (): void => {
                    setInvestigates(true);
                  },
                })
              )}
            </div>
          </div>
        );
      };

      cleanup();
      render(<Form />);

      const investigateToo: HTMLElement = screen.getByRole("button", {
        name: "Investigate too",
      });

      // A keyboard user presses it.
      investigateToo.focus();
      fireEvent.click(investigateToo);

      await waitFor(() => {
        expect(
          screen.getByRole("radio", {
            name: "Only if still open after a wait",
          }),
        ).toHaveFocus();
      });
      expect(
        screen.queryByTestId(AI_RULE_TEST_IDS.onlyFixesNote),
      ).not.toBeInTheDocument();
    },
  );

  test("Fix like a new rule hands keyboard focus to the Fix answer it now asks", async () => {
    const note: CapturedField = fieldNamed(
      tableFor(AiLane.Incident),
      "olderRuleNote",
    );

    const Form: () => React.ReactElement = (): React.ReactElement => {
      const [isOlder, setIsOlder] = React.useState<boolean>(true);

      return (
        <div role="dialog">
          {isOlder ? (
            note.getCustomElement!(OLDER_COMMANDS, {
              onChange: (): void => {
                setIsOlder(false);
              },
            })
          ) : (
            <></>
          )}
          <div role="radiogroup" data-testid={AI_RULE_TEST_IDS.fixField}>
            <div role="radio" aria-checked={false} tabIndex={-1}>
              Don&apos;t fix
            </div>
            <div role="radio" aria-checked={!isOlder} tabIndex={0}>
              Ask before fixing
            </div>
            <div role="radio" aria-checked={isOlder} tabIndex={-1}>
              Fix without asking
            </div>
          </div>
        </div>
      );
    };

    cleanup();
    render(<Form />);

    const fixLikeANewRule: HTMLElement = screen.getByRole("button", {
      name: AUTO_REMEDIATION_OLDER_RULE_COPY.fixLikeANewRule,
    });

    fixLikeANewRule.focus();
    fireEvent.click(fixLikeANewRule);

    await waitFor(() => {
      expect(
        screen.getByRole("radio", { name: "Ask before fixing" }),
      ).toHaveFocus();
    });
    expect(
      screen.queryByTestId(AUTO_REMEDIATION_OLDER_RULE_TEST_ID),
    ).not.toBeInTheDocument();
  });
});
