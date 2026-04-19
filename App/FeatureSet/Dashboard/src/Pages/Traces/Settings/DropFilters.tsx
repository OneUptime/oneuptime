import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red, Yellow } from "Common/Types/BrandColors";
import Navigation from "Common/UI/Utils/Navigation";
import TraceDropFilter from "Common/Models/DatabaseModels/TraceDropFilter";
import TraceDropFilterAction from "Common/Types/Trace/TraceDropFilterAction";
import ProjectUtil from "Common/UI/Utils/Project";
import FilterQueryBuilderField from "../../../Components/FilterQueryBuilder/FilterQueryBuilderField";
import TraceFilterConfig from "../../../Components/FilterQueryBuilder/TraceFilterConfig";
import React, { FunctionComponent, ReactElement } from "react";

const documentationMarkdown: string = `
### How Trace Drop Filters Work

Drop filters let you **discard or sample spans before they are stored**, reducing storage costs and noise. They run **before** scrubbing or pipeline processing.

### Actions

| Action | Description |
|--------|-------------|
| **Drop** | Permanently discard all matching spans |
| **Sample** | Keep only a percentage of matching spans |

### Filter Query Syntax

**Available fields:** \`name\`, \`kind\`, \`statusCode\`, \`serviceId\`, \`attributes.<key>\`

### Examples

- **Drop healthcheck spans:** \`name LIKE '%healthcheck%'\` (action: Drop)
- **Sample successful CRUD:** \`kind = 'SPAN_KIND_CLIENT' AND statusCode = 1\` (action: Sample, 10%)
`;

const TraceDropFilters: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <ModelTable<TraceDropFilter>
      modelType={TraceDropFilter}
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
      }}
      id="trace-drop-filters-table"
      name="Traces > Settings > Drop Filters"
      userPreferencesKey="trace-drop-filters-table"
      isDeleteable={false}
      isEditable={false}
      isCreateable={true}
      isViewable={true}
      sortBy="sortOrder"
      sortOrder={SortOrder.Ascending}
      enableDragAndDrop={true}
      dragDropIndexField="sortOrder"
      cardProps={{
        title: "Trace Drop Filters",
        description:
          "Discard or sample spans before they are stored to reduce noise and storage costs. Click a filter to configure its conditions and action.",
      }}
      helpContent={{
        title: "How Trace Drop Filters Work",
        description:
          "Understanding drop vs sample actions, filter queries, and how spans are discarded at ingest time",
        markdown: documentationMarkdown,
      }}
      noItemsMessage={"No drop filters found."}
      selectMoreFields={{
        samplePercentage: true,
      }}
      viewPageRoute={Navigation.getCurrentRoute()}
      createInitialValues={{
        isEnabled: true,
        action: TraceDropFilterAction.Drop,
      }}
      onBeforeCreate={async (item: TraceDropFilter) => {
        if (!item.sortOrder) {
          item.sortOrder = 1;
        }
        if (!item.action) {
          item.action = TraceDropFilterAction.Drop;
        }
        if (item.isEnabled === undefined || item.isEnabled === null) {
          item.isEnabled = true;
        }
        return item;
      }}
      formFields={[
        {
          field: {
            name: true,
          },
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "e.g. Drop Healthcheck Spans",
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
          placeholder: "Describe what this filter does.",
        },
        {
          field: {
            filterQuery: true,
          },
          title: "Filter Query",
          description:
            "Which spans this filter applies to. Build rules with fields like span name, kind, status, service, or custom attributes.",
          fieldType: FormFieldSchemaType.CustomComponent,
          required: true,
          getCustomElement: (
            values: FormValues<TraceDropFilter>,
            fieldProps: CustomElementProps,
          ): ReactElement => {
            return (
              <FilterQueryBuilderField
                initialValue={(values.filterQuery as string) || ""}
                onChange={(value: string) => {
                  if (fieldProps.onChange) {
                    fieldProps.onChange(value);
                  }
                }}
                error={fieldProps.error}
                config={TraceFilterConfig}
              />
            );
          },
        },
        {
          field: {
            action: true,
          },
          title: "Action",
          fieldType: FormFieldSchemaType.Dropdown,
          required: true,
          dropdownOptions: [
            { label: "Drop", value: "drop" },
            { label: "Sample", value: "sample" },
          ],
        },
        {
          field: {
            samplePercentage: true,
          },
          title: "Sample Percentage",
          description:
            "Only applies when Action is Sample. Percentage of matching spans to keep (e.g. 10 = keep 10%, discard 90%).",
          fieldType: FormFieldSchemaType.Number,
          required: false,
          placeholder: "e.g. 10",
        },
        {
          field: {
            isEnabled: true,
          },
          title: "Enabled",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
        },
      ]}
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
            action: true,
          },
          type: FieldType.Text,
          title: "Action",
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
          noValueMessage: "-",
          title: "Description",
          type: FieldType.LongText,
        },
        {
          field: {
            action: true,
          },
          title: "Action",
          type: FieldType.Text,
          getElement: (item: TraceDropFilter): ReactElement => {
            if (item.action === "drop") {
              return <Pill color={Red} text="Drop" />;
            }
            if (item.action === "sample") {
              return (
                <Pill
                  color={Yellow}
                  text={`Sample ${item.samplePercentage ? item.samplePercentage + "%" : ""}`}
                />
              );
            }
            return <Pill color={Red} text={item.action || "-"} />;
          },
        },
        {
          field: {
            isEnabled: true,
          },
          title: "Status",
          type: FieldType.Boolean,
          getElement: (item: TraceDropFilter): ReactElement => {
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

export default TraceDropFilters;
