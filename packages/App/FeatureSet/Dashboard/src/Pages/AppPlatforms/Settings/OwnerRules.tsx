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
import { CloudResourceKind } from "Common/Types/Cloud/CloudResourceKind";
import EqualToOrNull from "Common/Types/BaseDatabase/EqualToOrNull";
import {
  CLOUD_ENVIRONMENT_RULE_CRITERIA_SUBJECT,
  CLOUD_ENVIRONMENT_RULE_RUN_NOUNS,
  CloudRuleName,
  getCloudRuleListKind,
  getCloudRuleWording,
  withCloudRuleKind,
} from "../../../Components/Cloud/CloudRuleKind";
import { RuleWording } from "Common/UI/Components/RuleRun/RuleView";
import React, { FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Label from "Common/Models/DatabaseModels/Label";

// App Platforms' rules, and those made for both products before they split.
const cloudResourceKind: EqualToOrNull<string> = getCloudRuleListKind(
  CloudResourceKind.Environment,
);

// The pill on a rule's own page, and what its Run Now runs over.
const RULE_WORDING: RuleWording<CloudResourceOwnerRule> =
  getCloudRuleWording<CloudResourceOwnerRule>(CloudResourceKind.Environment);

/*
 * App Platforms > Settings > Owner Rules: the rules for environments. A
 * rule made here is for environments only (CloudRuleKind); Cloud has its
 * own for the resources of its accounts.
 */
const AppPlatformsOwnerRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  return (
    <RuleTable<CloudResourceOwnerRule>
      modelType={CloudResourceOwnerRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(props, CloudResourceOwnerRule)}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.APP_PLATFORMS_SETTINGS_OWNER_RULES,
      )}
      getRuleViewRoute={(rule: CloudResourceOwnerRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.APP_PLATFORMS_SETTINGS_OWNER_RULE_VIEW,
          rule,
        );
      }}
      id="app-platforms-owner-rules-table"
      name="Settings > Cloud Environment Owner Rules"
      /*
       * The rule model is shared with Cloud, whose nouns it carries (cloud
       * resource owner rules): the create button, the pager, the
       * rule's own page (its Edit and Delete), its conditions ("All cloud
       * environments") and Run Now say what these rules are for.
       */
      singularName="Cloud Environment Owner Rule"
      pluralName="Cloud Environment Owner Rules"
      userPreferencesKey="app-platforms-owner-rules-table"
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Cloud Environment Owner Rules",
        description:
          "Auto-assign owners when matching environments are created.",
      }}
      /*
       * App Platforms' rules are for environments; Cloud has its own for the
       * resources of its accounts. A rule from before the two products
       * split is for both, and says so (CloudRuleKind).
       */
      query={{ cloudResourceKind: cloudResourceKind }}
      onBeforeCreate={withCloudRuleKind<CloudResourceOwnerRule>(
        CloudResourceKind.Environment,
      )}
      ruleCriteriaSubject={CLOUD_ENVIRONMENT_RULE_CRITERIA_SUBJECT}
      ruleRunNouns={CLOUD_ENVIRONMENT_RULE_RUN_NOUNS}
      ruleWording={RULE_WORDING}
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
          getElement: (item: CloudResourceOwnerRule): ReactElement => {
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
          title: "Environment Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Filter environments by labels. Leave empty to skip the filter.",
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
        ...getOwnerRuleActionFields<CloudResourceOwnerRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

export default AppPlatformsOwnerRulesPage;
