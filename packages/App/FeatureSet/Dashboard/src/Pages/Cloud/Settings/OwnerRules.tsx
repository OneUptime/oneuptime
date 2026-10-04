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
import CloudResourceOwnerRule from "Common/Models/DatabaseModels/CloudResourceOwnerRule";
import React, { FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Label from "Common/Models/DatabaseModels/Label";

const CloudResourceOwnerRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  return (
    <RuleTable<CloudResourceOwnerRule>
      modelType={CloudResourceOwnerRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(props, CloudResourceOwnerRule)}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.CLOUD_SETTINGS_OWNER_RULES,
      )}
      getRuleViewRoute={(rule: CloudResourceOwnerRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.CLOUD_SETTINGS_OWNER_RULE_VIEW,
          rule,
        );
      }}
      id="cloud-resource-owner-rules-table"
      name="Settings > Cloud Resource Owner Rules"
      userPreferencesKey="cloud-resource-owner-rules-table"
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Cloud Resource Owner Rules",
        description:
          "Auto-assign owners when matching cloud resources are created.",
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
          getElement: (item: CloudResourceOwnerRule): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
      ]}
      formSteps={getOwnerRuleFormSteps<CloudResourceOwnerRule>()}
      formFields={[
        {
          field: { matchLabels: true },
          title: "Resource Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Filter resources by labels. Leave empty to skip the filter.",
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
          title: "Resource Name",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "Case-insensitive regex matched against the resource name and description.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "checkout-.*",
        },
        {
          field: { descriptionRegexPattern: true },
          title: "Resource Description",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "production|critical",
        },
        ...getOwnerRuleActionFields<CloudResourceOwnerRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

export default CloudResourceOwnerRulesPage;
