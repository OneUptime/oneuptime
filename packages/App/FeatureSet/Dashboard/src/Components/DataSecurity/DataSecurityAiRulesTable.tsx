import {
  DATA_SECURITY_AI_AUTONOMY_LABELS,
  DATA_SECURITY_AI_WORK_LABELS,
  DataSecurityAiRulesCopy,
} from "./DataSecurityAiCopy";
import {
  STORE_ENVIRONMENT_OPTIONS,
  STORE_KIND_OPTIONS,
  STORE_PROVIDER_OPTIONS,
  STORE_SENSITIVITY_OPTIONS,
} from "./StoreFieldOptions";
import AutoRemediationRule from "Common/Models/DatabaseModels/AutoRemediationRule";
import Label from "Common/Models/DatabaseModels/Label";
import Service from "Common/Models/DatabaseModels/Service";
import AutoRemediationTriggerEntity from "Common/Types/AutoRemediation/AutoRemediationTriggerEntity";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import DataCategory, {
  ALL_DATA_CATEGORIES,
} from "Common/Types/DataSecurity/DataCategory";
import {
  DATA_SECURITY_AI_WORK_AUTONOMIES,
  DATA_SECURITY_AI_WORK_COLUMN,
  DATA_SECURITY_AI_WORKS,
  DataSecurityAiAutonomy,
  DataSecurityAiWork,
  getDataSecurityAiRuleAutonomy,
} from "Common/Types/DataSecurity/DataSecurityAi";
import {
  ALL_DATA_SECURITY_CHECK_GROUPS,
  DATA_SECURITY_CHECKS,
  DataSecurityCheckGroup,
  DataSecurityCheckInfo,
} from "Common/Types/DataSecurity/DataSecurityCheckCatalog";
import SecuritySeverity from "Common/Types/SecuritySeverity";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import EnabledPill from "Common/UI/Components/Pill/EnabledPill";
import FieldType from "Common/UI/Components/Types/FieldType";
import { LABEL_WITH_COLON } from "Common/UI/Utils/LabelWithColon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * DATA SECURITY'S AI RULES (#10364): which Data Security issues OneUptime AI
 * works on, and for each kind of work - analyze, contain, fix, judge -
 * whether it is off, suggested for a person's approval, or done without
 * asking. One AutoRemediationRule each, with the DataSecurityIssue trigger,
 * as Incidents' and Alerts' AI rules are theirs: one place answers what AI
 * may do without asking in the project.
 *
 * A rule matches an issue by its check or check group, its severity, and
 * its store's sensitivity, kind, provider, environment, labels, data
 * categories and service; an empty condition matches every issue. With no
 * rule, the project's defaults apply (getDefaultDataSecurityAiWork). What
 * runs without asking is still held to the change's own safety: deleting
 * data and paging people always ask, whatever a rule says.
 *
 * The server holds each rule to these words (AutoRemediationRuleService):
 * Analyze is Off or Without asking, and a rule that does nothing is
 * refused, with why.
 */

export const DATA_SECURITY_AI_RULES_TABLE_ID: string = "data-security-ai-rules";

const SEVERITY_OPTIONS: Array<DropdownOption> = [
  { label: "Critical", value: SecuritySeverity.Critical },
  { label: "High", value: SecuritySeverity.High },
  { label: "Medium", value: SecuritySeverity.Medium },
  { label: "Low", value: SecuritySeverity.Low },
];

const CHECK_OPTIONS: Array<DropdownOption> = DATA_SECURITY_CHECKS.map(
  (check: DataSecurityCheckInfo): DropdownOption => {
    return { label: check.title, value: check.id };
  },
);

const CHECK_GROUP_OPTIONS: Array<DropdownOption> =
  ALL_DATA_SECURITY_CHECK_GROUPS.map(
    (group: DataSecurityCheckGroup): DropdownOption => {
      return { label: group, value: group };
    },
  );

const DATA_CATEGORY_OPTIONS: Array<DropdownOption> = ALL_DATA_CATEGORIES.map(
  (category: DataCategory): DropdownOption => {
    return { label: category, value: category };
  },
);

// A kind of work's choices: Analyze is never Suggest, it changes nothing.
function autonomyOptions(work: DataSecurityAiWork): Array<DropdownOption> {
  return DATA_SECURITY_AI_WORK_AUTONOMIES[work].map(
    (autonomy: DataSecurityAiAutonomy): DropdownOption => {
      return {
        label: DATA_SECURITY_AI_AUTONOMY_LABELS[autonomy],
        value: autonomy,
      };
    },
  );
}

const WORK_DESCRIPTIONS: Readonly<Record<DataSecurityAiWork, string>> = {
  [DataSecurityAiWork.Analyze]: DataSecurityAiRulesCopy.analyzeDescription,
  [DataSecurityAiWork.Contain]: DataSecurityAiRulesCopy.containDescription,
  [DataSecurityAiWork.Fix]: DataSecurityAiRulesCopy.fixDescription,
  [DataSecurityAiWork.Judge]: DataSecurityAiRulesCopy.judgeDescription,
};

// A new rule starts from the project's defaults: analyze, and suggest the rest.
const NEW_RULE_VALUES: FormValues<AutoRemediationRule> = {
  dataSecurityAnalyze: DataSecurityAiAutonomy.WithoutAsking,
  dataSecurityContain: DataSecurityAiAutonomy.Suggest,
  dataSecurityFix: DataSecurityAiAutonomy.Suggest,
  dataSecurityJudge: DataSecurityAiAutonomy.Suggest,
} as FormValues<AutoRemediationRule>;

const DataSecurityAiRulesTable: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <ModelTable<AutoRemediationRule>
      modelType={AutoRemediationRule}
      id={DATA_SECURITY_AI_RULES_TABLE_ID}
      userPreferencesKey={DATA_SECURITY_AI_RULES_TABLE_ID}
      name="Data Security AI Rules"
      query={{
        triggerEntityType: AutoRemediationTriggerEntity.DataSecurityIssue,
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      isViewable={false}
      showRefreshButton={true}
      createEditModalWidth={ModalWidth.Large}
      sortBy="name"
      sortOrder={SortOrder.Ascending}
      cardProps={{
        title: DataSecurityAiRulesCopy.title,
        description: DataSecurityAiRulesCopy.description,
      }}
      noItemsMessage={DataSecurityAiRulesCopy.empty}
      createInitialValues={NEW_RULE_VALUES}
      onBeforeCreate={(
        rule: AutoRemediationRule,
      ): Promise<AutoRemediationRule> => {
        rule.triggerEntityType = AutoRemediationTriggerEntity.DataSecurityIssue;
        return Promise.resolve(rule);
      }}
      selectMoreFields={{
        isEnabled: true,
        dataSecurityAnalyze: true,
        dataSecurityContain: true,
        dataSecurityFix: true,
        dataSecurityJudge: true,
      }}
      filters={[]}
      columns={[
        { field: { name: true }, title: "Name", type: FieldType.Text },
        {
          field: { dataSecurityContain: true },
          title: DataSecurityAiRulesCopy.whatItDoes,
          type: FieldType.Element,
          disableSort: true,
          hideOnMobile: true,
          getElement: (rule: AutoRemediationRule): ReactElement => {
            return (
              <ul className="space-y-0.5 text-sm text-gray-700">
                {DATA_SECURITY_AI_WORKS.map(
                  (work: DataSecurityAiWork): ReactElement => {
                    return (
                      <li key={work}>
                        {translator.translateTemplate(LABEL_WITH_COLON, {
                          label:
                            translator.translateText(
                              DATA_SECURITY_AI_WORK_LABELS[work],
                            ) || DATA_SECURITY_AI_WORK_LABELS[work],
                        })}{" "}
                        {translator.translateText(
                          DATA_SECURITY_AI_AUTONOMY_LABELS[
                            getDataSecurityAiRuleAutonomy(rule, work)
                          ],
                        )}
                      </li>
                    );
                  },
                )}
              </ul>
            );
          },
        },
        {
          field: { isEnabled: true },
          title: "Status",
          type: FieldType.Boolean,
          getElement: (rule: AutoRemediationRule): ReactElement => {
            return <EnabledPill isEnabled={rule.isEnabled} />;
          },
        },
      ]}
      formFields={[
        {
          field: { name: true },
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: DataSecurityAiRulesCopy.namePlaceholder,
        },
        {
          field: { description: true },
          title: "Description",
          fieldType: FormFieldSchemaType.LongText,
          required: false,
        },
        {
          field: { isEnabled: true },
          title: "Enabled",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
        },
        ...DATA_SECURITY_AI_WORKS.map((work: DataSecurityAiWork) => {
          return {
            field: { [DATA_SECURITY_AI_WORK_COLUMN[work]]: true } as never,
            title: DATA_SECURITY_AI_WORK_LABELS[work],
            description: WORK_DESCRIPTIONS[work],
            sectionTitle:
              work === DataSecurityAiWork.Analyze
                ? DataSecurityAiRulesCopy.worksSection
                : undefined,
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: autonomyOptions(work),
            required: true,
          };
        }),
        {
          field: { dataSecuritySeverities: true },
          title: "Severity",
          sectionTitle: DataSecurityAiRulesCopy.matchSection,
          sectionDescription: DataSecurityAiRulesCopy.matchDescription,
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownOptions: SEVERITY_OPTIONS,
          required: false,
        },
        {
          field: { dataSecurityChecks: true },
          title: "Checks",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownOptions: CHECK_OPTIONS,
          required: false,
        },
        {
          field: { dataSecurityCheckGroups: true },
          title: DataSecurityAiRulesCopy.checkGroups,
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownOptions: CHECK_GROUP_OPTIONS,
          required: false,
        },
        {
          field: { dataStoreSensitivities: true },
          title: "Sensitivity",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownOptions: STORE_SENSITIVITY_OPTIONS,
          required: false,
        },
        {
          field: { dataStoreKinds: true },
          title: "Kind",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownOptions: STORE_KIND_OPTIONS,
          required: false,
        },
        {
          field: { dataStoreProviders: true },
          title: "Provider",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownOptions: STORE_PROVIDER_OPTIONS,
          required: false,
        },
        {
          field: { dataStoreEnvironments: true },
          title: "Environment",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownOptions: STORE_ENVIRONMENT_OPTIONS,
          required: false,
        },
        {
          field: { dataStoreLabels: true },
          title: DataSecurityAiRulesCopy.storeLabels,
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
        },
        {
          field: { dataCategories: true },
          title: DataSecurityAiRulesCopy.dataCategories,
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownOptions: DATA_CATEGORY_OPTIONS,
          required: false,
        },
        {
          field: { services: true },
          title: DataSecurityAiRulesCopy.services,
          description: DataSecurityAiRulesCopy.servicesDescription,
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Service,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
        },
      ]}
    />
  );
};

export default DataSecurityAiRulesTable;
