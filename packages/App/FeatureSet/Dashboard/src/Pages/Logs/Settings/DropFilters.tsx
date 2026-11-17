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
import LogDropFilter from "Common/Models/DatabaseModels/LogDropFilter";
import LogDropFilterAction from "Common/Types/Log/LogDropFilterAction";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  getDropFilterFormSteps,
  getLogDropFilterFormFields,
} from "../../../Components/Telemetry/DropFilterForm";
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { getReaderNumberLocale } from "Common/Types/DateLanguage";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";

const documentationMarkdown: string = `
A drop filter throws away logs you do not need, or keeps only a sample of them, before they are stored. Fewer noisy logs cost less and are easier to search.

## How It Works

- Drop filters run first, before scrub rules and pipelines: a dropped log is never stored or processed.
- Filters are checked from the top of the list down. Drag a filter to change its place. The first **Drop** filter a log matches drops it.
- A **Sample** filter keeps the share of matching logs you set, such as 10% (about 1 in 10), and drops the rest.
- The **Dropped** column counts what each filter has dropped, so you can see what it does.
- A filter changes the logs that arrive after you save it, within about a minute.

## Filter Queries

| Operator | Example | Matches |
|----------|---------|---------|
| \`=\` | \`severityText = 'Debug'\` | Exactly this value |
| \`!=\` | \`severityText != 'Error'\` | Anything but this value |
| \`IN\` | \`severityText IN ('Debug', 'Trace')\` | Any value in the list |
| \`LIKE\` | \`body LIKE 'healthcheck'\` | Text that contains this, in any case (\`%\` stands for any text) |
| \`AND\`, \`OR\` | \`severityText = 'Debug' AND attributes.source = 'loadbalancer'\` | Both, or either, of two conditions |

- **Fields:** \`severityText\`, \`body\`, \`primaryEntityId\` and \`attributes.<key>\`.
- **Severities:** \`Unspecified\`, \`Trace\`, \`Debug\`, \`Information\`, \`Warning\`, \`Error\` and \`Fatal\`. It is \`Information\`, not \`INFO\`, and \`Warning\`, not \`WARN\`.
- \`=\`, \`!=\` and \`IN\` are case-sensitive: \`'Debug'\` matches, \`'DEBUG'\` does not. Only \`LIKE\` ignores case.

## Examples

- **Drop every debug log**: \`severityText = 'Debug'\`, with **Drop**.
- **Keep a few health checks**: \`body LIKE 'healthcheck' AND severityText = 'Information'\`, with **Sample** at 5%: enough to spot a trend, without the noise.
- **Drop the internal load balancer's logs**: \`attributes.source = 'internal-lb'\`, with **Drop**.

## Tips

- Not sure? Sample at 50% first, and see what you lose before you drop it all.
- Keep each filter narrow, so it never catches logs you need.
`;

const LogDropFilters: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();

  /*
   * Match (the name and the filter query), then Action (Drop picked, the
   * percentage for Sample, and the description and Enabled folded under
   * Advanced): Components/Telemetry/DropFilterForm, shared with Traces.
   */
  const formSteps: Array<FormStep<LogDropFilter>> = useMemo((): Array<
    FormStep<LogDropFilter>
  > => {
    return getDropFilterFormSteps<LogDropFilter>();
  }, []);

  const formFields: Array<ModelField<LogDropFilter>> = useMemo((): Array<
    ModelField<LogDropFilter>
  > => {
    return getLogDropFilterFormFields();
  }, []);

  /*
   * Enable and Disable in Bulk Actions: a disabled drop filter keeps the logs it
   * would drop - how a set of them is paused while a problem is chased.
   */
  const {
    bulkActions: switchBulkActions,
    rowActions: switchRowActions,
  }: SwitchActionsResult<LogDropFilter> = useSwitchActions<LogDropFilter>({
    modelType: LogDropFilter,
    column: "isEnabled",
  });

  return (
    <ModelTable<LogDropFilter>
      modelType={LogDropFilter}
      // Enable or Disable in each row's ⋯ menu: the one that changes the row.
      actionButtons={[...switchRowActions]}
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
      }}
      id="log-drop-filters-table"
      name="Logs > Settings > Drop Filters"
      userPreferencesKey="log-drop-filters-table"
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
        title: "Log Drop Filters",
        description:
          "Discard or sample logs before they are stored to reduce noise and storage costs. Click a filter to configure its conditions and action.",
      }}
      helpContent={{
        title: "How Log Drop Filters Work",
        description:
          "Drop or sample the logs you do not need, before they are stored.",
        markdown: documentationMarkdown,
      }}
      noItemsMessage={"No drop filters found."}
      selectMoreFields={{
        samplePercentage: true,
        // Whether each row is on, for Enable and Disable to count.
        isEnabled: true,
      }}
      viewPageRoute={Navigation.getCurrentRoute()}
      /*
       * Drop is the form's suggestion: the action has no server default (a
       * filter created without one is refused). Enabled starts from its
       * column default, on.
       */
      createInitialValues={{
        action: LogDropFilterAction.Drop,
      }}
      onBeforeCreate={async (item: LogDropFilter) => {
        // No sortOrder: the server puts a new filter at the end of the list.
        if (!item.action) {
          item.action = LogDropFilterAction.Drop;
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
          getElement: (item: LogDropFilter): ReactElement => {
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
          getElement: (item: LogDropFilter): ReactElement => {
            if (item.isEnabled) {
              return <Pill color={Green} text="Enabled" />;
            }
            return <Pill color={Red} text="Disabled" />;
          },
        },
        /*
         * A drop filter used to discard logs leaving no trace at all, so
         * "are my logs missing because of this filter?" was unanswerable
         * without reading the database. These two columns answer it.
         */
        {
          field: {
            droppedCount: true,
          },
          title: "Dropped",
          type: FieldType.Number,
          getElement: (item: LogDropFilter): ReactElement => {
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
  );
};

export default LogDropFilters;
