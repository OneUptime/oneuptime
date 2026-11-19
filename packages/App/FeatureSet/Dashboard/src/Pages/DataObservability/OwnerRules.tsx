import EnabledPill from "Common/UI/Components/Pill/EnabledPill";
import RuleSettingsPageProps from "../RuleSettingsPageProps";
import PageMap from "../../Utils/PageMap";
import RuleViewPageUtil from "../../Utils/RuleViewPage";
import { getOwnerRuleHelpMarkdown } from "../../Utils/Help/ResourceRuleHelp";
import {
  getOwnerRuleActionFields,
  getOwnerRuleFormSteps,
} from "../../Utils/Form/ResourceRuleForm";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import RuleTable from "Common/UI/Components/RuleRun/RuleTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import FieldType from "Common/UI/Components/Types/FieldType";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import DataAssetOwnerRule from "Common/Models/DatabaseModels/DataAssetOwnerRule";
import DataPipelineOwnerRule from "Common/Models/DatabaseModels/DataPipelineOwnerRule";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Label from "Common/Models/DatabaseModels/Label";

/*
 * Data Observability > Settings > Owner Rules: owners added by rule, to
 * tables and to pipelines, a tab each (#9527) - one kind of record, one
 * page. Table rules match a table by its labels, its name, its database or
 * its schema as tables are discovered (DataAssetOwnerRuleEngineService);
 * pipeline rules match a pipeline by its name or its namespace as
 * OneUptime first sees it (DataPipelineOwnerRuleEngineService). Both take
 * the same two-step form as every owner rule (Utils/Form/ResourceRuleForm):
 * what the rule matches, then who it adds. Routed as one rule's view page,
 * the page shows that rule through the table that lists it.
 */

const pipelineOwnerRuleDocumentation: string = getOwnerRuleHelpMarkdown({
  nouns: { singular: "pipeline", plural: "pipelines" },
  topics: [
    {
      topic: "When a Rule Runs",
      markdown:
        "A pipeline is added the first time OneUptime sees it run: from its OpenLineage events, its dbt artifacts, a Fivetran or Airbyte webhook, or a traced job. Its owners hear when a run fails or a run is late.",
    },
    {
      topic: "Name and Namespace",
      markdown:
        "**Pipeline Name** is matched against the job's name, such as `orders_daily.load_orders`, and **Namespace** against where it runs, such as `airflow://prod`. Both are case-insensitive regular expressions, and a pipeline has no labels to match.",
    },
  ],
});

interface RulesTableProps {
  // Set when the page is routed as this rule's view page.
  viewRuleId?: ObjectID | undefined;
}

const TableRulesTable: FunctionComponent<RulesTableProps> = (
  props: RulesTableProps,
): ReactElement => {
  return (
    <RuleTable<DataAssetOwnerRule>
      modelType={DataAssetOwnerRule}
      viewRuleId={props.viewRuleId}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.DATA_OBSERVABILITY_SETTINGS_OWNER_RULES,
      )}
      getRuleViewRoute={(rule: DataAssetOwnerRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.DATA_OBSERVABILITY_SETTINGS_OWNER_RULE_VIEW,
          rule,
        );
      }}
      id="data-asset-owner-rules-table"
      name="Data Observability > Table Owner Rules"
      userPreferencesKey="data-asset-owner-rules-table"
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Table Owner Rules",
        description: "Auto-assign owners when matching tables are discovered.",
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
          getElement: (item: DataAssetOwnerRule): ReactElement => {
            return <EnabledPill isEnabled={item.isEnabled} />;
          },
        },
      ]}
      formSteps={getOwnerRuleFormSteps<DataAssetOwnerRule>()}
      formFields={[
        {
          field: { matchLabels: true },
          title: "Table Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Filter tables by labels. Leave empty to skip the filter.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Labels",
        },
        {
          field: { nameRegexPattern: true },
          title: "Table Name",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "Case-insensitive regex matched against the table's name, the database it is in, and its schema.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "orders_.*",
        },
        {
          field: { databaseRegexPattern: true },
          title: "Database",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "warehouse|orders-db",
        },
        {
          field: { schemaRegexPattern: true },
          title: "Schema",
          stepId: "match-criteria",

          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "^billing$",
        },
        ...getOwnerRuleActionFields<DataAssetOwnerRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

const PipelineRulesTable: FunctionComponent<RulesTableProps> = (
  props: RulesTableProps,
): ReactElement => {
  return (
    <RuleTable<DataPipelineOwnerRule>
      modelType={DataPipelineOwnerRule}
      viewRuleId={props.viewRuleId}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.DATA_OBSERVABILITY_SETTINGS_OWNER_RULES,
      )}
      getRuleViewRoute={(rule: DataPipelineOwnerRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.DATA_OBSERVABILITY_SETTINGS_PIPELINE_OWNER_RULE_VIEW,
          rule,
        );
      }}
      id="data-pipeline-owner-rules-table"
      name="Data Observability > Pipeline Owner Rules"
      userPreferencesKey="data-pipeline-owner-rules-table"
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Pipeline Owner Rules",
        description:
          "Auto-assign owners when OneUptime first sees a matching pipeline run.",
      }}
      helpContent={{
        title: "How Pipeline Owner Rules Work",
        description: "Match pipelines and add owner users/teams automatically.",
        markdown: pipelineOwnerRuleDocumentation,
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
          getElement: (item: DataPipelineOwnerRule): ReactElement => {
            return <EnabledPill isEnabled={item.isEnabled} />;
          },
        },
      ]}
      formSteps={getOwnerRuleFormSteps<DataPipelineOwnerRule>()}
      formFields={[
        {
          field: { nameRegexPattern: true },
          title: "Pipeline Name",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "Case-insensitive regex matched against the pipeline's name and where it runs.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "orders_daily\\..*",
        },
        {
          field: { namespaceRegexPattern: true },
          title: "Namespace",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "^airflow://prod$",
        },
        ...getOwnerRuleActionFields<DataPipelineOwnerRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

const DataObservabilityOwnerRulesPage: FunctionComponent<
  RuleSettingsPageProps
> = (props: RuleSettingsPageProps): ReactElement => {
  const tableRuleId: ObjectID | undefined = RuleViewPageUtil.getViewRuleId(
    props,
    DataAssetOwnerRule,
  );
  const pipelineRuleId: ObjectID | undefined = RuleViewPageUtil.getViewRuleId(
    props,
    DataPipelineOwnerRule,
  );

  if (tableRuleId) {
    return <TableRulesTable viewRuleId={tableRuleId} />;
  }

  if (pipelineRuleId) {
    return <PipelineRulesTable viewRuleId={pipelineRuleId} />;
  }

  return (
    <Fragment>
      <Tabs
        label="Owner Rules"
        tabs={[
          {
            name: "Table Rules",
            children: <TableRulesTable />,
          },
          {
            name: "Pipeline Rules",
            children: <PipelineRulesTable />,
          },
        ]}
        onTabChange={() => {}}
      />
    </Fragment>
  );
};

export default DataObservabilityOwnerRulesPage;
