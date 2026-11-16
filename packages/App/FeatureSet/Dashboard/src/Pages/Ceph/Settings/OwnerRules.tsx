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
import CephClusterOwnerRule from "Common/Models/DatabaseModels/CephClusterOwnerRule";
import React, { FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Label from "Common/Models/DatabaseModels/Label";

const cephClusterOwnerDocumentation: string = getOwnerRuleHelpMarkdown({
  nouns: { singular: "Ceph cluster", plural: "Ceph clusters" },
});

const CephClusterOwnerRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  return (
    <RuleTable<CephClusterOwnerRule>
      modelType={CephClusterOwnerRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(props, CephClusterOwnerRule)}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.CEPH_SETTINGS_OWNER_RULES,
      )}
      getRuleViewRoute={(rule: CephClusterOwnerRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.CEPH_SETTINGS_OWNER_RULE_VIEW,
          rule,
        );
      }}
      id="cephCluster-owner-rules-table"
      name="Settings > Ceph Cluster Owner Rules"
      userPreferencesKey="cephCluster-owner-rules-table"
      saveFilterProps={{
        tableId: "ceph-cluster-owner-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Ceph Cluster Owner Rules",
        description:
          "Auto-assign owner users and teams when matching Ceph clusters are created.",
      }}
      helpContent={{
        title: "How Ceph Cluster Owner Rules Work",
        description:
          "Match Ceph clusters and add owner users/teams automatically.",
        markdown: cephClusterOwnerDocumentation,
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
          getElement: (item: CephClusterOwnerRule): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
      ]}
      formSteps={getOwnerRuleFormSteps<CephClusterOwnerRule>()}
      formFields={[
        {
          field: { cephClusterLabels: true },
          title: "Ceph Cluster Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Filter Ceph clusters by labels. Leave empty to skip the filter.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Ceph Cluster Labels",
        },
        {
          field: { cephClusterNamePattern: true },
          title: "Ceph Cluster Name",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "Case-insensitive regex matched against the Ceph cluster name and description.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "prod-.*",
        },
        {
          field: { cephClusterDescriptionPattern: true },
          title: "Ceph Cluster Description",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "production|critical",
        },
        ...getOwnerRuleActionFields<CephClusterOwnerRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

export default CephClusterOwnerRulesPage;
