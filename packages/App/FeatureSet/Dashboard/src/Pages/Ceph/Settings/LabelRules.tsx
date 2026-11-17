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
import CephClusterLabelRule from "Common/Models/DatabaseModels/CephClusterLabelRule";
import React, { FunctionComponent, ReactElement } from "react";
import Label from "Common/Models/DatabaseModels/Label";

const cephClusterLabelDocumentation: string = getLabelRuleHelpMarkdown({
  nouns: { singular: "Ceph cluster", plural: "Ceph clusters" },
});

const CephClusterLabelRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  return (
    <LabelRuleTable<CephClusterLabelRule>
      modelType={CephClusterLabelRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(props, CephClusterLabelRule)}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.CEPH_SETTINGS_LABEL_RULES,
      )}
      getRuleViewRoute={(rule: CephClusterLabelRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.CEPH_SETTINGS_LABEL_RULE_VIEW,
          rule,
        );
      }}
      id="cephCluster-label-rules-table"
      name="Settings > Ceph Cluster Label Rules"
      userPreferencesKey="cephCluster-label-rules-table"
      saveFilterProps={{
        tableId: "ceph-cluster-label-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Ceph Cluster Label Rules",
        description:
          "Auto-attach labels when matching Ceph clusters are created.",
      }}
      helpContent={{
        title: "How Ceph Cluster Label Rules Work",
        description: "Match Ceph clusters and attach labels automatically.",
        markdown: cephClusterLabelDocumentation,
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
          getElement: (item: CephClusterLabelRule): ReactElement => {
            return <EnabledPill isEnabled={item.isEnabled} />;
          },
        },
      ]}
      formSteps={getLabelRuleFormSteps<CephClusterLabelRule>()}
      formFields={[
        {
          field: { cephClusterLabels: true },
          title: "Ceph Cluster Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Only trigger for Ceph clusters that already have at least one of these labels. Leave empty to skip the filter.",
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
        ...getLabelRuleActionFields<CephClusterLabelRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

export default CephClusterLabelRulesPage;
