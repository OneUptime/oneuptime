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
import KubernetesClusterLabelRule from "Common/Models/DatabaseModels/KubernetesClusterLabelRule";
import React, { FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Label from "Common/Models/DatabaseModels/Label";

const kubernetesClusterLabelDocumentation: string = getLabelRuleHelpMarkdown({
  nouns: { singular: "Kubernetes cluster", plural: "Kubernetes clusters" },
});

const KubernetesClusterLabelRulesPage: FunctionComponent<
  RuleSettingsPageProps
> = (props: RuleSettingsPageProps): ReactElement => {
  return (
    <LabelRuleTable<KubernetesClusterLabelRule>
      modelType={KubernetesClusterLabelRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(
        props,
        KubernetesClusterLabelRule,
      )}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.KUBERNETES_SETTINGS_LABEL_RULES,
      )}
      getRuleViewRoute={(rule: KubernetesClusterLabelRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.KUBERNETES_SETTINGS_LABEL_RULE_VIEW,
          rule,
        );
      }}
      id="kubernetesCluster-label-rules-table"
      name="Settings > Kubernetes Cluster Label Rules"
      userPreferencesKey="kubernetesCluster-label-rules-table"
      saveFilterProps={{
        tableId: "kubernetes-cluster-label-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Kubernetes Cluster Label Rules",
        description:
          "Auto-attach labels when matching Kubernetes clusters are created.",
      }}
      helpContent={{
        title: "How Kubernetes Cluster Label Rules Work",
        description:
          "Match Kubernetes clusters and attach labels automatically.",
        markdown: kubernetesClusterLabelDocumentation,
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
          getElement: (item: KubernetesClusterLabelRule): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
      ]}
      formSteps={getLabelRuleFormSteps<KubernetesClusterLabelRule>()}
      formFields={[
        {
          field: { kubernetesClusterLabels: true },
          title: "Kubernetes Cluster Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Only trigger for Kubernetes clusters that already have at least one of these labels. Leave empty to skip the filter.",
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
        ...getLabelRuleActionFields<KubernetesClusterLabelRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

export default KubernetesClusterLabelRulesPage;
