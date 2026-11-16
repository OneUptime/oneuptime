import PageComponentProps from "../../PageComponentProps";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { ModalType } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import {
  SwitchActionsResult,
  useSwitchActions,
} from "Common/UI/Components/BulkUpdate/BulkSwitchActions";
import FieldType from "Common/UI/Components/Types/FieldType";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";
import Navigation from "Common/UI/Utils/Navigation";
import LogPipeline from "Common/Models/DatabaseModels/LogPipeline";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";

const documentationMarkdown: string = `
A log pipeline changes logs as they arrive, before they are stored. It picks logs with a filter, then runs its processors on them in order: parse a text line into attributes, set the right severity, rename an attribute or tag a category.

## How It Works

1. Drop filters run first, then scrub rules. A log a drop filter drops never reaches a pipeline.
2. Every pipeline whose filter matches the log runs its processors on it, from the top of the list down. Drag a pipeline to change its place. A pipeline with no filter takes every log.
3. Open a pipeline to add its processors. They run in their own order, each on what the one before it left.

A pipeline changes the logs that arrive after you save it, within about a minute. Logs already stored stay as they are.

## Processors

| Processor | What it does |
|-----------|--------------|
| **Grok Parser** | Pulls fields out of a text line into attributes, with a grok pattern |
| **Key=Value Parser** | Splits a line of \`key=value\` pairs into attributes, whatever their order |
| **Severity Remapper** | Sets a log's severity from a field, such as \`level=warn\` |
| **Attribute Remapper** | Renames or copies an attribute |
| **Category Processor** | Sets an attribute to a category, by the first of its filters a log matches |

## Filter Queries

A filter picks logs by their fields:

| Operator | Example | Matches |
|----------|---------|---------|
| \`=\` | \`severityText = 'Error'\` | Exactly this value |
| \`!=\` | \`severityText != 'Debug'\` | Anything but this value |
| \`IN\` | \`severityText IN ('Error', 'Warning')\` | Any value in the list |
| \`LIKE\` | \`body LIKE 'timeout'\` | Text that contains this, in any case |
| \`AND\`, \`OR\` | \`severityText = 'Error' AND attributes.service = 'api'\` | Both, or either, of two conditions |

- **Fields:** \`severityText\`, \`body\`, \`primaryEntityId\` and \`attributes.<key>\`.
- **Severities:** \`Unspecified\`, \`Trace\`, \`Debug\`, \`Information\`, \`Warning\`, \`Error\` and \`Fatal\`. It is \`Information\`, not \`INFO\`, and \`Warning\`, not \`WARN\`.
- \`=\`, \`!=\` and \`IN\` are case-sensitive: \`'Error'\` matches, \`'ERROR'\` does not. Only \`LIKE\` ignores case.

## Examples

- **Fix a legacy app's severities**: a pipeline for \`attributes.source = 'legacy-app'\` with a **Severity Remapper** that reads \`level\` and maps \`warn\` to Warning, \`fatal\` to Fatal and \`info\` to Information.
- **Use one name for an attribute**: a pipeline with no filter and an **Attribute Remapper** from \`attributes.client_ip\` to \`attributes.source_address\`.
- **Sort errors into categories**: a pipeline for \`severityText IN ('Error', 'Fatal')\` with a **Category Processor** that writes \`error_category\`: "Database Error" for \`body LIKE 'connection'\`, "Timeout" for \`body LIKE 'timeout'\`.
`;

/*
 * A new pipeline is a name. It does nothing until it has a filter and
 * processors, and those are set up on its own page - so the create form asks
 * only for the name (the description folded under Advanced), and creating
 * one opens its page. Enabled is not asked: the column defaults to on, and a
 * pipeline with no processors changes nothing; it is switched off on its
 * page.
 */
const ADVANCED: FormFieldCollapsibleSection<LogPipeline> =
  getAdvancedFormSection<LogPipeline>();

type GetPipelineRouteFunction = (item: LogPipeline) => Route;

// The new pipeline's page, as the table's View opens it.
const getPipelineRoute: GetPipelineRouteFunction = (
  item: LogPipeline,
): Route => {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.LOGS_SETTINGS_PIPELINE_VIEW] as Route,
    {
      modelId: item._id as string,
    },
  );
};

const LogPipelines: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * Enable and Disable in Bulk Actions: a disabled pipeline no longer
   * transforms new logs. The list selects isEnabled for its Enabled column.
   */
  const {
    bulkActions: switchBulkActions,
    rowActions: switchRowActions,
  }: SwitchActionsResult<LogPipeline> = useSwitchActions<LogPipeline>({
    modelType: LogPipeline,
    column: "isEnabled",
  });

  return (
    <ModelTable<LogPipeline>
      modelType={LogPipeline}
      // Enable or Disable in each row's ⋯ menu: the one that changes the row.
      actionButtons={[...switchRowActions]}
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
      }}
      id="log-pipelines-table"
      name="Logs > Settings > Pipelines"
      userPreferencesKey="log-pipelines-table"
      saveFilterProps={{
        tableId: "log-pipelines-table",
      }}
      isDeleteable={true}
      bulkActions={{
        buttons: [...switchBulkActions],
      }}
      selectMoreFields={{
        isEnabled: true,
      }}
      isEditable={false}
      isCreateable={true}
      isViewable={true}
      sortBy="sortOrder"
      sortOrder={SortOrder.Ascending}
      enableDragAndDrop={true}
      dragDropIndexField="sortOrder"
      cardProps={{
        title: "Log Pipelines",
        description:
          "Transform and enrich logs at ingest time. Each pipeline matches logs using a filter, then runs processors in order to modify them. Click a pipeline to configure its filter and processors.",
      }}
      helpContent={{
        title: "How Log Pipelines Work",
        description:
          "Parse, fix and tag logs as they arrive, before they are stored.",
        markdown: documentationMarkdown,
      }}
      noItemsMessage={"No log pipelines found."}
      viewPageRoute={Navigation.getCurrentRoute()}
      formFields={[
        {
          field: {
            name: true,
          },
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "e.g. Parse Nginx Logs",
          validation: {
            minLength: 2,
          },
        },
        {
          field: {
            description: true,
          },
          title: "Description",
          fieldType: FormFieldSchemaType.LongText,
          required: false,
          placeholder: "Describe what this pipeline does.",
          collapsibleSection: ADVANCED,
        },
      ]}
      /*
       * Its filter and processors are what make a pipeline do anything,
       * and they are on its page: land there.
       */
      onCreateSuccess={(
        item: LogPipeline,
        modalType?: ModalType,
      ): Promise<LogPipeline> => {
        if (modalType === ModalType.Create && item._id) {
          Navigation.navigate(getPipelineRoute(item));
        }

        return Promise.resolve(item);
      }}
      showRefreshButton={true}
      showViewIdButton={true}
      filters={[
        {
          field: {
            name: true,
          },
          type: FieldType.Text,
          title: "Name",
        },
        {
          field: {
            isEnabled: true,
          },
          type: FieldType.Boolean,
          title: "Enabled",
        },
      ]}
      columns={[
        {
          field: {
            name: true,
          },
          title: "Name",
          type: FieldType.Text,
        },
        {
          field: {
            description: true,
          },
          title: "Description",
          type: FieldType.LongText,
        },
        {
          field: {
            isEnabled: true,
          },
          title: "Status",
          type: FieldType.Boolean,
          getElement: (item: LogPipeline): ReactElement => {
            if (item.isEnabled) {
              return <Pill color={Green} text="Enabled" />;
            }
            return <Pill color={Red} text="Disabled" />;
          },
        },
      ]}
    />
  );
};

export default LogPipelines;
