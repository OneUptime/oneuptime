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
import OpenStackCloudOwnerRule from "Common/Models/DatabaseModels/OpenStackCloudOwnerRule";
import React, { FunctionComponent, ReactElement } from "react";
import OpenStackScopedRulesCard from "../../../Components/OpenStack/OpenStackScopedRulesCard";
import OpenStackRuleScopeText, {
  getOpenStackRuleScopeFields,
} from "../../../Components/OpenStack/OpenStackRuleScope";
import Label from "Common/Models/DatabaseModels/Label";

const openStackCloudOwnerDocumentation: string = getOwnerRuleHelpMarkdown({
  nouns: { singular: "OpenStack cloud", plural: "OpenStack clouds" },
  topics: [
    {
      topic: "By Project and Domain",
      markdown: `A rule with no project or domain owns whole clouds. Give it an **OpenStack Project ID** or an **OpenStack Domain ID** and it adds no owner to the cloud: it adds its owners to every alert and incident a monitor opens that reaches that project or domain, on the clouds its other conditions allow.

A project's page and the **Domains** page fill these in for you. They match by ID, so renaming a project or a domain breaks nothing.`,
    },
  ],
});

const OpenStackCloudOwnerRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  return (
    <>
      <RuleTable<OpenStackCloudOwnerRule>
        modelType={OpenStackCloudOwnerRule}
        viewRuleId={RuleViewPageUtil.getViewRuleId(
          props,
          OpenStackCloudOwnerRule,
        )}
        listRoute={RuleViewPageUtil.getListRoute(
          PageMap.OPENSTACK_SETTINGS_OWNER_RULES,
        )}
        getRuleViewRoute={(rule: OpenStackCloudOwnerRule): Route => {
          return RuleViewPageUtil.getRuleViewRoute(
            PageMap.OPENSTACK_SETTINGS_OWNER_RULE_VIEW,
            rule,
          );
        }}
        id="openStackCloud-owner-rules-table"
        name="Settings > OpenStack Cloud Owner Rules"
        userPreferencesKey="openStackCloud-owner-rules-table"
        saveFilterProps={{
          tableId: "openstack-cloud-owner-rules-table",
        }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        createEditModalWidth={ModalWidth.Large}
        cardProps={{
          title: "OpenStack Cloud Owner Rules",
          description:
            "Auto-assign owner users and teams when matching OpenStack clouds are created, or to what opens on one project or domain of them.",
        }}
        helpContent={{
          title: "How OpenStack Cloud Owner Rules Work",
          description:
            "Match OpenStack clouds and add owner users/teams automatically.",
          markdown: openStackCloudOwnerDocumentation,
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
            getElement: (item: OpenStackCloudOwnerRule): ReactElement => {
              return <OpenStackRuleScopeText rule={item} />;
            },
          },
          {
            field: { isEnabled: true },
            title: "Status",
            type: FieldType.Boolean,
            getElement: (item: OpenStackCloudOwnerRule): ReactElement => {
              return <EnabledPill isEnabled={item.isEnabled} />;
            },
          },
        ]}
        formSteps={getOwnerRuleFormSteps<OpenStackCloudOwnerRule>()}
        formFields={[
          {
            field: { openStackCloudLabels: true },
            title: "OpenStack Cloud Labels",
            stepId: "match-criteria",
            sectionTitle: "Match by Attributes",
            sectionDescription:
              "Filter OpenStack clouds by labels. Leave empty to skip the filter.",
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
          ...getOwnerRuleActionFields<OpenStackCloudOwnerRule>(),
          ...getOpenStackRuleScopeFields<OpenStackCloudOwnerRule>("owners"),
        ]}
        showRefreshButton={true}
      />
      <div className="mt-5">
        <OpenStackScopedRulesCard mode="owner" />
      </div>
    </>
  );
};

export default OpenStackCloudOwnerRulesPage;
