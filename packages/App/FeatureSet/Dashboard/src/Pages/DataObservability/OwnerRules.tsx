import RuleSettingsPageProps from "../RuleSettingsPageProps";
import PageMap from "../../Utils/PageMap";
import RuleViewPageUtil from "../../Utils/RuleViewPage";
import {
  getOwnerRuleActionFields,
  getOwnerRuleFormSteps,
} from "../../Utils/Form/ResourceRuleForm";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import RuleTable from "Common/UI/Components/RuleRun/RuleTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import DataAssetOwnerRule from "Common/Models/DatabaseModels/DataAssetOwnerRule";
import React, { FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Label from "Common/Models/DatabaseModels/Label";

/*
 * Data Security > Settings > Owner Rules: owners added to the tables a
 * rule matches - by the store's labels, its name or description, or its
 * cloud tags - when a store is discovered (DataAssetOwnerRuleEngineService).
 * The same two-step form as every owner rule (Utils/Form/ResourceRuleForm):
 * what the rule matches, then who it adds.
 */
const DataAssetOwnerRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  return (
    <RuleTable<DataAssetOwnerRule>
      modelType={DataAssetOwnerRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(props, DataAssetOwnerRule)}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.DATA_OBSERVABILITY_SETTINGS_OWNER_RULES,
      )}
      getRuleViewRoute={(rule: DataAssetOwnerRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.DATA_OBSERVABILITY_SETTINGS_OWNER_RULE_VIEW,
          rule,
        );
      }}
      id="data-asset-owner-rules-table"
      name="Data Observability > Table Owner Rules"
      userPreferencesKey="data-asset-owner-rules-table"
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Table Owner Rules",
        description:
          "Auto-assign owners when matching tables are discovered.",
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
          getElement: (item: DataAssetOwnerRule): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
      ]}
      formSteps={getOwnerRuleFormSteps<DataAssetOwnerRule>()}
      formFields={[
        {
          field: { matchLabels: true },
          title: "Table Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Filter tables by labels. Leave empty to skip the filter.",
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
        ...getOwnerRuleActionFields<DataAssetOwnerRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

export default DataAssetOwnerRulesPage;
