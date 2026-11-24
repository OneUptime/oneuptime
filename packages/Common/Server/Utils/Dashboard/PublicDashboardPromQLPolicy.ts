import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardVariable, {
  DashboardVariableOption,
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import {
  DASHBOARD_WIDGET_SORT_ARGUMENT,
  DashboardWidgetSortChoice,
  parseDashboardWidgetSortChoice,
} from "../../../Types/Dashboard/DashboardWidgetSort";
import DataSourceQueryConfig, {
  DataSourceResultKind,
} from "../../../Types/DataSource/DataSourceQueryConfig";
import DataSourceTableResult, {
  DataSourceTableColumn,
} from "../../../Types/DataSource/DataSourceTableResult";
import BadDataException from "../../../Types/Exception/BadDataException";
import DashboardVariableInterpolation, {
  ResolvedVariableValue,
} from "../../../Utils/Dashboard/VariableInterpolation";
import DataSourceQueryText from "../../../Utils/DataSource/DataSourceQueryText";
import {
  capDataSourceTableRows,
  sortDataSourceTableRows,
} from "../../../Utils/DataSource/DataSourceTableRows";
import { ProjectMetricsQueryAnswer } from "../PromQL/PromQLDataSourceQuery";
import PublicDashboardResourceListPolicy from "./PublicDashboardResourceListPolicy";
import { DrawnDataSourceWidget } from "./PublicDashboardViewConfig";

/*
 * WHAT A PUBLIC DASHBOARD'S PROMQL WIDGET MAY RUN, FOR A VISITOR NOBODY
 * SIGNED IN (issue #10226).
 *
 * The Data Source widgets that read only this project's metrics are drawn
 * on a public dashboard, served without their queries' text. Their data
 * comes from one public route, and nothing a visitor sends is a query:
 *
 *   - Which query runs is named by the widget the page draws (its id) and
 *     the query's place among that widget's set-up queries. Its text is read
 *     from the stored dashboard. A query, a label filter or a variable's
 *     definition in the request is never read; a widget of another
 *     dashboard is not among this one's widgets.
 *   - Its variables are the dashboard's own, as its toolbar draws them, and
 *     the visitor's pick of each is held to what its definition allows
 *     (resolveVariables): a list's values, a label variable's labels, its
 *     saved value, or All. A value typed into a text box, or one of a
 *     telemetry attribute, is free only where the query reads it as a
 *     label matcher's value - always a quoted string there - and keeps its
 *     saved value anywhere else, where it would be written into the query
 *     as it is.
 *   - Its window is the visitor's, held to the authenticated route's rules;
 *     its step is worked out from the window, never sent; the result kind
 *     is the widget's.
 *   - Its answer holds only what the widget draws (shapeAnswer): a chart's
 *     series with the labels its legend names them by, a value's or a
 *     gauge's points with no labels at all, a table's rows as many as it
 *     shows, in the order it shows them.
 *
 * The route decides who may see the dashboard first (DashboardService
 * .decidePublicAccess), reads the project's metrics through the PromQL
 * engine held to the authenticated route's limits
 * (runPromQLOverProjectMetrics), and keeps a rate of its own per dashboard
 * and visitor (PublicDashboardRateLimit's PromQL bucket).
 */

export const PUBLIC_DASHBOARD_PROMQL_WIDGET_NOT_FOUND_MESSAGE: string =
  "This widget is not part of this dashboard.";

export const PUBLIC_DASHBOARD_PROMQL_QUERY_NOT_FOUND_MESSAGE: string =
  "This query is not part of this widget.";

export const PUBLIC_DASHBOARD_PROMQL_WINDOW_MESSAGE: string =
  "A valid startDate and endDate are required (startDate must be before endDate).";

export const PUBLIC_DASHBOARD_PROMQL_TOO_LONG_MESSAGE: string =
  "This widget's query is too long to run.";

// The longest id the page draws a widget under: an id of a few dozen characters.
const MAX_COMPONENT_ID_LENGTH: number = 256;

// What a query's text is held to, as the authenticated route holds it.
export const PUBLIC_DASHBOARD_PROMQL_MAX_QUERY_LENGTH: number = 100_000;

// A value no list offers: the dashboard's variable does not take it.
export const getVariableValueNotOfferedMessage: (
  variableName: string,
) => string = (variableName: string): string => {
  return `This dashboard's ${variableName} variable does not offer this value.`;
};

// A value typed in, where the query would write it in as it is.
export const getVariableValueKeptSavedMessage: (
  variableName: string,
) => string = (variableName: string): string => {
  return `This widget's query uses the ${variableName} variable outside a label matcher, so on a public dashboard it keeps its saved value.`;
};

export interface PublicDashboardPromQLPlan {
  widget: DrawnDataSourceWidget;
  queryIndex: number;
  query: DataSourceQueryConfig;
  resultKind: DataSourceResultKind;
  startDate: Date;
  endDate: Date;
  // The stored query, with the variables filled in as allowed.
  queryText: string;
}

const isObject: (value: unknown) => value is Record<string, unknown> = (
  value: unknown,
): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

// A value's own field, never one every object inherits.
const ownField: (value: Record<string, unknown>, name: string) => unknown = (
  value: Record<string, unknown>,
  name: string,
): unknown => {
  return Object.prototype.hasOwnProperty.call(value, name)
    ? value[name]
    : undefined;
};

/*
 * Whether a value can be filled into a query at all: text with no line
 * break or other control character, and no "{{" or "}}" - which the
 * filling would read as another variable's token, and fill again.
 */
const isFillableValue: (value: string) => boolean = (
  value: string,
): boolean => {
  if (value.includes("{{") || value.includes("}}")) {
    return false;
  }

  for (let index: number = 0; index < value.length; index++) {
    const code: number = value.charCodeAt(index);

    if (code < 0x20 || code === 0x7f) {
      return false;
    }
  }

  return true;
};

export default class PublicDashboardPromQLPolicy {
  /*
   * Everything the route runs, from the dashboard's drawn widgets and
   * variables and the request - read for its widget's id, the query's
   * place, the window and the visitor's variable picks only.
   */
  public static plan(data: {
    widgets: Array<DrawnDataSourceWidget>;
    variables: Array<DashboardVariable> | undefined;
    body: unknown;
  }): PublicDashboardPromQLPlan {
    const body: Record<string, unknown> = isObject(data.body) ? data.body : {};

    const widget: DrawnDataSourceWidget =
      PublicDashboardPromQLPolicy.selectWidget({
        widgets: data.widgets,
        requestedComponentId: ownField(body, "componentId"),
      });

    const queryIndex: number = PublicDashboardPromQLPolicy.selectQueryIndex({
      widget,
      requestedQueryIndex: ownField(body, "queryIndex"),
    });

    const query: DataSourceQueryConfig = widget.queries[queryIndex]!;

    const window: { startDate: Date; endDate: Date } =
      PublicDashboardPromQLPolicy.readWindow({
        startDate: ownField(body, "startDate"),
        endDate: ownField(body, "endDate"),
      });

    const variables: Array<DashboardVariable> =
      PublicDashboardPromQLPolicy.resolveVariables({
        variables: data.variables,
        requestedVariables: ownField(body, "variables"),
        queryText: query.query,
      });

    const queryText: string = DataSourceQueryText.applyVariablesForSource({
      dataSourceId: query.dataSourceId,
      queryText: query.query,
      variables,
    });

    if (queryText.length > PUBLIC_DASHBOARD_PROMQL_MAX_QUERY_LENGTH) {
      throw new BadDataException(PUBLIC_DASHBOARD_PROMQL_TOO_LONG_MESSAGE);
    }

    return {
      widget,
      queryIndex,
      query,
      resultKind:
        widget.componentType === DashboardComponentType.DataSourceTable
          ? DataSourceResultKind.Table
          : DataSourceResultKind.TimeSeries,
      startDate: window.startDate,
      endDate: window.endDate,
      queryText,
    };
  }

  /*
   * The widget a request names: one of the dashboard's own drawn Data
   * Source widgets, by the exact id the page draws it under. A widget of
   * another dashboard, one this dashboard leaves out, and anything that is
   * not an id are none of them.
   */
  public static selectWidget(data: {
    widgets: Array<DrawnDataSourceWidget>;
    requestedComponentId: unknown;
  }): DrawnDataSourceWidget {
    const requested: unknown = data.requestedComponentId;

    const widget: DrawnDataSourceWidget | undefined =
      typeof requested === "string" &&
      requested.length > 0 &&
      requested.length <= MAX_COMPONENT_ID_LENGTH
        ? data.widgets.find((candidate: DrawnDataSourceWidget): boolean => {
            return candidate.componentId === requested;
          })
        : undefined;

    if (!widget || widget.queries.length === 0) {
      throw new BadDataException(
        PUBLIC_DASHBOARD_PROMQL_WIDGET_NOT_FOUND_MESSAGE,
      );
    }

    return widget;
  }

  // The place of one of the widget's set-up queries: a whole number in range.
  public static selectQueryIndex(data: {
    widget: DrawnDataSourceWidget;
    requestedQueryIndex: unknown;
  }): number {
    const requested: unknown =
      data.requestedQueryIndex === undefined ||
      data.requestedQueryIndex === null
        ? 0
        : data.requestedQueryIndex;

    if (
      typeof requested !== "number" ||
      !Number.isInteger(requested) ||
      requested < 0 ||
      requested >= data.widget.queries.length
    ) {
      throw new BadDataException(
        PUBLIC_DASHBOARD_PROMQL_QUERY_NOT_FOUND_MESSAGE,
      );
    }

    return requested;
  }

  // The window, as the authenticated route reads it: two dates, in order.
  public static readWindow(data: { startDate: unknown; endDate: unknown }): {
    startDate: Date;
    endDate: Date;
  } {
    const read: (value: unknown) => Date | null = (
      value: unknown,
    ): Date | null => {
      if (typeof value !== "string" || value.length > 64) {
        return null;
      }

      const date: Date = new Date(value);

      return isNaN(date.getTime()) ? null : date;
    };

    const startDate: Date | null = read(data.startDate);
    const endDate: Date | null = read(data.endDate);

    if (!startDate || !endDate || startDate.getTime() >= endDate.getTime()) {
      throw new BadDataException(PUBLIC_DASHBOARD_PROMQL_WINDOW_MESSAGE);
    }

    return { startDate, endDate };
  }

  /*
   * The dashboard's variables - those its toolbar draws - each with the
   * visitor's pick, held to what its definition allows:
   *
   *   - All (nothing picked) is always allowed: it is what an empty pick
   *     means on every board.
   *   - A variable that lists its values (a custom list, a project label
   *     variable's labels) takes only those, and its saved value.
   *   - Any other (a text box, a telemetry attribute's values) takes any
   *     value where the query reads it only as a label matcher's value, a
   *     quoted string there; where the query writes it in anywhere else, as
   *     it is, it keeps its saved value.
   *   - No value may hold a line break or "{{" / "}}".
   *
   * A pick under an id the toolbar does not draw is not read, and a pick
   * the request does not send keeps the variable's saved one. The request's
   * picks are bounded as every public route bounds them
   * (PublicDashboardResourceListPolicy.validateRequestedVariableSelections).
   */
  public static resolveVariables(data: {
    variables: Array<DashboardVariable> | undefined;
    requestedVariables: unknown;
    queryText: string;
  }): Array<DashboardVariable> {
    const selections: Map<
      string,
      Record<string, unknown>
    > = PublicDashboardResourceListPolicy.validateRequestedVariableSelections(
      data.requestedVariables,
    );

    const writtenAsTheyAre: Set<string> =
      DataSourceQueryText.getVariableNamesOutsidePromQLMatchers(data.queryText);

    const resolved: Array<DashboardVariable> = [];

    for (const drawn of data.variables || []) {
      if (!isObject(drawn)) {
        continue;
      }

      const saved: DashboardVariable =
        PublicDashboardPromQLPolicy.readSavedVariable(drawn);

      // A variable with no name fills no token.
      if (!saved.name) {
        continue;
      }

      const selection: Record<string, unknown> | undefined = saved.id
        ? selections.get(saved.id)
        : undefined;

      const variable: DashboardVariable = selection
        ? {
            ...saved,
            selectedValue: saved.isMultiSelect
              ? undefined
              : typeof selection["selectedValue"] === "string"
                ? selection["selectedValue"]
                : undefined,
            selectedValues: saved.isMultiSelect
              ? Array.isArray(selection["selectedValues"])
                ? (selection["selectedValues"] as Array<string>)
                : []
              : undefined,
          }
        : saved;

      PublicDashboardPromQLPolicy.assertAllowedPick({
        saved,
        variable,
        isWrittenAsItIs: writtenAsTheyAre.has(saved.name),
      });

      resolved.push(variable);
    }

    return resolved;
  }

  /*
   * A drawn variable's fields as its toolbar reads them, each only when it
   * is of the type its toolbar reads it as.
   */
  private static readSavedVariable(
    drawn: Record<string, unknown>,
  ): DashboardVariable {
    const text: (name: string) => string | undefined = (
      name: string,
    ): string | undefined => {
      const value: unknown = ownField(drawn, name);
      return typeof value === "string" ? value : undefined;
    };

    const selectedValues: unknown = ownField(drawn, "selectedValues");
    const labelOptions: unknown = ownField(drawn, "labelOptions");

    return {
      id: text("id") || "",
      name: text("name") || "",
      label: text("label"),
      type: (text("type") || "") as DashboardVariableType,
      customListValues: text("customListValues"),
      attributeKey: text("attributeKey"),
      labelOptions: Array.isArray(labelOptions)
        ? (labelOptions.filter(
            isObject,
          ) as unknown as Array<DashboardVariableOption>)
        : undefined,
      isMultiSelect: ownField(drawn, "isMultiSelect") === true,
      selectedValue: text("selectedValue"),
      selectedValues: Array.isArray(selectedValues)
        ? selectedValues.filter((value: unknown): value is string => {
            return typeof value === "string";
          })
        : undefined,
      defaultValue: text("defaultValue"),
    };
  }

  /*
   * The values a variable lists, which are all a visitor may pick of it -
   * or null for one whose values are anything (a text box, a telemetry
   * attribute's). As its toolbar offers them (DashboardVariableControl).
   */
  private static getListedValues(
    variable: DashboardVariable,
  ): Set<string> | null {
    if (variable.type === DashboardVariableType.TelemetryAttribute) {
      return null;
    }

    if (variable.type === DashboardVariableType.ProjectLabel) {
      return new Set<string>(
        (variable.labelOptions || [])
          .map((option: DashboardVariableOption): unknown => {
            return isObject(option) ? ownField(option, "value") : undefined;
          })
          .filter((value: unknown): value is string => {
            return typeof value === "string" && value.length > 0;
          }),
      );
    }

    if (
      variable.type === DashboardVariableType.CustomList ||
      Boolean(variable.customListValues)
    ) {
      return new Set<string>(
        (variable.customListValues || "")
          .split(",")
          .map((value: string): string => {
            return value.trim();
          })
          .filter((value: string): boolean => {
            return value.length > 0;
          }),
      );
    }

    return null;
  }

  // The values a variable was saved with: what its toolbar starts on.
  private static getSavedValues(variable: DashboardVariable): Set<string> {
    return new Set<string>(
      [
        variable.selectedValue,
        variable.defaultValue,
        ...(variable.selectedValues || []),
      ].filter((value: string | undefined): value is string => {
        return typeof value === "string" && value.length > 0;
      }),
    );
  }

  private static assertAllowedPick(data: {
    saved: DashboardVariable;
    variable: DashboardVariable;
    isWrittenAsItIs: boolean;
  }): void {
    const resolved: ResolvedVariableValue | undefined =
      DashboardVariableInterpolation.resolveValue(data.variable);

    // All: no value, which every board reads as every value.
    if (!resolved) {
      return;
    }

    const values: Array<string> =
      resolved.multi && resolved.multi.length > 0
        ? resolved.multi
        : [resolved.scalar || ""];

    const name: string = data.saved.label || data.saved.name;

    for (const value of values) {
      if (!isFillableValue(value)) {
        throw new BadDataException(getVariableValueNotOfferedMessage(name));
      }
    }

    const saved: Set<string> = PublicDashboardPromQLPolicy.getSavedValues(
      data.saved,
    );
    const listed: Set<string> | null =
      PublicDashboardPromQLPolicy.getListedValues(data.saved);

    if (listed) {
      for (const value of values) {
        if (!listed.has(value) && !saved.has(value)) {
          throw new BadDataException(getVariableValueNotOfferedMessage(name));
        }
      }

      return;
    }

    if (data.isWrittenAsItIs) {
      for (const value of values) {
        if (!saved.has(value)) {
          throw new BadDataException(getVariableValueKeptSavedMessage(name));
        }
      }
    }
  }

  /*
   * The answer as the widget draws it, and nothing more:
   *
   *   - a chart's series with every label, its legend's default naming
   *     each series by all of them - or, with a legend template, only the
   *     labels the template names: its series are told apart by the names
   *     the template gives them, so no other label is drawn;
   *   - a value's or a gauge's points, which it reduces to one number, with
   *     no labels at all;
   *   - a table's rows in the order it draws them - the visitor's sort when
   *     it names one of the answer's columns, else the widget's own, else
   *     the query's - and only as many as its Max Rows draws.
   */
  public static shapeAnswer(data: {
    plan: PublicDashboardPromQLPlan;
    answer: ProjectMetricsQueryAnswer;
    requestedSort: unknown;
  }): ProjectMetricsQueryAnswer {
    if (data.answer.resultKind === DataSourceResultKind.Table) {
      return {
        resultKind: DataSourceResultKind.Table,
        result: PublicDashboardPromQLPolicy.shapeTable({
          settings: data.plan.widget.settings,
          result: data.answer.result,
          requestedSort: data.requestedSort,
        }),
      };
    }

    const keptLabels: Array<string> | null =
      data.plan.widget.componentType === DashboardComponentType.DataSourceChart
        ? PublicDashboardPromQLPolicy.getChartLabels(data.plan.query)
        : [];

    return {
      resultKind: DataSourceResultKind.TimeSeries,
      result: PublicDashboardPromQLPolicy.keepLabels(
        data.answer.result,
        keptLabels,
      ),
    };
  }

  /*
   * The labels a chart's series are drawn with: every one (null) unless
   * its legend is a template, whose labels are all it draws.
   */
  private static getChartLabels(
    query: DataSourceQueryConfig,
  ): Array<string> | null {
    const legend: unknown = query.legend;

    if (typeof legend !== "string" || !legend.includes("{{")) {
      return null;
    }

    return DataSourceQueryText.getLegendTemplateKeys(legend);
  }

  // Each point with only these labels: every one for null, none for [].
  private static keepLabels(
    result: AggregatedResult,
    labels: Array<string> | null,
  ): AggregatedResult {
    if (labels === null) {
      return result;
    }

    return {
      ...result,
      data: result.data.map((point: AggregatedModel): AggregatedModel => {
        const attributes: unknown = (point as Record<string, unknown>)[
          "attributes"
        ];
        const rest: Record<string, unknown> = {};

        for (const key of Object.keys(point)) {
          if (key !== "attributes") {
            rest[key] = (point as Record<string, unknown>)[key];
          }
        }

        if (labels.length === 0 || !isObject(attributes)) {
          return rest as unknown as AggregatedModel;
        }

        const kept: Record<string, unknown> = {};

        for (const label of labels) {
          if (Object.prototype.hasOwnProperty.call(attributes, label)) {
            kept[label] = attributes[label];
          }
        }

        return { ...rest, attributes: kept } as unknown as AggregatedModel;
      }),
    };
  }

  private static shapeTable(data: {
    settings: Record<string, unknown>;
    result: DataSourceTableResult;
    requestedSort: unknown;
  }): DataSourceTableResult {
    const columns: Array<DataSourceTableColumn> = data.result.columns || [];

    const hasColumn: (choice: DashboardWidgetSortChoice | null) => boolean = (
      choice: DashboardWidgetSortChoice | null,
    ): boolean => {
      return Boolean(
        choice &&
          columns.some((column: DataSourceTableColumn): boolean => {
            return column.key === choice.column;
          }),
      );
    };

    const requested: DashboardWidgetSortChoice | null =
      parseDashboardWidgetSortChoice(data.requestedSort);
    const own: DashboardWidgetSortChoice | null =
      parseDashboardWidgetSortChoice(
        ownField(data.settings, DASHBOARD_WIDGET_SORT_ARGUMENT),
      );

    const sort: DashboardWidgetSortChoice | null = hasColumn(requested)
      ? requested
      : hasColumn(own)
        ? own
        : null;

    const rows: DataSourceTableResult["rows"] = sort
      ? sortDataSourceTableRows(
          data.result.rows || [],
          sort.column,
          sort.direction,
        )
      : data.result.rows || [];

    return {
      ...data.result,
      rows: capDataSourceTableRows(rows, ownField(data.settings, "maxRows")),
    };
  }
}
