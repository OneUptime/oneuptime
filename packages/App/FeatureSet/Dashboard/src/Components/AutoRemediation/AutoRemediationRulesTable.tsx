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
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator, translateText } from "Common/UI/Utils/TranslateTemplate";
import { FOLDED_SECTION_ON } from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import AutoRemediationRule from "Common/Models/DatabaseModels/AutoRemediationRule";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import ExternalMcpServer from "Common/Models/DatabaseModels/ExternalMcpServer";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import AutoRemediationAction from "Common/Types/AutoRemediation/AutoRemediationAction";
import AutoRemediationExecutionMode from "Common/Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationTriggerEntity from "Common/Types/AutoRemediation/AutoRemediationTriggerEntity";
import {
  AutoRemediationFixKind,
  getRuleRunnerId,
} from "Common/Types/AutoRemediation/AutoRemediationFix";
import { getRunnerLiveStatusLabel } from "Common/Types/Runner/RunnerLiveStatus";
import { Blue, Green, Red, Yellow } from "Common/Types/BrandColors";
import useTranslator from "Common/UI/Utils/UseTranslator";
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
  AI_LANE_REMEDIATION_RULES_TABLE_ID,
  AI_LANE_RULE_CRITERIA_SUBJECTS,
  AI_LANE_RULES_COPY,
  AiLane,
  AiLaneAdvancedCard,
} from "../AISettings/ProjectAiSettingsCopy";
import { reportEnabledAiLaneRuleCount } from "../AISettings/AiLaneRuleCount";
import {
  AUTO_REMEDIATION_APPROVAL_FIELD_COPY,
  AUTO_REMEDIATION_APPROVAL_OPTIONS,
  AUTO_REMEDIATION_APPROVAL_TEXT,
  AUTO_REMEDIATION_FIX_WITH_TEXT,
  AUTO_REMEDIATION_MORE_FIELDS_COPY,
  AUTO_REMEDIATION_PULL_REQUEST_TEST_IDS,
  AutoRemediationFixWith,
  doesAutoRemediationRuleAskFirst,
  getAutoRemediationFixWith,
  getAutoRemediationFixWithText,
  getAutoRemediationMoreFieldsSummary,
  getEditedRuleFixKind,
  getOlderAutoRemediationRuleText,
  getValuesFixingLikeANewRule,
  hasRuleRunbooks,
  isOlderAutoRemediationRule,
  isRunbooksEveryTime,
} from "./AutoRemediationRuleCopy";
import {
  AutoRemediationRunnerPicker,
  OlderAutoRemediationRuleNote,
  RunbooksEveryTimeSwitch,
  useAutoRemediationRunnerChoices,
} from "./AutoRemediationRuleFields";
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

export interface ComponentProps {
  lane: AiLane;
  // How many enabled rules there are, after every read of the table.
  onRulesLoaded?: ((count: number) => void) | undefined;
}

export const AI_LANE_REMEDIATION_RULE_TRIGGER: Record<
  AiLane,
  AutoRemediationTriggerEntity
> = {
  [AiLane.Incident]: AutoRemediationTriggerEntity.Incident,
  [AiLane.Alert]: AutoRemediationTriggerEntity.Alert,
};

/*
 * Incidents (or Alerts) → Settings → AI → More settings → Auto remediation
 * rules: which new incidents are fixed while "Fix new incidents
 * automatically" is on. With no rule, OneUptime AI fixes every one; with
 * rules, only those that match at least one are fixed.
 *
 * A rule answers two questions, and that is all it asks up front:
 *
 *   - Which incidents? Its conditions.
 *   - Ask first? Whether a fix waits for someone to approve it.
 *
 * OneUptime AI fixes what it matches: through the AI agent on the cluster
 * or host it affects, and with one of the project's runbooks. The maintainer:
 * "Why should I pick between OneUptime AI and Runbook? Can OneUptime AI do
 * things by default, and I can whitelist some Runbook for AI to pick and
 * run?" So there is no "Fix With" choice any more. What most people never
 * change is folded under More fields (getAdvancedFormSection):
 *
 *   - Runbooks: the ones OneUptime AI may run; none picked is any runbook;
 *   - Run them every time: the rule starts every runbook it names for every
 *     match instead, without OneUptime AI deciding - what every rule saved
 *     with Fix With set to Runbooks keeps doing;
 *   - Runner: the one OneUptime AI runs the rule's Bash commands on - the
 *     project's default Runner for a new rule, when it has one - or none.
 *     Picking it is what lets OneUptime AI's commands run there - the
 *     Runner's own "Runs AI Remediation Commands" switch is gone. Commands
 *     on the affected cluster or host go through its AI agent whatever the
 *     rule picks, so that agent is not one of the choices;
 *   - MCP Servers and Code Repositories: the outside servers and the
 *     repositories OneUptime AI may use; none picked is all of them;
 *   - Fix pull requests and Telemetry pull requests: whether an
 *     investigation of a match opens one - on by default, as with no rule
 *     (Common/Types/AI/AutomaticFixPullRequests). They used to be two
 *     switches of the project, under "Fix new incidents automatically".
 *
 * What the old fields hold on a rule saved before rules were simplified is
 * kept and still used (AutoRemediationRuleEngineService): the form never
 * sends them, so editing a rule's name or conditions does not change how it
 * fixes. The table names those rules for what they still do, and such a
 * rule's Fix step says what it does - in place of the fields that do
 * nothing for it - with "Fix like a new rule" (OlderAutoRemediationRuleNote).
 */

export interface AutoRemediationRuleFixCellProps {
  rule: AutoRemediationRule;
}

/*
 * The table's Fix column: whether the rule asks first and, in a quiet line
 * under it, how it fixes - only for a rule that does not fix the way every
 * new rule does (its runbooks every time, or an older rule's one thing).
 * One column, so the table fits the card beside its row actions, with no
 * "OneUptime AI" on every row; the line wraps rather than widen the table.
 */
export const AutoRemediationRuleFixCell: FunctionComponent<
  AutoRemediationRuleFixCellProps
> = (props: AutoRemediationRuleFixCellProps): ReactElement => {
  const translator: Translator = useTranslator();
  const fixWith: string | null = getAutoRemediationFixWithText(props.rule);

  return (
    <div className="flex flex-col items-start gap-1">
      {doesAutoRemediationRuleAskFirst(props.rule) ? (
        <Pill color={Blue} text={AUTO_REMEDIATION_APPROVAL_TEXT.asksFirst} />
      ) : (
        <Pill
          color={Yellow}
          text={AUTO_REMEDIATION_APPROVAL_TEXT.withoutAsking}
        />
      )}
      {fixWith ? (
        <span
          className="whitespace-normal text-xs text-gray-500"
          data-testid="auto-remediation-rule-fixed-with"
        >
          {translator.translateText(fixWith)}
        </span>
      ) : (
        <></>
      )}
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

/*
 * The Fix step's More fields: one section, built once per table, for the
 * fields that follow one another at the end of the step (FormStepsScan
 * groups by it). Its summary names the default LLM provider first, from the
 * providers as the table last read them, then what the rest's defaults do.
 */
export function getAutoRemediationRuleMoreFields(
  getLlmProviderChoices: () => RuleLlmProviderChoices | null,
): FormFieldCollapsibleSection<AutoRemediationRule> {
  return getAdvancedFormSection<AutoRemediationRule>({
    getSummary: (
      values: FormValues<AutoRemediationRule>,
    ): Array<string> | undefined => {
      return withRuleLlmProviderSummary(
        getAutoRemediationMoreFieldsSummary(values),
        values,
        // A rule that runs its runbooks every time uses no AI to name.
        isRunbooksEveryTime(values) ? null : getLlmProviderChoices(),
      );
    },
  });
}

/*
 * What a rule saves for its Fix With: the form always says, so a rule that
 * names runbooks is never taken for one that runs them every time by the
 * server's reading of an older API client's create
 * (AutoRemediationRuleService.getRemediationActionOnCreate). A rule that
 * runs its runbooks every time picks no Runner: OneUptime AI composes no
 * commands for it.
 */
export function prepareAutoRemediationRuleSave(
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

const AutoRemediationRulesTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isIncident: boolean = props.lane === AiLane.Incident;
  const triggerEntityType: AutoRemediationTriggerEntity =
    AI_LANE_REMEDIATION_RULE_TRIGGER[props.lane];

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
      return getAutoRemediationRuleMoreFields(
        (): RuleLlmProviderChoices | null => {
          return llmProviderChoicesRef.current;
        },
      );
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
      id={AI_LANE_REMEDIATION_RULES_TABLE_ID[props.lane]}
      name="Settings > AI > Auto Remediation Rules"
      userPreferencesKey={AI_LANE_REMEDIATION_RULES_TABLE_ID[props.lane]}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      // "All incidents" or "Only incidents that match conditions".
      ruleCriteriaSubject={AI_LANE_RULE_CRITERIA_SUBJECTS[props.lane]}
      query={{ triggerEntityType: triggerEntityType }}
      onBeforeCreate={async (item: AutoRemediationRule) => {
        item.triggerEntityType = triggerEntityType;
        return prepareAutoRemediationRuleSave(item);
      }}
      onBeforeUpdate={async (item: AutoRemediationRule) => {
        return prepareAutoRemediationRuleSave(item);
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
          AI_LANE_ADVANCED_CARD_TITLES[props.lane][
            AiLaneAdvancedCard.RemediationRules
          ],
        description: AI_LANE_RULES_COPY[props.lane].remediationRulesDescription,
      }}
      noItemsMessage={
        isIncident
          ? "No rules. Every new incident is fixed while fixing is on."
          : "No rules. Every new alert is fixed while fixing is on."
      }
      sortBy="name"
      sortOrder={SortOrder.Ascending}
      selectMoreFields={{
        isEnabled: true,
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
        { field: { name: true }, title: "Name", type: FieldType.Text },
        {
          field: { executionMode: true },
          title: "Fix",
          type: FieldType.Text,
          getElement: (item: AutoRemediationRule): ReactElement => {
            return <AutoRemediationRuleFixCell rule={item} />;
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
        { title: "Rule", id: "basic-info" },
        { title: "Conditions", id: "match-criteria" },
        { title: "Fix", id: "remediation" },
      ]}
      formFields={[
        {
          field: { name: true },
          title: "Name",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "Restart API pods on high error rate",
          validation: { minLength: 2 },
        },
        {
          field: { isEnabled: true },
          title: "Enabled",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.Toggle,
          // A rule starts on: the switch is on its edit form only.
          doNotShowWhenCreating: true,
          required: false,
        },
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
         * The two flags a rule saved before rules were simplified holds,
         * never drawn: registered so an older rule's edit reads them, says
         * what the rule does, and can clear them (Fix like a new rule).
         */
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
          showIf: isOlderAutoRemediationRule,
          onChange: (
            _value: unknown,
            currentValues: FormValues<AutoRemediationRule>,
            setNewFormValues: (values: FormValues<AutoRemediationRule>) => void,
          ): void => {
            setNewFormValues(getValuesFixingLikeANewRule(currentValues));
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
              />
            );
          },
        },
        {
          // Ask first: the one question the Fix step asks up front.
          field: { executionMode: true },
          title: AUTO_REMEDIATION_APPROVAL_FIELD_COPY.title,
          description: AUTO_REMEDIATION_APPROVAL_FIELD_COPY.description,
          stepId: "remediation",
          fieldType: FormFieldSchemaType.CardSelect,
          cardSelectSingleColumn: true,
          cardSelectOptions: AUTO_REMEDIATION_APPROVAL_OPTIONS,
          required: true,
          defaultValue: AutoRemediationExecutionMode.Suggest,
          dataTestId: "auto-remediation-approval-field",
          // An older rule that picks a runbook always asks first: not a choice.
          showIf: (values: FormValues<AutoRemediationRule>): boolean => {
            return !isEditingOlderRuleOfKind(
              values,
              AutoRemediationFixKind.AiPicksRunbook,
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
          required: isRunbooksEveryTime,
          // Empty is an answer of its own - any runbook - not "(Optional)".
          hideOptionalLabel: true,
          placeholder: AUTO_REMEDIATION_MORE_FIELDS_COPY.runbooksPlaceholder,
          dataTestId: "auto-remediation-runbooks-field",
          // An older rule that composes commands runs no runbook.
          showIf: (values: FormValues<AutoRemediationRule>): boolean => {
            return !isEditingOlderRuleOfKind(
              values,
              AutoRemediationFixKind.CommandsOnRunners,
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
           * them; an older rule does what its note says until it is made
           * to fix like a new rule.
           */
          showIf: (values: FormValues<AutoRemediationRule>): boolean => {
            return (
              (hasRuleRunbooks(values) || isRunbooksEveryTime(values)) &&
              !isOlderAutoRemediationRule(values)
            );
          },
          getFoldedValue: (
            values: FormValues<AutoRemediationRule>,
          ): string | null => {
            return isRunbooksEveryTime(values)
              ? translateText(FOLDED_SECTION_ON) || FOLDED_SECTION_ON
              : null;
          },
          /*
           * Named on the folded line only while on ("Run them every time:
           * On"): named while off, beside the set fields, it read as on.
           */
          isListedWhileFolded: isRunbooksEveryTime,
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
        /*
         * The LLM provider OneUptime AI fixes with - its runbook picks, its
         * commands, its MCP fixes and the rule's pull requests: none is the
         * default. Not for a rule that runs its runbooks every time: no AI
         * decides anything for it. After the switch that turns AI off, never
         * first in More fields: the fold keeps its place (open or not) by its
         * first field, and this one comes and goes with the switch.
         */
        getRuleLlmProviderFormField<AutoRemediationRule>({
          stepId: "remediation",
          collapsibleSection: moreFields,
          dataTestId: "auto-remediation-llm-provider-field",
          getChoices: (): RuleLlmProviderChoices | null => {
            return llmProviderChoicesRef.current;
          },
          showIf: (values: FormValues<AutoRemediationRule>): boolean => {
            return !isRunbooksEveryTime(values);
          },
        }),
        {
          /*
           * Where OneUptime AI runs the rule's Bash commands: the project's
           * default Runner for a new rule, or none.
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
          getFoldedValue: getRunnerFoldedValue,
          /*
           * A rule that runs its runbooks every time composes no commands,
           * nor does an older rule that picks a runbook.
           */
          showIf: (values: FormValues<AutoRemediationRule>): boolean => {
            return (
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
                onChange={(runnerId: string | null): void => {
                  elementProps.onChange?.(runnerId);
                }}
              />
            );
          },
        },
        {
          /*
           * The MCP servers OneUptime AI may fix through: none picked is all
           * of them, and their changes always wait for approval - picking
           * some is what lets "Fix without asking" use them.
           */
          field: { externalMcpServers: true },
          title: RULE_MCP_SERVERS_FIELD_COPY.title,
          description: RULE_MCP_SERVERS_FIELD_COPY.remediationDescription,
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
           * A rule that runs its runbooks every time fixes through nothing
           * else, nor does an older rule until it fixes like a new one.
           */
          showIf: (values: FormValues<AutoRemediationRule>): boolean => {
            return (
              !isRunbooksEveryTime(values) &&
              !isOlderAutoRemediationRule(values)
            );
          },
          getFooterElement: (): ReactElement => {
            return <RuleMcpServersFieldHint />;
          },
        },
        {
          /*
           * The code repositories OneUptime AI may read while it fixes, and
           * open the rule's pull requests in: none picked is every connected
           * repository. Every rule has them: the pull requests below are.
           */
          field: { codeRepositories: true },
          title: RULE_CODE_REPOSITORIES_FIELD_COPY.title,
          description: RULE_CODE_REPOSITORIES_FIELD_COPY.remediationDescription,
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
        /*
         * The two pull requests an investigation of a match can lead to,
         * each a switch, on by default - the project's AI settings page held
         * them until they moved here.
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
        },
      ]}
      showRefreshButton={true}
    />
  );
};

export {
  AUTO_REMEDIATION_APPROVAL_OPTIONS,
  AUTO_REMEDIATION_APPROVAL_TEXT,
  AUTO_REMEDIATION_FIX_WITH_TEXT,
  AutoRemediationFixWith,
  doesAutoRemediationRuleAskFirst,
  getAutoRemediationFixWith,
  isRunbooksEveryTime,
};

export default AutoRemediationRulesTable;
