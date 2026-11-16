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
import ProxmoxClusterOwnerRule from "Common/Models/DatabaseModels/ProxmoxClusterOwnerRule";
import React, { FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Label from "Common/Models/DatabaseModels/Label";

const proxmoxClusterOwnerDocumentation: string = getOwnerRuleHelpMarkdown({
  nouns: { singular: "Proxmox cluster", plural: "Proxmox clusters" },
});

const ProxmoxClusterOwnerRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  return (
    <RuleTable<ProxmoxClusterOwnerRule>
      modelType={ProxmoxClusterOwnerRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(
        props,
        ProxmoxClusterOwnerRule,
      )}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.PROXMOX_SETTINGS_OWNER_RULES,
      )}
      getRuleViewRoute={(rule: ProxmoxClusterOwnerRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.PROXMOX_SETTINGS_OWNER_RULE_VIEW,
          rule,
        );
      }}
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
      formSteps={getOwnerRuleFormSteps<ProxmoxClusterOwnerRule>()}
      formFields={[
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
          placeholder: "Select Proxmox Cluster Labels",
        },
        {
          field: { proxmoxClusterNamePattern: true },
          title: "Proxmox Cluster Name",
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
          title: "Proxmox Cluster Description",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "production|critical",
        },
        ...getOwnerRuleActionFields<ProxmoxClusterOwnerRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

export default ProxmoxClusterOwnerRulesPage;
