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
import DockerSwarmClusterLabelRule from "Common/Models/DatabaseModels/DockerSwarmClusterLabelRule";
import React, { FunctionComponent, ReactElement } from "react";
import Label from "Common/Models/DatabaseModels/Label";

const dockerSwarmClusterLabelDocumentation: string = getLabelRuleHelpMarkdown({
  nouns: { singular: "Docker Swarm cluster", plural: "Docker Swarm clusters" },
});

const DockerSwarmClusterLabelRulesPage: FunctionComponent<
  RuleSettingsPageProps
> = (props: RuleSettingsPageProps): ReactElement => {
  return (
    <LabelRuleTable<DockerSwarmClusterLabelRule>
      modelType={DockerSwarmClusterLabelRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(
        props,
        DockerSwarmClusterLabelRule,
      )}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.DOCKER_SWARM_SETTINGS_LABEL_RULES,
      )}
      getRuleViewRoute={(rule: DockerSwarmClusterLabelRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.DOCKER_SWARM_SETTINGS_LABEL_RULE_VIEW,
          rule,
        );
      }}
      id="dockerSwarmCluster-label-rules-table"
      name="Settings > Docker Swarm Cluster Label Rules"
      userPreferencesKey="dockerSwarmCluster-label-rules-table"
      saveFilterProps={{
        tableId: "docker-swarm-cluster-label-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Docker Swarm Cluster Label Rules",
        description:
          "Auto-attach labels when matching Docker Swarm clusters are created.",
      }}
      helpContent={{
        title: "How Docker Swarm Cluster Label Rules Work",
        description:
          "Match Docker Swarm clusters and attach labels automatically.",
        markdown: dockerSwarmClusterLabelDocumentation,
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
          getElement: (item: DockerSwarmClusterLabelRule): ReactElement => {
            return <EnabledPill isEnabled={item.isEnabled} />;
          },
        },
      ]}
      formSteps={getLabelRuleFormSteps<DockerSwarmClusterLabelRule>()}
      formFields={[
        {
          field: { dockerSwarmClusterLabels: true },
          title: "Docker Swarm Cluster Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Only trigger for Docker Swarm clusters that already have at least one of these labels. Leave empty to skip the filter.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Docker Swarm Cluster Labels",
        },
        {
          field: { dockerSwarmClusterNamePattern: true },
          title: "Docker Swarm Cluster Name",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "Case-insensitive regex matched against the Docker Swarm cluster name and description.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "prod-.*",
        },
        {
          field: { dockerSwarmClusterDescriptionPattern: true },
          title: "Docker Swarm Cluster Description",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "production|critical",
        },
        ...getLabelRuleActionFields<DockerSwarmClusterLabelRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

export default DockerSwarmClusterLabelRulesPage;
