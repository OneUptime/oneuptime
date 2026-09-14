import { JSONObject } from "../../../Types/JSON";
import SeriesLabelDisplay, {
  DisplaySeriesLabel,
} from "../../../Types/Monitor/SeriesContext/SeriesLabelDisplay";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Table from "../Table/Table";
import FieldType from "../Types/FieldType";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  seriesLabels?: JSONObject | undefined;
}

/**
 * The identity of the metric series an alert or incident was raised for.
 *
 * Rendered from the same `SeriesLabelDisplay` the alert TITLE is built
 * from, so the page and the notification agree on both the naming
 * ("Pod", not `resource.k8s.pod.name`) and the ordering (the object that
 * breached first, the scope that qualifies it after). A generic
 * key/value viewer here would drift from the title the moment either
 * side changed.
 *
 * The raw attribute key is kept underneath the friendly name rather than
 * dropped: it is what the user types into a Group By field or a metric
 * filter to go and look at the same series themselves.
 */
const SeriesLabelsViewer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const labels: Array<DisplaySeriesLabel> = SeriesLabelDisplay.getDisplayLabels(
    props.seriesLabels,
  );

  if (labels.length === 0) {
    return (
      <div className="text-gray-400 text-sm py-2">
        No resource labels on this alert.
      </div>
    );
  }

  return (
    <Table<DisplaySeriesLabel>
      id="series-labels-viewer-table"
      data={labels}
      singularLabel="Label"
      pluralLabel="Labels"
      isLoading={false}
      error=""
      currentPageNumber={1}
      totalItemsCount={labels.length}
      itemsOnPage={labels.length}
      disablePagination={true}
      noItemsMessage="No resource labels on this alert."
      onNavigateToPage={() => {}}
      sortBy={null}
      sortOrder={SortOrder.Ascending}
      onSortChanged={() => {}}
      columns={[
        {
          title: "Resource",
          type: FieldType.Element,
          key: "name",
          disableSort: true,
          getElement: (item: DisplaySeriesLabel): ReactElement => {
            return (
              <div>
                <div className="font-medium text-gray-900">{item.name}</div>
                <div className="font-mono text-xs text-gray-400">
                  {item.key}
                </div>
              </div>
            );
          },
        },
        {
          title: "Value",
          type: FieldType.Element,
          key: "value",
          disableSort: true,
          getElement: (item: DisplaySeriesLabel): ReactElement => {
            return (
              <span className="font-mono text-gray-700">{item.value}</span>
            );
          },
        },
      ]}
    />
  );
};

export default SeriesLabelsViewer;
