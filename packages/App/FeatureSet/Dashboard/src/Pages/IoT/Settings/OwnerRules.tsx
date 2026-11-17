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
import IoTFleetOwnerRule from "Common/Models/DatabaseModels/IoTFleetOwnerRule";
import React, { FunctionComponent, ReactElement } from "react";
import Label from "Common/Models/DatabaseModels/Label";

const iotFleetOwnerDocumentation: string = getOwnerRuleHelpMarkdown({
  nouns: { singular: "IoT fleet", plural: "IoT fleets" },
});

const IoTFleetOwnerRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  return (
    <RuleTable<IoTFleetOwnerRule>
      modelType={IoTFleetOwnerRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(props, IoTFleetOwnerRule)}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.IOT_SETTINGS_OWNER_RULES,
      )}
      getRuleViewRoute={(rule: IoTFleetOwnerRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.IOT_SETTINGS_OWNER_RULE_VIEW,
          rule,
        );
      }}
      id="iotFleet-owner-rules-table"
      name="Settings > IoT Fleet Owner Rules"
      userPreferencesKey="iotFleet-owner-rules-table"
      saveFilterProps={{
        tableId: "iot-fleet-owner-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "IoT Fleet Owner Rules",
        description:
          "Auto-assign owner users and teams when matching IoT fleets are created.",
      }}
      helpContent={{
        title: "How IoT Fleet Owner Rules Work",
        description:
          "Match IoT fleets and add owner users/teams automatically.",
        markdown: iotFleetOwnerDocumentation,
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
          getElement: (item: IoTFleetOwnerRule): ReactElement => {
            return <EnabledPill isEnabled={item.isEnabled} />;
          },
        },
      ]}
      formSteps={getOwnerRuleFormSteps<IoTFleetOwnerRule>()}
      formFields={[
        {
          field: { iotFleetLabels: true },
          title: "IoT Fleet Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Filter IoT fleets by labels. Leave empty to skip the filter.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select IoT Fleet Labels",
        },
        {
          field: { iotFleetNamePattern: true },
          title: "IoT Fleet Name",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "Case-insensitive regex matched against the IoT fleet name and description.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "prod-.*",
        },
        {
          field: { iotFleetDescriptionPattern: true },
          title: "IoT Fleet Description",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "production|critical",
        },
        ...getOwnerRuleActionFields<IoTFleetOwnerRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

export default IoTFleetOwnerRulesPage;
