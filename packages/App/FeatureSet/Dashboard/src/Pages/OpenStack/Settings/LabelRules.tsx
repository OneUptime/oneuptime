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
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import OpenStackCloudLabelRule from "Common/Models/DatabaseModels/OpenStackCloudLabelRule";
import React, { FunctionComponent, ReactElement } from "react";
import OpenStackScopedRulesCard from "../../../Components/OpenStack/OpenStackScopedRulesCard";
import OpenStackRuleScopeText, {
  getOpenStackRuleScopeFields,
} from "../../../Components/OpenStack/OpenStackRuleScope";
import { Green, Red } from "Common/Types/BrandColors";
import Label from "Common/Models/DatabaseModels/Label";

const openStackCloudLabelDocumentation: string = getLabelRuleHelpMarkdown({
  nouns: { singular: "OpenStack cloud", plural: "OpenStack clouds" },
  topics: [
    {
      title: "By Project and Domain",
      markdown: `A rule with no project or domain labels whole clouds. Give it an **OpenStack Project ID** or an **OpenStack Domain ID** and it labels no cloud: it adds its labels to every alert and incident a monitor opens that reaches that project or domain, on the clouds its other conditions allow.

A project's page and the **Domains** page fill these in for you. They match by ID, so renaming a project or a domain breaks nothing.`,
    },
  ],
});

const OpenStackCloudLabelRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  return (
    <>
      <LabelRuleTable<OpenStackCloudLabelRule>
        modelType={OpenStackCloudLabelRule}
        viewRuleId={RuleViewPageUtil.getViewRuleId(
          props,
          OpenStackCloudLabelRule,
        )}
        listRoute={RuleViewPageUtil.getListRoute(
          PageMap.OPENSTACK_SETTINGS_LABEL_RULES,
        )}
        getRuleViewRoute={(rule: OpenStackCloudLabelRule): Route => {
          return RuleViewPageUtil.getRuleViewRoute(
            PageMap.OPENSTACK_SETTINGS_LABEL_RULE_VIEW,
            rule,
          );
        }}
        id="openStackCloud-label-rules-table"
        name="Settings > OpenStack Cloud Label Rules"
        userPreferencesKey="openStackCloud-label-rules-table"
        saveFilterProps={{
          tableId: "openstack-cloud-label-rules-table",
        }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        createEditModalWidth={ModalWidth.Large}
        cardProps={{
          title: "OpenStack Cloud Label Rules",
          description:
            "Auto-attach labels when matching OpenStack clouds are created, or to what opens on one project or domain of them.",
        }}
        helpContent={{
          title: "How OpenStack Cloud Label Rules Work",
          description:
            "Match OpenStack clouds and attach labels automatically.",
          markdown: openStackCloudLabelDocumentation,
        }}
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        selectMoreFields={{ isEnabled: true, openStackDomainId: true }}
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
            field: { openStackProjectId: true },
            title: "Reaches",
            type: FieldType.Element,
            getElement: (item: OpenStackCloudLabelRule): ReactElement => {
              return <OpenStackRuleScopeText rule={item} />;
            },
          },
          {
            field: { isEnabled: true },
            title: "Status",
            type: FieldType.Boolean,
            getElement: (item: OpenStackCloudLabelRule): ReactElement => {
              return item.isEnabled ? (
                <Pill color={Green} text="Enabled" />
              ) : (
                <Pill color={Red} text="Disabled" />
              );
            },
          },
        ]}
        formSteps={getLabelRuleFormSteps<OpenStackCloudLabelRule>()}
        formFields={[
          {
            field: { openStackCloudLabels: true },
            title: "OpenStack Cloud Labels",
            stepId: "match-criteria",
            sectionTitle: "Match by Attributes",
            sectionDescription:
              "Only trigger for OpenStack clouds that already have at least one of these labels. Leave empty to skip the filter.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select OpenStack Cloud Labels",
          },
          {
            field: { openStackCloudNamePattern: true },
            title: "OpenStack Cloud Name",
            stepId: "match-criteria",
            sectionTitle: "Match by Pattern",
            sectionDescription:
              "Case-insensitive regex matched against the OpenStack cloud name and description.",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "prod-.*",
          },
          {
            field: { openStackCloudDescriptionPattern: true },
            title: "OpenStack Cloud Description",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "production|critical",
          },
          ...getLabelRuleActionFields<OpenStackCloudLabelRule>(),
          ...getOpenStackRuleScopeFields<OpenStackCloudLabelRule>("labels"),
        ]}
        showRefreshButton={true}
      />
      <div className="mt-5">
        <OpenStackScopedRulesCard mode="label" />
      </div>
    </>
  );
};

export default OpenStackCloudLabelRulesPage;
