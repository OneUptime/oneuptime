import RuleSettingsPageProps from "../../RuleSettingsPageProps";
import PageMap from "../../../Utils/PageMap";
import RuleViewPageUtil from "../../../Utils/RuleViewPage";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import LabelRuleTable from "Common/UI/Components/LabelRule/LabelRuleTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import DatabaseServerLabelRule from "Common/Models/DatabaseModels/DatabaseServerLabelRule";
import React, { FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Label from "Common/Models/DatabaseModels/Label";

const databaseServerLabelDocumentation: string = `
### How Database Label Rules Work

Database Label Rules attach labels to a database automatically when it matches your criteria — so you don't have to remember to tag new databases.

### Match Criteria

A rule matches a database only when **all** specified criteria pass. Empty criteria are skipped.

- **Database Labels** (prerequisite) — any-of
- **Name / Description Pattern** — case-insensitive regex. Discovered databases are named after their engine and endpoint (\`PostgreSQL db.prod:5432\`), so \`^PostgreSQL\` matches every PostgreSQL database.

### Action

When a rule matches, every label listed in \`Labels to Add\` is attached to the database. Already-attached labels are not duplicated. Multiple matching rules all fire — the union of their labels ends up attached.
`;

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
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
      ]}
      formSteps={[
        { title: "Basic Info", id: "basic-info" },
        { title: "Match Criteria", id: "match-criteria", columns: 2 },
        { title: "Labels", id: "labels", columns: 2 },
      ]}
      formFields={[
        {
          field: { name: true },
          title: "Name",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "Tag matching databases",
          validation: { minLength: 2 },
        },
        {
          field: { description: true },
          title: "Description",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.LongText,
          required: false,
        },
        {
          field: { isEnabled: true },
          title: "Enabled",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          description: "Enable or disable this rule.",
        },
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
          placeholder: "Select Database Labels (optional)",
        },
        {
          field: { databaseServerNamePattern: true },
          title: "Database Name Pattern",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "Case-insensitive regex matched against the database name and description. Names start with the engine, so ^PostgreSQL matches every PostgreSQL database.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "^PostgreSQL",
        },
        {
          field: { databaseServerDescriptionPattern: true },
          title: "Database Description Pattern",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "production|critical",
        },
        {
          field: { labelsToAdd: true },
          title: "Labels to Add",
          stepId: "labels",
          sectionTitle: "Labels to Attach",
          sectionDescription:
            "When this rule matches, every selected label is attached to the database. Already-attached labels are not duplicated.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Labels",
        },
      ]}
      showRefreshButton={true}
    />
  );
};

export default DatabaseServerLabelRulesPage;
