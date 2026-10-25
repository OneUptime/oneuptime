import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  CustomElementProps,
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import { RadioButton } from "Common/UI/Components/RadioButtons/GroupRadioButtons";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator, translateText } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { FOLDED_SECTION_ON } from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import AutoRemediationRule from "Common/Models/DatabaseModels/AutoRemediationRule";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import ExternalMcpServer from "Common/Models/DatabaseModels/ExternalMcpServer";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import {
  AiRuleFix,
  doesAiRuleFix,
  getAiRuleFix,
  getAiRuleFixColumns,
  isAiRuleFix,
} from "Common/Types/AI/AiRule";
import AutoRemediationAction from "Common/Types/AutoRemediation/AutoRemediationAction";
import AutoRemediationTriggerEntity from "Common/Types/AutoRemediation/AutoRemediationTriggerEntity";
import {
  AutoRemediationFixKind,
  getRuleRunnerId,
} from "Common/Types/AutoRemediation/AutoRemediationFix";
import { getRunnerLiveStatusLabel } from "Common/Types/Runner/RunnerLiveStatus";
import { Blue, Gray500, Green, Red, Yellow } from "Common/Types/BrandColors";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useMemo,
  useRef,
} from "react";
import {
  RuleLlmProviderChoices,
  withRuleLlmProviderSummary,
} from "../AI/RuleLlmProviderCopy";
import {
  getRuleLlmProviderFormField,
  useRuleLlmProviderChoices,
} from "../AI/RuleLlmProviderField";
import {
  AI_LANE_ADVANCED_CARD_TITLES,
  AI_LANE_AI_RULES_TABLE_ID,
  AI_LANE_RULE_CRITERIA_SUBJECTS,
  AI_LANE_RULES_COPY,
  AiLane,
  AiLaneAdvancedCard,
} from "./ProjectAiSettingsCopy";
import { reportEnabledAiLaneRuleCount } from "./AiLaneRuleCount";
import { focusWhenDrawn } from "./FocusWhenDrawn";
import {
  AI_CONTEXT_TEST_IDS,
  AI_RULE_AI_CONTEXT_FIELD_COPY,
  getAiContextFieldError,
  getAiRuleAiContextFoldedValue,
} from "./AiContextCopy";
import AiContextLengthFooter from "./AiContextLengthFooter";
import { AiContextOwner } from "Common/Types/AI/AiContext";
import {
  AI_RULE_COLUMN_TITLE,
  AI_RULE_DOES_NOT_INVESTIGATE_TEXT,
  AI_RULE_FIX_FIELD_COPY,
  AI_RULE_FIX_FIELD_KEY,
  AI_RULE_FIX_OPTIONS,
  AI_RULE_FIX_TEXT,
  AI_RULE_FOCUS_AFTER_FIX_LIKE_A_NEW_RULE,
  AI_RULE_FOCUS_AFTER_INVESTIGATE_TOO,
  AI_RULE_ONLY_FIXES_COPY,
  AI_RULE_TEST_IDS,
  doesEditedRuleFix,
  doesEditedRuleInvestigate,
  getAiRuleFixText,
  getAiRuleMoreFieldsSummary,
  getEditedRuleFix,
  getShownAiRuleFix,
  isFixingWithOneUptimeAi,
  prepareAiRuleCreate,
  validateAiRuleFix,
} from "./AiRuleCopy";
import {
  INVESTIGATION_RULE_NAME_COLUMN_CLASS_NAME,
  INVESTIGATION_RULE_TIMING_COLUMN_CLASS_NAME,
  INVESTIGATION_RULE_TIMING_COLUMN_FLOOR_CLASS_NAME,
  INVESTIGATION_RULE_TIMING_COPY,
  INVESTIGATION_RULE_TIMING_FIELD_KEY,
  INVESTIGATION_RULE_TIMING_FIELD_TITLE,
  INVESTIGATION_RULE_TIMINGS,
  INVESTIGATION_RULE_WAIT_FIELD_DESCRIPTION,
  INVESTIGATION_RULE_WAIT_FIELD_TITLE,
  InvestigationRuleTiming,
  describeInvestigationRuleTiming,
  getInvestigationRuleTiming,
  getValuesForInvestigationRuleTiming,
  isInvestigationRuleTiming,
  isWaitChosen,
  validateInvestigationRuleWait,
} from "./InvestigationRuleTiming";
import {
  AUTO_REMEDIATION_MORE_FIELDS_COPY,
  AUTO_REMEDIATION_PULL_REQUEST_TEST_IDS,
  getAutoRemediationFixWithText,
  getEditedRuleFixKind,
  getOlderAutoRemediationRuleText,
  getValuesFixingLikeANewRule,
  hasRuleRunbooks,
  isOlderAutoRemediationRule,
  isRunbooksEveryTime,
} from "../AutoRemediation/AutoRemediationRuleCopy";
import {
  AutoRemediationRunnerPicker,
  OlderAutoRemediationRuleNote,
  RunbooksEveryTimeSwitch,
  useAutoRemediationRunnerChoices,
} from "../AutoRemediation/AutoRemediationRuleFields";
import { RULE_MCP_SERVERS_FIELD_COPY } from "../ExternalMcpServer/ExternalMcpServerCopy";
import RuleMcpServersFieldHint from "../ExternalMcpServer/RuleMcpServersFieldHint";
import {
  RULE_CODE_REPOSITORIES_FIELD_COPY,
  getRuleCodeRepositoriesFoldedValue,
} from "../Code/RuleCodeRepositoriesCopy";
import {
  RuleCodeRepositoriesFieldHint,
  RuleCodeRepositoriesPicker,
} from "../Code/RuleCodeRepositoriesField";
import { RunnerChoices } from "../Runner/RunnerChoices";
import {
  CODE_HIDDEN_RUNNER_LABEL,
  RuleRunnerFoldedValue,
  getNewRuleRunnerId,
  getRuleRunnerFoldedValue,
} from "../Runner/RunnerPickerModel";
import {
  RULE_ENABLED_DESCRIPTION,
  RULE_NAME_MAX_LENGTH,
} from "../../Utils/Form/ResourceRuleForm";

export interface ComponentProps {
  lane: AiLane;
  // How many enabled rules there are, after every read of the table.
  onRulesLoaded?: ((count: number) => void) | undefined;
}

export const AI_LANE_AI_RULE_TRIGGER: Record<
  AiLane,
  AutoRemediationTriggerEntity
> = {
  [AiLane.Incident]: AutoRemediationTriggerEntity.Incident,
  [AiLane.Alert]: AutoRemediationTriggerEntity.Alert,
};

/*
 * Incidents (or Alerts) → Settings → AI → More settings → AI rules: which
 * new incidents OneUptime AI works on, and what it does with each -
 * investigate it, and fix it or not. With no rule, it investigates every
 * new incident and fixes each one while fixing is on; with rules, only the
 * incidents a rule matches, the way that rule says (Common/Types/AI/AiRule).
 *
 * Investigation rules and auto remediation rules were two tables with the
 * same conditions: "Should incident investigation rule and remediation rule
 * be the same entity ... Since its not possible to remediate without
 * investigation" - the maintainer. So a rule asks, a step each:
 *
 *   - Match: which incidents (one conditions builder, on "All incidents");
 *   - Investigate: right away, or only if still open after a wait (issue
 *     #5074);
 *   - Fix: don't fix, ask before fixing, or fix without asking - and its
 *     name. What most rules never change is folded under More fields
 *     (getAdvancedFormSection): the code repositories and MCP servers
 *     OneUptime AI may use (investigating too), the LLM provider, the
 *     runbooks it may run and whether the rule runs them every time, the
 *     Runner, the two pull requests, and the description.
 *
 * A rule set up as an auto remediation rule before the merge may only fix:
 * its Investigate step says so, with "Investigate too". A rule saved before
 * rules were simplified (AI composes commands, or picks a runbook) keeps
 * doing that until "Fix like a new rule" (OlderAutoRemediationRuleNote).
 */

export interface AiRuleFixCellProps {
  rule: AutoRemediationRule;
}

/*
 * The table's Fix column: whether the rule fixes and whether it asks first
 * and, in a quiet line under it, how - only for a rule that does not fix the
 * way every new rule does (its runbooks every time, or an older rule's one
 * thing). The line wraps rather than widen the table.
 */
export const AiRuleFixCell: FunctionComponent<AiRuleFixCellProps> = (
  props: AiRuleFixCellProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  // An older rule that picks a runbook always asks first, whatever it says.
  const shownFix: AiRuleFix = getShownAiRuleFix(props.rule);
  const fixWith: string | null =
    shownFix === AiRuleFix.DoNotFix
      ? null
      : getAutoRemediationFixWithText(props.rule);

  return (
    <div
      className="flex flex-col items-start gap-1"
      data-testid={AI_RULE_TEST_IDS.fixColumn}
    >
      {/*
       * On a second line rather than cut short: a longer language's
       * "Asks before fixing" is wider than the column.
       */}
      <Pill
        color={
          shownFix === AiRuleFix.DoNotFix
            ? Gray500
            : shownFix === AiRuleFix.WithoutAsking
              ? Yellow
              : Blue
        }
        text={AI_RULE_FIX_TEXT[shownFix]}
        isWrapping={true}
      />
      {fixWith ? (
        <span
          className="whitespace-normal text-xs text-gray-500"
          data-testid={AI_RULE_TEST_IDS.fixColumnLine}
        >
          {translator.translateText(fixWith)}
        </span>
      ) : (
        <></>
      )}
    </div>
  );
};

export interface AiRuleTimingCellProps {
  rule: AutoRemediationRule;
}

/*
 * When the rule investigates - right away, or if still open after its wait -
 * or, for a rule that only fixes, that it does not: the first line of the
 * table's column for what the rule does.
 */
export const AiRuleTimingCell: FunctionComponent<AiRuleTimingCellProps> = (
  props: AiRuleTimingCellProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (!doesEditedRuleInvestigate(props.rule)) {
    return (
      <span
        className="text-gray-500"
        data-testid={AI_RULE_TEST_IDS.timingColumn}
      >
        {translator.translateText(AI_RULE_DOES_NOT_INVESTIGATE_TEXT)}
      </span>
    );
  }

  return (
    <span data-testid={AI_RULE_TEST_IDS.timingColumn}>
      {describeInvestigationRuleTiming(props.rule.onlyIfOpenAfterMinutes)}
    </span>
  );
};

export interface AiRuleDoesCellProps {
  rule: AutoRemediationRule;
}

/*
 * The table's one column for what a rule does: when it investigates, and
 * under it whether and how it fixes (AI_RULE_COLUMN_TITLE). Read the way
 * the rule's steps ask it: Investigate, then Fix.
 */
export const AiRuleDoesCell: FunctionComponent<AiRuleDoesCellProps> = (
  props: AiRuleDoesCellProps,
): ReactElement => {
  return (
    <div className="flex flex-col items-start gap-1.5">
      <AiRuleTimingCell rule={props.rule} />
      <AiRuleFixCell rule={props.rule} />
    </div>
  );
};

/*
 * What the column says, as one line of an export: "Right away · Asks
 * before fixing".
 */
export function getAiRuleDoesText(rule: AutoRemediationRule): string {
  const timing: string = doesEditedRuleInvestigate(rule)
    ? describeInvestigationRuleTiming(rule.onlyIfOpenAfterMinutes)
    : translateText(AI_RULE_DOES_NOT_INVESTIGATE_TEXT) ||
      AI_RULE_DOES_NOT_INVESTIGATE_TEXT;
  const fix: string = getAiRuleFixText(rule);

  return `${timing} · ${translateText(fix) || fix}`;
}

export interface AiRuleOnlyFixesNoteProps {
  lane: AiLane;
  onInvestigateToo: () => void;
}

/*
 * The Investigate step of a rule that only fixes: what it does, where the
 * question it does not answer would be, and the one way to make it a rule
 * like every other. The rule changes only when the dialog is saved. The
 * question takes the note's place, and keyboard focus goes to its answer.
 */
export const AiRuleOnlyFixesNote: FunctionComponent<
  AiRuleOnlyFixesNoteProps
> = (props: AiRuleOnlyFixesNoteProps): ReactElement => {
  const translator: Translator = useTranslator();
  const noteRef: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={noteRef}
      className="flex flex-col items-start gap-3 rounded-md border border-gray-200 bg-gray-50 p-3 sm:flex-row sm:items-center sm:justify-between"
      data-testid={AI_RULE_TEST_IDS.onlyFixesNote}
    >
      <p className="text-sm text-gray-700">
        {translator.translateText(AI_RULE_ONLY_FIXES_COPY[props.lane].note)}
      </p>
      <button
        type="button"
        onClick={(): void => {
          focusWhenDrawn({
            from: noteRef.current,
            selectors: AI_RULE_FOCUS_AFTER_INVESTIGATE_TOO,
          });
          props.onInvestigateToo();
        }}
        className="flex-none rounded-md border border-gray-300 bg-white px-2.5 py-1 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        data-testid={AI_RULE_TEST_IDS.investigateToo}
      >
        {translator.translateText(
          AI_RULE_ONLY_FIXES_COPY[props.lane].investigateToo,
        )}
      </button>
    </div>
  );
};

/*
 * Whether the rule being edited is an older rule of this kind - one a field
 * does nothing for, so the field is not drawn.
 */
function isEditingOlderRuleOfKind(
  values: FormValues<AutoRemediationRule>,
  kind: AutoRemediationFixKind,
): boolean {
  return getEditedRuleFixKind(values) === kind;
}

// When to investigate: the two answers, each with its line.
export const getAiRuleTimingChoices: (lane: AiLane) => Array<RadioButton> = (
  lane: AiLane,
): Array<RadioButton> => {
  return INVESTIGATION_RULE_TIMINGS.map(
    (timing: InvestigationRuleTiming): RadioButton => {
      return {
        value: timing,
        title: INVESTIGATION_RULE_TIMING_COPY[lane][timing].title,
        description: INVESTIGATION_RULE_TIMING_COPY[lane][timing].description,
      };
    },
  );
};

/*
 * The Fix step's More fields: one section, built once per table, for the
 * fields that follow one another at the end of the step (FormStepsScan
 * groups by it). Its summary names the default LLM provider first - while
 * the rule uses AI: it investigates, or OneUptime AI fixes for it - then
 * what the rest's defaults do.
 */
export function getAiRuleMoreFields(
  getLlmProviderChoices: () => RuleLlmProviderChoices | null,
): FormFieldCollapsibleSection<AutoRemediationRule> {
  return getAdvancedFormSection<AutoRemediationRule>({
    getSummary: (
      values: FormValues<AutoRemediationRule>,
    ): Array<string> | undefined => {
      return withRuleLlmProviderSummary(
        getAiRuleMoreFieldsSummary(values),
        values,
        doesRuleUseAi(values) ? getLlmProviderChoices() : null,
      );
    },
  });
}

/*
 * Whether OneUptime AI works for the rule being edited - an investigation,
 * or a fix it works out - so it has an LLM provider and MCP servers to
 * pick. A rule that only runs its runbooks every time uses none.
 */
export function doesRuleUseAi(
  values: FormValues<AutoRemediationRule>,
): boolean {
  return (
    doesEditedRuleInvestigate(values) ||
    (doesEditedRuleFix(values) && !isRunbooksEveryTime(values))
  );
}

/*
 * What a rule saves for its Fix With: the form always says, so a rule that
 * names runbooks is never taken for one that runs them every time by the
 * server's reading of an older API client's create
 * (AutoRemediationRuleService.getRemediationActionOnCreate). A rule that
 * runs its runbooks every time picks no Runner: OneUptime AI composes no
 * commands for it.
 */
export function prepareAiRuleSave(
  item: AutoRemediationRule,
): AutoRemediationRule {
  if (item.remediationAction !== AutoRemediationAction.Runbooks) {
    item.remediationAction = AutoRemediationAction.OneUptimeAI;
  }

  if (item.remediationAction === AutoRemediationAction.Runbooks) {
    (item as unknown as { runnerId: null }).runnerId = null;
  }

  return item;
}

/*
 * What a new rule saves: it investigates, and - when it does not fix - it
 * picks no Runner, so no Runner is let run OneUptime AI's commands for a
 * rule that never sends one (RunnerAiCommandsPick).
 */
export function prepareNewAiRule(
  item: AutoRemediationRule,
): AutoRemediationRule {
  prepareAiRuleCreate(item);
  prepareAiRuleSave(item);

  if (!doesAiRuleFix(item)) {
    (item as unknown as { runnerId: null }).runnerId = null;
  }

  return item;
}

const AiRulesTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isIncident: boolean = props.lane === AiLane.Incident;
  const triggerEntityType: AutoRemediationTriggerEntity =
    AI_LANE_AI_RULE_TRIGGER[props.lane];

  /*
   * The Runner a new rule starts on: the project's default Runner, when it
   * has one (getNewRuleRunnerId). Read with the page, so the form opens on
   * it; the rule saves it as its own pick.
   */
  const runnerChoices: RunnerChoices | null = useAutoRemediationRunnerChoices();
  const newRuleRunnerId: string | undefined = runnerChoices
    ? getNewRuleRunnerId(runnerChoices.projectRunners)
    : undefined;

  /*
   * The same Runners, for the folded More fields line to name the rule's
   * pick by. Read through a ref: a form may hold on to the fields it was
   * opened with, and the line must name the Runners as last read.
   */
  const runnerChoicesRef: MutableRefObject<RunnerChoices | null> =
    useRef<RunnerChoices | null>(runnerChoices);
  runnerChoicesRef.current = runnerChoices;

  /*
   * The project's LLM providers, for the folded line to name a rule's
   * provider - or the default one - by, read through a ref the same way.
   */
  const llmProviderChoices: RuleLlmProviderChoices | null =
    useRuleLlmProviderChoices();
  const llmProviderChoicesRef: MutableRefObject<RuleLlmProviderChoices | null> =
    useRef<RuleLlmProviderChoices | null>(llmProviderChoices);
  llmProviderChoicesRef.current = llmProviderChoices;

  const moreFields: FormFieldCollapsibleSection<AutoRemediationRule> =
    useMemo(() => {
      return getAiRuleMoreFields((): RuleLlmProviderChoices | null => {
        return llmProviderChoicesRef.current;
      });
    }, []);

  // "Runner: prod-eu-runner" - or with " · Disconnected" when it is not connected.
  const getRunnerFoldedValue: (
    values: FormValues<AutoRemediationRule>,
  ) => string | null = (
    values: FormValues<AutoRemediationRule>,
  ): string | null => {
    const folded: RuleRunnerFoldedValue | undefined = getRuleRunnerFoldedValue({
      runnerId: getRuleRunnerId({
        runnerId: (values as { runnerId?: unknown }).runnerId,
      }),
      projectRunners: runnerChoicesRef.current
        ? runnerChoicesRef.current.projectRunners
        : null,
    });

    if (!folded) {
      return null;
    }

    if (folded.isHidden) {
      return (
        translateText(CODE_HIDDEN_RUNNER_LABEL) || CODE_HIDDEN_RUNNER_LABEL
      );
    }

    if (!folded.notConnectedStatus) {
      return folded.name;
    }

    const status: string = getRunnerLiveStatusLabel(folded.notConnectedStatus);

    return `${folded.name} · ${translateText(status) || status}`;
  };

  return (
    <ModelTable<AutoRemediationRule>
      modelType={AutoRemediationRule}
      id={AI_LANE_AI_RULES_TABLE_ID[props.lane]}
      name="Settings > AI > AI Rules"
      userPreferencesKey={AI_LANE_AI_RULES_TABLE_ID[props.lane]}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      // "All incidents" or "Only incidents that match conditions".
      ruleCriteriaSubject={AI_LANE_RULE_CRITERIA_SUBJECTS[props.lane]}
      query={{ triggerEntityType: triggerEntityType }}
      onBeforeCreate={async (item: AutoRemediationRule) => {
        item.triggerEntityType = triggerEntityType;
        return prepareNewAiRule(item);
      }}
      onBeforeUpdate={async (item: AutoRemediationRule) => {
        return prepareAiRuleSave(item);
      }}
      onFetchSuccess={() => {
        void reportEnabledAiLaneRuleCount<AutoRemediationRule>({
          modelType: AutoRemediationRule,
          triggerEntityType: triggerEntityType,
          onRulesLoaded: props.onRulesLoaded,
        });
      }}
      cardProps={{
        title:
          AI_LANE_ADVANCED_CARD_TITLES[props.lane][AiLaneAdvancedCard.AiRules],
        description: AI_LANE_RULES_COPY[props.lane].aiRulesDescription,
        /*
         * Its place on the page: a link to ".../ai/settings#AiRules" (an
         * incident's or alert's AI card, when it matched none of the rules)
         * opens More settings at this table.
         */
        id: AiLaneAdvancedCard.AiRules,
      }}
      noItemsMessage={AI_LANE_RULES_COPY[props.lane].noAiRulesMessage}
      sortBy="name"
      sortOrder={SortOrder.Ascending}
      selectMoreFields={{
        isEnabled: true,
        investigates: true,
        fixes: true,
        executionMode: true,
        remediationAction: true,
        aiSelectsRunbook: true,
        aiComposesCommands: true,
      }}
      filters={[
        { field: { name: true }, title: "Name", type: FieldType.Text },
        {
          field: { isEnabled: true },
          title: "Enabled",
          type: FieldType.Boolean,
        },
      ]}
      columns={[
        {
          field: { name: true },
          title: "Name",
          type: FieldType.Text,
          /*
           * A rule's name on as many lines as it needs: cut short on one
           * line, beside Investigates, Fix and Status, the part that tells
           * two rules apart was the part cut off.
           */
          wrapContent: true,
          contentClassName: INVESTIGATION_RULE_NAME_COLUMN_CLASS_NAME,
        },
        {
          /*
           * What the rule does: when it investigates, and under it whether
           * and how it fixes - one column, so Status stays in sight at
           * 1280px beside the side menu. "If still open after 10 minutes"
           * on one line in English; a longer language takes two.
           */
          field: { onlyIfOpenAfterMinutes: true },
          title: AI_RULE_COLUMN_TITLE,
          type: FieldType.Element,
          disableSort: true,
          wrapContent: true,
          wrapMaxWidthClassName: INVESTIGATION_RULE_TIMING_COLUMN_CLASS_NAME,
          contentClassName: INVESTIGATION_RULE_TIMING_COLUMN_FLOOR_CLASS_NAME,
          getElement: (item: AutoRemediationRule): ReactElement => {
            return <AiRuleDoesCell rule={item} />;
          },
          getExportValue: (item: AutoRemediationRule): string => {
            return getAiRuleDoesText(item);
          },
        },
        {
          field: { isEnabled: true },
          title: "Status",
          type: FieldType.Boolean,
          getElement: (item: AutoRemediationRule): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
      ]}
      viewPageRoute={Navigation.getCurrentRoute()}
      formSteps={[
        { title: "Match", id: "match-criteria" },
        { title: "Investigate", id: "investigate" },
        { title: "Fix", id: "remediation" },
      ]}
      formFields={[
        // Match: drawn as one conditions builder, on "All incidents".
        {
          field: { monitors: true },
          title: "Monitors",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Monitor,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Monitors (optional)",
        },
        ...(isIncident
          ? [
              {
                field: { incidentSeverities: true },
                title: "Incident Severities",
                stepId: "match-criteria",
                fieldType: FormFieldSchemaType.MultiSelectDropdown,
                dropdownModal: {
                  type: IncidentSeverity,
                  labelField: "name",
                  valueField: "_id",
                  sort: {
                    order: SortOrder.Ascending,
                  },
                },
                required: false,
                placeholder: "Select Severities (optional)",
              },
            ]
          : [
              {
                field: { alertSeverities: true },
                title: "Alert Severities",
                stepId: "match-criteria",
                fieldType: FormFieldSchemaType.MultiSelectDropdown,
                dropdownModal: {
                  type: AlertSeverity,
                  labelField: "name",
                  valueField: "_id",
                  sort: {
                    order: SortOrder.Ascending,
                  },
                },
                required: false,
                placeholder: "Select Severities (optional)",
              },
            ]),
        {
          field: { labels: true },
          title: isIncident ? "Incident Labels" : "Alert Labels",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Labels (optional)",
        },
        {
          field: { monitorLabels: true },
          title: "Monitor Labels",
          description:
            "Only match incidents and alerts whose monitor has one of these labels.",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Monitor Labels (optional)",
        },
        {
          field: { titlePattern: true },
          title: isIncident ? "Incident Title" : "Alert Title",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "database|postgres|db-",
        },
        {
          field: { descriptionPattern: true },
          title: isIncident ? "Incident Description" : "Alert Description",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "timeout|connection refused",
        },
        /*
         * Investigate. Whether the rule investigates is never drawn: every
         * rule made here does (a new one starts on, prepareNewAiRule), and
         * one that only fixes says so with "Investigate too", which turns
         * it on.
         */
        {
          field: { investigates: true },
          title: "Investigates",
          stepId: "investigate",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          defaultValue: true,
          // Never drawn: no line of the column's written for the API reference.
          hideColumnDescription: true,
          showIf: (): boolean => {
            return false;
          },
        },
        {
          // A rule that only fixes says so, where the question would be.
          overrideField: { investigates: true },
          overrideFieldKey: "onlyFixesNote",
          formOnly: true,
          stepId: "investigate",
          fieldType: FormFieldSchemaType.CustomComponent,
          customElementDrawsOwnLabel: true,
          required: false,
          dataTestId: "ai-rule-only-fixes-field",
          showIf: (values: FormValues<AutoRemediationRule>): boolean => {
            return !doesEditedRuleInvestigate(values);
          },
          onChange: (
            _value: unknown,
            currentValues: FormValues<AutoRemediationRule>,
            setNewFormValues: (values: FormValues<AutoRemediationRule>) => void,
          ): void => {
            setNewFormValues({
              ...currentValues,
              investigates: true,
            } as FormValues<AutoRemediationRule>);
          },
          getCustomElement: (
            _values: FormValues<AutoRemediationRule>,
            elementProps: CustomElementProps,
          ): ReactElement => {
            return (
              <AiRuleOnlyFixesNote
                lane={props.lane}
                onInvestigateToo={(): void => {
                  elementProps.onChange?.(true);
                }}
              />
            );
          },
        },
        /*
         * When: right away (the default, and what every rule did before
         * rules could wait), or only if the incident is still open after a
         * wait (issue #5074). Form-only: it starts on the answer the rule's
         * wait makes, and a pick writes the wait - cleared for right away,
         * the minutes below otherwise.
         */
        {
          overrideField: {
            onlyIfOpenAfterMinutes: true,
          },
          overrideFieldKey: INVESTIGATION_RULE_TIMING_FIELD_KEY,
          formOnly: true,
          title: INVESTIGATION_RULE_TIMING_FIELD_TITLE,
          stepId: "investigate",
          fieldType: FormFieldSchemaType.RadioButton,
          radioButtonOptions: getAiRuleTimingChoices(props.lane),
          required: true,
          // Each answer says what it does; the column's sentence is half of it.
          hideColumnDescription: true,
          dataTestId: AI_RULE_TEST_IDS.timingField,
          showIf: (values: FormValues<AutoRemediationRule>): boolean => {
            return doesEditedRuleInvestigate(values);
          },
          getDefaultValue: (
            values: FormValues<AutoRemediationRule>,
          ): string => {
            return getInvestigationRuleTiming(values);
          },
          onChange: (
            value: unknown,
            currentValues: FormValues<AutoRemediationRule>,
            setNewFormValues: (values: FormValues<AutoRemediationRule>) => void,
          ): void => {
            if (!isInvestigationRuleTiming(value)) {
              return;
            }

            setNewFormValues(
              getValuesForInvestigationRuleTiming({
                values: currentValues,
                timing: value,
              }),
            );
          },
        },
        {
          field: { onlyIfOpenAfterMinutes: true },
          title: INVESTIGATION_RULE_WAIT_FIELD_TITLE,
          description: INVESTIGATION_RULE_WAIT_FIELD_DESCRIPTION[props.lane],
          stepId: "investigate",
          fieldType: FormFieldSchemaType.Number,
          required: false,
          // Asked only with a wait, and then it is needed: no "(Optional)".
          hideOptionalLabel: true,
          placeholder: "10",
          dataTestId: "investigation-rule-wait-minutes",
          showIf: (values: FormValues<AutoRemediationRule>): boolean => {
            return doesEditedRuleInvestigate(values) && isWaitChosen(values);
          },
          // A whole number from 1 to the longest wait, in one message.
          customValidation: (
            values: FormValues<AutoRemediationRule>,
          ): string | null => {
            return doesEditedRuleInvestigate(values)
              ? validateInvestigationRuleWait(values)
              : null;
          },
        },
        /*
         * Fix. The rule's two columns behind its one question, never drawn:
         * registered so the edit reads them and the save sends what the
         * answer wrote. And the two flags a rule saved before rules were
         * simplified holds, so an older rule's edit says what it does and
         * can clear them (Fix like a new rule).
         */
        {
          field: { fixes: true },
          title: "Fixes",
          stepId: "remediation",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          hideColumnDescription: true,
          showIf: (): boolean => {
            return false;
          },
        },
        {
          field: { executionMode: true },
          title: "Execution Mode",
          stepId: "remediation",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          hideColumnDescription: true,
          showIf: (): boolean => {
            return false;
          },
        },
        {
          field: { aiComposesCommands: true },
          title: "Let AI Compose Commands",
          stepId: "remediation",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          // Never drawn: no line of the column's written for the API reference.
          hideColumnDescription: true,
          showIf: (): boolean => {
            return false;
          },
        },
        {
          field: { aiSelectsRunbook: true },
          title: "Let AI Pick the Runbook",
          stepId: "remediation",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          // Never drawn: no line of the column's written for the API reference.
          hideColumnDescription: true,
          showIf: (): boolean => {
            return false;
          },
        },
        {
          // An older rule says what it still does, first on the step.
          overrideField: { aiComposesCommands: true },
          overrideFieldKey: "olderRuleNote",
          formOnly: true,
          stepId: "remediation",
          fieldType: FormFieldSchemaType.CustomComponent,
          customElementDrawsOwnLabel: true,
          required: false,
          dataTestId: "auto-remediation-older-rule-field",
          showIf: (values: FormValues<AutoRemediationRule>): boolean => {
            return (
              doesEditedRuleFix(values) && isOlderAutoRemediationRule(values)
            );
          },
          onChange: (
            _value: unknown,
            currentValues: FormValues<AutoRemediationRule>,
            setNewFormValues: (values: FormValues<AutoRemediationRule>) => void,
          ): void => {
            const fixingLikeANewRule: FormValues<AutoRemediationRule> =
              getValuesFixingLikeANewRule(currentValues);

            /*
             * The Fix answer follows the columns it writes: asking first,
             * not the answer the older rule opened on, which the question
             * kept while it was hidden.
             */
            setNewFormValues({
              ...fixingLikeANewRule,
              [AI_RULE_FIX_FIELD_KEY]: getAiRuleFix(
                fixingLikeANewRule as {
                  fixes?: unknown;
                  executionMode?: unknown;
                },
              ),
            } as FormValues<AutoRemediationRule>);
          },
          getCustomElement: (
            values: FormValues<AutoRemediationRule>,
            elementProps: CustomElementProps,
          ): ReactElement => {
            const text: string | null = getOlderAutoRemediationRuleText(values);

            if (!text) {
              return <></>;
            }

            return (
              <OlderAutoRemediationRuleNote
                text={text}
                onFixLikeANewRule={(): void => {
                  elementProps.onChange?.(true);
                }}
                // Then onto the Fix answer it now asks, "Ask before fixing".
                focusAfterSelectors={AI_RULE_FOCUS_AFTER_FIX_LIKE_A_NEW_RULE}
              />
            );
          },
        },
        {
          /*
           * The Fix step's one question: don't fix, ask before fixing, or
           * fix without asking. Form-only: it starts on the answer the
           * rule's columns make, and a pick writes them (fixes and
           * executionMode).
           */
          overrideField: { fixes: true },
          overrideFieldKey: AI_RULE_FIX_FIELD_KEY,
          formOnly: true,
          title: AI_RULE_FIX_FIELD_COPY.title,
          description: AI_RULE_FIX_FIELD_COPY.description,
          stepId: "remediation",
          fieldType: FormFieldSchemaType.CardSelect,
          cardSelectSingleColumn: true,
          cardSelectOptions: AI_RULE_FIX_OPTIONS,
          required: true,
          dataTestId: AI_RULE_TEST_IDS.fixField,
          // An older rule that picks a runbook always asks first: not a choice.
          showIf: (values: FormValues<AutoRemediationRule>): boolean => {
            return !(
              doesEditedRuleFix(values) &&
              isEditingOlderRuleOfKind(
                values,
                AutoRemediationFixKind.AiPicksRunbook,
              )
            );
          },
          getDefaultValue: (
            values: FormValues<AutoRemediationRule>,
          ): string => {
            return getEditedRuleFix(values);
          },
          onChange: (
            value: unknown,
            currentValues: FormValues<AutoRemediationRule>,
            setNewFormValues: (values: FormValues<AutoRemediationRule>) => void,
          ): void => {
            if (!isAiRuleFix(value)) {
              return;
            }

            setNewFormValues({
              ...currentValues,
              [AI_RULE_FIX_FIELD_KEY]: value,
              ...getAiRuleFixColumns(
                value,
                (currentValues as { executionMode?: unknown }).executionMode,
              ),
            } as FormValues<AutoRemediationRule>);
          },
          // A rule that does not investigate must fix.
          customValidation: (
            values: FormValues<AutoRemediationRule>,
          ): string | null => {
            return validateAiRuleFix(values);
          },
        },
        {
          field: { name: true },
          title: "Name",
          stepId: "remediation",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          // "Name of this AI rule." says nothing the title does not.
          hideColumnDescription: true,
          placeholder: isIncident
            ? "Production incidents"
            : "Production alerts",
          validation: {
            minLength: 2,
            maxLength: RULE_NAME_MAX_LENGTH,
          },
        },
        {
          field: { isEnabled: true },
          title: "Enabled",
          description: RULE_ENABLED_DESCRIPTION,
          stepId: "remediation",
          fieldType: FormFieldSchemaType.Toggle,
          // A rule starts on: the switch is on its edit form only.
          doNotShowWhenCreating: true,
          required: false,
        },
        {
          /*
           * The code repositories OneUptime AI may read while it
           * investigates and fixes, and open the rule's pull requests in:
           * none picked is every connected repository. First under More
           * fields, as the one field every rule shows: the form keys the
           * fold by its first field on screen, so a first field that comes
           * and goes with the Fix answer (the runbooks) or with the switch
           * that turns AI off (the LLM provider) would close the fold
           * whenever either changed.
           */
          field: { codeRepositories: true },
          title: RULE_CODE_REPOSITORIES_FIELD_COPY.title,
          description: RULE_CODE_REPOSITORIES_FIELD_COPY.aiRuleDescription,
          stepId: "remediation",
          collapsibleSection: moreFields,
          fieldType: FormFieldSchemaType.CustomComponent,
          required: false,
          // Empty is an answer of its own - all of them - not "(Optional)".
          hideOptionalLabel: true,
          hideColumnDescription: true,
          dataTestId: "auto-remediation-code-repositories-field",
          getFoldedValue: (
            values: FormValues<AutoRemediationRule>,
          ): string | null => {
            return getRuleCodeRepositoriesFoldedValue(values);
          },
          getCustomElement: (
            values: FormValues<AutoRemediationRule>,
            elementProps: CustomElementProps,
          ): ReactElement => {
            return (
              <RuleCodeRepositoriesPicker
                value={
                  (values as { codeRepositories?: unknown }).codeRepositories
                }
                ariaLabelledby={elementProps.ariaLabelledby}
                onChange={(repositoryIds: Array<string>): void => {
                  elementProps.onChange?.(repositoryIds);
                }}
              />
            );
          },
          getFooterElement: (): ReactElement => {
            return <RuleCodeRepositoriesFieldHint />;
          },
        },
        {
          /*
           * The MCP servers OneUptime AI may use - only their tools that
           * read while it investigates; to fix too: none picked is all of
           * them, and their changes always wait for approval - picking some
           * is what lets "Fix without asking" use them.
           */
          field: { externalMcpServers: true },
          title: RULE_MCP_SERVERS_FIELD_COPY.title,
          description: RULE_MCP_SERVERS_FIELD_COPY.aiRuleDescription,
          stepId: "remediation",
          collapsibleSection: moreFields,
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: ExternalMcpServer,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          // Empty is an answer of its own - all of them - not "(Optional)".
          hideOptionalLabel: true,
          hideColumnDescription: true,
          placeholder: RULE_MCP_SERVERS_FIELD_COPY.placeholder,
          dataTestId: "auto-remediation-mcp-servers-field",
          /*
           * For a rule that investigates, or one OneUptime AI fixes for: a
           * rule that only runs its runbooks every time, or an older rule
           * that only fixes, uses no MCP server.
           */
          showIf: (values: FormValues<AutoRemediationRule>): boolean => {
            return (
              doesEditedRuleInvestigate(values) ||
              isFixingWithOneUptimeAi(values)
            );
          },
          getFooterElement: (): ReactElement => {
            return <RuleMcpServersFieldHint />;
          },
        },
        /*
         * The LLM provider OneUptime AI uses for everything the rule starts
         * - the investigation, and the fixes it works out: none is the
         * default. Not for a rule that only runs its runbooks every time:
         * no AI works for it.
         */
        getRuleLlmProviderFormField<AutoRemediationRule>({
          stepId: "remediation",
          collapsibleSection: moreFields,
          dataTestId: "auto-remediation-llm-provider-field",
          getChoices: (): RuleLlmProviderChoices | null => {
            return llmProviderChoicesRef.current;
          },
          showIf: (values: FormValues<AutoRemediationRule>): boolean => {
            return doesRuleUseAi(values);
          },
        }),
        {
          /*
           * Notes for OneUptime AI about what the rule matches (issue
           * #5198): read after the project's AI context by the
           * investigation and the fix the rule starts. For a rule OneUptime
           * AI works for, as the LLM provider is: a rule that only runs its
           * runbooks every time asks no AI anything.
           */
          field: { aiContext: true },
          title: AI_RULE_AI_CONTEXT_FIELD_COPY.title,
          description: AI_RULE_AI_CONTEXT_FIELD_COPY.description,
          stepId: "remediation",
          collapsibleSection: moreFields,
          fieldType: FormFieldSchemaType.Markdown,
          required: false,
          // Empty is an answer of its own - the project's notes alone.
          hideOptionalLabel: true,
          placeholder: AI_RULE_AI_CONTEXT_FIELD_COPY.placeholder,
          // Notes are text: a model is never given an image's bytes.
          allowImageUpload: false,
          dataTestId: AI_CONTEXT_TEST_IDS.ruleField,
          showIf: (values: FormValues<AutoRemediationRule>): boolean => {
            return doesRuleUseAi(values);
          },
          customValidation: (
            values: FormValues<AutoRemediationRule>,
          ): string | null => {
            return getAiContextFieldError({
              value: (values as { aiContext?: unknown }).aiContext,
              owner: AiContextOwner.AiRule,
              translator,
            });
          },
          // "AI context: about 310 tokens" on the folded line, once written.
          getFoldedValue: (
            values: FormValues<AutoRemediationRule>,
          ): string | null => {
            return doesRuleUseAi(values)
              ? getAiRuleAiContextFoldedValue(
                  (values as { aiContext?: unknown }).aiContext,
                  translator,
                )
              : null;
          },
          getFooterElement: (
            values: FormValues<AutoRemediationRule>,
          ): ReactElement => {
            return (
              <AiContextLengthFooter
                value={(values as { aiContext?: unknown }).aiContext}
                owner={AiContextOwner.AiRule}
              />
            );
          },
        },
        {
          // The runbooks OneUptime AI may run: none picked is any runbook.
          field: { runbooks: true },
          title: AUTO_REMEDIATION_MORE_FIELDS_COPY.runbooksTitle,
          description: AUTO_REMEDIATION_MORE_FIELDS_COPY.runbooksDescription,
          stepId: "remediation",
          collapsibleSection: moreFields,
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Runbook,
            labelField: "name",
            valueField: "_id",
          },
          // A rule that runs its runbooks every time needs some to run.
          required: (values: FormValues<AutoRemediationRule>): boolean => {
            return doesEditedRuleFix(values) && isRunbooksEveryTime(values);
          },
          // Empty is an answer of its own - any runbook - not "(Optional)".
          hideOptionalLabel: true,
          placeholder: AUTO_REMEDIATION_MORE_FIELDS_COPY.runbooksPlaceholder,
          dataTestId: "auto-remediation-runbooks-field",
          // Only for a rule that fixes; an older rule that composes commands runs none.
          showIf: (values: FormValues<AutoRemediationRule>): boolean => {
            return (
              doesEditedRuleFix(values) &&
              !isEditingOlderRuleOfKind(
                values,
                AutoRemediationFixKind.CommandsOnRunners,
              )
            );
          },
        },
        {
          // "Run them every time": the rule's Fix With, Runbooks when on.
          field: { remediationAction: true },
          title: AUTO_REMEDIATION_MORE_FIELDS_COPY.everyTimeTitle,
          // The switch draws it beside itself; the field's own, not the column's.
          description: AUTO_REMEDIATION_MORE_FIELDS_COPY.everyTimeDescription,
          stepId: "remediation",
          collapsibleSection: moreFields,
          fieldType: FormFieldSchemaType.CustomComponent,
          customElementDrawsOwnLabel: true,
          required: false,
          defaultValue: AutoRemediationAction.OneUptimeAI,
          dataTestId: "auto-remediation-every-time-field",
          /*
           * Shown once there are runbooks to run - or for a rule that runs
           * them - while the rule fixes; an older rule does what its note
           * says until it is made to fix like a new rule.
           */
          showIf: (values: FormValues<AutoRemediationRule>): boolean => {
            return (
              doesEditedRuleFix(values) &&
              (hasRuleRunbooks(values) || isRunbooksEveryTime(values)) &&
              !isOlderAutoRemediationRule(values)
            );
          },
          getFoldedValue: (
            values: FormValues<AutoRemediationRule>,
          ): string | null => {
            return doesEditedRuleFix(values) && isRunbooksEveryTime(values)
              ? translateText(FOLDED_SECTION_ON) || FOLDED_SECTION_ON
              : null;
          },
          /*
           * Named on the folded line only while on ("Run them every time:
           * On"): named while off, beside the set fields, it read as on.
           */
          isListedWhileFolded: (
            values: FormValues<AutoRemediationRule>,
          ): boolean => {
            return doesEditedRuleFix(values) && isRunbooksEveryTime(values);
          },
          getCustomElement: (
            values: FormValues<AutoRemediationRule>,
            elementProps: CustomElementProps,
          ): ReactElement => {
            return (
              <RunbooksEveryTimeSwitch
                value={
                  (values as { remediationAction?: unknown }).remediationAction
                }
                error={elementProps.error}
                onChange={(remediationAction: AutoRemediationAction): void => {
                  elementProps.onChange?.(remediationAction);
                }}
              />
            );
          },
        },
        {
          /*
           * Where OneUptime AI runs the rule's Bash commands: the project's
           * default Runner for a new rule, or none - shown as the Global
           * Runner where there is one, on which it runs none of them.
           */
          field: { runnerId: true },
          title: AUTO_REMEDIATION_MORE_FIELDS_COPY.runnerTitle,
          description: AUTO_REMEDIATION_MORE_FIELDS_COPY.runnerDescription,
          stepId: "remediation",
          collapsibleSection: moreFields,
          fieldType: FormFieldSchemaType.CustomComponent,
          required: false,
          // Empty is an answer of its own - no Runner - not "(Optional)".
          hideOptionalLabel: true,
          // Its own line, not the column's (written for the API reference).
          hideColumnDescription: true,
          ...(newRuleRunnerId ? { defaultValue: newRuleRunnerId } : {}),
          dataTestId: "auto-remediation-runner-field",
          /*
           * Named with the Runner it picks, the project's default included -
           * where the rule's commands run is never hidden by the fold.
           */
          getFoldedValue: (
            values: FormValues<AutoRemediationRule>,
          ): string | null => {
            return doesEditedRuleFix(values)
              ? getRunnerFoldedValue(values)
              : null;
          },
          /*
           * Only for a rule that fixes with OneUptime AI: one that runs its
           * runbooks every time composes no commands, nor does an older rule
           * that picks a runbook.
           */
          showIf: (values: FormValues<AutoRemediationRule>): boolean => {
            return (
              doesEditedRuleFix(values) &&
              !isRunbooksEveryTime(values) &&
              !isEditingOlderRuleOfKind(
                values,
                AutoRemediationFixKind.AiPicksRunbook,
              )
            );
          },
          getCustomElement: (
            values: FormValues<AutoRemediationRule>,
            elementProps: CustomElementProps,
          ): ReactElement => {
            return (
              <AutoRemediationRunnerPicker
                value={(values as { runnerId?: unknown }).runnerId}
                ariaLabelledby={elementProps.ariaLabelledby}
                /*
                 * An older rule that composes commands runs them on its
                 * Command Runners too: none here reads "No Runner".
                 */
                isGlobalRunnerShown={
                  !isEditingOlderRuleOfKind(
                    values,
                    AutoRemediationFixKind.CommandsOnRunners,
                  )
                }
                onChange={(runnerId: string | null): void => {
                  elementProps.onChange?.(runnerId);
                }}
              />
            );
          },
        },
        /*
         * The two pull requests an investigation of a match can lead to,
         * each a switch, on by default - part of fixing, so only for a rule
         * that fixes.
         */
        {
          field: { openCodeFixPullRequests: true },
          title: AUTO_REMEDIATION_MORE_FIELDS_COPY.codeFixTitle,
          description: AUTO_REMEDIATION_MORE_FIELDS_COPY.codeFixDescription,
          stepId: "remediation",
          collapsibleSection: moreFields,
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          // Its own line, not the column's (written for the API reference).
          hideColumnDescription: true,
          dataTestId: AUTO_REMEDIATION_PULL_REQUEST_TEST_IDS.codeFix,
          showIf: (values: FormValues<AutoRemediationRule>): boolean => {
            return doesEditedRuleFix(values);
          },
        },
        {
          field: { openTelemetryPullRequests: true },
          title: AUTO_REMEDIATION_MORE_FIELDS_COPY.telemetryTitle,
          description: AUTO_REMEDIATION_MORE_FIELDS_COPY.telemetryDescription,
          stepId: "remediation",
          collapsibleSection: moreFields,
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          // Its own line, not the column's (written for the API reference).
          hideColumnDescription: true,
          dataTestId: AUTO_REMEDIATION_PULL_REQUEST_TEST_IDS.telemetry,
          showIf: (values: FormValues<AutoRemediationRule>): boolean => {
            return doesEditedRuleFix(values);
          },
        },
        {
          field: { description: true },
          title: "Description",
          stepId: "remediation",
          fieldType: FormFieldSchemaType.LongText,
          required: false,
          // "Description of this AI rule." says nothing the title does not.
          hideColumnDescription: true,
          collapsibleSection: moreFields,
        },
      ]}
      showRefreshButton={true}
    />
  );
};

export default AiRulesTable;
