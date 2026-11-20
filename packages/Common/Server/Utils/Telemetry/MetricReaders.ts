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
import { JSONObject } from "../../../Types/JSON";
import {
  getEmptyMetricOutputReaders,
  isMetricOutputReadersEmpty,
  MAX_OUTPUT_METRIC_DEPTH,
  MetricOutputReader,
  MetricOutputReaderKindKey,
  MetricOutputReaders,
  MetricOutputReadersOfKind,
} from "../../../Types/Metrics/MetricOutputReaders";
import { SearchValueOperator } from "../../../Types/Telemetry/TelemetrySearchQuery";
import StoredDashboardViewConfig from "../../../Utils/Dashboard/StoredDashboardViewConfig";
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
 *
 * Asked to (followsOutputMetrics, #10085), it follows each recording rule
 * it finds to what reads the metric the rule writes - which no longer
 * includes what is taken away - and on down the chain, each record named
 * once (Types/Metrics/MetricOutputReaders). The records are read once,
 * whatever the chain's length, and the person's own read of each kind is
 * one read of every record found. A widget is named by the id the board
 * draws it under, so a warning's link opens the dashboard at it (#10084).
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
  // The id the board draws it under, in lower case: a link opens it there (#10084).
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
  /*
   * Asked for (keepsReferences): its references that read what was asked
   * about, so the caller can tell more of each - which cloud resource a
   * query reads (#10078). The server's, never sent as they are.
   */
  references?: Array<MetricNameReference> | undefined;
  /*
   * A recording rule's, asked for (followsOutputMetrics, #10085): what
   * reads the metric it writes, which no longer includes what is taken
   * away - and on down the chain. None when nothing does.
   */
  outputReaders?: MetricOutputReaders | undefined;
}

export interface MetricReadersOfKind {
  // Those the person asking may read, by name.
  readers: Array<MetricReader>;
  // How many more read it that they may not read: counted, never named.
  hiddenCount: number;
  // False when the records could not be read: nothing is known of them.
  isChecked: boolean;
  /*
   * Asked for (keepsReferences): the references of those they may not read
   * that read it - what they read, never which records they are.
   */
  hiddenReferences?: Array<MetricNameReference> | undefined;
  /*
   * Recording rules', asked for (followsOutputMetrics): what reads the
   * output metrics of the ones they may not read - never which rules those
   * are. None when nothing does.
   */
  hiddenOutputReaders?: MetricOutputReaders | undefined;
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
 *
 * Its widgets are read as every board reads them
 * (StoredDashboardViewConfig): from the config in whatever shape it was
 * stored - inside the API reference's envelope, as JSON text, a widget or
 * its settings written as text - and each is named by the id the board
 * draws it under, its own or the one every reader derives for a widget
 * stored without one. So a link to the widget a warning names opens the
 * board at that very widget (#10084).
 */
export function findDashboardMetricReferences(
  dashboardViewConfig: unknown,
): DashboardMetricReferences {
  const found: DashboardMetricReferences = { widgets: [], dashboard: [] };
  const config: JSONObject = StoredDashboardViewConfig.unwrap(
    asStored(dashboardViewConfig),
  );
  const entries: Array<unknown> =
    StoredDashboardViewConfig.getComponentEntries(config);
  const ids: Array<string | null> =
    StoredDashboardViewConfig.getComponentIds(entries);

  entries.forEach((entry: unknown, index: number): void => {
    const id: string | null = ids[index] || null;

    if (!id || !StoredDashboardViewConfig.isWidgetEntry(entry)) {
      return;
    }

    const component: JSONObject =
      StoredDashboardViewConfig.withArgumentsRead(entry);
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
        id: id.toLowerCase(),
        title: title.slice(0, MAX_WIDGET_TITLE_LENGTH),
        type: readText(component["componentType"]),
      },
      references: findMetricNameReferences(component),
    });
  });

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

function idOf(record: { id?: ObjectID | null }): string {
  return record.id?.toString() || "";
}

/*
 * ONE READ OF A PROJECT'S RECORDS, ASKED AS OFTEN AS IT TAKES.
 *
 * Each kind's records are read once, as the server, and each record kept
 * as the parts it reads metrics in, with what each part reads: a monitor,
 * an SLO or a recording rule whole; a dashboard widget by widget, and
 * apart from them what it reads outside its widgets. A part is what "named
 * once" is kept by, so a dashboard named for one widget is named again for
 * another further down a chain (#10085). Asking which records read
 * something is then a walk of what is in memory: the caller's test of the
 * metrics taken away, and each recording rule's output metric after it.
 */
interface ReadingPart {
  // Unique in the project: its kind, its record and its widget.
  key: string;
  references: Array<MetricNameReference>;
  // A dashboard's widget; none for a record read whole.
  widget?: MetricReaderWidget | undefined;
  // What a dashboard reads outside its widgets: asked only when no widget of it reads it.
  isOutsideWidgets?: boolean | undefined;
}

interface ReadingRecord {
  kind: MetricReaderKind;
  id: string;
  name: string;
  parts: Array<ReadingPart>;
  // A recording rule's: the metric it writes.
  outputMetricName?: string | undefined;
}

// A record found reading it: the parts of it that do.
interface FoundReader {
  record: ReadingRecord;
  parts: Array<ReadingPart>;
  // A dashboard's widgets among them, in their order on it.
  widgets: Array<MetricReaderWidget>;
  // The references that read it, when every one of them is asked (keepsReferences).
  references: Array<MetricNameReference>;
}

type FoundByKind = Record<MetricReaderKind, Array<FoundReader>>;

// What reads one recording rule's output metric, found as the server.
interface FoundOutput {
  readers: FoundByKind;
  // More read it, further down the chain than is followed.
  isPastDepth: boolean;
}

// The kinds' records, or null for a kind that could not be read.
type ReadingRecords = Record<MetricReaderKind, Array<ReadingRecord> | null>;

const OUTPUT_KEY_OF_KIND: Record<MetricReaderKind, MetricOutputReaderKindKey> =
  {
    [MetricReaderKind.Monitor]: "monitors",
    [MetricReaderKind.Dashboard]: "dashboards",
    [MetricReaderKind.ServiceLevelObjective]: "slos",
    [MetricReaderKind.MetricRecordingRule]: "recordingRules",
  };

function noneFound(): FoundByKind {
  return {
    [MetricReaderKind.Monitor]: [],
    [MetricReaderKind.Dashboard]: [],
    [MetricReaderKind.ServiceLevelObjective]: [],
    [MetricReaderKind.MetricRecordingRule]: [],
  };
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name);
}

function wholeRecord(data: {
  kind: MetricReaderKind;
  id: string;
  name: string;
  references: Array<MetricNameReference>;
  outputMetricName?: string | undefined;
}): ReadingRecord {
  return {
    kind: data.kind,
    id: data.id,
    name: data.name,
    parts: [{ key: `${data.kind}:${data.id}`, references: data.references }],
    ...(data.outputMetricName !== undefined
      ? { outputMetricName: data.outputMetricName }
      : {}),
  };
}

function dashboardRecord(dashboard: Dashboard): ReadingRecord | null {
  const id: string = idOf(dashboard);

  if (!id) {
    return null;
  }

  const found: DashboardMetricReferences = findDashboardMetricReferences(
    dashboard.dashboardViewConfig,
  );
  const key: string = `${MetricReaderKind.Dashboard}:${id}/`;

  return {
    kind: MetricReaderKind.Dashboard,
    id,
    name: dashboard.name || "",
    parts: [
      ...found.widgets.map(
        (entry: {
          widget: MetricReaderWidget;
          references: Array<MetricNameReference>;
        }): ReadingPart => {
          return {
            key: `${key}${entry.widget.id}`,
            references: entry.references,
            widget: entry.widget,
          };
        },
      ),
      { key, references: found.dashboard, isOutsideWidgets: true },
    ],
  };
}

/*
 * The parts of a record that read it and are not named already, as a
 * reader: null when none does. `reading` says which of a part's references
 * read it - every one, or none but a sign, as asked - and null when none
 * does. A dashboard's reading outside its widgets is asked only when none
 * of its widgets reads it, unless every reference is asked.
 */
function findReaderParts(
  record: ReadingRecord,
  data: {
    reading: (
      references: Array<MetricNameReference>,
    ) => Array<MetricNameReference> | null;
    isNamed: (part: ReadingPart) => boolean;
    asksEveryPart: boolean;
  },
): FoundReader | null {
  const found: FoundReader = {
    record,
    parts: [],
    widgets: [],
    references: [],
  };

  const ask: (part: ReadingPart) => void = (part: ReadingPart): void => {
    if (data.isNamed(part)) {
      return;
    }

    const reading: Array<MetricNameReference> | null = data.reading(
      part.references,
    );

    if (!reading) {
      return;
    }

    found.parts.push(part);
    found.references.push(...reading);

    if (part.widget) {
      found.widgets.push(part.widget);
    }
  };

  for (const part of record.parts) {
    if (!part.isOutsideWidgets) {
      ask(part);
    }
  }

  for (const part of record.parts) {
    if (
      part.isOutsideWidgets &&
      (data.asksEveryPart || found.parts.length === 0)
    ) {
      ask(part);
    }
  }

  return found.parts.length > 0 ? found : null;
}

// A metric's name as an output metric is matched by: whatever its case, or the spaces around it.
function outputNameOf(name: string | null | undefined): string {
  return (name || "").trim().toLowerCase();
}

/*
 * The records that read each metric by name, in the order they were read:
 * what a recording rule's output metric is looked up in.
 */
function indexByMetricName(
  records: ReadingRecords,
): Map<string, Array<ReadingRecord>> {
  const index: Map<string, Array<ReadingRecord>> = new Map<
    string,
    Array<ReadingRecord>
  >();

  for (const kind of METRIC_READER_KINDS) {
    for (const record of records[kind] || []) {
      const names: Set<string> = new Set<string>();

      for (const part of record.parts) {
        for (const reference of part.references) {
          names.add(outputNameOf(reference.metricName));
        }
      }

      for (const name of names) {
        if (!name) {
          continue;
        }

        const readers: Array<ReadingRecord> = index.get(name) || [];

        readers.push(record);
        index.set(name, readers);
      }
    }
  }

  return index;
}

/*
 * FOLLOWING THE CHAIN (#10085): what reads the output metric of each
 * recording rule found, and of each rule found among those, kind by kind.
 *
 * A rule writes its output for the project, under no service
 * (ComputeRecordingRules), so a query of the output metric reads it
 * whatever services or attributes it is limited to: on the safe side, as
 * a recording rule's own source is read. The chain is followed breadth
 * first, nearest first, so each record is named at the first place it is
 * met, and a chain that comes back to a record already named - a rule
 * reading its own output, two rules reading each other's - ends there. An
 * output metric is followed MAX_OUTPUT_METRIC_DEPTH steps down at most;
 * past that, a rule says only that more read its output (isPastDepth).
 *
 * `isFirst` orders the rules met at one step: the ones the person may read
 * first, so a record two rules' outputs both lead to is named under the
 * one they can see.
 */
function followOutputMetrics(data: {
  direct: FoundByKind;
  index: Map<string, Array<ReadingRecord>>;
  isFirst?: ((reader: FoundReader) => boolean) | undefined;
}): Map<FoundReader, FoundOutput> {
  const outputs: Map<FoundReader, FoundOutput> = new Map<
    FoundReader,
    FoundOutput
  >();
  const named: Set<string> = new Set<string>();

  for (const kind of METRIC_READER_KINDS) {
    for (const reader of data.direct[kind]) {
      for (const part of reader.parts) {
        named.add(part.key);
      }
    }
  }

  const ordered: (rules: Array<FoundReader>) => Array<FoundReader> = (
    rules: Array<FoundReader>,
  ): Array<FoundReader> => {
    return [...rules].sort((a: FoundReader, b: FoundReader): number => {
      const firstA: boolean = data.isFirst ? data.isFirst(a) : true;
      const firstB: boolean = data.isFirst ? data.isFirst(b) : true;

      if (firstA !== firstB) {
        return firstA ? -1 : 1;
      }

      return byName(a.record, b.record);
    });
  };

  const readsOutput: (
    outputName: string,
  ) => (
    references: Array<MetricNameReference>,
  ) => Array<MetricNameReference> | null = (outputName: string) => {
    return (
      references: Array<MetricNameReference>,
    ): Array<MetricNameReference> | null => {
      return references.some((reference: MetricNameReference): boolean => {
        return outputNameOf(reference.metricName) === outputName;
      })
        ? []
        : null;
    };
  };

  const isNamed: (part: ReadingPart) => boolean = (
    part: ReadingPart,
  ): boolean => {
    return named.has(part.key);
  };

  // What reads one rule's output metric, of the records not named yet; named now.
  const followOne: (rule: FoundReader, depth: number) => Array<FoundReader> = (
    rule: FoundReader,
    depth: number,
  ): Array<FoundReader> => {
    const outputName: string = outputNameOf(rule.record.outputMetricName);

    if (!outputName) {
      return [];
    }

    const candidates: Array<ReadingRecord> = data.index.get(outputName) || [];

    // Past the last step followed: only whether more read it.
    if (depth > MAX_OUTPUT_METRIC_DEPTH) {
      const isReadFurther: boolean = candidates.some(
        (record: ReadingRecord): boolean => {
          return (
            findReaderParts(record, {
              reading: readsOutput(outputName),
              isNamed,
              asksEveryPart: false,
            }) !== null
          );
        },
      );

      if (isReadFurther) {
        outputs.set(rule, { readers: noneFound(), isPastDepth: true });
      }

      return [];
    }

    const readers: FoundByKind = noneFound();

    for (const record of candidates) {
      const found: FoundReader | null = findReaderParts(record, {
        reading: readsOutput(outputName),
        isNamed,
        asksEveryPart: false,
      });

      if (!found) {
        continue;
      }

      for (const part of found.parts) {
        named.add(part.key);
      }

      readers[record.kind].push(found);
    }

    if (
      METRIC_READER_KINDS.some((kind: MetricReaderKind): boolean => {
        return readers[kind].length > 0;
      })
    ) {
      outputs.set(rule, { readers, isPastDepth: false });
    }

    return readers[MetricReaderKind.MetricRecordingRule];
  };

  /*
   * Step by step: every rule of one step, in order - the ones the person
   * may read first, then by name, across the whole step - before any of
   * the next.
   */
  let step: Array<FoundReader> = ordered(
    data.direct[MetricReaderKind.MetricRecordingRule],
  );

  for (let depth: number = 1; step.length > 0; depth++) {
    const next: Array<FoundReader> = [];

    for (const rule of step) {
      next.push(...followOne(rule, depth));
    }

    step = ordered(next);
  }

  return outputs;
}

/*
 * What reads the output metrics of several rules, together: what the ones
 * the person may not read lead to. A dashboard met under two of them is
 * one dashboard, with the widgets of both.
 */
function mergeOutputs(
  found: Array<FoundOutput | undefined>,
): FoundOutput | undefined {
  const outputs: Array<FoundOutput> = found.filter(
    (output: FoundOutput | undefined): output is FoundOutput => {
      return output !== undefined;
    },
  );

  if (outputs.length === 0) {
    return undefined;
  }

  const merged: FoundOutput = { readers: noneFound(), isPastDepth: false };

  for (const output of outputs) {
    merged.isPastDepth = merged.isPastDepth || output.isPastDepth;

    for (const kind of METRIC_READER_KINDS) {
      for (const reader of output.readers[kind]) {
        const same: FoundReader | undefined = merged.readers[kind].find(
          (other: FoundReader): boolean => {
            return other.record === reader.record;
          },
        );

        if (same) {
          same.parts.push(...reader.parts);
          same.widgets.push(...reader.widgets);
        } else if (kind === MetricReaderKind.Dashboard) {
          // A copy, to take the widgets of the others: the reader as found is left as it was.
          merged.readers[kind].push({
            ...reader,
            parts: [...reader.parts],
            widgets: [...reader.widgets],
          });
        } else {
          // The reader as found: a rule's output is looked up by it.
          merged.readers[kind].push(reader);
        }
      }
    }
  }

  return merged;
}

// The ids of every record found, kind by kind: the direct readers and all down the chain.
function collectIds(data: {
  direct: FoundByKind;
  outputs: Map<FoundReader, FoundOutput>;
}): Record<MetricReaderKind, Set<string>> {
  const ids: Record<MetricReaderKind, Set<string>> = {
    [MetricReaderKind.Monitor]: new Set<string>(),
    [MetricReaderKind.Dashboard]: new Set<string>(),
    [MetricReaderKind.ServiceLevelObjective]: new Set<string>(),
    [MetricReaderKind.MetricRecordingRule]: new Set<string>(),
  };
  const add: (found: FoundByKind) => void = (found: FoundByKind): void => {
    for (const kind of METRIC_READER_KINDS) {
      for (const reader of found[kind]) {
        ids[kind].add(reader.record.id);
      }
    }
  };

  add(data.direct);

  for (const output of data.outputs.values()) {
    add(output.readers);
  }

  return ids;
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
  /*
   * Keep each reader's references that read what is asked about
   * (MetricReader.references), and the hidden readers'
   * (MetricReadersOfKind.hiddenReferences): every reference is then asked,
   * not only up to the first that reads it.
   */
  keepsReferences?: boolean | undefined;
  /*
   * Follow each recording rule that reads it to what reads the metric it
   * writes, and on down the chain (MetricReader.outputReaders,
   * MetricReadersOfKind.hiddenOutputReaders, #10085): what taking the
   * metric away leaves without data one step further on.
   */
  followsOutputMetrics?: boolean | undefined;
}): Promise<MetricReaders> {
  const keepsReferences: boolean = Boolean(data.keepsReferences);
  const projectId: ObjectID = data.projectId;

  /*
   * A part's references that read it: null for none. Every one of them is
   * asked when they are kept; else up to the first that reads it.
   */
  const readingOf: (
    references: Array<MetricNameReference>,
  ) => Array<MetricNameReference> | null = (
    references: Array<MetricNameReference>,
  ): Array<MetricNameReference> | null => {
    if (!keepsReferences) {
      return references.some(data.reads) ? [] : null;
    }

    const reading: Array<MetricNameReference> = references.filter(data.reads);

    return reading.length > 0 ? reading : null;
  };

  const readOfKind: <T>(read: {
    kind: MetricReaderKind;
    readAll: () => Promise<Array<T>>;
    recordOf: (record: T) => ReadingRecord | null;
  }) => Promise<Array<ReadingRecord> | null> = async <T>(read: {
    kind: MetricReaderKind;
    readAll: () => Promise<Array<T>>;
    recordOf: (record: T) => ReadingRecord | null;
  }): Promise<Array<ReadingRecord> | null> => {
    let records: Array<T>;

    try {
      records = await read.readAll();
    } catch (error) {
      logger.warn(
        `Metric readers: could not read the ${read.kind} records of project ${projectId.toString()}:`,
      );
      logger.warn(error);

      return null;
    }

    return records
      .map(read.recordOf)
      .filter((record: ReadingRecord | null): record is ReadingRecord => {
        return record !== null;
      });
  };

  const [
    monitors,
    dashboards,
    slos,
    rules,
  ]: Array<Array<ReadingRecord> | null> = await Promise.all([
    readOfKind<Monitor>({
      kind: MetricReaderKind.Monitor,
      readAll: (): Promise<Array<Monitor>> => {
        return MonitorService.findBy({
          query: { projectId },
          select: { _id: true, name: true, monitorSteps: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: { isRoot: true },
        });
      },
      recordOf: (monitor: Monitor): ReadingRecord | null => {
        return idOf(monitor)
          ? wholeRecord({
              kind: MetricReaderKind.Monitor,
              id: idOf(monitor),
              name: monitor.name || "",
              references: findMetricNameReferences(monitor.monitorSteps),
            })
          : null;
      },
    }),
    readOfKind<Dashboard>({
      kind: MetricReaderKind.Dashboard,
      readAll: (): Promise<Array<Dashboard>> => {
        return DashboardService.findBy({
          query: { projectId },
          select: { _id: true, name: true, dashboardViewConfig: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: { isRoot: true },
        });
      },
      recordOf: dashboardRecord,
    }),
    readOfKind<ServiceLevelObjective>({
      kind: MetricReaderKind.ServiceLevelObjective,
      readAll: (): Promise<Array<ServiceLevelObjective>> => {
        return ServiceLevelObjectiveService.findBy({
          query: {
            projectId,
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
      recordOf: (slo: ServiceLevelObjective): ReadingRecord | null => {
        return idOf(slo)
          ? wholeRecord({
              kind: MetricReaderKind.ServiceLevelObjective,
              id: idOf(slo),
              name: slo.name || "",
              references: findSloMetricReferences({
                sliType: slo.sliType,
                metricQueryConfig: slo.metricQueryConfig,
                serviceIds: (slo.services || []).map(
                  (service: Service): string => {
                    return service.id?.toString() || "";
                  },
                ),
              }),
            })
          : null;
      },
    }),
    readOfKind<MetricRecordingRule>({
      kind: MetricReaderKind.MetricRecordingRule,
      readAll: (): Promise<Array<MetricRecordingRule>> => {
        return MetricRecordingRuleService.findBy({
          query: { projectId },
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
      recordOf: (rule: MetricRecordingRule): ReadingRecord | null => {
        return idOf(rule)
          ? wholeRecord({
              kind: MetricReaderKind.MetricRecordingRule,
              id: idOf(rule),
              name: rule.name || "",
              references: findRecordingRuleMetricReferences(rule.definition),
              outputMetricName: rule.outputMetricName || "",
            })
          : null;
      },
    }),
  ]);

  const records: ReadingRecords = {
    [MetricReaderKind.Monitor]: monitors!,
    [MetricReaderKind.Dashboard]: dashboards!,
    [MetricReaderKind.ServiceLevelObjective]: slos!,
    [MetricReaderKind.MetricRecordingRule]: rules!,
  };

  // What reads what is asked about, as the server.
  const direct: FoundByKind = noneFound();

  for (const kind of METRIC_READER_KINDS) {
    for (const record of records[kind] || []) {
      const found: FoundReader | null = findReaderParts(record, {
        reading: readingOf,
        isNamed: (): boolean => {
          return false;
        },
        asksEveryPart: keepsReferences,
      });

      if (found) {
        direct[kind].push(found);
      }
    }
  }

  const index: Map<string, Array<ReadingRecord>> | null =
    data.followsOutputMetrics ? indexByMetricName(records) : null;
  const reachable: Map<FoundReader, FoundOutput> = index
    ? followOutputMetrics({ direct, index })
    : new Map<FoundReader, FoundOutput>();

  // Which of all of them the person may read: one read of each kind, as them.
  const readVisible: Record<
    MetricReaderKind,
    (query: {
      projectId: ObjectID;
      ids: Array<string>;
      props: DatabaseCommonInteractionProps;
    }) => Promise<Array<{ id?: ObjectID | null | undefined }>>
  > = {
    [MetricReaderKind.Monitor]: (query: {
      projectId: ObjectID;
      ids: Array<string>;
      props: DatabaseCommonInteractionProps;
    }): Promise<Array<Monitor>> => {
      return MonitorService.findBy({
        query: { projectId: query.projectId, _id: QueryHelper.any(query.ids) },
        select: { _id: true },
        skip: 0,
        limit: query.ids.length,
        props: query.props,
      });
    },
    [MetricReaderKind.Dashboard]: (query: {
      projectId: ObjectID;
      ids: Array<string>;
      props: DatabaseCommonInteractionProps;
    }): Promise<Array<Dashboard>> => {
      return DashboardService.findBy({
        query: { projectId: query.projectId, _id: QueryHelper.any(query.ids) },
        select: { _id: true },
        skip: 0,
        limit: query.ids.length,
        props: query.props,
      });
    },
    [MetricReaderKind.ServiceLevelObjective]: (query: {
      projectId: ObjectID;
      ids: Array<string>;
      props: DatabaseCommonInteractionProps;
    }): Promise<Array<ServiceLevelObjective>> => {
      return ServiceLevelObjectiveService.findBy({
        query: { projectId: query.projectId, _id: QueryHelper.any(query.ids) },
        select: { _id: true },
        skip: 0,
        limit: query.ids.length,
        props: query.props,
      });
    },
    [MetricReaderKind.MetricRecordingRule]: (query: {
      projectId: ObjectID;
      ids: Array<string>;
      props: DatabaseCommonInteractionProps;
    }): Promise<Array<MetricRecordingRule>> => {
      return MetricRecordingRuleService.findBy({
        query: { projectId: query.projectId, _id: QueryHelper.any(query.ids) },
        select: { _id: true },
        skip: 0,
        limit: query.ids.length,
        props: query.props,
      });
    },
  };
  const candidates: Record<MetricReaderKind, Set<string>> = collectIds({
    direct,
    outputs: reachable,
  });
  const visibleOfKinds: Array<Set<string> | null> = await Promise.all(
    METRIC_READER_KINDS.map(
      (kind: MetricReaderKind): Promise<Set<string> | null> => {
        // A kind that could not be read has nobody to ask about.
        if (!records[kind]) {
          return Promise.resolve(null);
        }

        return findVisibleIds({
          ids: Array.from(candidates[kind]),
          projectId,
          read: readVisible[kind],
          props: data.props,
          kind,
        });
      },
    ),
  );
  const visible: Record<MetricReaderKind, Set<string> | null> = {
    [MetricReaderKind.Monitor]: visibleOfKinds[0]!,
    [MetricReaderKind.Dashboard]: visibleOfKinds[1]!,
    [MetricReaderKind.ServiceLevelObjective]: visibleOfKinds[2]!,
    [MetricReaderKind.MetricRecordingRule]: visibleOfKinds[3]!,
  };
  const isVisible: (reader: FoundReader) => boolean = (
    reader: FoundReader,
  ): boolean => {
    return Boolean(
      visible[reader.record.kind]?.has(reader.record.id.toLowerCase()),
    );
  };

  /*
   * The chain again, now that it is known which rules the person may read:
   * those first at each step, so what two outputs lead to is named under
   * the rule they can see. The same records are met; only where.
   */
  const outputs: Map<FoundReader, FoundOutput> = index
    ? followOutputMetrics({ direct, index, isFirst: isVisible })
    : reachable;

  // What reads an output metric, as the person may know it: named, counted, or - unknown kinds - neither.
  const toOutputReaders: (
    found: FoundOutput | undefined,
  ) => MetricOutputReaders | undefined = (
    found: FoundOutput | undefined,
  ): MetricOutputReaders | undefined => {
    if (!found) {
      return undefined;
    }

    const answer: MetricOutputReaders = getEmptyMetricOutputReaders();

    for (const kind of METRIC_READER_KINDS) {
      if (!visible[kind]) {
        continue;
      }

      const ofKind: Array<FoundReader> = found.readers[kind];
      const hidden: Array<FoundReader> = ofKind.filter(
        (reader: FoundReader): boolean => {
          return !isVisible(reader);
        },
      );
      const answered: MetricOutputReadersOfKind = {
        readers: ofKind
          .filter(isVisible)
          .sort((a: FoundReader, b: FoundReader): number => {
            return byName(a.record, b.record);
          })
          .map(toOutputReader),
        hidden: hidden.length,
      };

      if (kind === MetricReaderKind.MetricRecordingRule) {
        const hiddenOutputReaders: MetricOutputReaders | undefined =
          toOutputReaders(
            mergeOutputs(
              hidden.map((rule: FoundReader): FoundOutput | undefined => {
                return outputs.get(rule);
              }),
            ),
          );

        if (hiddenOutputReaders) {
          answered.hiddenOutputReaders = hiddenOutputReaders;
        }
      }

      answer[OUTPUT_KEY_OF_KIND[kind]] = answered;
    }

    if (found.isPastDepth) {
      answer.isPastDepth = true;
    }

    return isMetricOutputReadersEmpty(answer) ? undefined : answer;
  };

  const toOutputReader: (reader: FoundReader) => MetricOutputReader = (
    reader: FoundReader,
  ): MetricOutputReader => {
    const answered: MetricOutputReader = {
      id: reader.record.id,
      name: reader.record.name,
    };

    if (reader.record.kind === MetricReaderKind.Dashboard) {
      answered.widgets = reader.widgets.map(
        (widget: MetricReaderWidget): MetricReaderWidget => {
          return { id: widget.id, title: widget.title, type: widget.type };
        },
      );
    }

    if (reader.record.outputMetricName) {
      answered.outputMetricName = reader.record.outputMetricName;
    }

    const outputReaders: MetricOutputReaders | undefined = toOutputReaders(
      outputs.get(reader),
    );

    if (outputReaders) {
      answered.outputReaders = outputReaders;
    }

    return answered;
  };

  // A reader of what is asked about, as the answer names it.
  const toReader: (reader: FoundReader) => MetricReader = (
    reader: FoundReader,
  ): MetricReader => {
    const answered: MetricReader = {
      id: reader.record.id,
      name: reader.record.name,
    };

    if (reader.record.kind === MetricReaderKind.Dashboard) {
      answered.widgets = reader.widgets;
    }

    if (reader.record.kind === MetricReaderKind.MetricRecordingRule) {
      answered.outputMetricName = reader.record.outputMetricName || "";
    }

    if (keepsReferences) {
      answered.references = reader.references;
    }

    const outputReaders: MetricOutputReaders | undefined = toOutputReaders(
      outputs.get(reader),
    );

    if (outputReaders) {
      answered.outputReaders = outputReaders;
    }

    return answered;
  };

  const answer: MetricReaders = {} as MetricReaders;

  for (const kind of METRIC_READER_KINDS) {
    const visibleIds: Set<string> | null = visible[kind];

    if (!records[kind] || !visibleIds) {
      answer[kind] = { readers: [], hiddenCount: 0, isChecked: false };
      continue;
    }

    const hidden: Array<FoundReader> = direct[kind].filter(
      (reader: FoundReader): boolean => {
        return !isVisible(reader);
      },
    );
    const ofKind: MetricReadersOfKind = {
      readers: direct[kind]
        .filter(isVisible)
        .sort((a: FoundReader, b: FoundReader): number => {
          return byName(a.record, b.record);
        })
        .map(toReader),
      hiddenCount: hidden.length,
      isChecked: true,
    };

    if (keepsReferences) {
      ofKind.hiddenReferences = hidden.flatMap(
        (reader: FoundReader): Array<MetricNameReference> => {
          return reader.references;
        },
      );
    }

    if (kind === MetricReaderKind.MetricRecordingRule && index) {
      const hiddenOutputReaders: MetricOutputReaders | undefined =
        toOutputReaders(
          mergeOutputs(
            hidden.map((rule: FoundReader): FoundOutput | undefined => {
              return outputs.get(rule);
            }),
          ),
        );

      if (hiddenOutputReaders) {
        ofKind.hiddenOutputReaders = hiddenOutputReaders;
      }
    }

    answer[kind] = ofKind;
  }

  return answer;
}
