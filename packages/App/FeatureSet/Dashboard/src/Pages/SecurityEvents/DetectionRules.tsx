import PageComponentProps from "../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import {
  SwitchActionsResult,
  useSwitchActions,
} from "Common/UI/Components/BulkUpdate/BulkSwitchActions";
import FieldType from "Common/UI/Components/Types/FieldType";
import Pill from "Common/UI/Components/Pill/Pill";
import DetectionRule from "Common/Models/DatabaseModels/DetectionRule";
import {
  DETECTION_MATCH_COUNT_THRESHOLD_MAX,
  DETECTION_MATCH_COUNT_THRESHOLD_MIN,
} from "Common/Types/SecurityEvent/DetectionFindingConstants";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import {
  FieldFooterProps,
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import DetectionRuleAiDraft from "../../Components/SecurityEvents/DetectionRuleAiDraft";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import {
  DETECTION_RULE_MATCH_WORDING,
  getSecurityMatchActionFields,
  getSecurityMatchFindingField,
} from "../../Components/SecurityEvents/SecurityMatchActionFields";
import {
  DETECTION_RULE_NAME_DESCRIPTION,
  getDetectionRuleNameAfterYamlChange,
} from "../../Components/SecurityEvents/SecurityMatchRaises";
import {
  SecurityDetectionStatus,
  getDetectionRuleMessages,
  getDetectionRuleStatus,
} from "../../Components/SecurityEvents/SecurityDetectionStatus";
import {
  SecurityDetectionErrors,
  getViewErrorActionButton,
  useSecurityDetectionErrors,
} from "../../Components/SecurityEvents/SecurityDetectionErrorModal";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { ActionButtonPlacement } from "Common/UI/Components/ActionButton/ActionButtonSchema";
import IconProp from "Common/Types/Icon/IconProp";
import Route from "Common/Types/API/Route";
import Navigation from "Common/UI/Utils/Navigation";
import { VoidFunction } from "Common/Types/FunctionTypes";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import SecurityEventsHowItWorksCard from "../../Components/SecurityEvents/HowItWorks/SecurityEventsHowItWorksCard";
import DetectionRuleSummary, {
  DetectionRuleTypeLabel,
} from "../../Components/SecurityEvents/DetectionRuleSummary";
import {
  DetectionRuleShape,
  readDetectionRuleShape,
} from "../../Components/SecurityEvents/DetectionRuleShape";
import DetectionRulesGuide from "../../Components/SecurityEvents/HowItWorks/DetectionRulesGuide";
import RelativeTimeCell from "../../Components/SecurityEvents/RelativeTimeCell";
import { guideToMarkdown } from "../../Components/SecurityEvents/HowItWorks/SecurityEventsGuide";
import {
  RISK_POINTS_FIELD_DESCRIPTION,
  RISK_POINTS_FIELD_TITLE,
} from "../../Components/SecurityEvents/EntityRisk/EntityRiskCopy";
import {
  ENTITY_RISK_POINTS_MAX,
  ENTITY_RISK_POINTS_MIN,
} from "Common/Types/SecurityCase/SecurityEntityRisk";
import {
  DETECTION_RULES_EMPTY_DESCRIPTION,
  DETECTION_RULES_EMPTY_TITLE,
  OPEN_RULE_LIBRARY,
} from "../../Components/SecurityEvents/SecurityDetectionsCopy";
import SecurityListNameCell, {
  SECURITY_LIST_NAME_COLUMN_MAX_WIDTH_CLASS_NAME,
} from "../../Components/SecurityEvents/SecurityListNameCell";
import DetectionRuleRetrohuntInForm from "../../Components/SecurityEvents/Retrohunt/DetectionRuleRetrohuntInForm";
import DetectionRuleWatchlists from "../../Components/SecurityEvents/Watchlists/DetectionRuleWatchlists";
import DetectionRuleRetrohuntModal from "../../Components/SecurityEvents/Retrohunt/DetectionRuleRetrohuntModal";
import { RUN_ON_PAST_EVENTS } from "../../Components/SecurityEvents/Retrohunt/RetrohuntCopy";
import AddRuleExceptionModal from "../../Components/SecurityEvents/RuleExceptions/AddRuleExceptionModal";
import {
  ACTIVE_EXCEPTION_COUNT,
  ADD_EXCEPTION_ACTION,
  ADD_EXCEPTION_DESCRIPTION,
  RULE_EXCEPTIONS_TEST_IDS,
  VIEW_EXCEPTIONS_ACTION,
} from "../../Components/SecurityEvents/RuleExceptions/RuleExceptionsCopy";
import { getRuleExceptionsRoute } from "../../Components/SecurityEvents/RuleExceptions/RuleExceptionsRoute";
import useActiveRuleExceptionCounts, {
  ActiveRuleExceptionCounts,
} from "../../Components/SecurityEvents/RuleExceptions/useActiveRuleExceptionCounts";
import DetectionRuleException from "Common/Models/DatabaseModels/DetectionRuleException";
import Link from "Common/UI/Components/Link/Link";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * How often a new rule runs, as the form starts it: the
 * evaluationIntervalInMinutes of createInitialValues below, written out
 * there as the literal the docs facts read (the column's own default, for
 * a rule made through the API, is a minute).
 */
const DETECTION_RULE_FORM_EVALUATION_INTERVAL_IN_MINUTES: number = 5;

/*
 * The row menu's run of tuning actions - Run on Past Events, Add Exception,
 * View Exceptions - set apart from Create Monitor, Edit and Delete.
 */
export const DETECTION_RULE_TUNING_MENU_GROUP: string = "tuning";

// The line of quiet tools under the form's YAML: Draft with AI, Run on Past Events.
export const DETECTION_RULE_YAML_TOOLS_TEST_ID: string =
  "detection-rule-yaml-tools";

/*
 * The description, the detection finding and how matches are counted:
 * folded under More fields on their steps.
 */
const advancedSection: FormFieldCollapsibleSection<DetectionRule> =
  getAdvancedFormSection<DetectionRule>();

// Whether the form's rule checks each event as it arrives (a switch Postgres may hand back as "true").
export function runsInRealTime(values: FormValues<DetectionRule>): boolean {
  const value: unknown = (values as unknown as { isRealTime?: unknown })
    .isRealTime;

  return value === true || value === "true";
}

/*
 * A single Sigma rule counts its matches by the form's Group By Field,
 * Distinct Count Field and Match Count Threshold; a correlation says how it
 * counts in its own YAML, so the form leaves those three out for it.
 */
export function countsByFormFields(values: FormValues<DetectionRule>): boolean {
  const shape: DetectionRuleShape | null = readDetectionRuleShape(
    values.sigmaRuleYaml,
  );

  return !shape || !shape.isCorrelation;
}

const DetectionRulesPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  /*
   * A rule's last message in full, from its row's View Error. A hook: it
   * runs before the reseller gate below can return early.
   */
  const ruleErrors: SecurityDetectionErrors<DetectionRule> =
    useSecurityDetectionErrors<DetectionRule>(getDetectionRuleMessages);

  /*
   * How many rules the project has, as the table first reads them: the
   * how-it-works card opens by itself only on an empty list. A hook too.
   */
  const [ruleCount, setRuleCount] = useState<number | null>(null);

  /*
   * Enable and Disable in Bulk Actions (a hook too, so above the gate):
   * tuning a project's detections is turning sets of rules on and off -
   * the noisy ones after a burst, a library's worth added at once.
   */
  const {
    bulkActions: switchBulkActions,
    rowActions: switchRowActions,
  }: SwitchActionsResult<DetectionRule> = useSwitchActions<DetectionRule>({
    modelType: DetectionRule,
    column: "isEnabled",
  });

  const translator: Translator = useTranslator();

  /*
   * How many of each rule's exceptions skip something now, for the line
   * under its name: a rule with blind spots says so where its name is.
   */
  const exceptionCounts: ActiveRuleExceptionCounts =
    useActiveRuleExceptionCounts(ProjectUtil.getCurrentProjectId());

  // The rule whose Run on Past Events or Add Exception is open, from its row.
  const [retrohuntRule, setRetrohuntRule] = useState<DetectionRule | null>(
    null,
  );
  const [exceptionRule, setExceptionRule] = useState<DetectionRule | null>(
    null,
  );

  /*
   * Same reseller-telemetry gate as every other Security Events page —
   * detection rules run over telemetry-billed security events, so a plan
   * without telemetry features has nothing for them to evaluate.
   */
  const disableTelemetryForThisProject: boolean =
    props.currentProject?.reseller?.enableTelemetryFeatures === false;

  if (disableTelemetryForThisProject) {
    return (
      <ErrorMessage message="Looks like you have bought this plan from a reseller. It did not include telemetry features in your plan. Telemetry features are disabled for this project." />
    );
  }

  /*
   * The row action deep-links into the monitor create wizard, which
   * ModelTable's own permission gating never sees — so gate it here the
   * way MonitorTable gates its create button (issue #3306): a member who
   * cannot create monitors gets a disabled button that says why, not a
   * wizard that refuses at submit.
   */
  const monitorCreateGate: PermissionGateResult = PermissionGate.check(
    new Monitor(),
    ModelAction.Create,
  );

  /*
   * Add Exception opens the exception form over the list, which ModelTable
   * never gates: a member who may not add exceptions gets a disabled item
   * that says why.
   */
  const exceptionCreateGate: PermissionGateResult = PermissionGate.check(
    new DetectionRuleException(),
    ModelAction.Create,
  );

  return (
    /*
     * The page's own vertical rhythm: without it the How-it-works card and
     * the table under it sit flush against each other.
     */
    <div className="space-y-6">
      <SecurityEventsHowItWorksCard
        guide={DetectionRulesGuide}
        listItemCount={ruleCount}
      />

      <ModelTable<DetectionRule>
        modelType={DetectionRule}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        id="detection-rules-table"
        name="Security Events > Detection Rules"
        userPreferencesKey="detection-rules-table"
        isDeleteable={true}
        bulkActions={{
          buttons: [...switchBulkActions],
        }}
        isEditable={true}
        isCreateable={true}
        isViewable={false}
        createEditModalWidth={ModalWidth.Large}
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        cardProps={{
          title: "Detection Rules",
          description:
            "Sigma rules run on a schedule against your security events. A matching rule can raise an alert and open a case.",
        }}
        helpContent={{
          title: DetectionRulesGuide.guideTitle,
          description: DetectionRulesGuide.guideDescription,
          markdown: guideToMarkdown(DetectionRulesGuide),
        }}
        onFetchSuccess={(_rules: Array<DetectionRule>, total: number) => {
          // The first read decides the card; a search or filter after it does not.
          setRuleCount((count: number | null): number => {
            return count === null ? total : count;
          });
        }}
        /*
         * A project with no rule is one click from the ready-made ones: the
         * Rule Library, beside writing one in Sigma.
         */
        emptyState={{
          title: DETECTION_RULES_EMPTY_TITLE,
          description: DETECTION_RULES_EMPTY_DESCRIPTION,
          actions: [
            {
              title: OPEN_RULE_LIBRARY,
              icon: IconProp.SquareStack3D,
              dataTestId: "detection-rules-open-rule-library",
              onClick: (): void => {
                Navigation.navigate(
                  RouteUtil.populateRouteParams(
                    RouteMap[PageMap.SECURITY_EVENTS_RULE_LIBRARY] as Route,
                  ),
                );
              },
            },
          ],
        }}
        createInitialValues={{
          isEnabled: true,
          isRealTime: false,
          evaluationIntervalInMinutes: 5,
          /*
           * Mirror the DB defaults (DetectionRule.ts): without these the
           * severity dropdowns' showIf sees undefined on a fresh create
           * form and hides fields whose toggles are actually on.
           */
          shouldCreateCase: true,
          shouldCreateAlert: true,
          shouldWriteDetectionFinding: true,
          shouldCreateIncident: false,
          matchCountThreshold: 1,
        }}
        /*
         * The rule, then what a match does. It was five steps - Basic Info,
         * Sigma Rule, Evaluation, Security Cases, On Match - for a rule
         * whose one required thing is its Sigma YAML. Now the YAML comes
         * first and names the rule after its title; Enabled is the Edit
         * form's (a new rule runs); what a match raises is one choice
         * (SecurityMatchActionFields); and the description, the detection
         * finding and how matches are counted wait under More fields,
         * starting at the defaults the guide documents.
         */
        formSteps={[
          { title: "Sigma Rule", id: "sigma-rule" },
          { title: "On Match", id: "on-match" },
        ]}
        formFields={[
          {
            field: {
              sigmaRuleYaml: true,
            },
            title: "Sigma Rule (YAML)",
            stepId: "sigma-rule",
            description:
              "One Sigma rule, or a Sigma correlation with the rules it reads, in YAML.",
            /*
             * Draft with AI - describe what to catch and OneUptime AI
             * writes the rule here - and what a correlation looks for, in a
             * sentence, as it is typed.
             */
            getFooterElement: (
              values: FormValues<DetectionRule>,
              _error?: string,
              footer?: FieldFooterProps,
            ): ReactElement | undefined => {
              const shape: DetectionRuleShape | null = readDetectionRuleShape(
                values.sigmaRuleYaml,
              );

              return (
                <>
                  {/*
                   * The field's quiet tools on one line - Draft with AI,
                   * then Run on Past Events once there is a rule to run -
                   * and the one opened across the field's width under it.
                   */}
                  <div
                    className="flex flex-wrap items-start gap-x-4"
                    data-testid={DETECTION_RULE_YAML_TOOLS_TEST_ID}
                  >
                    <DetectionRuleAiDraft
                      hasRule={
                        typeof values.sigmaRuleYaml === "string" &&
                        values.sigmaRuleYaml.trim().length > 0
                      }
                      onDraft={(sigmaRuleYaml: string) => {
                        footer?.setValue(sigmaRuleYaml);
                      }}
                    />
                    {/*
                     * Run on Past Events: the rule as the form holds it -
                     * new, or changed and not saved - over past events,
                     * with the saved rule's exceptions on an edit.
                     */}
                    <DetectionRuleRetrohuntInForm
                      rule={{
                        detectionRuleId:
                          (values as Record<string, unknown>)[
                            "_id"
                          ]?.toString() || undefined,
                        sigmaRuleYaml:
                          typeof values.sigmaRuleYaml === "string"
                            ? values.sigmaRuleYaml
                            : undefined,
                        groupByField: values.groupByField,
                        distinctCountField: values.distinctCountField,
                        matchCountThreshold: values.matchCountThreshold as
                          | number
                          | undefined,
                        evaluationIntervalInMinutes:
                          values.evaluationIntervalInMinutes as
                            | number
                            | undefined,
                      }}
                    />
                  </div>
                  {shape && shape.isCorrelation ? (
                    <div className="mt-2">
                      <DetectionRuleSummary shape={shape} />
                    </div>
                  ) : (
                    <></>
                  )}
                  {/*
                   * The watchlists the rule reads, as it is typed: each with
                   * what it holds, or a name the project has no list of.
                   */}
                  <DetectionRuleWatchlists
                    sigmaRuleYaml={values.sigmaRuleYaml}
                  />
                </>
              );
            },
            /*
             * YAML, not Markdown. Markdown put a rich-text toolbar (Bold, H1)
             * over a Sigma rule, and the editor behind it round-trips its value
             * through HTML - which indentation-sensitive YAML does not survive.
             */
            fieldType: FormFieldSchemaType.YAML,
            required: true,
            placeholder:
              "Sigma rule YAML — title, logsource, detection and condition.",
            dataTestId: "detection-rule-sigma-yaml",
            // The rule is named after the Sigma rule's title (below).
            onChange: (
              value: unknown,
              currentValues: FormValues<DetectionRule>,
              setNewFormValues: (values: FormValues<DetectionRule>) => void,
            ): void => {
              const name: string | null = getDetectionRuleNameAfterYamlChange({
                name: currentValues.name,
                previousYaml: currentValues.sigmaRuleYaml,
                nextYaml: value,
              });

              if (name === null) {
                return;
              }

              setNewFormValues({
                ...currentValues,
                sigmaRuleYaml: value,
                name: name,
              } as FormValues<DetectionRule>);
            },
          },
          {
            field: {
              name: true,
            },
            title: "Name",
            stepId: "sigma-rule",
            description: DETECTION_RULE_NAME_DESCRIPTION,
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "e.g. Failed logon burst",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            stepId: "sigma-rule",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            /*
             * A new rule runs: the create sends no isEnabled and the
             * column's default, on, is stored (#5158). Turning it off is an
             * edit.
             */
            doNotShowWhenCreating: true,
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            stepId: "sigma-rule",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Describe what this rule detects.",
            collapsibleSection: advancedSection,
          },
          ...getSecurityMatchActionFields<DetectionRule>(
            DETECTION_RULE_MATCH_WORDING,
          ),
          getSecurityMatchFindingField<DetectionRule>(
            DETECTION_RULE_MATCH_WORDING,
            advancedSection,
          ),
          {
            /*
             * A rule that fires on one event can check each event as it
             * arrives (Types/SecurityEvent/RealTimeDetection); the server
             * says why when the rule cannot. A correlation reads events
             * together, so it is never offered.
             */
            field: {
              isRealTime: true,
            },
            showIf: countsByFormFields,
            title: "Run in Real Time",
            stepId: "on-match",
            description:
              "Check each event as it arrives, within seconds, instead of every interval. For a rule that fires on one event: a threshold of 1, no distinct count field and no regular expression.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            collapsibleSection: advancedSection,
          },
          {
            field: {
              evaluationIntervalInMinutes: true,
            },
            // A real-time rule runs on no interval.
            showIf: (values: FormValues<DetectionRule>): boolean => {
              return !runsInRealTime(values);
            },
            title: "Evaluation Interval (Minutes)",
            stepId: "on-match",
            description: "How often this rule is evaluated, in minutes.",
            fieldType: FormFieldSchemaType.Number,
            required: true,
            placeholder: "e.g. 5",
            collapsibleSection: advancedSection,
            /*
             * At what a new rule starts with, it is nobody's setting: the
             * folded More fields does not mark it as set on a new rule (it
             * compared with the column's 1 minute and always did).
             */
            isAtDefault: (values: FormValues<DetectionRule>): boolean => {
              return (
                Number(values.evaluationIntervalInMinutes) ===
                DETECTION_RULE_FORM_EVALUATION_INTERVAL_IN_MINUTES
              );
            },
          },
          {
            field: {
              groupByField: true,
            },
            showIf: countsByFormFields,
            title: "Group By Field",
            stepId: "on-match",
            description:
              "Matches that share this field's value become one finding, such as one alert per host.",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "principalHost",
            collapsibleSection: advancedSection,
          },
          {
            field: {
              distinctCountField: true,
            },
            showIf: countsByFormFields,
            title: "Distinct Count Field",
            stepId: "on-match",
            description:
              "Count distinct values of this field instead of matching events, such as users per IP to catch one IP trying many accounts.",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "principalUser",
            collapsibleSection: advancedSection,
          },
          {
            field: {
              matchCountThreshold: true,
            },
            showIf: countsByFormFields,
            title: "Match Count Threshold",
            stepId: "on-match",
            description:
              "Fire when a group's count reaches this number within one evaluation window. 1 fires on any match.",
            fieldType: FormFieldSchemaType.Number,
            required: true,
            placeholder: "e.g. 5",
            /*
             * The shared constants keep this range identical to
             * DetectionRuleService.validateMatchCountThreshold, so
             * out-of-range values fail in the form. The service's
             * whole-number requirement has no form-side equivalent
             * (Validation.ts parseInts before comparing), so a fractional
             * value is still rejected at submit.
             */
            validation: {
              minValue: DETECTION_MATCH_COUNT_THRESHOLD_MIN,
              maxValue: DETECTION_MATCH_COUNT_THRESHOLD_MAX,
            },
            collapsibleSection: advancedSection,
          },
          {
            /*
             * What a match adds to the risk of the entity it is about
             * (Security Events > Entity Risk): empty for the level's points,
             * which is what most rules want, so it waits under More fields.
             */
            field: {
              riskScore: true,
            },
            title: RISK_POINTS_FIELD_TITLE,
            stepId: "on-match",
            description: RISK_POINTS_FIELD_DESCRIPTION,
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "By the rule's level",
            validation: {
              minValue: ENTITY_RISK_POINTS_MIN,
              maxValue: ENTITY_RISK_POINTS_MAX,
            },
            collapsibleSection: advancedSection,
          },
        ]}
        showRefreshButton={true}
        searchableFields={["name", "description"]}
        showViewIdButton={true}
        actionButtons={[
          // Enable or Disable: the one that changes the row.
          ...switchRowActions,
          // On a rule whose last run left a message, the row's button.
          getViewErrorActionButton<DetectionRule>({
            getMessages: getDetectionRuleMessages,
            show: ruleErrors.show,
          }),
          /*
           * Tuning, in the row's menu: what the rule would have found on
           * past events, and what it skips - an exception added here, or
           * the list of its exceptions.
           */
          {
            title: RUN_ON_PAST_EVENTS,
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.Backward,
            placement: ActionButtonPlacement.MoreMenu,
            menuGroup: DETECTION_RULE_TUNING_MENU_GROUP,
            onClick: (item: DetectionRule, onCompleteAction: VoidFunction) => {
              setRetrohuntRule(item);
              onCompleteAction();
            },
          },
          {
            title: ADD_EXCEPTION_ACTION,
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.EyeSlash,
            placement: ActionButtonPlacement.MoreMenu,
            menuGroup: DETECTION_RULE_TUNING_MENU_GROUP,
            disabled: !exceptionCreateGate.isAllowed,
            tooltip: exceptionCreateGate.isAllowed
              ? undefined
              : exceptionCreateGate.disabledReason ||
                "You do not have permission to add exceptions.",
            onClick: (item: DetectionRule, onCompleteAction: VoidFunction) => {
              setExceptionRule(item);
              onCompleteAction();
            },
          },
          {
            title: VIEW_EXCEPTIONS_ACTION,
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.List,
            placement: ActionButtonPlacement.MoreMenu,
            menuGroup: DETECTION_RULE_TUNING_MENU_GROUP,
            onClick: (item: DetectionRule, onCompleteAction: VoidFunction) => {
              Navigation.navigate(
                getRuleExceptionsRoute(item._id?.toString() || undefined),
              );
              onCompleteAction();
            },
          },
          {
            title: "Create Monitor",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.AltGlobe,
            /*
             * In the row's menu: a monitor on a rule's findings is set up
             * once, and as the row's one button it took the place of what a
             * rule's row is for, and the width Last Match needed.
             */
            placement: ActionButtonPlacement.MoreMenu,
            disabled: !monitorCreateGate.isAllowed,
            tooltip: monitorCreateGate.isAllowed
              ? "Create a Security Events monitor watching this rule's Detection Findings — alert on rate, not just occurrence."
              : monitorCreateGate.disabledReason ||
                "You do not have permission to create monitors.",
            onClick: (item: DetectionRule, onCompleteAction: VoidFunction) => {
              /*
               * Deep link, not an inline create: the monitor create page is
               * where the pay-as-you-go consent and the criteria builder
               * live, and a second door that skips either is not a door we
               * want. The page fetches the rule by id and pre-fills a
               * Security Events step scoped to this rule's findings.
               */
              Navigation.navigate(
                (
                  RouteUtil.populateRouteParams(
                    RouteMap[PageMap.MONITOR_CREATE] as Route,
                  ) as Route
                ).addQueryParams({
                  detectionRuleId: item._id?.toString() || "",
                }),
              );
              onCompleteAction();
            },
          },
        ]}
        filters={[
          {
            field: {
              name: true,
            },
            type: FieldType.Text,
            title: "Name",
          },
          {
            field: {
              isEnabled: true,
            },
            type: FieldType.Boolean,
            title: "Enabled",
          },
        ]}
        selectMoreFields={{
          sigmaRuleYaml: true,
          // Whether each row is on, for Enable and Disable to count.
          isEnabled: true,
          // A real-time rule's Status and Interval say so.
          isRealTime: true,
        }}
        columns={[
          /*
           * The rule's name, with how many of its exceptions skip
           * something now under it ("2 active exceptions", opening them):
           * a rule with blind spots says so where its name is.
           */
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
            wrapContent: true,
            wrapMaxWidthClassName:
              SECURITY_LIST_NAME_COLUMN_MAX_WIDTH_CLASS_NAME,
            getElement: (item: DetectionRule): ReactElement => {
              const count: number =
                exceptionCounts.counts.get(item._id?.toString() || "") || 0;

              return (
                <SecurityListNameCell
                  name={item.name || ""}
                  /*
                   * The count opens what it counts: the list of the
                   * rule's exceptions, as View Exceptions in its menu does.
                   */
                  detail={
                    count > 0 ? (
                      <Link
                        to={getRuleExceptionsRoute(
                          item._id?.toString() || undefined,
                        )}
                        className="rounded hover:text-indigo-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                      >
                        {translator.translatePlural(
                          ACTIVE_EXCEPTION_COUNT,
                          count,
                        )}
                      </Link>
                    ) : undefined
                  }
                  detailTestId={RULE_EXCEPTIONS_TEST_IDS.ruleCount}
                />
              );
            },
          },
          {
            field: {
              sigmaRuleYaml: true,
            },
            title: "Type",
            type: FieldType.Element,
            disableSort: true,
            getElement: (item: DetectionRule): ReactElement => {
              const shape: DetectionRuleShape | null = readDetectionRuleShape(
                item.sigmaRuleYaml,
              );

              return shape ? (
                <DetectionRuleTypeLabel
                  shape={shape}
                  dataTestId="detection-rule-type"
                />
              ) : (
                <span className="text-gray-500">-</span>
              );
            },
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Status",
            type: FieldType.Boolean,
            /*
             * Whether the rule works, not only whether it is on: a failed
             * run reads red here, a run's note about its own work yellow,
             * with View Error on its row (SecurityDetectionStatus). It reads
             * Last Error, which the table selects even while it is hidden.
             */
            getElement: (item: DetectionRule): ReactElement => {
              const status: SecurityDetectionStatus =
                getDetectionRuleStatus(item);

              return (
                <Pill
                  color={status.color}
                  text={status.text}
                  tooltip={status.tooltip}
                />
              );
            },
          },
          /*
           * When it last fired, as how long ago ("5 minutes ago", the date
           * under the pointer): two columns of full dates ran the table
           * past its card at 1280, Last Evaluated under the row's buttons.
           */
          {
            field: {
              lastMatchAt: true,
            },
            title: "Last Match",
            type: FieldType.Element,
            getElement: (item: DetectionRule): ReactElement => {
              return <RelativeTimeCell date={item.lastMatchAt} />;
            },
          },
          /*
           * Hidden at first (Customize Columns brings them back): that a
           * rule runs, its Status says ("Waiting for first run", red when a
           * run fails); the interval is the rule's setting; and Last Error,
           * empty while the rule works, shows through the Status and View
           * Error.
           */
          {
            field: {
              lastEvaluatedAt: true,
            },
            title: "Last Evaluated",
            type: FieldType.Element,
            isHiddenByDefault: true,
            getElement: (item: DetectionRule): ReactElement => {
              return <RelativeTimeCell date={item.lastEvaluatedAt} />;
            },
          },
          {
            field: {
              evaluationIntervalInMinutes: true,
            },
            title: "Interval (Minutes)",
            type: FieldType.Element,
            isHiddenByDefault: true,
            // A real-time rule runs on no interval: it says so instead.
            getElement: (item: DetectionRule): ReactElement => {
              if (item.isRealTime) {
                return (
                  <span className="text-gray-700">
                    {translator.translateText("Real time")}
                  </span>
                );
              }

              return (
                <span>
                  {item.evaluationIntervalInMinutes !== undefined &&
                  item.evaluationIntervalInMinutes !== null
                    ? translator.formatNumber(item.evaluationIntervalInMinutes)
                    : "-"}
                </span>
              );
            },
          },
          {
            field: {
              lastError: true,
            },
            title: "Last Error",
            type: FieldType.LongText,
            noValueMessage: "-",
            wrapContent: true,
            isHiddenByDefault: true,
          },
        ]}
      />

      {ruleErrors.element}

      {retrohuntRule ? (
        <DetectionRuleRetrohuntModal
          ruleId={retrohuntRule._id?.toString() || ""}
          ruleName={retrohuntRule.name || ""}
          onClose={() => {
            setRetrohuntRule(null);
          }}
        />
      ) : (
        <></>
      )}

      {exceptionRule ? (
        <AddRuleExceptionModal
          detectionRuleId={exceptionRule._id?.toString() || undefined}
          description={ADD_EXCEPTION_DESCRIPTION}
          onClose={() => {
            setExceptionRule(null);
          }}
          onSuccess={() => {
            setExceptionRule(null);
            exceptionCounts.refresh();
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default DetectionRulesPage;
