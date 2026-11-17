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
import StatusPageLabelRule from "Common/Models/DatabaseModels/StatusPageLabelRule";
import React, { FunctionComponent, ReactElement } from "react";
import Label from "Common/Models/DatabaseModels/Label";

const statusPageLabelDocumentation: string = getLabelRuleHelpMarkdown({
  nouns: { singular: "status page", plural: "status pages" },
});

const StatusPageLabelRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  return (
    <LabelRuleTable<StatusPageLabelRule>
      modelType={StatusPageLabelRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(props, StatusPageLabelRule)}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.STATUS_PAGES_SETTINGS_LABEL_RULES,
      )}
      getRuleViewRoute={(rule: StatusPageLabelRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.STATUS_PAGES_SETTINGS_LABEL_RULE_VIEW,
          rule,
        );
      }}
      id="status-page-label-rules-table"
      name="Settings > Status Page Label Rules"
      userPreferencesKey="status-page-label-rules-table"
      saveFilterProps={{
        tableId: "status-page-label-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Status Page Label Rules",
        description:
          "Auto-attach labels when matching status pages are created.",
      }}
      helpContent={{
        title: "How Status Page Label Rules Work",
        description: "Match status pages and attach labels automatically.",
        markdown: statusPageLabelDocumentation,
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
          /*
           * An element, not a Boolean: a phone's card leaves out a Boolean
           * that is off, so a disabled rule showed no status at all.
           */
          type: FieldType.Element,
          getElement: (item: StatusPageLabelRule): ReactElement => {
            return <EnabledPill isEnabled={item.isEnabled} />;
          },
        },
      ]}
      formSteps={getLabelRuleFormSteps<StatusPageLabelRule>()}
      formFields={[
        {
          field: { statusPageLabels: true },
          title: "Status Page Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Only trigger for status pages that already have at least one of these labels. Leave empty to skip the filter.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Status Page Labels",
        },
        {
          field: { statusPageNamePattern: true },
          title: "Status Page Name",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "Case-insensitive regex matched against the status page name and description.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "public-.*",
        },
        {
          field: { statusPageDescriptionPattern: true },
          title: "Status Page Description",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "customer|external",
        },
        ...getLabelRuleActionFields<StatusPageLabelRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

export default StatusPageLabelRulesPage;
