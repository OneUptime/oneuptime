import { PillTone } from "Common/UI/Components/Pill/PillTone";
import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import {
  SwitchActionsResult,
  useSwitchActions,
} from "Common/UI/Components/BulkUpdate/BulkSwitchActions";
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
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useMemo,
} from "react";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import DropFilterImpactPreview from "../../../Components/Telemetry/DropFilterImpact/DropFilterImpactPreview";
import useDropFilterImpactConfirmation, {
  DropFilterImpactConfirmation,
  DropFilterSavePurpose,
} from "../../../Components/Telemetry/DropFilterImpact/useDropFilterImpactConfirmation";
import { getDropFilterRowConfirmation } from "../../../Components/Telemetry/DropFilterImpact/DropFilterRowSwitch";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { getReaderNumberLocale } from "Common/Types/DateLanguage";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";

const documentationMarkdown: string = `
A drop filter throws away spans you do not need, or keeps only a sample of them, before they are stored. Fewer noisy spans cost less and are easier to search.

## How It Works

- Drop filters run first, before scrub rules and pipelines: a dropped span is never stored or processed.
- Filters are checked from the top of the list down. Drag a filter to change its place. The first **Drop** filter a span matches drops it.
- A **Sample** filter keeps the share of matching spans you set, such as 10%, and drops the rest.
- The **Dropped** column counts what each filter has dropped, so you can see what it does.
- A filter changes the spans that arrive after you save it, within about a minute.

## What It Takes from Others

A filter takes what it matches from everything that reads it. As you write one, the form says how many of the last day's spans it matches, how many of those Security Events read, and which monitors, dashboards, recording rules, saved views and SLOs read the same spans. A **Sample** filter says what keeping only its share does: a Security Events rule that fires at 10 failed sign-ins needs about 100 when a tenth is kept.

When something reads what a filter takes, creating it or turning it on asks you to confirm. The filter is saved either way: the question is there so you decide knowing.

## Build a Filter

A span is one step of a request, such as a call to an API or a database query. A filter picks spans with conditions, and each condition is a **Field**, an **Operator** and a **Value**: **Span Name** · contains · \`healthcheck\`.

- **Fields:** **Span Name**, **Span Kind**, **Status**, **Status Message**, **Service ID**, **Has Exception** and **Is Root Span**, or any attribute with **Custom Attribute...**.
- **Operators:** **equals** and **does not equal** match the exact value, with its upper and lower case. **contains** finds the text anywhere, in any case, in a field you type into. **is one of** matches any of several values: on a field you pick from a list, such as **Status**, you pick them from the same list, and on any other you type them with commas between them.
- With more than one condition, pick **All conditions** or **Any condition**.

**Status** is **Error**, **Ok** or **Unset**. Most instrumentation leaves a successful span **Unset** (the OpenTelemetry default) and sets **Error** only on a failure, so match "not an error" with **Status** · does not equal · **Error**, not **Status** · equals · **Ok**.

## Examples

- **Drop health checks**: **Span Name** · contains · \`healthcheck\`, with **Drop**.
- **Keep a tenth of successful client calls**: **Span Kind** · equals · **Client** and **Status** · does not equal · **Error**, under **All conditions**, with **Sample** at 10%.
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

  /*
   * Under the query and under the action, what the filter would take as it
   * is written (#10436): what it matched in the last day, what Security
   * Events and the monitors, SLOs and dashboards that read it lose.
   */
  const formFields: Array<ModelField<TraceDropFilter>> = useMemo((): Array<
    ModelField<TraceDropFilter>
  > => {
    return getTraceDropFilterFormFields(
      (values: FormValues<TraceDropFilter>): ReactElement => {
        return (
          <DropFilterImpactPreview
            signal="trace"
            rule={values}
            dataTestId="drop-filter-form-impact"
          />
        );
      },
    );
  }, []);

  // Asks before a filter that takes what others read is created.
  const confirmation: DropFilterImpactConfirmation =
    useDropFilterImpactConfirmation();

  /*
   * Enable and Disable in Bulk Actions: a disabled drop filter keeps the spans it
   * would drop - how a set of them is paused while a problem is chased.
   */
  const {
    bulkActions: switchBulkActions,
    rowActions: switchRowActions,
  }: SwitchActionsResult<TraceDropFilter> = useSwitchActions<TraceDropFilter>({
    modelType: TraceDropFilter,
    column: "isEnabled",
    // Enable says what the filter would take, as the form does (#10436).
    getRowConfirmation: (data: {
      value: boolean;
      item: TraceDropFilter;
      name: string;
    }) => {
      return getDropFilterRowConfirmation({
        signal: "trace",
        value: data.value,
        item: data.item,
        name: data.name,
        singularName: new TraceDropFilter().singularName || "",
        tableName: new TraceDropFilter().tableName || "",
        translator,
      });
    },
  });

  return (
    <Fragment>
      {confirmation.confirmation}
      <ModelTable<TraceDropFilter>
        modelType={TraceDropFilter}
        // Enable or Disable in each row's ⋯ menu: the one that changes the row.
        actionButtons={[...switchRowActions]}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        id="trace-drop-filters-table"
        name="Traces > Settings > Drop Filters"
        userPreferencesKey="trace-drop-filters-table"
        isDeleteable={true}
        bulkActions={{
          buttons: [...switchBulkActions],
        }}
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
            "Drop or sample the spans you do not need, before they are stored.",
          markdown: documentationMarkdown,
        }}
        noItemsMessage={"No drop filters yet."}
        selectMoreFields={{
          samplePercentage: true,
          // Whether each row is on, for Enable and Disable to count.
          isEnabled: true,
          // The whole filter, for what Enable says it would take (#10436).
          filterQuery: true,
          action: true,
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

          // When something reads what it would take, ask once more (#10436).
          if (item.isEnabled !== false) {
            await confirmation.confirmOrCancel({
              signal: "trace",
              rule: item,
              purpose: DropFilterSavePurpose.Create,
            });
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
                    // Worded here either way: drawn as given (#8067).
                    text={
                      item.samplePercentage
                        ? translator.translateTemplate("Sample {{percent}}%", {
                            percent: item.samplePercentage,
                          })
                        : translator.translateText("Sample") || "Sample"
                    }
                    isUserContent={true}
                  />
                );
              }
              if (!item.action) {
                return <TableEmptyValue />;
              }
              return <Pill color={Red} text={item.action} />;
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
              return <Pill tone={PillTone.Paused} text="Disabled" />;
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
                  <span className="text-sm text-gray-500">
                    {translator.translateText("Nothing dropped yet")}
                  </span>
                );
              }

              return (
                <span className="text-sm text-gray-900">
                  {dropped.toLocaleString(getReaderNumberLocale())}
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
    </Fragment>
  );
};

export default TraceDropFilters;
