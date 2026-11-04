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
import { Green, Red } from "Common/Types/BrandColors";
import Label from "Common/Models/DatabaseModels/Label";

const openStackCloudLabelDocumentation: string = `
### How OpenStack Cloud Label Rules Work

OpenStack Cloud Label Rules attach labels to an OpenStack cloud automatically when it matches your criteria — so you don't have to remember to tag new OpenStack clouds.

### Match Criteria

A rule matches an OpenStack cloud only when **all** specified criteria pass. Empty criteria are skipped.

- **OpenStack Cloud Labels** (prerequisite) — any-of
- **Name / Description Pattern** — case-insensitive regex

### Action

When a rule matches, every label listed in \`Labels to Add\` is attached to the OpenStack cloud. Already-attached labels are not duplicated. Multiple matching rules all fire — the union of their labels ends up attached.

### By project and domain

These rules label a whole cloud. To label what opens about one project or domain, add labels on the project's page or the Domains page. Those are listed under this table, and match by the project's ID, so a rename breaks nothing.
`;

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
            "Auto-attach labels when matching OpenStack clouds are created.",
        }}
        helpContent={{
          title: "How OpenStack Cloud Label Rules Work",
          description:
            "Match OpenStack clouds and attach labels automatically.",
          markdown: openStackCloudLabelDocumentation,
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
