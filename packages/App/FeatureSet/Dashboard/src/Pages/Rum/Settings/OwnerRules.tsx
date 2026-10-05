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
import RumApplicationOwnerRule from "Common/Models/DatabaseModels/RumApplicationOwnerRule";
import React, { FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Label from "Common/Models/DatabaseModels/Label";

const RumApplicationOwnerRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  return (
    <RuleTable<RumApplicationOwnerRule>
      modelType={RumApplicationOwnerRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(
        props,
        RumApplicationOwnerRule,
      )}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.RUM_SETTINGS_OWNER_RULES,
      )}
      getRuleViewRoute={(rule: RumApplicationOwnerRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.RUM_SETTINGS_OWNER_RULE_VIEW,
          rule,
        );
      }}
      id="rum-application-owner-rules-table"
      name="Settings > RUM Application Owner Rules"
      userPreferencesKey="rum-application-owner-rules-table"
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "RUM Application Owner Rules",
        description:
          "Auto-assign owners when matching RUM applications are created.",
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
          getElement: (item: RumApplicationOwnerRule): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
      ]}
      formSteps={getOwnerRuleFormSteps<RumApplicationOwnerRule>()}
      formFields={[
        {
          field: { matchLabels: true },
          title: "Application Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Filter applications by labels. Leave empty to skip the filter.",
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
          title: "Application Name",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "Case-insensitive regex matched against the application name and description.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "web-.*",
        },
        {
          field: { descriptionRegexPattern: true },
          title: "Application Description",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "production|critical",
        },
        ...getOwnerRuleActionFields<RumApplicationOwnerRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

export default RumApplicationOwnerRulesPage;
