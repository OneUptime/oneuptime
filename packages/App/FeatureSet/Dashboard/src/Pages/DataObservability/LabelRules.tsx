import RuleSettingsPageProps from "../RuleSettingsPageProps";
import PageMap from "../../Utils/PageMap";
import RuleViewPageUtil from "../../Utils/RuleViewPage";
import {
  getLabelRuleActionFields,
  getLabelRuleFormSteps,
} from "../../Utils/Form/ResourceRuleForm";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import LabelRuleTable from "Common/UI/Components/LabelRule/LabelRuleTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import DataAssetLabelRule from "Common/Models/DatabaseModels/DataAssetLabelRule";
import React, { FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Label from "Common/Models/DatabaseModels/Label";

/*
 * Data Security > Settings > Label Rules: labels added to the tables a
 * rule matches - by the store's labels, its name or description, or its
 * cloud tags - when a store is discovered (DataAssetLabelRuleEngineService).
 * The same two-step form as every label rule (Utils/Form/ResourceRuleForm):
 * what the rule matches, then the labels it adds.
 */
const DataAssetLabelRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  return (
    <LabelRuleTable<DataAssetLabelRule>
      modelType={DataAssetLabelRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(props, DataAssetLabelRule)}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.DATA_OBSERVABILITY_SETTINGS_LABEL_RULES,
      )}
      getRuleViewRoute={(rule: DataAssetLabelRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.DATA_OBSERVABILITY_SETTINGS_LABEL_RULE_VIEW,
          rule,
        );
      }}
      id="data-asset-label-rules-table"
      name="Data Observability > Table Label Rules"
      userPreferencesKey="data-asset-label-rules-table"
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Table Label Rules",
        description:
          "Auto-attach labels when matching tables are discovered.",
      }}
      sortBy="name"
      sortOrder={SortOrder.Ascending}
      selectMoreFields={{ isEnabled: true }}
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
          field: { description: true },
          title: "Description",
          type: FieldType.Text,
        },
        {
          field: { isEnabled: true },
          title: "Status",
          type: FieldType.Boolean,
          getElement: (item: DataAssetLabelRule): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
      ]}
      formSteps={getLabelRuleFormSteps<DataAssetLabelRule>()}
      formFields={[
        {
          field: { matchLabels: true },
          title: "Table Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Only trigger for tables that already have at least one of these labels. Leave empty to skip the filter.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Labels",
        },
        {
          field: { nameRegexPattern: true },
          title: "Table Name",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "Case-insensitive regex matched against the table's name, the database it is in, and its schema.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "orders_.*",
        },
        {
          field: { databaseRegexPattern: true },
          title: "Database",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "warehouse|orders-db",
        },
        {
          field: { schemaRegexPattern: true },
          title: "Schema",
          stepId: "match-criteria",
          
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "^billing$",
        },
        ...getLabelRuleActionFields<DataAssetLabelRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

export default DataAssetLabelRulesPage;
