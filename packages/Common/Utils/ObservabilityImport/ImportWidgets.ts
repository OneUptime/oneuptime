import DashboardChartType from "../../Types/Dashboard/Chart/ChartType";
import DashboardBaseComponent from "../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardDataSourceChartComponent from "../../Types/Dashboard/DashboardComponents/DashboardDataSourceChartComponent";
import DashboardDataSourceGaugeComponent from "../../Types/Dashboard/DashboardComponents/DashboardDataSourceGaugeComponent";
import DashboardDataSourceTableComponent from "../../Types/Dashboard/DashboardComponents/DashboardDataSourceTableComponent";
import DashboardDataSourceValueComponent, {
  DataSourceValueReduce,
} from "../../Types/Dashboard/DashboardComponents/DashboardDataSourceValueComponent";
import DashboardHtmlComponent from "../../Types/Dashboard/DashboardComponents/DashboardHtmlComponent";
import DashboardLogChartComponent from "../../Types/Dashboard/DashboardComponents/DashboardLogChartComponent";
import DashboardLogStreamComponent from "../../Types/Dashboard/DashboardComponents/DashboardLogStreamComponent";
import DashboardTextComponent from "../../Types/Dashboard/DashboardComponents/DashboardTextComponent";
import DataSourceQueryConfig from "../../Types/DataSource/DataSourceQueryConfig";
import LogSeverity from "../../Types/Log/LogSeverity";
import { PROJECT_METRICS_DATA_SOURCE_ID } from "../../Types/DataSource/ProjectMetricsDataSource";
import ObjectID from "../../Types/ObjectID";
import DashboardDataSourceChartComponentUtil from "../Dashboard/Components/DashboardDataSourceChartComponent";
import DashboardDataSourceGaugeComponentUtil from "../Dashboard/Components/DashboardDataSourceGaugeComponent";
import DashboardDataSourceTableComponentUtil from "../Dashboard/Components/DashboardDataSourceTableComponent";
import DashboardDataSourceValueComponentUtil from "../Dashboard/Components/DashboardDataSourceValueComponent";
import DashboardHtmlComponentUtil from "../Dashboard/Components/DashboardHtmlComponent";
import DashboardLogChartComponentUtil from "../Dashboard/Components/DashboardLogChartComponent";
import DashboardLogStreamComponentUtil from "../Dashboard/Components/DashboardLogStreamComponent";
import DashboardTextComponentUtil from "../Dashboard/Components/DashboardTextComponent";
import { LogWidgetFilters } from "./Grafana/GrafanaLoki";
import { cutText } from "./ImportValues";

/*
 * THE WIDGETS AN IMPORTED PANEL BECOMES (issue #7697), each started from
 * the widget's own defaults - its minimum size, its arguments - as Add
 * Widget starts one, with the panel's queries, title and display filled in.
 * Every query reads the project's own metrics with PromQL
 * (ProjectMetricsDataSource): data sent with Prometheus remote write, the
 * Datadog Agent or OpenTelemetry, under the names the panel queries.
 */

// A widget's title, as long as a title shows.
const TITLE_MAX_LENGTH: number = 200;

export interface ImportedQuery {
  promQL: string;
  legend?: string | undefined;
}

const toQueryConfig: (query: ImportedQuery) => DataSourceQueryConfig = (
  query: ImportedQuery,
): DataSourceQueryConfig => {
  const config: DataSourceQueryConfig = {
    id: ObjectID.generate().toString(),
    dataSourceId: PROJECT_METRICS_DATA_SOURCE_ID,
    query: query.promQL,
  };

  if (query.legend) {
    config.legend = query.legend;
  }

  return config;
};

export const buildChartWidget: (data: {
  title: string;
  description?: string | undefined;
  queries: Array<ImportedQuery>;
  chartType: DashboardChartType;
  unit?: string | undefined;
}) => DashboardBaseComponent = (data: {
  title: string;
  description?: string | undefined;
  queries: Array<ImportedQuery>;
  chartType: DashboardChartType;
  unit?: string | undefined;
}): DashboardBaseComponent => {
  const component: DashboardDataSourceChartComponent =
    DashboardDataSourceChartComponentUtil.getDefaultComponent();

  component.arguments = {
    queries: data.queries.map(toQueryConfig),
    chartType: data.chartType,
    ...(data.title
      ? { chartTitle: cutText(data.title, TITLE_MAX_LENGTH) }
      : {}),
    ...(data.description ? { chartDescription: data.description } : {}),
    ...(data.unit ? { unit: data.unit } : {}),
  };

  return component;
};

export interface ValueWidgetData {
  title: string;
  query: ImportedQuery;
  reduce: DataSourceValueReduce;
  unit?: string | undefined;
  warningThreshold?: number | undefined;
  criticalThreshold?: number | undefined;
}

export const buildValueWidget: (
  data: ValueWidgetData,
) => DashboardBaseComponent = (
  data: ValueWidgetData,
): DashboardBaseComponent => {
  const component: DashboardDataSourceValueComponent =
    DashboardDataSourceValueComponentUtil.getDefaultComponent();

  component.arguments = {
    title: cutText(data.title, TITLE_MAX_LENGTH),
    query: toQueryConfig(data.query),
    reduce: data.reduce,
    ...(data.unit ? { unit: data.unit } : {}),
    ...(data.warningThreshold !== undefined
      ? { warningThreshold: data.warningThreshold }
      : {}),
    ...(data.criticalThreshold !== undefined
      ? { criticalThreshold: data.criticalThreshold }
      : {}),
  };

  return component;
};

export const buildGaugeWidget: (
  data: ValueWidgetData & {
    minValue?: number | undefined;
    maxValue?: number | undefined;
  },
) => DashboardBaseComponent = (
  data: ValueWidgetData & {
    minValue?: number | undefined;
    maxValue?: number | undefined;
  },
): DashboardBaseComponent => {
  const component: DashboardDataSourceGaugeComponent =
    DashboardDataSourceGaugeComponentUtil.getDefaultComponent();

  component.arguments = {
    query: toQueryConfig(data.query),
    reduce: data.reduce,
    ...(data.title
      ? { gaugeTitle: cutText(data.title, TITLE_MAX_LENGTH) }
      : {}),
    ...(data.unit ? { unit: data.unit } : {}),
    ...(data.minValue !== undefined ? { minValue: data.minValue } : {}),
    ...(data.maxValue !== undefined ? { maxValue: data.maxValue } : {}),
    ...(data.warningThreshold !== undefined
      ? { warningThreshold: data.warningThreshold }
      : {}),
    ...(data.criticalThreshold !== undefined
      ? { criticalThreshold: data.criticalThreshold }
      : {}),
  };

  return component;
};

export const buildTableWidget: (data: {
  title: string;
  description?: string | undefined;
  query: ImportedQuery;
  maxRows?: number | undefined;
}) => DashboardBaseComponent = (data: {
  title: string;
  description?: string | undefined;
  query: ImportedQuery;
  maxRows?: number | undefined;
}): DashboardBaseComponent => {
  const component: DashboardDataSourceTableComponent =
    DashboardDataSourceTableComponentUtil.getDefaultComponent();

  component.arguments = {
    query: toQueryConfig(data.query),
    ...(data.title
      ? { tableTitle: cutText(data.title, TITLE_MAX_LENGTH) }
      : {}),
    ...(data.description ? { tableDescription: data.description } : {}),
    ...(data.maxRows !== undefined ? { maxRows: data.maxRows } : {}),
  };

  return component;
};

export const buildTextWidget: (data: {
  text: string;
  isMarkdown: boolean;
  isBold?: boolean | undefined;
}) => DashboardBaseComponent = (data: {
  text: string;
  isMarkdown: boolean;
  isBold?: boolean | undefined;
}): DashboardBaseComponent => {
  const component: DashboardTextComponent =
    DashboardTextComponentUtil.getDefaultComponent();

  component.arguments = {
    text: data.text,
    isBold: Boolean(data.isBold),
    isItalic: false,
    isUnderline: false,
    isMarkdown: data.isMarkdown,
  };

  return component;
};

/*
 * A panel of HTML: drawn in the HTML widget's sandbox, with scripts off,
 * as Grafana draws a text panel's HTML without them.
 */
export const buildHtmlWidget: (html: string) => DashboardBaseComponent = (
  html: string,
): DashboardBaseComponent => {
  const component: DashboardHtmlComponent =
    DashboardHtmlComponentUtil.getDefaultComponent();

  component.arguments = {
    html,
    css: "",
    javascript: "",
    allowScripts: false,
    allowForms: false,
    allowPopups: false,
  };

  return component;
};

export const buildLogStreamWidget: (data: {
  title: string;
  filters: LogWidgetFilters;
  // The one severity it lists (a Datadog search's status).
  severity?: LogSeverity | undefined;
}) => DashboardBaseComponent = (data: {
  title: string;
  filters: LogWidgetFilters;
  severity?: LogSeverity | undefined;
}): DashboardBaseComponent => {
  const component: DashboardLogStreamComponent =
    DashboardLogStreamComponentUtil.getDefaultComponent();

  component.arguments = {
    ...component.arguments,
    ...(data.title ? { title: cutText(data.title, TITLE_MAX_LENGTH) } : {}),
    ...(data.severity ? { severityFilter: data.severity } : {}),
    ...(data.filters.bodyContains
      ? { bodyContains: data.filters.bodyContains }
      : {}),
    ...(data.filters.attributeFilterQuery
      ? { attributeFilterQuery: data.filters.attributeFilterQuery }
      : {}),
  };

  return component;
};

export const buildLogChartWidget: (data: {
  title: string;
  filters: LogWidgetFilters;
  // The severities it counts (a Datadog search's statuses).
  severities?: Array<LogSeverity> | undefined;
  chartType?: DashboardChartType | undefined;
}) => DashboardBaseComponent = (data: {
  title: string;
  filters: LogWidgetFilters;
  severities?: Array<LogSeverity> | undefined;
  chartType?: DashboardChartType | undefined;
}): DashboardBaseComponent => {
  const component: DashboardLogChartComponent =
    DashboardLogChartComponentUtil.getDefaultComponent();

  const attributeFilters: Record<string, string> = {};

  for (const key of Object.keys(data.filters.attributeFilters)) {
    attributeFilters[key] = data.filters.attributeFilters[key] || "";
  }

  component.arguments = {
    ...component.arguments,
    ...(data.title ? { title: cutText(data.title, TITLE_MAX_LENGTH) } : {}),
    ...(data.chartType ? { chartType: data.chartType } : {}),
    ...(data.severities && data.severities.length > 0
      ? { severityFilters: [...data.severities] }
      : {}),
    ...(data.filters.bodyContains
      ? { bodyContains: data.filters.bodyContains }
      : {}),
    ...(Object.keys(attributeFilters).length > 0 ? { attributeFilters } : {}),
  };

  return component;
};
