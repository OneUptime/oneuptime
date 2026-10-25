import PageComponentProps from "../../PageComponentProps";
import {
  ProjectColumnsEditGate,
  getProjectColumnsEditGate,
} from "../../Settings/ProjectColumnEditGate";
import EntityCriticalityPill from "../../../Components/SecurityEvents/EntityRisk/EntityCriticalityPill";
import {
  ANY_ENTITY_TYPE,
  CRITICALITY_DESCRIPTION_DESCRIPTION,
  CRITICALITY_LEVEL_DESCRIPTION,
  CRITICALITY_PLURAL,
  CRITICALITY_SINGULAR,
  CRITICALITY_TABLE_DESCRIPTION,
  CRITICALITY_TABLE_EMPTY,
  CRITICALITY_TABLE_TITLE,
  CRITICALITY_TYPE_DESCRIPTION,
  CRITICALITY_VALUE_DESCRIPTION,
  CRITICALITY_WEIGHT_LABELS,
  ENTITY_RISK_TEST_IDS,
  RISK_CASES_CARD_DESCRIPTION,
  RISK_CASES_CARD_TITLE,
  RISK_CASES_SWITCH_OFF,
  RISK_CASES_SWITCH_ON,
  RISK_CASES_SWITCH_TITLE,
  RISK_THRESHOLD_CARD_DESCRIPTION,
  RISK_THRESHOLD_CARD_TITLE,
  RISK_THRESHOLD_FIELD_DESCRIPTION,
  RISK_THRESHOLD_FIELD_TITLE,
} from "../../../Components/SecurityEvents/EntityRisk/EntityRiskCopy";
import { readEntityCriticality } from "../../../Components/SecurityEvents/EntityRisk/EntityRiskModel";
import Project from "Common/Models/DatabaseModels/Project";
import SecurityEntityCriticality from "Common/Models/DatabaseModels/SecurityEntityCriticality";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  SecurityEntityType,
  getSecurityEntityIcon,
} from "Common/Types/SecurityCase/SecurityEntity";
import {
  ENTITY_RISK_CASE_THRESHOLD_MAX,
  ENTITY_RISK_CASE_THRESHOLD_MIN,
  RISK_ENTITY_TYPES,
  SECURITY_ENTITY_CRITICALITIES,
  SecurityEntityCriticality as Criticality,
} from "Common/Types/SecurityCase/SecurityEntityRisk";
import { getRiskCaseThresholdError } from "Common/Utils/SecurityCase/SecurityEntityRiskScore";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Icon from "Common/UI/Components/Icon/Icon";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * An entry's kind and why it matters: optional, so they wait under More
 * fields, and the form is its value and how much it matters.
 */
const criticalityMoreFields: FormFieldCollapsibleSection<SecurityEntityCriticality> =
  getAdvancedFormSection<SecurityEntityCriticality>();

function entityTypeOptions(): Array<DropdownOption> {
  return RISK_ENTITY_TYPES.map((type: SecurityEntityType): DropdownOption => {
    return { label: type, value: type };
  });
}

function criticalityOptions(): Array<DropdownOption> {
  return SECURITY_ENTITY_CRITICALITIES.map(
    (criticality: Criticality): DropdownOption => {
      return {
        label: CRITICALITY_WEIGHT_LABELS[criticality],
        value: criticality,
      };
    },
  );
}

/*
 * Security Events > Settings > Risk Scoring: whether an entity's risk opens
 * a case, at what risk, and how much each entity matters.
 *
 *  - Risk Cases: one switch that saves the moment it is flipped, as the AI
 *    settings' do (Project.enableSecurityRiskCases: on for new projects).
 *  - Risk Threshold: where a case opens and an entity reads High; the other
 *    levels follow from it.
 *  - Entity Criticality: the users, hosts and addresses that matter more or
 *    less, a value or a `*` pattern each, as Protected Entities are kept.
 *
 * The two Project settings take a Project Owner or Admin, as the project's
 * AI triage does; Entity Criticality whoever writes detection rules.
 */
const SecurityRiskScoringPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    return <></>;
  }

  const thresholdGate: ProjectColumnsEditGate = getProjectColumnsEditGate({
    fields: ["securityRiskCaseThreshold"],
    buttonTitle: "Edit",
  });

  return (
    <div className="space-y-6">
      <ModelSwitchCard<Project>
        modelType={Project}
        modelId={projectId}
        column="enableSecurityRiskCases"
        cardTitle={RISK_CASES_CARD_TITLE}
        cardDescription={RISK_CASES_CARD_DESCRIPTION}
        title={RISK_CASES_SWITCH_TITLE}
        getDescription={(isOn: boolean): string => {
          return isOn ? RISK_CASES_SWITCH_ON : RISK_CASES_SWITCH_OFF;
        }}
        dataTestId={ENTITY_RISK_TEST_IDS.riskCasesSwitch}
      />

      <div data-testid={ENTITY_RISK_TEST_IDS.thresholdCard}>
        <CardModelDetail<Project>
          name="Security Risk Threshold"
          cardProps={{
            title: RISK_THRESHOLD_CARD_TITLE,
            description: RISK_THRESHOLD_CARD_DESCRIPTION,
            buttons: thresholdGate.lockedButtons,
          }}
          isEditable={thresholdGate.isEditable}
          editButtonText="Edit"
          editModalTitle={RISK_THRESHOLD_CARD_TITLE}
          formFields={[
            {
              field: { securityRiskCaseThreshold: true },
              title: RISK_THRESHOLD_FIELD_TITLE,
              description: RISK_THRESHOLD_FIELD_DESCRIPTION,
              fieldType: FormFieldSchemaType.Number,
              required: true,
              placeholder: "100",
              validation: {
                minValue: ENTITY_RISK_CASE_THRESHOLD_MIN,
                maxValue: ENTITY_RISK_CASE_THRESHOLD_MAX,
              },
              customValidation: (
                values: FormValues<Project>,
              ): string | null => {
                const error: string | null = getRiskCaseThresholdError(
                  (values as Record<string, unknown>)[
                    "securityRiskCaseThreshold"
                  ],
                );

                return error ? translator.translateText(error) || error : null;
              },
            },
          ]}
          modelDetailProps={{
            modelType: Project,
            id: "model-detail-project-security-risk-threshold",
            modelId: projectId,
            fields: [
              {
                field: { securityRiskCaseThreshold: true },
                title: RISK_THRESHOLD_FIELD_TITLE,
                fieldType: FieldType.Number,
              },
            ],
          }}
        />
      </div>

      <ModelTable<SecurityEntityCriticality>
        modelType={SecurityEntityCriticality}
        id={ENTITY_RISK_TEST_IDS.criticalityTable}
        name="Security Events > Settings > Entity Criticality"
        userPreferencesKey="security-entity-criticality-table"
        singularName={CRITICALITY_SINGULAR}
        pluralName={CRITICALITY_PLURAL}
        createVerb="Add"
        query={{ projectId: projectId }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={false}
        sortBy="value"
        sortOrder={SortOrder.Ascending}
        cardProps={{
          title: CRITICALITY_TABLE_TITLE,
          description: CRITICALITY_TABLE_DESCRIPTION,
        }}
        emptyState={{
          description: CRITICALITY_TABLE_EMPTY,
          icon: IconProp.Star,
        }}
        createInitialValues={{
          criticality: Criticality.High,
        }}
        formFields={[
          {
            field: { value: true },
            title: "Value",
            description: CRITICALITY_VALUE_DESCRIPTION,
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "e.g. dc-*.corp.example",
            disableSpellCheck: true,
          },
          {
            field: { criticality: true },
            title: "Criticality",
            description: CRITICALITY_LEVEL_DESCRIPTION,
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: criticalityOptions(),
            required: true,
          },
          {
            field: { entityType: true },
            title: "Type",
            description: CRITICALITY_TYPE_DESCRIPTION,
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: entityTypeOptions(),
            required: false,
            collapsibleSection: criticalityMoreFields,
          },
          {
            field: { description: true },
            title: "Description",
            description: CRITICALITY_DESCRIPTION_DESCRIPTION,
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            collapsibleSection: criticalityMoreFields,
          },
        ]}
        showRefreshButton={true}
        searchableFields={["value", "description"]}
        filters={[
          { field: { value: true }, title: "Value", type: FieldType.Text },
          {
            field: { criticality: true },
            title: "Criticality",
            type: FieldType.Dropdown,
            filterDropdownOptions: criticalityOptions(),
          },
          {
            field: { entityType: true },
            title: "Type",
            type: FieldType.Dropdown,
            filterDropdownOptions: entityTypeOptions(),
          },
        ]}
        columns={[
          {
            field: { value: true },
            title: "Value",
            type: FieldType.Element,
            getElement: (item: SecurityEntityCriticality): ReactElement => {
              return (
                <div className="flex min-w-0 items-center gap-2">
                  <Icon
                    icon={
                      item.entityType
                        ? getSecurityEntityIcon(item.entityType)
                        : IconProp.Star
                    }
                    className="h-4 w-4 flex-shrink-0 text-gray-400"
                  />
                  <span className="font-mono text-sm text-gray-900 [overflow-wrap:anywhere]">
                    {item.value || ""}
                  </span>
                </div>
              );
            },
          },
          {
            field: { criticality: true },
            title: "Criticality",
            type: FieldType.Element,
            getElement: (item: SecurityEntityCriticality): ReactElement => {
              const criticality: Criticality | null = readEntityCriticality(
                item.criticality,
              );

              return criticality ? (
                <EntityCriticalityPill criticality={criticality} />
              ) : (
                <span className="text-sm text-gray-400">-</span>
              );
            },
          },
          {
            field: { entityType: true },
            title: "Type",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: SecurityEntityCriticality): ReactElement => {
              const type: string = item.entityType || ANY_ENTITY_TYPE;

              return (
                <span className="text-sm text-gray-700">
                  {translator.translateText(type) || type}
                </span>
              );
            },
          },
          {
            field: { description: true },
            title: "Description",
            type: FieldType.LongText,
            noValueMessage: "-",
            hideOnMobile: true,
          },
        ]}
      />
    </div>
  );
};

export default SecurityRiskScoringPage;
