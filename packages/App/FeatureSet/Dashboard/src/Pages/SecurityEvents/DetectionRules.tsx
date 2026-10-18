import PageComponentProps from "../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";
import DetectionRule from "Common/Models/DatabaseModels/DetectionRule";
import {
  DETECTION_MATCH_COUNT_THRESHOLD_MAX,
  DETECTION_MATCH_COUNT_THRESHOLD_MIN,
} from "Common/Types/SecurityEvent/DetectionFindingConstants";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
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
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
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
import DetectionRulesGuide from "../../Components/SecurityEvents/HowItWorks/DetectionRulesGuide";
import { guideToMarkdown } from "../../Components/SecurityEvents/HowItWorks/SecurityEventsGuide";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * How often a new rule runs, as the form starts it: the
 * evaluationIntervalInMinutes of createInitialValues below, written out
 * there as the literal the docs facts read (the column's own default, for
 * a rule made through the API, is a minute).
 */
const DETECTION_RULE_FORM_EVALUATION_INTERVAL_IN_MINUTES: number = 5;

/*
 * The description, the detection finding and how matches are counted:
 * folded under More fields on their steps.
 */
const advancedSection: FormFieldCollapsibleSection<DetectionRule> =
  getAdvancedFormSection<DetectionRule>();

const DetectionRulesPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  /*
   * Same reseller-telemetry gate as every other Security Events tab —
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

  return (
    /*
     * The page's own vertical rhythm. `Page` only wraps its children in
     * `space-y-6` on the side-menu branch, and this product moved its
     * destinations into header tabs — so without this the How-it-works card
     * and the table under it sit flush against each other.
     */
    <div className="space-y-6">
      <SecurityEventsHowItWorksCard guide={DetectionRulesGuide} />

      <ModelTable<DetectionRule>
        modelType={DetectionRule}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        id="detection-rules-table"
        name="Security Events > Detection Rules"
        userPreferencesKey="detection-rules-table"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={false}
        createEditModalWidth={ModalWidth.Large}
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        cardProps={{
          // Its search and buttons drop under the title beside the side menu.
          headerLayout: "stacked",
          title: "Detection Rules",
          description:
            "Sigma rules run on a schedule against your security events. A matching rule can raise an alert and open a case.",
        }}
        helpContent={{
          title: DetectionRulesGuide.guideTitle,
          description: DetectionRulesGuide.guideDescription,
          markdown: guideToMarkdown(DetectionRulesGuide),
        }}
        noItemsMessage={"No detection rules found."}
        createInitialValues={{
          isEnabled: true,
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
              "The Sigma rule to evaluate against incoming security events, in YAML.",
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
            // A new rule runs (createInitialValues); turning it off is an edit.
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
            field: {
              evaluationIntervalInMinutes: true,
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
        ]}
        showRefreshButton={true}
        searchableFields={["name", "description"]}
        showViewIdButton={true}
        actionButtons={[
          {
            title: "Create Monitor",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.AltGlobe,
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
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Status",
            type: FieldType.Boolean,
            getElement: (item: DetectionRule): ReactElement => {
              if (item.isEnabled) {
                return <Pill color={Green} text="Enabled" />;
              }
              return <Pill color={Red} text="Disabled" />;
            },
          },
          {
            field: {
              evaluationIntervalInMinutes: true,
            },
            title: "Interval (Minutes)",
            type: FieldType.Number,
            noValueMessage: "-",
          },
          {
            field: {
              lastEvaluatedAt: true,
            },
            title: "Last Evaluated",
            type: FieldType.DateTime,
            noValueMessage: "Never",
          },
          {
            field: {
              lastMatchAt: true,
            },
            title: "Last Match",
            type: FieldType.DateTime,
            noValueMessage: "Never",
          },
          {
            field: {
              lastError: true,
            },
            title: "Last Error",
            type: FieldType.LongText,
            noValueMessage: "-",
          },
        ]}
      />
    </div>
  );
};

export default DetectionRulesPage;
