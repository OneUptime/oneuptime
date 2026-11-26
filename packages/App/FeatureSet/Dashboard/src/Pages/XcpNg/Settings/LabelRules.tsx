import EnabledPill from "Common/UI/Components/Pill/EnabledPill";
import { getLabelRuleHelpMarkdown } from "../../../Utils/Help/ResourceRuleHelp";
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
import FieldType from "Common/UI/Components/Types/FieldType";
import XcpNgPoolLabelRule from "Common/Models/DatabaseModels/XcpNgPoolLabelRule";
import React, { FunctionComponent, ReactElement } from "react";
import Label from "Common/Models/DatabaseModels/Label";

const xcpNgPoolLabelDocumentation: string = getLabelRuleHelpMarkdown({
  nouns: { singular: "XCP-ng pool", plural: "XCP-ng pools" },
});

const XcpNgPoolLabelRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  return (
    <LabelRuleTable<XcpNgPoolLabelRule>
      modelType={XcpNgPoolLabelRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(props, XcpNgPoolLabelRule)}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.XCP_NG_SETTINGS_LABEL_RULES,
      )}
      getRuleViewRoute={(rule: XcpNgPoolLabelRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.XCP_NG_SETTINGS_LABEL_RULE_VIEW,
          rule,
        );
      }}
      id="xcpNgPool-label-rules-table"
      name="Settings > XCP-ng Pool Label Rules"
      userPreferencesKey="xcpNgPool-label-rules-table"
      saveFilterProps={{
        tableId: "xcp-ng-pool-label-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "XCP-ng Pool Label Rules",
        description:
          "Auto-attach labels when matching XCP-ng pools are created.",
      }}
      helpContent={{
        title: "How XCP-ng Pool Label Rules Work",
        description: "Match XCP-ng pools and attach labels automatically.",
        markdown: xcpNgPoolLabelDocumentation,
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
          getElement: (item: XcpNgPoolLabelRule): ReactElement => {
            return <EnabledPill isEnabled={item.isEnabled} />;
          },
        },
      ]}
      formSteps={getLabelRuleFormSteps<XcpNgPoolLabelRule>()}
      formFields={[
        {
          field: { xcpNgPoolLabels: true },
          title: "XCP-ng Pool Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Only trigger for XCP-ng pools that already have at least one of these labels. Leave empty to skip the filter.",
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
        ...getLabelRuleActionFields<XcpNgPoolLabelRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

export default XcpNgPoolLabelRulesPage;
