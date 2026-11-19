import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import MetricRecordingRule from "../../../Models/DatabaseModels/MetricRecordingRule";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Service from "../../../Models/DatabaseModels/Service";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../Types/ObjectID";
import SliType from "../../../Types/ServiceLevelObjective/SliType";
import { SearchValueOperator } from "../../../Types/Telemetry/TelemetrySearchQuery";
import {
  ParsedSloMetricSearch,
  parseSloMetricSearch,
} from "../../../Utils/Slo/SloMetricSli";
import DashboardService from "../../Services/DashboardService";
import MetricRecordingRuleService from "../../Services/MetricRecordingRuleService";
import MonitorService from "../../Services/MonitorService";
import ServiceLevelObjectiveService from "../../Services/ServiceLevelObjectiveService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";

/*
 * WHICH SAVED RECORDS READ A METRIC (issues #9757, #9946).
 *
 * A metric is read by name, in a query a record keeps: a monitor's steps, a
 * dashboard's widgets, a Metric SLO's metric query, a metric recording
 * rule's sources. Once a metric stops being stored - dropped at ingest,
 * renamed, no longer read from a cloud - each of them gets no new data, so
 * whatever takes a metric away says first which records read it.
 *
 * What a query reads is a metric name and the services it reads it of:
 *
 *  - a monitor's steps and a dashboard's widgets keep their queries under
 *    keys of every shape, and may limit them to some services
 *    (telemetryServiceIds, on the query or on the step around it), so both
 *    are walked whole, as JSON, for every metricName in them: a monitor
 *    type or a widget added tomorrow is read without anyone remembering to
 *    add it here. A dashboard is walked widget by widget, so the widgets
 *    that read the metric are named;
 *  - a Metric SLO counts its metric's events of its own services only (no
 *    SLO of another kind reads its metric query, and one of no service
 *    reads nothing), and an archived SLO is measured no more;
 *  - a metric recording rule reads each source's metric of every service.
 *
 * A query may also keep only some of the metric's series, by their
 * attributes: each reference says which (`attributes`), so a caller that
 * takes away the metric of some series only - a cloud resource's, when an
 * added cloud metric is removed (#9807) - names the queries of those.
 *
 * The caller says which references read what it takes away (`reads`). The
 * records are read as the server - so every reader is counted - and only
 * the ones the person asking may read themselves are named: the rest are a
 * count, never a name, so a person whose role cannot see some monitors
 * still learns that more read the metric than they can see.
 */

// How deep, and how many values, a record's queries are walked.
const MAX_DEPTH: number = 64;
const MAX_VALUES: number = 100_000;

// The kinds of saved record that read metrics by name.
export enum MetricReaderKind {
  Monitor = "Monitor",
  Dashboard = "Dashboard",
  ServiceLevelObjective = "ServiceLevelObjective",
  MetricRecordingRule = "MetricRecordingRule",
}

export const METRIC_READER_KINDS: ReadonlyArray<MetricReaderKind> = [
  MetricReaderKind.Monitor,
  MetricReaderKind.Dashboard,
  MetricReaderKind.ServiceLevelObjective,
  MetricReaderKind.MetricRecordingRule,
];

// A metric a record reads, and the services it reads it of.
export interface MetricNameReference {
  metricName: string;
  // The services the query is limited to, in lower case; none for every service.
  serviceIds: Array<string> | null;
  /*
   * The attributes the query keeps the metric's series by, as stored - a
   * value, or an operator's object - when it names any: its own filter, its
   * table's (attributeFilters), its recording rule source's key and value,
   * or its SLO's `@key:value` terms. None when it keeps every series. The
   * series it reads are always among the ones these name, so a caller that
   * asks about some series only never misses a query that reads them.
   */
  attributes?: Record<string, unknown> | undefined;
}

// A dashboard's widget, as its dashboard names it.
export interface MetricReaderWidget {
  // Its componentId.
  id: string;
  // Its title, or "" when it has none.
  title: string;
  // Its componentType ("chart"), which names it when it has no title.
  type: string;
}

// A record that reads the metric.
export interface MetricReader {
  id: string;
  name: string;
  // A dashboard's: the widgets on it that read the metric, in their order on it.
  widgets?: Array<MetricReaderWidget> | undefined;
  // A recording rule's: the metric it writes, which finds it in its list.
  outputMetricName?: string | undefined;
}

export interface MetricReadersOfKind {
  // Those the person asking may read, by name.
  readers: Array<MetricReader>;
  // How many more read it that they may not read: counted, never named.
  hiddenCount: number;
  // False when the records could not be read: nothing is known of them.
  isChecked: boolean;
}

export type MetricReaders = Record<MetricReaderKind, MetricReadersOfKind>;

export type MetricReferenceReads = (reference: MetricNameReference) => boolean;

// An id as JSON writes one: its text, or ObjectID's { _type, value }.
function readId(value: unknown): string {
  if (typeof value === "string") {
    return value.trim().toLowerCase();
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const inner: unknown = (value as Record<string, unknown>)["value"];

    return typeof inner === "string" ? inner.trim().toLowerCase() : "";
  }

  return "";
}

// The services a query or a step is limited to: none when it names none.
function readServiceScope(value: unknown): Array<string> | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const ids: Array<string> = value.map(readId).filter((id: string) => {
    return ObjectID.isValidUUID(id);
  });

  return ids.length > 0 ? ids : null;
}

/*
 * A value as it is stored: a column's own classes (MonitorSteps) write their
 * JSON, and a row kept as text (as an older recording rule's definition may
 * be) is its JSON read back.
 */
function asStored(value: unknown): unknown {
  try {
    return typeof value === "string"
      ? JSON.parse(value)
      : JSON.parse(JSON.stringify(value ?? null));
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// An attribute filter as stored: none when it names no attribute.
function readAttributeFilter(
  value: unknown,
): Record<string, unknown> | undefined {
  const filter: Record<string, unknown> | undefined = asRecord(value);

  return filter && Object.keys(filter).length > 0 ? { ...filter } : undefined;
}

/*
 * The attributes a query that names a metric keeps its series by: its own
 * (a metric query's `attributes`, which may be none, or a recording rule
 * source's one key and value, which the rule's cron reads only together),
 * else the filter around it - a table's, for its columns' metrics.
 */
function readQueryAttributes(
  query: Record<string, unknown>,
  around: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if ("attributes" in query) {
    return readAttributeFilter(query["attributes"]);
  }

  // As stored: the cron filters by the key as written.
  const key: unknown = query["filterAttributeKey"];
  const value: unknown = query["filterAttributeValue"];

  if (
    typeof key === "string" &&
    key.trim() &&
    typeof value === "string" &&
    value
  ) {
    return { [key]: value };
  }

  return around;
}

function toReference(
  metricName: string,
  serviceIds: Array<string> | null,
  attributes: Record<string, unknown> | undefined,
): MetricNameReference {
  return attributes
    ? { metricName, serviceIds, attributes }
    : { metricName, serviceIds };
}

/*
 * Every metric name a monitor's steps or a dashboard's widgets query, each
 * with the services its query is limited to - its own, or the nearest
 * around it that names some - and the attributes it filters by.
 */
export function findMetricNameReferences(
  value: unknown,
): Array<MetricNameReference> {
  const references: Array<MetricNameReference> = [];
  const plain: unknown = asStored(value);
  let visited: number = 0;

  const walk: (
    node: unknown,
    scope: Array<string> | null,
    filter: Record<string, unknown> | undefined,
    depth: number,
  ) => void = (
    node: unknown,
    scope: Array<string> | null,
    filter: Record<string, unknown> | undefined,
    depth: number,
  ): void => {
    if (visited++ >= MAX_VALUES || depth > MAX_DEPTH || !node) {
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item, scope, filter, depth + 1);
      }

      return;
    }

    if (typeof node !== "object") {
      return;
    }

    const entries: Record<string, unknown> = node as Record<string, unknown>;
    const ownScope: Array<string> | null =
      readServiceScope(entries["telemetryServiceIds"]) || scope;
    // A table's filter, which each of its columns' metrics is read with.
    const ownFilter: Record<string, unknown> | undefined =
      readAttributeFilter(entries["attributeFilters"]) || filter;
    const metricName: unknown = entries["metricName"];

    if (typeof metricName === "string" && metricName.trim()) {
      references.push(
        toReference(
          metricName,
          ownScope,
          readQueryAttributes(entries, ownFilter),
        ),
      );
    }

    for (const [key, child] of Object.entries(entries)) {
      if (key !== "metricName" && key !== "telemetryServiceIds") {
        walk(child, ownScope, ownFilter, depth + 1);
      }
    }
  };

  walk(plain, null, undefined, 0);

  return references;
}

// What a widget is titled by, by kind: most `title`, charts `chartTitle` (ComponentSettingsModal's WIDGET_TITLE_ARGUMENTS).
const WIDGET_TITLE_ARGUMENTS: ReadonlyArray<string> = [
  "title",
  "chartTitle",
  "widgetTitle",
  "tableTitle",
  "gaugeTitle",
];

// The most of a widget's title kept: enough to know it by.
const MAX_WIDGET_TITLE_LENGTH: number = 200;

export interface DashboardMetricReferences {
  // Each widget, in its order on the dashboard, and the metric names it reads.
  widgets: Array<{
    widget: MetricReaderWidget;
    references: Array<MetricNameReference>;
  }>;
  // What the dashboard reads outside its widgets, such as a variable's metric.
  dashboard: Array<MetricNameReference>;
}

/*
 * A dashboard's metric names, widget by widget: each widget's own queries
 * (findMetricNameReferences), named by its id, title and type, and what
 * the rest of the dashboard reads.
 */
export function findDashboardMetricReferences(
  dashboardViewConfig: unknown,
): DashboardMetricReferences {
  const found: DashboardMetricReferences = { widgets: [], dashboard: [] };
  const config: Record<string, unknown> | undefined = asRecord(
    asStored(dashboardViewConfig),
  );

  if (!config) {
    return found;
  }

  const components: unknown = config["components"];

  for (const item of Array.isArray(components) ? components : []) {
    const component: Record<string, unknown> | undefined = asRecord(item);

    if (!component) {
      continue;
    }

    const widgetArguments: Record<string, unknown> =
      asRecord(component["arguments"]) || {};
    let title: string = "";

    for (const key of WIDGET_TITLE_ARGUMENTS) {
      title = readText(widgetArguments[key]);

      if (title) {
        break;
      }
    }

    found.widgets.push({
      widget: {
        id: readId(component["componentId"]),
        title: title.slice(0, MAX_WIDGET_TITLE_LENGTH),
        type: readText(component["componentType"]),
      },
      references: findMetricNameReferences(component),
    });
  }

  const rest: Record<string, unknown> = { ...config };

  delete rest["components"];
  found.dashboard = findMetricNameReferences(rest);

  return found;
}

/*
 * An SLO's filter as attributes: its `@key:value` terms, a value each. A
 * term of another kind (`-@k:v`, `@k:<5`, a pattern) keeps fewer of their
 * series, so it is left out: the series the SLO reads are among the ones
 * these name. None when it has no filter, or one that cannot be read (such
 * an SLO measures nothing).
 */
function readSloFilterAttributes(
  filter: unknown,
): Record<string, unknown> | undefined {
  if (typeof filter !== "string" || !filter.trim()) {
    return undefined;
  }

  const parsed: ParsedSloMetricSearch = parseSloMetricSearch(filter);
  const attributes: Record<string, unknown> = {};

  if (parsed.problem) {
    return undefined;
  }

  for (const term of parsed.terms) {
    if (
      term.key &&
      term.predicate.operator === SearchValueOperator.Equals &&
      !(term.key in attributes)
    ) {
      attributes[term.key] = term.predicate.value;
    }
  }

  return readAttributeFilter(attributes);
}

/*
 * What a Metric SLO reads: its metric query's metric, of its own services,
 * with the attributes its filter names. Nothing for an SLO of another
 * kind - its metric query is never read - or of no service, which counts
 * nothing (EvaluateSlos).
 */
export function findSloMetricReferences(slo: {
  sliType?: SliType | string | undefined;
  metricQueryConfig?: unknown;
  serviceIds: ReadonlyArray<string>;
}): Array<MetricNameReference> {
  const serviceIds: Array<string> =
    readServiceScope(Array.from(slo.serviceIds)) || [];

  if (slo.sliType !== SliType.Metric || serviceIds.length === 0) {
    return [];
  }

  const config: Record<string, unknown> | undefined = asRecord(
    asStored(slo.metricQueryConfig),
  );
  const metricName: string = readText(config?.["metricName"]);

  return metricName
    ? [
        toReference(
          metricName,
          serviceIds,
          readSloFilterAttributes(config?.["filter"]),
        ),
      ]
    : [];
}

/*
 * What a metric recording rule reads: each of its sources' metrics, of every
 * service - the rule's cron reads a source's points of the whole project
 * (ComputeRecordingRules) - with the attribute its source filters by.
 */
export function findRecordingRuleMetricReferences(
  definition: unknown,
): Array<MetricNameReference> {
  return findMetricNameReferences(
    asRecord(asStored(definition))?.["sources"],
  ).map((reference: MetricNameReference): MetricNameReference => {
    return toReference(reference.metricName, null, reference.attributes);
  });
}

// A refusal of the person's own permissions: what they may not read, not what failed.
function isPermissionRefusal(error: unknown): boolean {
  return (
    error instanceof NotAuthorizedException ||
    error instanceof NotAuthenticatedException ||
    error instanceof PaymentRequiredException
  );
}

/*
 * Which of these records the person asking may read themselves: their ids,
 * as their own read of them answers. None when their role may read none of
 * the kind; null when that could not be told.
 */
async function findVisibleIds(data: {
  ids: Array<string>;
  projectId: ObjectID;
  read: (query: {
    projectId: ObjectID;
    ids: Array<string>;
    props: DatabaseCommonInteractionProps;
  }) => Promise<Array<{ id?: ObjectID | null | undefined }>>;
  props: DatabaseCommonInteractionProps;
  kind: MetricReaderKind;
}): Promise<Set<string> | null> {
  if (data.ids.length === 0) {
    return new Set();
  }

  try {
    const visible: Array<{ id?: ObjectID | null | undefined }> =
      await data.read({
        projectId: data.projectId,
        ids: data.ids,
        props: data.props,
      });

    return new Set(
      visible
        .map((record: { id?: ObjectID | null | undefined }): string => {
          return record.id?.toString().toLowerCase() || "";
        })
        .filter(Boolean),
    );
  } catch (error) {
    if (isPermissionRefusal(error)) {
      return new Set();
    }

    logger.warn(
      `Metric readers: could not tell which ${data.kind} records of project ${data.projectId.toString()} the person asking may read:`,
    );
    logger.warn(error);

    return null;
  }
}

/*
 * One kind's readers: the records of the project that read the metric, read
 * as the server, then split by what the person asking may read.
 */
async function findReadersOfKind<T extends { id?: ObjectID | null }>(data: {
  kind: MetricReaderKind;
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
  // Every record of the kind, read as the server.
  readAll: () => Promise<Array<T>>;
  // The records of these ids the person may read, read as them.
  readVisible: (query: {
    projectId: ObjectID;
    ids: Array<string>;
    props: DatabaseCommonInteractionProps;
  }) => Promise<Array<{ id?: ObjectID | null | undefined }>>;
  // The record as a reader, when it reads the metric.
  readerOf: (record: T) => MetricReader | null;
}): Promise<MetricReadersOfKind> {
  const unchecked: MetricReadersOfKind = {
    readers: [],
    hiddenCount: 0,
    isChecked: false,
  };
  let records: Array<T>;

  try {
    records = await data.readAll();
  } catch (error) {
    logger.warn(
      `Metric readers: could not read the ${data.kind} records of project ${data.projectId.toString()}:`,
    );
    logger.warn(error);

    return unchecked;
  }

  const readers: Array<MetricReader> = [];

  for (const record of records) {
    const reader: MetricReader | null = data.readerOf(record);

    if (reader) {
      readers.push(reader);
    }
  }

  const visible: Set<string> | null = await findVisibleIds({
    ids: readers.map((reader: MetricReader): string => {
      return reader.id;
    }),
    projectId: data.projectId,
    read: data.readVisible,
    props: data.props,
    kind: data.kind,
  });

  if (!visible) {
    return unchecked;
  }

  const shown: Array<MetricReader> = readers
    .filter((reader: MetricReader): boolean => {
      return visible.has(reader.id.toLowerCase());
    })
    .sort((a: MetricReader, b: MetricReader): number => {
      return a.name.localeCompare(b.name);
    });

  return {
    readers: shown,
    hiddenCount: readers.length - shown.length,
    isChecked: true,
  };
}

function idOf(record: { id?: ObjectID | null }): string {
  return record.id?.toString() || "";
}

/*
 * The records of a project that read a metric, kind by kind: each a reader
 * when one of its references `reads` what is asked about. Named only where
 * the person asking (`props`) may read them; counted where they may not.
 */
export async function findMetricReaders(data: {
  projectId: ObjectID;
  reads: MetricReferenceReads;
  props: DatabaseCommonInteractionProps;
}): Promise<MetricReaders> {
  const anyReads: (references: Array<MetricNameReference>) => boolean = (
    references: Array<MetricNameReference>,
  ): boolean => {
    return references.some(data.reads);
  };
  const common: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  } = { projectId: data.projectId, props: data.props };

  const [
    monitors,
    dashboards,
    slos,
    recordingRules,
  ]: Array<MetricReadersOfKind> = await Promise.all([
    findReadersOfKind<Monitor>({
      ...common,
      kind: MetricReaderKind.Monitor,
      readAll: (): Promise<Array<Monitor>> => {
        return MonitorService.findBy({
          query: { projectId: data.projectId },
          select: { _id: true, name: true, monitorSteps: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: { isRoot: true },
        });
      },
      readVisible: (query: {
        projectId: ObjectID;
        ids: Array<string>;
        props: DatabaseCommonInteractionProps;
      }): Promise<Array<Monitor>> => {
        return MonitorService.findBy({
          query: {
            projectId: query.projectId,
            _id: QueryHelper.any(query.ids),
          },
          select: { _id: true },
          skip: 0,
          limit: query.ids.length,
          props: query.props,
        });
      },
      readerOf: (monitor: Monitor): MetricReader | null => {
        return idOf(monitor) &&
          anyReads(findMetricNameReferences(monitor.monitorSteps))
          ? { id: idOf(monitor), name: monitor.name || "" }
          : null;
      },
    }),
    findReadersOfKind<Dashboard>({
      ...common,
      kind: MetricReaderKind.Dashboard,
      readAll: (): Promise<Array<Dashboard>> => {
        return DashboardService.findBy({
          query: { projectId: data.projectId },
          select: { _id: true, name: true, dashboardViewConfig: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: { isRoot: true },
        });
      },
      readVisible: (query: {
        projectId: ObjectID;
        ids: Array<string>;
        props: DatabaseCommonInteractionProps;
      }): Promise<Array<Dashboard>> => {
        return DashboardService.findBy({
          query: {
            projectId: query.projectId,
            _id: QueryHelper.any(query.ids),
          },
          select: { _id: true },
          skip: 0,
          limit: query.ids.length,
          props: query.props,
        });
      },
      readerOf: (dashboard: Dashboard): MetricReader | null => {
        const found: DashboardMetricReferences = findDashboardMetricReferences(
          dashboard.dashboardViewConfig,
        );
        const widgets: Array<MetricReaderWidget> = found.widgets
          .filter(
            (entry: {
              widget: MetricReaderWidget;
              references: Array<MetricNameReference>;
            }): boolean => {
              return anyReads(entry.references);
            },
          )
          .map(
            (entry: {
              widget: MetricReaderWidget;
              references: Array<MetricNameReference>;
            }): MetricReaderWidget => {
              return entry.widget;
            },
          );

        return idOf(dashboard) &&
          (widgets.length > 0 || anyReads(found.dashboard))
          ? { id: idOf(dashboard), name: dashboard.name || "", widgets }
          : null;
      },
    }),
    findReadersOfKind<ServiceLevelObjective>({
      ...common,
      kind: MetricReaderKind.ServiceLevelObjective,
      readAll: (): Promise<Array<ServiceLevelObjective>> => {
        return ServiceLevelObjectiveService.findBy({
          query: {
            projectId: data.projectId,
            sliType: SliType.Metric,
            isArchived: false,
          },
          select: {
            _id: true,
            name: true,
            sliType: true,
            metricQueryConfig: true,
            services: { _id: true },
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: { isRoot: true },
        });
      },
      readVisible: (query: {
        projectId: ObjectID;
        ids: Array<string>;
        props: DatabaseCommonInteractionProps;
      }): Promise<Array<ServiceLevelObjective>> => {
        return ServiceLevelObjectiveService.findBy({
          query: {
            projectId: query.projectId,
            _id: QueryHelper.any(query.ids),
          },
          select: { _id: true },
          skip: 0,
          limit: query.ids.length,
          props: query.props,
        });
      },
      readerOf: (slo: ServiceLevelObjective): MetricReader | null => {
        const references: Array<MetricNameReference> = findSloMetricReferences({
          sliType: slo.sliType,
          metricQueryConfig: slo.metricQueryConfig,
          serviceIds: (slo.services || []).map((service: Service): string => {
            return service.id?.toString() || "";
          }),
        });

        return idOf(slo) && anyReads(references)
          ? { id: idOf(slo), name: slo.name || "" }
          : null;
      },
    }),
    findReadersOfKind<MetricRecordingRule>({
      ...common,
      kind: MetricReaderKind.MetricRecordingRule,
      readAll: (): Promise<Array<MetricRecordingRule>> => {
        return MetricRecordingRuleService.findBy({
          query: { projectId: data.projectId },
          select: {
            _id: true,
            name: true,
            outputMetricName: true,
            definition: true,
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: { isRoot: true },
        });
      },
      readVisible: (query: {
        projectId: ObjectID;
        ids: Array<string>;
        props: DatabaseCommonInteractionProps;
      }): Promise<Array<MetricRecordingRule>> => {
        return MetricRecordingRuleService.findBy({
          query: {
            projectId: query.projectId,
            _id: QueryHelper.any(query.ids),
          },
          select: { _id: true },
          skip: 0,
          limit: query.ids.length,
          props: query.props,
        });
      },
      readerOf: (rule: MetricRecordingRule): MetricReader | null => {
        return idOf(rule) &&
          anyReads(findRecordingRuleMetricReferences(rule.definition))
          ? {
              id: idOf(rule),
              name: rule.name || "",
              outputMetricName: rule.outputMetricName || "",
            }
          : null;
      },
    }),
  ]);

  return {
    [MetricReaderKind.Monitor]: monitors!,
    [MetricReaderKind.Dashboard]: dashboards!,
    [MetricReaderKind.ServiceLevelObjective]: slos!,
    [MetricReaderKind.MetricRecordingRule]: recordingRules!,
  };
}
