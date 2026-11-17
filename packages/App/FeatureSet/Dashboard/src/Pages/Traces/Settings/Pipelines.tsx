import { PillTone } from "Common/UI/Components/Pill/PillTone";
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
import { Green } from "Common/Types/BrandColors";
import Navigation from "Common/UI/Utils/Navigation";
import TracePipeline from "Common/Models/DatabaseModels/TracePipeline";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";

const documentationMarkdown: string = `
A trace pipeline changes spans as they arrive, before they are stored. It picks spans with a filter, then runs its processors on them in order: rename an attribute or a span, set a span's status or kind, or tag a category.

## How It Works

1. Drop filters run first, then scrub rules. A span a drop filter drops never reaches a pipeline.
2. Every pipeline whose filter matches the span runs its processors on it, from the top of the list down. Drag a pipeline to change its place. A pipeline with no filter takes every span.
3. Open a pipeline to add its processors. They run in their own order, each on what the one before it left.

A pipeline changes the spans that arrive after you save it, within about a minute. Spans already stored keep what they had.

## Processors

| Processor | What it does |
|-----------|--------------|
| **Attribute Remapper** | Renames or copies an attribute |
| **Span Name Remapper** | Rewrites a span's name when a field has a value |
| **Status Remapper** | Sets a span's status from a field |
| **Span Kind Remapper** | Sets a span's kind from a field |
| **Category Processor** | Sets an attribute to a category, by the first of its filters a span matches |

## Filter Conditions

A pipeline's filter is built on its page, under **Filter Conditions**. Each condition is a **Field**, an **Operator** and a **Value**: **Span Kind** · equals · **Server**.

- **Fields:** **Span Name**, **Span Kind**, **Status**, **Status Message**, **Service ID**, **Has Exception** and **Is Root Span**, or any attribute with **Custom Attribute...**.
- **Operators:** **equals** and **does not equal** match the exact value. **contains** finds the text anywhere, in any case. **is one of** takes a list of values separated by commas.
- With more than one condition, pick **All conditions** or **Any condition**.

## Example: Mark Successful HTTP Spans as Ok

Most instrumentation leaves a successful span **Unset**, the OpenTelemetry default, and sets **Error** only on a failure, so Unset already means "no error". To show successful requests as **Ok**:

1. Create a pipeline whose filter is **Status** · equals · **Unset**, so a span marked Error is never changed.
2. Add a **Status Remapper** that reads \`http.response.status_code\` (older SDKs write \`http.status_code\`), with one mapping per code: \`200\` → Ok, \`201\` → Ok, \`204\` → Ok and \`304\` → Ok. Each mapping matches one exact value.
`;

/*
 * A new pipeline is a name. It does nothing until it has a filter and
 * processors, and those are set up on its own page - so the create form asks
 * only for the name (the description folded under Advanced), and creating
 * one opens its page. Enabled is not asked: the column defaults to on, and a
 * pipeline with no processors changes nothing; it is switched off on its
 * page.
 */
const ADVANCED: FormFieldCollapsibleSection<TracePipeline> =
  getAdvancedFormSection<TracePipeline>();

type GetPipelineRouteFunction = (item: TracePipeline) => Route;

// The new pipeline's page, as the table's View opens it.
const getPipelineRoute: GetPipelineRouteFunction = (
  item: TracePipeline,
): Route => {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.TRACES_SETTINGS_PIPELINE_VIEW] as Route,
    {
      modelId: item._id as string,
    },
  );
};

const TracePipelines: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * Enable and Disable in Bulk Actions: a disabled pipeline no longer
   * transforms new spans. The list selects isEnabled for its Enabled column.
   */
  const {
    bulkActions: switchBulkActions,
    rowActions: switchRowActions,
  }: SwitchActionsResult<TracePipeline> = useSwitchActions<TracePipeline>({
    modelType: TracePipeline,
    column: "isEnabled",
  });

  return (
    <ModelTable<TracePipeline>
      modelType={TracePipeline}
      // Enable or Disable in each row's ⋯ menu: the one that changes the row.
      actionButtons={[...switchRowActions]}
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
      }}
      id="trace-pipelines-table"
      name="Traces > Settings > Pipelines"
      userPreferencesKey="trace-pipelines-table"
      saveFilterProps={{
        tableId: "trace-pipelines-table",
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
        title: "Trace Pipelines",
        description:
          "Transform and enrich spans at ingest time. Each pipeline matches spans using a filter, then runs processors in order to modify them. Click a pipeline to configure its filter and processors.",
      }}
      helpContent={{
        title: "How Trace Pipelines Work",
        description:
          "Rename, fix and tag spans as they arrive, before they are stored.",
        markdown: documentationMarkdown,
      }}
      noItemsMessage={"No trace pipelines yet."}
      viewPageRoute={Navigation.getCurrentRoute()}
      formFields={[
        {
          field: {
            name: true,
          },
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "e.g. Normalize HTTP Spans",
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
        item: TracePipeline,
        modalType?: ModalType,
      ): Promise<TracePipeline> => {
        if (modalType === ModalType.Create && item._id) {
          Navigation.navigate(getPipelineRoute(item));
        }

        return Promise.resolve(item);
      }}
      showRefreshButton={true}
      searchableFields={["name", "description"]}
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
          getElement: (item: TracePipeline): ReactElement => {
            if (item.isEnabled) {
              return <Pill color={Green} text="Enabled" />;
            }
            return <Pill tone={PillTone.Paused} text="Disabled" />;
          },
        },
      ]}
    />
  );
};

export default TracePipelines;
