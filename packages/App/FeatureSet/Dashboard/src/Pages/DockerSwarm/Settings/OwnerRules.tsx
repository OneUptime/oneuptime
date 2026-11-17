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
import DockerSwarmClusterOwnerRule from "Common/Models/DatabaseModels/DockerSwarmClusterOwnerRule";
import React, { FunctionComponent, ReactElement } from "react";
import Label from "Common/Models/DatabaseModels/Label";

const dockerSwarmClusterOwnerDocumentation: string = getOwnerRuleHelpMarkdown({
  nouns: { singular: "Docker Swarm cluster", plural: "Docker Swarm clusters" },
});

const DockerSwarmClusterOwnerRulesPage: FunctionComponent<
  RuleSettingsPageProps
> = (props: RuleSettingsPageProps): ReactElement => {
  return (
    <RuleTable<DockerSwarmClusterOwnerRule>
      modelType={DockerSwarmClusterOwnerRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(
        props,
        DockerSwarmClusterOwnerRule,
      )}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.DOCKER_SWARM_SETTINGS_OWNER_RULES,
      )}
      getRuleViewRoute={(rule: DockerSwarmClusterOwnerRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.DOCKER_SWARM_SETTINGS_OWNER_RULE_VIEW,
          rule,
        );
      }}
      id="dockerSwarmCluster-owner-rules-table"
      name="Settings > Docker Swarm Cluster Owner Rules"
      userPreferencesKey="dockerSwarmCluster-owner-rules-table"
      saveFilterProps={{
        tableId: "docker-swarm-cluster-owner-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Docker Swarm Cluster Owner Rules",
        description:
          "Auto-assign owner users and teams when matching Docker Swarm clusters are created.",
      }}
      helpContent={{
        title: "How Docker Swarm Cluster Owner Rules Work",
        description:
          "Match Docker Swarm clusters and add owner users/teams automatically.",
        markdown: dockerSwarmClusterOwnerDocumentation,
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
          getElement: (item: DockerSwarmClusterOwnerRule): ReactElement => {
            return <EnabledPill isEnabled={item.isEnabled} />;
          },
        },
      ]}
      formSteps={getOwnerRuleFormSteps<DockerSwarmClusterOwnerRule>()}
      formFields={[
        {
          field: { dockerSwarmClusterLabels: true },
          title: "Docker Swarm Cluster Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Filter Docker Swarm clusters by labels. Leave empty to skip the filter.",
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
        ...getOwnerRuleActionFields<DockerSwarmClusterOwnerRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

export default DockerSwarmClusterOwnerRulesPage;
