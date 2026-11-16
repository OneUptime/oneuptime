import { getOwnerRuleHelpMarkdown } from "../../../Utils/Help/ResourceRuleHelp";
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
import HostOwnerRule from "Common/Models/DatabaseModels/HostOwnerRule";
import React, { FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Label from "Common/Models/DatabaseModels/Label";

const hostOwnerDocumentation: string = getOwnerRuleHelpMarkdown({
  nouns: { singular: "host", plural: "hosts" },
});

const HostOwnerRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  return (
    <RuleTable<HostOwnerRule>
      modelType={HostOwnerRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(props, HostOwnerRule)}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.HOST_SETTINGS_OWNER_RULES,
      )}
      getRuleViewRoute={(rule: HostOwnerRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.HOST_SETTINGS_OWNER_RULE_VIEW,
          rule,
        );
      }}
      id="host-owner-rules-table"
      name="Settings > Host Owner Rules"
      userPreferencesKey="host-owner-rules-table"
      saveFilterProps={{
        tableId: "host-owner-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Host Owner Rules",
        description:
          "Auto-assign owner users and teams when matching hosts are created.",
      }}
      helpContent={{
        title: "How Host Owner Rules Work",
        description: "Match hosts and add owner users/teams automatically.",
        markdown: hostOwnerDocumentation,
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
          getElement: (item: HostOwnerRule): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
      ]}
      formSteps={getOwnerRuleFormSteps<HostOwnerRule>()}
      formFields={[
        {
          field: { hostLabels: true },
          title: "Host Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Filter hosts by labels. Leave empty to skip the filter.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Host Labels",
        },
        {
          field: { hostNamePattern: true },
          title: "Host Name",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "Case-insensitive regex matched against the host name and description.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "prod-.*",
        },
        {
          field: { hostDescriptionPattern: true },
          title: "Host Description",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "production|critical",
        },
        ...getOwnerRuleActionFields<HostOwnerRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

export default HostOwnerRulesPage;
