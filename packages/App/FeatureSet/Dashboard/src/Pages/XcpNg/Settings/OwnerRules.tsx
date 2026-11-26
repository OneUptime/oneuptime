import EnabledPill from "Common/UI/Components/Pill/EnabledPill";
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
import FieldType from "Common/UI/Components/Types/FieldType";
import XcpNgPoolOwnerRule from "Common/Models/DatabaseModels/XcpNgPoolOwnerRule";
import React, { FunctionComponent, ReactElement } from "react";
import Label from "Common/Models/DatabaseModels/Label";

const xcpNgPoolOwnerDocumentation: string = getOwnerRuleHelpMarkdown({
  nouns: { singular: "XCP-ng pool", plural: "XCP-ng pools" },
});

const XcpNgPoolOwnerRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  return (
    <RuleTable<XcpNgPoolOwnerRule>
      modelType={XcpNgPoolOwnerRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(props, XcpNgPoolOwnerRule)}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.XCP_NG_SETTINGS_OWNER_RULES,
      )}
      getRuleViewRoute={(rule: XcpNgPoolOwnerRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.XCP_NG_SETTINGS_OWNER_RULE_VIEW,
          rule,
        );
      }}
      id="xcpNgPool-owner-rules-table"
      name="Settings > XCP-ng Pool Owner Rules"
      userPreferencesKey="xcpNgPool-owner-rules-table"
      saveFilterProps={{
        tableId: "xcp-ng-pool-owner-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "XCP-ng Pool Owner Rules",
        description:
          "Auto-assign owner users and teams when matching XCP-ng pools are created.",
      }}
      helpContent={{
        title: "How XCP-ng Pool Owner Rules Work",
        description:
          "Match XCP-ng pools and add owner users/teams automatically.",
        markdown: xcpNgPoolOwnerDocumentation,
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
          getElement: (item: XcpNgPoolOwnerRule): ReactElement => {
            return <EnabledPill isEnabled={item.isEnabled} />;
          },
        },
      ]}
      formSteps={getOwnerRuleFormSteps<XcpNgPoolOwnerRule>()}
      formFields={[
        {
          field: { xcpNgPoolLabels: true },
          title: "XCP-ng Pool Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Filter XCP-ng pools by labels. Leave empty to skip the filter.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select XCP-ng Pool Labels",
        },
        {
          field: { xcpNgPoolNamePattern: true },
          title: "XCP-ng Pool Name",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "Case-insensitive regex matched against the XCP-ng pool name and description.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "prod-.*",
        },
        {
          field: { xcpNgPoolDescriptionPattern: true },
          title: "XCP-ng Pool Description",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "production|critical",
        },
        ...getOwnerRuleActionFields<XcpNgPoolOwnerRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

export default XcpNgPoolOwnerRulesPage;
