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
import DatabaseServerLabelRule from "Common/Models/DatabaseModels/DatabaseServerLabelRule";
import React, { FunctionComponent, ReactElement } from "react";
import Label from "Common/Models/DatabaseModels/Label";

const databaseServerLabelDocumentation: string = getLabelRuleHelpMarkdown({
  nouns: { singular: "database", plural: "databases" },
  topics: [
    {
      topic: "Matching Discovered Databases",
      markdown: `A database OneUptime discovers is named after its engine and endpoint, such as \`PostgreSQL db.prod:5432\`. So **Database Name** starts with \`PostgreSQL\` matches every PostgreSQL database.`,
    },
  ],
});

const DatabaseServerLabelRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  return (
    <LabelRuleTable<DatabaseServerLabelRule>
      modelType={DatabaseServerLabelRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(
        props,
        DatabaseServerLabelRule,
      )}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.DATABASE_SETTINGS_LABEL_RULES,
      )}
      getRuleViewRoute={(rule: DatabaseServerLabelRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.DATABASE_SETTINGS_LABEL_RULE_VIEW,
          rule,
        );
      }}
      id="database-server-label-rules-table"
      name="Settings > Database Label Rules"
      userPreferencesKey="database-server-label-rules-table"
      saveFilterProps={{
        tableId: "database-server-label-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Database Label Rules",
        description: "Auto-attach labels when matching databases are created.",
      }}
      helpContent={{
        title: "How Database Label Rules Work",
        description: "Match databases and attach labels automatically.",
        markdown: databaseServerLabelDocumentation,
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
          getElement: (item: DatabaseServerLabelRule): ReactElement => {
            return <EnabledPill isEnabled={item.isEnabled} />;
          },
        },
      ]}
      formSteps={getLabelRuleFormSteps<DatabaseServerLabelRule>()}
      formFields={[
        {
          field: { databaseServerLabels: true },
          title: "Database Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Only trigger for databases that already have at least one of these labels. Leave empty to skip the filter.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Database Labels",
        },
        {
          field: { databaseServerNamePattern: true },
          title: "Database Name",
          description: "Leave empty to match any name.",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "Case-insensitive regexes. Database names start with the engine, so ^PostgreSQL matches every PostgreSQL database.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "^PostgreSQL",
        },
        {
          field: { databaseServerDescriptionPattern: true },
          title: "Database Description",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "production|critical",
        },
        ...getLabelRuleActionFields<DatabaseServerLabelRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

export default DatabaseServerLabelRulesPage;
