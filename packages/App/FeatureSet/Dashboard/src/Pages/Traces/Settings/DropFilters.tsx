import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red, Yellow } from "Common/Types/BrandColors";
import Navigation from "Common/UI/Utils/Navigation";
import TraceDropFilter from "Common/Models/DatabaseModels/TraceDropFilter";
import TraceDropFilterAction from "Common/Types/Trace/TraceDropFilterAction";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  getDropFilterFormSteps,
  getTraceDropFilterFormFields,
} from "../../../Components/Telemetry/DropFilterForm";
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

const documentationMarkdown: string = `
### How Trace Drop Filters Work

Drop filters let you **discard or sample spans before they are stored**, reducing storage costs and noise. They run **before** scrubbing or pipeline processing.

### Actions

| Action | Description |
|--------|-------------|
| **Drop** | Permanently discard all matching spans |
| **Sample** | Keep only a percentage of matching spans |

### Filter Query Syntax

**Available fields:** \`name\`, \`kind\`, \`statusCode\`, \`primaryEntityId\`, \`attributes.<key>\`

### Examples

- **Drop healthcheck spans:** \`name LIKE 'healthcheck'\` (action: Drop)
- **Sample successful CRUD:** \`kind = 'SPAN_KIND_CLIENT' AND statusCode != 2\` (action: Sample, 10%)

Status codes: \`0\` Unset, \`1\` Ok, \`2\` Error. Most instrumentation leaves successful spans **Unset** (the OpenTelemetry default) and sets **Error** only on failure, so match "not an error" with \`statusCode != 2\` rather than \`statusCode = 1\`.
`;

const TraceDropFilters: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();

  /*
   * Match (the name and the filter query), then Action (Drop picked, the
   * percentage for Sample, and the description and Enabled folded under
   * Advanced): Components/Telemetry/DropFilterForm, shared with Logs.
   */
  const formSteps: Array<FormStep<TraceDropFilter>> = useMemo((): Array<
    FormStep<TraceDropFilter>
  > => {
    return getDropFilterFormSteps<TraceDropFilter>();
  }, []);

  const formFields: Array<ModelField<TraceDropFilter>> = useMemo((): Array<
    ModelField<TraceDropFilter>
  > => {
    return getTraceDropFilterFormFields();
  }, []);

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
      createEditModalWidth={ModalWidth.Large}
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
      /*
       * Drop is the form's suggestion: the action has no server default (a
       * filter created without one is refused). Enabled starts from its
       * column default, on.
       */
      createInitialValues={{
        action: TraceDropFilterAction.Drop,
      }}
      onBeforeCreate={async (item: TraceDropFilter) => {
        // No sortOrder: the server puts a new filter at the end of the list.
        if (!item.action) {
          item.action = TraceDropFilterAction.Drop;
        }
        return item;
      }}
      formSteps={formSteps}
      formFields={formFields}
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
                  text={
                    item.samplePercentage
                      ? translator.translateTemplate("Sample {{percent}}%", {
                          percent: item.samplePercentage,
                        })
                      : "Sample"
                  }
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
        /*
         * A drop filter used to discard spans leaving no trace at all, so
         * "are my spans missing because of this filter?" was unanswerable
         * without reading the database. These two columns answer it.
         */
        {
          field: {
            droppedCount: true,
          },
          title: "Dropped",
          type: FieldType.Number,
          getElement: (item: TraceDropFilter): ReactElement => {
            const dropped: number = item.droppedCount || 0;

            if (dropped === 0) {
              return (
                <span className="text-sm text-gray-400">
                  {translator.translateText("Nothing dropped yet")}
                </span>
              );
            }

            return (
              <span className="text-sm text-gray-900">
                {dropped.toLocaleString()}
              </span>
            );
          },
        },
        {
          field: {
            lastDroppedAt: true,
          },
          title: "Last Dropped",
          type: FieldType.DateTime,
          noValueMessage: "Never",
        },
      ]}
    />
  );
};

export default TraceDropFilters;
