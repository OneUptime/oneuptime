import AutoRemediationRule from "Common/Models/DatabaseModels/AutoRemediationRule";
import ExternalMcpServer from "Common/Models/DatabaseModels/ExternalMcpServer";
import Label from "Common/Models/DatabaseModels/Label";
import Service from "Common/Models/DatabaseModels/Service";
import {
  AiRuleFix,
  getAiRuleFix,
  getAiRuleFixColumns,
  isAiRuleFix,
} from "Common/Types/AI/AiRule";
import {
  TELEMETRY_AI_LANES,
  TelemetryAiLane,
  getTelemetryAiDefaultWaitMinutes,
} from "Common/Types/AI/TelemetryAi";
import AutoRemediationAction from "Common/Types/AutoRemediation/AutoRemediationAction";
import AutoRemediationTriggerEntity from "Common/Types/AutoRemediation/AutoRemediationTriggerEntity";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Blue, Gray500, Green, Red, Yellow } from "Common/Types/BrandColors";
import {
  CustomElementProps,
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import { RadioButton } from "Common/UI/Components/RadioButtons/GroupRadioButtons";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
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
import { reportEnabledAiLaneRuleCount } from "../AISettings/AiLaneRuleCount";
import {
  AI_RULE_COLUMN_TITLE,
  AI_RULE_FIX_FIELD_COPY,
  AI_RULE_FIX_FIELD_KEY,
  AI_RULE_FIX_TEXT,
  AI_RULE_TEST_IDS,
  doesEditedRuleInvestigate,
  getEditedRuleFix,
  prepareAiRuleCreate,
  validateAiRuleFix,
} from "../AISettings/AiRuleCopy";
import {
  INVESTIGATION_RULE_NAME_COLUMN_CLASS_NAME,
  INVESTIGATION_RULE_TIMING_COLUMN_CLASS_NAME,
  INVESTIGATION_RULE_TIMING_COLUMN_FLOOR_CLASS_NAME,
  INVESTIGATION_RULE_TIMING_FIELD_KEY,
  INVESTIGATION_RULE_TIMING_FIELD_TITLE,
  INVESTIGATION_RULE_TIMINGS,
  INVESTIGATION_RULE_WAIT_FIELD_TITLE,
  InvestigationRuleTiming,
  getInvestigationRuleTiming,
  getValuesForInvestigationRuleTiming,
  isInvestigationRuleTiming,
  isWaitChosen,
  validateInvestigationRuleWait,
} from "../AISettings/InvestigationRuleTiming";
import {
  RULE_CODE_REPOSITORIES_FIELD_COPY,
  getRuleCodeRepositoriesFoldedValue,
} from "../Code/RuleCodeRepositoriesCopy";
import {
  RuleCodeRepositoriesFieldHint,
  RuleCodeRepositoriesPicker,
} from "../Code/RuleCodeRepositoriesField";
import {
  RULE_MCP_SERVERS_FIELD_COPY,
  getInvestigationRuleMoreFieldsSummary,
} from "../ExternalMcpServer/ExternalMcpServerCopy";
import RuleMcpServersFieldHint from "../ExternalMcpServer/RuleMcpServersFieldHint";
import {
  RULE_ENABLED_DESCRIPTION,
  RULE_NAME_MAX_LENGTH,
} from "../../Utils/Form/ResourceRuleForm";
import {
  TELEMETRY_AI_LANE_COPY,
  TELEMETRY_AI_RULES_CARD_TITLE,
  TELEMETRY_AI_RUNNER_HINT,
  TELEMETRY_AI_TEST_IDS,
  TelemetryAiLaneCopy,
  describeTelemetryAiRuleTiming,
  getTelemetryAiFixOptions,
  getTelemetryAiRulesTableId,
} from "./TelemetryAiCopy";

/*
 * A telemetry product's AI → Settings → More settings → AI rules: which
 * services' problems OneUptime AI works on, and what it does with each - in
 * the one shape every AI rule has (Common/Types/AI/AiRule), on the one AI
 * rule model, AutoRemediationRule, with the lane's triggerEntityType:
 *
 *   - Match: which services (one conditions builder, on "All services"):
 *     the services picked, their labels, a pattern on their names;
 *   - Investigate: right away, or only if the problem is still found after
 *     a wait - OneUptime AI's read-only look, written onto the finding;
 *   - Fix: don't fix, ask before fixing (the finding offers the pull
 *     request), or fix without asking (OneUptime AI opens it) - and the
 *     rule's name. Folded under More fields, in the order every AI rule
 *     has them: the code repositories it may read and open pull requests
 *     in, the MCP servers it may use, the LLM provider, the description.
 *
 * There is no Runner field: the code is changed on the Runner each
 * repository picks in Code, the only Runner that is ever handed it
 * (Common/Types/Runner/CodeRepositoryRunner) - the field's line says so.
 * Nor runbooks: a telemetry problem is fixed in the code. With no rule, the
 * lane's switch alone decides: everything is investigated right away and
 * fixed without asking, in any connected repository.
 */

export interface ComponentProps {
  lane: TelemetryAiLane;
  // How many enabled rules there are, after every read of the table.
  onRulesLoaded?: ((count: number) => void) | undefined;
}

export interface TelemetryAiRuleDoesCellProps {
  rule: AutoRemediationRule;
}

/*
 * The table's one column for what a rule does (AI_RULE_COLUMN_TITLE): when
 * it looks into a problem, and under it whether and how it fixes it.
 */
export const TelemetryAiRuleDoesCell: FunctionComponent<
  TelemetryAiRuleDoesCellProps
> = (props: TelemetryAiRuleDoesCellProps): ReactElement => {
  const fix: AiRuleFix = getAiRuleFix(props.rule);

  return (
    <div className="flex flex-col items-start gap-1.5">
      <span data-testid={AI_RULE_TEST_IDS.timingColumn}>
        {describeTelemetryAiRuleTiming(props.rule.onlyIfOpenAfterMinutes)}
      </span>
      <div data-testid={AI_RULE_TEST_IDS.fixColumn}>
        <Pill
          color={
            fix === AiRuleFix.DoNotFix
              ? Gray500
              : fix === AiRuleFix.WithoutAsking
                ? Yellow
                : Blue
          }
          text={AI_RULE_FIX_TEXT[fix]}
          isWrapping={true}
        />
      </div>
    </div>
  );
};

/*
 * What the column says, as one line of an export: "Right away · Asks
 * before fixing".
 */
export function getTelemetryAiRuleDoesText(
  rule: AutoRemediationRule,
  translator: Translator,
): string {
  return `${describeTelemetryAiRuleTiming(rule.onlyIfOpenAfterMinutes)} · ${translator.translateText(
    AI_RULE_FIX_TEXT[getAiRuleFix(rule)],
  )}`;
}

// When to look into a problem: the two answers, each with its line.
export function getTelemetryAiTimingChoices(
  lane: TelemetryAiLane,
): Array<RadioButton> {
  const copy: TelemetryAiLaneCopy = TELEMETRY_AI_LANE_COPY[lane];

  return INVESTIGATION_RULE_TIMINGS.map(
    (timing: InvestigationRuleTiming): RadioButton => {
      return {
        value: timing,
        title: copy.timing[timing].title,
        description: copy.timing[timing].description,
      };
    },
  );
}

/*
 * What a telemetry rule saves: it always investigates, its Fix answer is
 * written into the two columns the server reads, and it is an AI rule of
 * the lane - never one that runs runbooks or picks a Runner.
 */
export function prepareTelemetryAiRule(
  item: AutoRemediationRule,
  lane: TelemetryAiLane,
): AutoRemediationRule {
  prepareAiRuleCreate(item);
  item.triggerEntityType = TELEMETRY_AI_LANES[lane]
    .triggerEntityType as AutoRemediationTriggerEntity;
  item.remediationAction = AutoRemediationAction.OneUptimeAI;
  (item as unknown as { runnerId: null }).runnerId = null;

  return item;
}

/*
 * What an edit saves: its Fix answer in both columns, as a create does,
 * and still an AI rule of the lane.
 */
export function prepareTelemetryAiRuleUpdate(
  item: AutoRemediationRule,
): AutoRemediationRule {
  const columns: ReturnType<typeof getAiRuleFixColumns> = getAiRuleFixColumns(
    getAiRuleFix(item),
    item.executionMode,
  );
  item.fixes = columns.fixes;
  item.executionMode = columns.executionMode;

  return item;
}

const TelemetryAiRulesTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const copy: TelemetryAiLaneCopy = TELEMETRY_AI_LANE_COPY[props.lane];
  const triggerEntityType: AutoRemediationTriggerEntity = TELEMETRY_AI_LANES[
    props.lane
  ].triggerEntityType as AutoRemediationTriggerEntity;
  const tableId: string = getTelemetryAiRulesTableId(props.lane);

  /*
   * The project's LLM providers, for the folded line to name a rule's
   * provider - or the default one - by. Read through a ref: a form may hold
   * on to the fields it was opened with.
   */
  const llmProviderChoices: RuleLlmProviderChoices | null =
    useRuleLlmProviderChoices();
  const llmProviderChoicesRef: MutableRefObject<RuleLlmProviderChoices | null> =
    useRef<RuleLlmProviderChoices | null>(llmProviderChoices);
  llmProviderChoicesRef.current = llmProviderChoices;

  /*
   * The Fix step's More fields: its folded line names the default LLM
   * provider, then what the repositories' and MCP servers' defaults do.
   */
  const moreFields: FormFieldCollapsibleSection<AutoRemediationRule> =
    useMemo(() => {
      return getAdvancedFormSection<AutoRemediationRule>({
        getSummary: (
          values: FormValues<AutoRemediationRule>,
        ): Array<string> | undefined => {
          return withRuleLlmProviderSummary(
            getInvestigationRuleMoreFieldsSummary(values),
            values,
            llmProviderChoicesRef.current,
          );
        },
      });
    }, []);

  return (
    <ModelTable<AutoRemediationRule>
      // Enable or Disable in each row's ⋯ menu: the one that changes the row.
      rowSwitch={{ column: "isEnabled" }}
      modelType={AutoRemediationRule}
      id={tableId}
      name="Settings > AI > AI Rules"
      userPreferencesKey={tableId}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      // "All services" or "Only services that match conditions".
      ruleCriteriaSubject={copy.ruleCriteriaSubject}
      query={{ triggerEntityType: triggerEntityType }}
      onBeforeCreate={async (item: AutoRemediationRule) => {
        return prepareTelemetryAiRule(item, props.lane);
      }}
      onBeforeUpdate={async (item: AutoRemediationRule) => {
        return prepareTelemetryAiRuleUpdate(item);
      }}
      onFetchSuccess={() => {
        void reportEnabledAiLaneRuleCount<AutoRemediationRule>({
          modelType: AutoRemediationRule,
          triggerEntityType: triggerEntityType,
          onRulesLoaded: props.onRulesLoaded,
        });
      }}
      cardProps={{
        title: TELEMETRY_AI_RULES_CARD_TITLE,
        description: copy.rulesCardDescription,
      }}
      noItemsMessage={copy.noRulesMessage}
      sortBy="name"
      sortOrder={SortOrder.Ascending}
      selectMoreFields={{
        isEnabled: true,
        investigates: true,
        fixes: true,
        executionMode: true,
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
          wrapContent: true,
          contentClassName: INVESTIGATION_RULE_NAME_COLUMN_CLASS_NAME,
        },
        {
          // When it looks into a problem, and under it how it fixes it.
          field: { onlyIfOpenAfterMinutes: true },
          title: AI_RULE_COLUMN_TITLE,
          type: FieldType.Element,
          disableSort: true,
          wrapContent: true,
          wrapMaxWidthClassName: INVESTIGATION_RULE_TIMING_COLUMN_CLASS_NAME,
          contentClassName: INVESTIGATION_RULE_TIMING_COLUMN_FLOOR_CLASS_NAME,
          getElement: (item: AutoRemediationRule): ReactElement => {
            return <TelemetryAiRuleDoesCell rule={item} />;
          },
          getExportValue: (item: AutoRemediationRule): string => {
            return getTelemetryAiRuleDoesText(item, translator);
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
        // Match: drawn as one conditions builder, on "All services".
        {
          field: { services: true },
          title: "Services",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Service,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          hideColumnDescription: true,
          placeholder: "Select Services (optional)",
        },
        {
          field: { serviceLabels: true },
          title: "Service Labels",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          hideColumnDescription: true,
          placeholder: "Select Service Labels (optional)",
        },
        {
          field: { serviceNamePattern: true },
          title: "Service Name",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          hideColumnDescription: true,
          placeholder: "checkout|payments",
        },
        /*
         * Investigate. Every rule made here does (prepareTelemetryAiRule);
         * the column is registered so an edit reads it, and never drawn.
         */
        {
          field: { investigates: true },
          title: "Investigates",
          stepId: "investigate",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          defaultValue: true,
          hideColumnDescription: true,
          showIf: (): boolean => {
            return false;
          },
        },
        /*
         * When: right away, or only if the problem is still found after a
         * wait. Form-only: it starts on the answer the rule's wait makes,
         * and a pick writes the wait.
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
          radioButtonOptions: getTelemetryAiTimingChoices(props.lane),
          required: true,
          hideColumnDescription: true,
          dataTestId: AI_RULE_TEST_IDS.timingField,
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
                // One look of the lane: found again on its next look.
                defaultWaitMinutes: getTelemetryAiDefaultWaitMinutes(
                  props.lane,
                ),
              }),
            );
          },
        },
        {
          field: { onlyIfOpenAfterMinutes: true },
          title: INVESTIGATION_RULE_WAIT_FIELD_TITLE,
          description: copy.waitDescription,
          stepId: "investigate",
          fieldType: FormFieldSchemaType.Number,
          required: false,
          hideOptionalLabel: true,
          placeholder: "60",
          dataTestId: "telemetry-ai-rule-wait-minutes",
          showIf: (values: FormValues<AutoRemediationRule>): boolean => {
            return doesEditedRuleInvestigate(values) && isWaitChosen(values);
          },
          customValidation: (
            values: FormValues<AutoRemediationRule>,
          ): string | null => {
            return validateInvestigationRuleWait(values);
          },
        },
        /*
         * Fix. The rule's two columns behind its one question, never drawn:
         * registered so the edit reads them and the save sends what the
         * answer wrote.
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
          /*
           * The Fix step's one question, in pull requests: don't open one,
           * let the finding offer it, or open it without asking.
           */
          overrideField: { fixes: true },
          overrideFieldKey: AI_RULE_FIX_FIELD_KEY,
          formOnly: true,
          title: AI_RULE_FIX_FIELD_COPY.title,
          description: AI_RULE_FIX_FIELD_COPY.description,
          stepId: "remediation",
          fieldType: FormFieldSchemaType.CardSelect,
          cardSelectSingleColumn: true,
          cardSelectOptions: getTelemetryAiFixOptions(props.lane),
          required: true,
          dataTestId: AI_RULE_TEST_IDS.fixField,
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
          hideColumnDescription: true,
          placeholder: copy.ruleNamePlaceholder,
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
          doNotShowWhenCreating: true,
          required: false,
        },
        {
          /*
           * The repositories OneUptime AI may read while it looks into a
           * problem, and open the rule's pull requests in: none picked is
           * every connected repository. First under More fields, as on
           * every AI rule.
           */
          field: { codeRepositories: true },
          title: RULE_CODE_REPOSITORIES_FIELD_COPY.title,
          description: RULE_CODE_REPOSITORIES_FIELD_COPY.aiRuleDescription,
          stepId: "remediation",
          collapsibleSection: moreFields,
          fieldType: FormFieldSchemaType.CustomComponent,
          required: false,
          hideOptionalLabel: true,
          hideColumnDescription: true,
          dataTestId: "telemetry-ai-rule-code-repositories-field",
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
            // Where repositories are connected, then whose Runner works in them.
            return (
              <RuleCodeRepositoriesFieldHint
                extra={
                  <span data-testid={TELEMETRY_AI_TEST_IDS.runnerHint}>
                    {translator.translateText(TELEMETRY_AI_RUNNER_HINT)}
                  </span>
                }
              />
            );
          },
        },
        {
          // The MCP servers OneUptime AI may use: none picked is all of them.
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
          hideOptionalLabel: true,
          hideColumnDescription: true,
          placeholder: RULE_MCP_SERVERS_FIELD_COPY.placeholder,
          dataTestId: "telemetry-ai-rule-mcp-servers-field",
          getFooterElement: (): ReactElement => {
            return <RuleMcpServersFieldHint />;
          },
        },
        // The LLM provider for everything the rule starts: none is the default.
        getRuleLlmProviderFormField<AutoRemediationRule>({
          stepId: "remediation",
          collapsibleSection: moreFields,
          dataTestId: "telemetry-ai-rule-llm-provider-field",
          getChoices: (): RuleLlmProviderChoices | null => {
            return llmProviderChoicesRef.current;
          },
        }),
        {
          field: { description: true },
          title: "Description",
          stepId: "remediation",
          fieldType: FormFieldSchemaType.LongText,
          required: false,
          hideColumnDescription: true,
          collapsibleSection: moreFields,
        },
      ]}
      showRefreshButton={true}
    />
  );
};

export default TelemetryAiRulesTable;
