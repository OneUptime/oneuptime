import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ProxmoxClusterOwnerRule from "Common/Models/DatabaseModels/ProxmoxClusterOwnerRule";
import React, { FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Label from "Common/Models/DatabaseModels/Label";
import Team from "Common/Models/DatabaseModels/Team";
import ProjectUser from "../../../Utils/ProjectUser";
import ProjectUtil from "Common/UI/Utils/Project";

const proxmoxClusterOwnerDocumentation: string = `
### How Proxmox Cluster Owner Rules Work

Proxmox Cluster Owner Rules add owner users and teams to a Proxmox cluster automatically when it matches your criteria — without anyone having to remember to assign owners.

### Match Criteria

A rule matches a Proxmox cluster only when **all** specified criteria pass. Empty criteria are skipped.

- **Proxmox Cluster Labels** — any-of (M2M)
- **Name / Description Pattern** — case-insensitive regex

### Action

When a rule matches, every user and team listed on the rule is added as an owner. Already-assigned owners are not duplicated. If \`Notify Owners\` is enabled (default), added owners are notified. Multiple matching rules all fire — the union of their owners ends up assigned.
`;

const ProxmoxClusterOwnerRulesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <ModelTable<ProxmoxClusterOwnerRule>
      modelType={ProxmoxClusterOwnerRule}
      id="proxmoxCluster-owner-rules-table"
      name="Settings > Proxmox Cluster Owner Rules"
      userPreferencesKey="proxmoxCluster-owner-rules-table"
      saveFilterProps={{
        tableId: "proxmox-cluster-owner-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Proxmox Cluster Owner Rules",
        description:
          "Auto-assign owner users and teams when matching Proxmox clusters are created.",
      }}
      helpContent={{
        title: "How Proxmox Cluster Owner Rules Work",
        description:
          "Match Proxmox clusters and add owner users/teams automatically.",
        markdown: proxmoxClusterOwnerDocumentation,
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
          getElement: (item: ProxmoxClusterOwnerRule): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
      ]}
      viewPageRoute={Navigation.getCurrentRoute()}
      formSteps={[
        { title: "Basic Info", id: "basic-info" },
        { title: "Match Criteria", id: "match-criteria", columns: 2 },
        { title: "Owners", id: "owners", columns: 2 },
      ]}
      formFields={[
        {
          field: { name: true },
          title: "Name",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "Assign team to matching Proxmox clusters",
          validation: { minLength: 2 },
        },
        {
          field: { description: true },
          title: "Description",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.LongText,
          required: false,
        },
        {
          field: { isEnabled: true },
          title: "Enabled",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          description: "Enable or disable this rule.",
        },
        {
          field: { notifyOwners: true },
          title: "Notify Owners",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          description:
            "Notify owners when they are added by this rule. Disable to add silently.",
        },
        {
          field: { proxmoxClusterLabels: true },
          title: "Proxmox Cluster Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Filter Proxmox clusters by labels. Leave empty to skip the filter.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Proxmox Cluster Labels (optional)",
        },
        {
          field: { proxmoxClusterNamePattern: true },
          title: "Proxmox Cluster Name Pattern",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "Case-insensitive regex matched against the Proxmox cluster name and description.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "prod-.*",
        },
        {
          field: { proxmoxClusterDescriptionPattern: true },
          title: "Proxmox Cluster Description Pattern",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "production|critical",
        },
        {
          field: { ownerTeams: true },
          title: "Owner Teams",
          stepId: "owners",
          sectionTitle: "Owners to Assign",
          sectionDescription:
            "When this rule matches, every selected user and team is added as an owner. Already-assigned owners are not duplicated.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Team,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Teams",
        },
        {
          field: { ownerUsers: true },
          title: "Owner Users",
          stepId: "owners",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          fetchDropdownOptions: async () => {
            return await ProjectUser.fetchProjectUsersAsDropdownOptions(
              ProjectUtil.getCurrentProjectId()!,
            );
          },
          required: false,
          placeholder: "Select Users",
        },
      ]}
      showRefreshButton={true}
    />
  );
};

export default ProxmoxClusterOwnerRulesPage;
