import Dictionary from "Common/Types/Dictionary";
import JSONFunctions from "Common/Types/JSONFunctions";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricViewData from "Common/Types/Metrics/MetricViewData";

/*
 * A METRIC VIEW WHOSE CHARTS READ ITS QUERIES DIFFERENTLY FROM HOW THEY ARE
 * WRITTEN (issue #6264).
 *
 * An infrastructure monitor's step form edits its queries as the step saves
 * them: the metric, aggregation, grouping and the filters someone wrote.
 * Before each check the worker reads every query narrowed to the resource
 * the monitor watches - its cluster, host, vCenter, array or fleet, and its
 * resource filters - which the step never stores (the worker adds it, and a
 * cluster changed later would leave a stale filter behind). A chart of the
 * queries as written showed the metric for every cluster in the project.
 *
 * So a MetricView can be handed the queries its charts fetch and draw
 * (chartQueryConfigs), apart from the ones its query editor edits and its
 * onChange hands back. This works out the two:
 *
 * - getChartData: the view's data with the chart's queries in place of its
 *   own, while they line up index for index; the view's own data otherwise.
 * - toEditorQueryConfigs: a change the charts make to their queries (a
 *   Top-N, "Filter to this series") put onto the queries the editor edits,
 *   so the narrowing never reaches what the host saves.
 *
 * Pure: MetricView and its tests read it the same way.
 */

type Attributes = Dictionary<unknown>;

// A query's attribute filters, or none when they are not a map.
const getAttributes: (
  queryConfig: MetricQueryConfigData | undefined,
) => Attributes = (queryConfig: MetricQueryConfigData | undefined): Attributes => {
  const attributes: unknown =
    queryConfig?.metricQueryData?.filterData?.attributes;

  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) {
    return {};
  }

  return attributes as Attributes;
};

const hasOwnKey: (object: object, key: string) => boolean = (
  object: object,
  key: string,
): boolean => {
  return Object.prototype.hasOwnProperty.call(object, key);
};

/*
 * The editor's query with what the charts changed on their copy of it: the
 * chart's query, whose attribute filters are the editor's own with the
 * filters the charts added, changed or took away - never the narrowing the
 * chart's copy was read with.
 */
const toEditorQueryConfig: (input: {
  editor: MetricQueryConfigData;
  charted: MetricQueryConfigData;
  changed: MetricQueryConfigData;
}) => MetricQueryConfigData = (input: {
  editor: MetricQueryConfigData;
  charted: MetricQueryConfigData;
  changed: MetricQueryConfigData;
}): MetricQueryConfigData => {
  if (input.changed === input.charted) {
    return input.editor;
  }

  const chartedAttributes: Attributes = getAttributes(input.charted);
  const changedAttributes: Attributes = getAttributes(input.changed);
  const attributes: Attributes = { ...getAttributes(input.editor) };

  for (const key of Object.keys(changedAttributes)) {
    if (
      !hasOwnKey(chartedAttributes, key) ||
      !JSONFunctions.deepEqual(changedAttributes[key], chartedAttributes[key])
    ) {
      attributes[key] = changedAttributes[key];
    }
  }

  for (const key of Object.keys(chartedAttributes)) {
    if (!hasOwnKey(changedAttributes, key)) {
      delete attributes[key];
    }
  }

  const filterData: Record<string, unknown> = {
    ...((input.changed.metricQueryData?.filterData as unknown as
      | Record<string, unknown>
      | undefined) || {}),
  };

  const editorFilterData: Record<string, unknown> =
    (input.editor.metricQueryData?.filterData as unknown as
      | Record<string, unknown>
      | undefined) || {};

  /*
   * Kept in the editor's own shape when nothing is left: a map stays a map
   * (empty), a key that held no map keeps what it held, and none is added
   * where the editor had none.
   */
  const editorValue: unknown = editorFilterData["attributes"];
  const editorHadMap: boolean = Boolean(
    editorValue && typeof editorValue === "object" && !Array.isArray(editorValue),
  );

  if (Object.keys(attributes).length > 0 || editorHadMap) {
    filterData["attributes"] = attributes;
  } else if (hasOwnKey(editorFilterData, "attributes")) {
    filterData["attributes"] = editorValue;
  } else {
    delete filterData["attributes"];
  }

  return {
    ...input.changed,
    metricQueryData: {
      ...input.changed.metricQueryData,
      filterData:
        filterData as unknown as MetricQueryConfigData["metricQueryData"]["filterData"],
    },
  };
};

export default class MetricViewChartQueries {
  /*
   * Whether these chart queries can stand in for the view's own: one for
   * each of its queries, in order.
   */
  public static isUsable(input: {
    queryConfigs: Array<MetricQueryConfigData>;
    chartQueryConfigs: Array<MetricQueryConfigData> | null | undefined;
  }): boolean {
    return (
      Array.isArray(input.chartQueryConfigs) &&
      Array.isArray(input.queryConfigs) &&
      input.chartQueryConfigs.length === input.queryConfigs.length
    );
  }

  /*
   * What the charts fetch and draw: the view's data with the chart's
   * queries in place of its own. The very same data when there are no
   * chart queries, or they do not line up with the view's queries.
   */
  public static getChartData(input: {
    data: MetricViewData;
    chartQueryConfigs: Array<MetricQueryConfigData> | null | undefined;
  }): MetricViewData {
    if (
      !MetricViewChartQueries.isUsable({
        queryConfigs: input.data.queryConfigs,
        chartQueryConfigs: input.chartQueryConfigs,
      }) ||
      input.chartQueryConfigs === input.data.queryConfigs
    ) {
      return input.data;
    }

    return {
      ...input.data,
      queryConfigs: input.chartQueryConfigs as Array<MetricQueryConfigData>,
    };
  }

  /*
   * The queries the editor edits, with a change the charts made to their
   * own copies (changedQueryConfigs, a whole new list of the charts'
   * queries). Each query keeps the editor's attribute filters plus what the
   * charts added, changed or removed; a query the charts did not touch is
   * the editor's, unchanged. The changed list as it is when the charts read
   * the editor's own queries.
   */
  public static toEditorQueryConfigs(input: {
    editorQueryConfigs: Array<MetricQueryConfigData>;
    chartQueryConfigs: Array<MetricQueryConfigData>;
    changedQueryConfigs: Array<MetricQueryConfigData>;
  }): Array<MetricQueryConfigData> {
    if (
      input.chartQueryConfigs === input.editorQueryConfigs ||
      !MetricViewChartQueries.isUsable({
        queryConfigs: input.editorQueryConfigs,
        chartQueryConfigs: input.chartQueryConfigs,
      }) ||
      input.changedQueryConfigs.length !== input.chartQueryConfigs.length
    ) {
      return input.changedQueryConfigs;
    }

    return input.changedQueryConfigs.map(
      (changed: MetricQueryConfigData, index: number): MetricQueryConfigData => {
        const editor: MetricQueryConfigData | undefined =
          input.editorQueryConfigs[index];
        const charted: MetricQueryConfigData | undefined =
          input.chartQueryConfigs[index];

        if (
          !editor ||
          !charted ||
          typeof editor !== "object" ||
          typeof charted !== "object" ||
          !changed ||
          typeof changed !== "object"
        ) {
          return changed;
        }

        return toEditorQueryConfig({
          editor: editor,
          charted: charted,
          changed: changed,
        });
      },
    );
  }
}
