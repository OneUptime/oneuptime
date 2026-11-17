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
import KubernetesClusterOwnerRule from "Common/Models/DatabaseModels/KubernetesClusterOwnerRule";
import React, { FunctionComponent, ReactElement } from "react";
import Label from "Common/Models/DatabaseModels/Label";

const kubernetesClusterOwnerDocumentation: string = getOwnerRuleHelpMarkdown({
  nouns: { singular: "Kubernetes cluster", plural: "Kubernetes clusters" },
});

const KubernetesClusterOwnerRulesPage: FunctionComponent<
  RuleSettingsPageProps
> = (props: RuleSettingsPageProps): ReactElement => {
  return (
    <RuleTable<KubernetesClusterOwnerRule>
      modelType={KubernetesClusterOwnerRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(
        props,
        KubernetesClusterOwnerRule,
      )}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.KUBERNETES_SETTINGS_OWNER_RULES,
      )}
      getRuleViewRoute={(rule: KubernetesClusterOwnerRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.KUBERNETES_SETTINGS_OWNER_RULE_VIEW,
          rule,
        );
      }}
      id="kubernetesCluster-owner-rules-table"
      name="Settings > Kubernetes Cluster Owner Rules"
      userPreferencesKey="kubernetesCluster-owner-rules-table"
      saveFilterProps={{
        tableId: "kubernetes-cluster-owner-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Kubernetes Cluster Owner Rules",
        description:
          "Auto-assign owner users and teams when matching Kubernetes clusters are created.",
      }}
      helpContent={{
        title: "How Kubernetes Cluster Owner Rules Work",
        description:
          "Match Kubernetes clusters and add owner users/teams automatically.",
        markdown: kubernetesClusterOwnerDocumentation,
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
          getElement: (item: KubernetesClusterOwnerRule): ReactElement => {
            return <EnabledPill isEnabled={item.isEnabled} />;
          },
        },
      ]}
      formSteps={getOwnerRuleFormSteps<KubernetesClusterOwnerRule>()}
      formFields={[
        {
          field: { kubernetesClusterLabels: true },
          title: "Kubernetes Cluster Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Filter Kubernetes clusters by labels. Leave empty to skip the filter.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Kubernetes Cluster Labels",
        },
        {
          field: { kubernetesClusterNamePattern: true },
          title: "Kubernetes Cluster Name",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "Case-insensitive regex matched against the Kubernetes cluster name and description.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "prod-.*",
        },
        {
          field: { kubernetesClusterDescriptionPattern: true },
          title: "Kubernetes Cluster Description",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "production|critical",
        },
        ...getOwnerRuleActionFields<KubernetesClusterOwnerRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

export default KubernetesClusterOwnerRulesPage;
