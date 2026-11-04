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
import OpenStackCloudOwnerRule from "Common/Models/DatabaseModels/OpenStackCloudOwnerRule";
import React, { FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Label from "Common/Models/DatabaseModels/Label";

const openStackCloudOwnerDocumentation: string = `
### How OpenStack Cloud Owner Rules Work

OpenStack Cloud Owner Rules add owner users and teams to an OpenStack cloud automatically when it matches your criteria — without anyone having to remember to assign owners.

### Match Criteria

A rule matches an OpenStack cloud only when **all** specified criteria pass. Empty criteria are skipped.

- **OpenStack Cloud Labels** — any-of (M2M)
- **Name / Description Pattern** — case-insensitive regex

### Action

When a rule matches, every user and team listed on the rule is added as an owner. Already-assigned owners are not duplicated. If \`Notify Owners\` is enabled (default), added owners are notified. Multiple matching rules all fire — the union of their owners ends up assigned.
`;

const OpenStackCloudOwnerRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  return (
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
          "Auto-assign owner users and teams when matching OpenStack clouds are created.",
      }}
      helpContent={{
        title: "How OpenStack Cloud Owner Rules Work",
        description:
          "Match OpenStack clouds and add owner users/teams automatically.",
        markdown: openStackCloudOwnerDocumentation,
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
          getElement: (item: OpenStackCloudOwnerRule): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
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
      ]}
      showRefreshButton={true}
    />
  );
};

export default OpenStackCloudOwnerRulesPage;
