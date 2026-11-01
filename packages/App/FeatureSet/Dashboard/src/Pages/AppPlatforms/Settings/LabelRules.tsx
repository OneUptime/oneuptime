import RuleSettingsPageProps from "../../RuleSettingsPageProps";
import PageMap from "../../../Utils/PageMap";
import RuleViewPageUtil from "../../../Utils/RuleViewPage";
import {
  getLabelRuleActionFields,
  getLabelRuleFormSteps,
} from "../../../Utils/Form/ResourceRuleForm";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import LabelRuleTable from "Common/UI/Components/LabelRule/LabelRuleTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import CloudResourceLabelRule from "Common/Models/DatabaseModels/CloudResourceLabelRule";
import { CloudResourceKind } from "Common/Types/Cloud/CloudResourceKind";
import EqualToOrNull from "Common/Types/BaseDatabase/EqualToOrNull";
import {
  CloudRuleName,
  getCloudRuleListKind,
  withCloudRuleKind,
} from "../../../Components/Cloud/CloudRuleKind";
import React, { FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Label from "Common/Models/DatabaseModels/Label";

// App Platforms' rules, and those made for both products before they split.
const cloudResourceKind: EqualToOrNull<string> = getCloudRuleListKind(
  CloudResourceKind.Environment,
);

/*
 * App Platforms > Settings > Label Rules: the rules for environments. A
 * rule made here is for environments only (CloudRuleKind); Cloud has its
 * own for the resources of its accounts.
 */
const AppPlatformsLabelRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  return (
    <LabelRuleTable<CloudResourceLabelRule>
      modelType={CloudResourceLabelRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(props, CloudResourceLabelRule)}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.APP_PLATFORMS_SETTINGS_LABEL_RULES,
      )}
      getRuleViewRoute={(rule: CloudResourceLabelRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.APP_PLATFORMS_SETTINGS_LABEL_RULE_VIEW,
          rule,
        );
      }}
      id="app-platforms-label-rules-table"
      name="Settings > Cloud Environment Label Rules"
      userPreferencesKey="app-platforms-label-rules-table"
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Cloud Environment Label Rules",
        description:
          "Auto-attach labels when matching environments are created.",
      }}
      /*
       * App Platforms' rules are for environments; Cloud has its own for the
       * resources of its accounts. A rule from before the two products
       * split is for both, and says so (CloudRuleKind).
       */
      query={{ cloudResourceKind: cloudResourceKind }}
      onBeforeCreate={withCloudRuleKind<CloudResourceLabelRule>(
        CloudResourceKind.Environment,
      )}
      sortBy="name"
      sortOrder={SortOrder.Ascending}
      selectMoreFields={{ isEnabled: true, cloudResourceKind: true }}
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
          type: FieldType.Element,
          getElement: (item: CloudResourceLabelRule): ReactElement => {
            return (
              <CloudRuleName rule={item} kind={CloudResourceKind.Environment} />
            );
          },
        },
        {
          field: { description: true },
          title: "Description",
          type: FieldType.Text,
        },
        {
          field: { isEnabled: true },
          title: "Status",
          type: FieldType.Boolean,
          getElement: (item: CloudResourceLabelRule): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
      ]}
      formSteps={getLabelRuleFormSteps<CloudResourceLabelRule>()}
      formFields={[
        {
          field: { matchLabels: true },
          title: "Environment Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Only trigger for environments that already have at least one of these labels. Leave empty to skip the filter.",
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
          title: "Environment Name",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "Case-insensitive regex matched against the environment name and description.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "checkout-.*",
        },
        {
          field: { descriptionRegexPattern: true },
          title: "Environment Description",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "production|critical",
        },
        ...getLabelRuleActionFields<CloudResourceLabelRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

export default AppPlatformsLabelRulesPage;
