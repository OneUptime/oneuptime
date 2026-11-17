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
import DockerHostOwnerRule from "Common/Models/DatabaseModels/DockerHostOwnerRule";
import React, { FunctionComponent, ReactElement } from "react";
import Label from "Common/Models/DatabaseModels/Label";

const dockerHostOwnerDocumentation: string = getOwnerRuleHelpMarkdown({
  nouns: { singular: "Docker host", plural: "Docker hosts" },
});

const DockerHostOwnerRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  return (
    <RuleTable<DockerHostOwnerRule>
      modelType={DockerHostOwnerRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(props, DockerHostOwnerRule)}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.DOCKER_SETTINGS_OWNER_RULES,
      )}
      getRuleViewRoute={(rule: DockerHostOwnerRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.DOCKER_SETTINGS_OWNER_RULE_VIEW,
          rule,
        );
      }}
      id="dockerHost-owner-rules-table"
      name="Settings > Docker Host Owner Rules"
      userPreferencesKey="dockerHost-owner-rules-table"
      saveFilterProps={{
        tableId: "docker-host-owner-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Docker Host Owner Rules",
        description:
          "Auto-assign owner users and teams when matching Docker hosts are created.",
      }}
      helpContent={{
        title: "How Docker Host Owner Rules Work",
        description:
          "Match Docker hosts and add owner users/teams automatically.",
        markdown: dockerHostOwnerDocumentation,
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
          getElement: (item: DockerHostOwnerRule): ReactElement => {
            return <EnabledPill isEnabled={item.isEnabled} />;
          },
        },
      ]}
      formSteps={getOwnerRuleFormSteps<DockerHostOwnerRule>()}
      formFields={[
        {
          field: { dockerHostLabels: true },
          title: "Docker Host Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Filter Docker hosts by labels. Leave empty to skip the filter.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Docker Host Labels",
        },
        {
          field: { dockerHostNamePattern: true },
          title: "Docker Host Name",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "Case-insensitive regex matched against the Docker host name and description.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "prod-.*",
        },
        {
          field: { dockerHostDescriptionPattern: true },
          title: "Docker Host Description",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "production|critical",
        },
        ...getOwnerRuleActionFields<DockerHostOwnerRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

export default DockerHostOwnerRulesPage;
