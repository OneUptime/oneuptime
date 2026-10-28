import RuleSettingsPageProps from "../../RuleSettingsPageProps";
import PageMap from "../../../Utils/PageMap";
import RuleViewPageUtil from "../../../Utils/RuleViewPage";
import {
  getLabelRuleActionFields,
  getLabelRuleFormSteps,
} from "../../../Utils/Form/ResourceRuleForm";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import LabelRuleTable from "Common/UI/Components/LabelRule/LabelRuleTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import DataStoreLabelRule from "Common/Models/DatabaseModels/DataStoreLabelRule";
import React, { FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Label from "Common/Models/DatabaseModels/Label";

/*
 * Data Security > Settings > Label Rules: labels added to the data stores a
 * rule matches - by the store's labels, its name or description, or its
 * cloud tags - when a store is discovered (DataStoreLabelRuleEngineService).
 * The same two-step form as every label rule (Utils/Form/ResourceRuleForm):
 * what the rule matches, then the labels it adds.
 */
const DataStoreLabelRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  return (
    <LabelRuleTable<DataStoreLabelRule>
      modelType={DataStoreLabelRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(props, DataStoreLabelRule)}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.DATA_SECURITY_SETTINGS_LABEL_RULES,
      )}
      id="data-store-label-rules-table"
      name="Settings > Data Store Label Rules"
      userPreferencesKey="data-store-label-rules-table"
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Data Store Label Rules",
        description:
          "Auto-attach labels when matching data stores are discovered.",
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
          getElement: (item: DataStoreLabelRule): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
      ]}
      formSteps={getLabelRuleFormSteps<DataStoreLabelRule>()}
      formFields={[
        {
          field: { matchLabels: true },
          title: "Store Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Only trigger for data stores that already have at least one of these labels. Leave empty to skip the filter.",
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
        ...getLabelRuleActionFields<DataStoreLabelRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

export default DataStoreLabelRulesPage;
