import RuleSettingsPageProps from "../../RuleSettingsPageProps";
import PageMap from "../../../Utils/PageMap";
import RuleViewPageUtil from "../../../Utils/RuleViewPage";
import {
  getOwnerRuleActionFields,
  getOwnerRuleFormSteps,
} from "../../../Utils/Form/ResourceRuleForm";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import RuleTable from "Common/UI/Components/RuleRun/RuleTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import DataStoreOwnerRule from "Common/Models/DatabaseModels/DataStoreOwnerRule";
import React, { FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Label from "Common/Models/DatabaseModels/Label";

/*
 * Data Security > Settings > Owner Rules: owners added to the data stores a
 * rule matches - by the store's labels, its name or description, or its
 * cloud tags - when a store is discovered (DataStoreOwnerRuleEngineService).
 * The same two-step form as every owner rule (Utils/Form/ResourceRuleForm):
 * what the rule matches, then who it adds.
 */
const DataStoreOwnerRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  return (
    <RuleTable<DataStoreOwnerRule>
      modelType={DataStoreOwnerRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(props, DataStoreOwnerRule)}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.DATA_SECURITY_SETTINGS_OWNER_RULES,
      )}
      getRuleViewRoute={(rule: DataStoreOwnerRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.DATA_SECURITY_SETTINGS_OWNER_RULE_VIEW,
          rule,
        );
      }}
      id="data-store-owner-rules-table"
      name="Settings > Data Store Owner Rules"
      userPreferencesKey="data-store-owner-rules-table"
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Data Store Owner Rules",
        description:
          "Auto-assign owners when matching data stores are discovered.",
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
          getElement: (item: DataStoreOwnerRule): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
      ]}
      formSteps={getOwnerRuleFormSteps<DataStoreOwnerRule>()}
      formFields={[
        {
          field: { matchLabels: true },
          title: "Store Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Filter data stores by labels. Leave empty to skip the filter.",
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
          title: "Store Name",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "Case-insensitive regex matched against the data store's name and description.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "customer-.*",
        },
        {
          field: { descriptionRegexPattern: true },
          title: "Store Description",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "production|pii",
        },
        {
          field: { cloudTagPattern: true },
          title: "Cloud Tag",
          stepId: "match-criteria",
          description:
            "Matched against each of the store's cloud tags, written key=value. ^team=payments$ matches every store tagged team=payments.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "^team=payments$",
        },
        ...getOwnerRuleActionFields<DataStoreOwnerRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

export default DataStoreOwnerRulesPage;
