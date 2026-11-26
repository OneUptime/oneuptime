import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import ExceptionSavedView from "../../../Models/DatabaseModels/ExceptionSavedView";
import LogRecordingRule from "../../../Models/DatabaseModels/LogRecordingRule";
import LogSavedView from "../../../Models/DatabaseModels/LogSavedView";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Service from "../../../Models/DatabaseModels/Service";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import TraceRecordingRule from "../../../Models/DatabaseModels/TraceRecordingRule";
import TraceSavedView from "../../../Models/DatabaseModels/TraceSavedView";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../Types/ObjectID";
import SliType from "../../../Types/ServiceLevelObjective/SliType";
import {
  getEmptyTelemetryFieldReadersByKind,
  TELEMETRY_FIELD_READER_KINDS,
  TelemetryFieldRead,
  TelemetryFieldReader,
  TelemetryFieldReaderKind,
  TelemetryFieldReaderList,
  TelemetryFieldReadersByKind,
  TelemetryFieldReaderWidget,
} from "../../../Types/Telemetry/TelemetryFieldReaders";
import {
  DashboardFieldReferences,
  DashboardTelemetryQueries,
  findDashboardFieldReferences,
  findDashboardTelemetryQueries,
  findExceptionSavedViewFieldReferences,
  findExceptionSavedViewTelemetryQueries,
  findLogRecordingRuleFieldReferences,
  findLogRecordingRuleTelemetryQueries,
  findLogSavedViewFieldReferences,
  findLogSavedViewTelemetryQueries,
  findMonitorFieldReferences,
  findMonitorTelemetryQueries,
  findSloFieldReferences,
  findSloTelemetryQueries,
  findTraceRecordingRuleFieldReferences,
  findTraceRecordingRuleTelemetryQueries,
  findTraceSavedViewFieldReferences,
  findTraceSavedViewTelemetryQueries,
  TelemetryFieldReference,
  TelemetryFieldReferenceWidget,
  TelemetryReadQuery,
} from "../../../Utils/Telemetry/TelemetryFieldReferences";
import QueryHelper from "../../Types/Database/QueryHelper";
import DashboardService from "../../Services/DashboardService";
import ExceptionSavedViewService from "../../Services/ExceptionSavedViewService";
import LogRecordingRuleService from "../../Services/LogRecordingRuleService";
import LogSavedViewService from "../../Services/LogSavedViewService";
import MonitorService from "../../Services/MonitorService";
import ServiceLevelObjectiveService from "../../Services/ServiceLevelObjectiveService";
import TraceRecordingRuleService from "../../Services/TraceRecordingRuleService";
import TraceSavedViewService from "../../Services/TraceSavedViewService";
import logger from "../Logger";

/*
 * WHICH SAVED RECORDS READ A LOG'S OR A SPAN'S FIELDS (#10433).
 *
 * The lookup beside MetricReaders, for logs and spans. A change that takes
 * something from what is stored of them - a scrub rule that hides a value
 * (DataSecurity/Telemetry/TelemetryScrubImpact), a drop or sample filter
 * that keeps a record out (#10436) - asks here what it breaks, before it is
 * made: every monitor (Logs, Traces and Exceptions steps), dashboard (Log
 * Stream, Log Chart, Trace Chart and Trace Table widgets, and its telemetry
 * attribute variables), saved view (Logs, Traces, Exceptions), recording
 * rule (log and trace) and request SLO of the project, walked into the
 * fields each reads (Utils/Telemetry/TelemetryFieldReferences), and asked
 * the caller's question of each field (`reads`). Security Events, which
 * reads the logs and spans themselves, is asked apart
 * (SecurityEvent/SecurityEventsFieldReaders).
 *
 * As MetricReaders: the records are read as the server - so every reader is
 * counted - and named only where the person asking (`props`) may read them
 * themselves; the rest are a count, never a name. A kind that cannot be
 * read is said to be unchecked, never empty. A monitor turned off and a
 * rule switched off still read what they read: they break when turned on.
 * An archived SLO is measured no more, and is left out.
 *
 * Each reader keeps what it reads that the change takes (TelemetryFieldRead,
 * the first MAX_READS_PER_READER), so a page says "filters on user.email",
 * and a dashboard the widgets that read it.
 */

// The most of one reader's readings an answer says.
export const MAX_READS_PER_READER: number = 3;

// Asked of each field a record reads: whether the change takes it away.
export type TelemetryFieldReferenceReads = (
  reference: TelemetryFieldReference,
) => boolean;

/*
 * Asked of each query a record keeps records by: whether the change takes
 * records it keeps - a drop or sample filter (#10436), which takes whole
 * records rather than a field of them.
 */
export type TelemetryReadQueryReads = (query: TelemetryReadQuery) => boolean;

/*
 * What a caller asks of the records: of each field they read (a scrub
 * rule), or of each query they keep records by (a drop filter).
 */
type ReaderQuestion =
  | { of: "field"; reads: TelemetryFieldReferenceReads }
  | { of: "query"; reads: TelemetryReadQueryReads };

// A record, as the parts it reads fields in.
interface ReadingPart {
  references: Array<TelemetryFieldReference>;
  // The queries the part keeps records by: read only when the question is of queries.
  queries?: Array<TelemetryReadQuery> | undefined;
  // A dashboard's widget; none for a record read whole.
  widget?: TelemetryFieldReferenceWidget | undefined;
}

interface ReadingRecord {
  id: string;
  name: string;
  // Which list a saved view or a recording rule is in.
  list?: TelemetryFieldReaderList | undefined;
  parts: Array<ReadingPart>;
}

// One kind's records, read from one or more tables.
interface KindRead {
  kind: TelemetryFieldReaderKind;
  // Each table's records, or null for one that could not be read.
  groups: Array<{
    name: string;
    records: Array<ReadingRecord> | null;
    readVisible: (query: {
      ids: Array<string>;
      props: DatabaseCommonInteractionProps;
    }) => Promise<Array<{ id?: ObjectID | null | undefined }>>;
  }>;
}

function idOf(record: { id?: ObjectID | null | undefined }): string {
  return record.id?.toString().toLowerCase() || "";
}

function wholeRecord(data: {
  id: string;
  name: string;
  references: Array<TelemetryFieldReference>;
  queries?: Array<TelemetryReadQuery> | undefined;
  list?: TelemetryFieldReaderList | undefined;
}): ReadingRecord {
  return {
    id: data.id,
    name: data.name,
    parts: [
      {
        references: data.references,
        ...(data.queries ? { queries: data.queries } : {}),
      },
    ],
    ...(data.list ? { list: data.list } : {}),
  };
}

function readOf(reference: TelemetryFieldReference): TelemetryFieldRead {
  const read: TelemetryFieldRead = {
    part: reference.part,
    use: reference.use,
  };

  if (reference.key !== undefined) {
    read.key = reference.key;
  }

  return read;
}

function readKey(read: TelemetryFieldRead): string {
  return `${read.part}|${(read.key || "").toLowerCase()}|${read.use}`;
}

// Whether a question holds for one thing asked about; a question that throws says no.
function holds<T>(reads: (asked: T) => boolean, asked: T): boolean {
  try {
    return reads(asked);
  } catch {
    return false;
  }
}

/*
 * What of a part reads what is asked about: the fields it reads that the
 * change takes, or every field of the queries whose records it takes. Null
 * when nothing of it does; none when a query the change reaches reads no
 * field (a monitor counting every log of a service).
 */
function readingOfPart(
  part: ReadingPart,
  question: ReaderQuestion,
): Array<TelemetryFieldReference> | null {
  if (question.of === "field") {
    const reading: Array<TelemetryFieldReference> = part.references.filter(
      (reference: TelemetryFieldReference): boolean => {
        return holds(question.reads, reference);
      },
    );

    return reading.length > 0 ? reading : null;
  }

  const reached: Array<TelemetryReadQuery> = (part.queries || []).filter(
    (readQuery: TelemetryReadQuery): boolean => {
      return holds(question.reads, readQuery);
    },
  );

  return reached.length > 0
    ? reached.flatMap(
        (readQuery: TelemetryReadQuery): Array<TelemetryFieldReference> => {
          return readQuery.references;
        },
      )
    : null;
}

/*
 * A record as a reader of what is asked about: its parts that read it, with
 * the widgets among them and what each reads - or null when none does.
 */
function asReader(
  record: ReadingRecord,
  question: ReaderQuestion,
): TelemetryFieldReader | null {
  const fieldReads: Map<string, TelemetryFieldRead> = new Map<
    string,
    TelemetryFieldRead
  >();
  const widgets: Array<TelemetryFieldReaderWidget> = [];
  let isReading: boolean = false;

  for (const part of record.parts) {
    const reading: Array<TelemetryFieldReference> | null = readingOfPart(
      part,
      question,
    );

    if (!reading) {
      continue;
    }

    isReading = true;

    if (part.widget) {
      widgets.push({ ...part.widget });
    }

    for (const reference of reading) {
      const read: TelemetryFieldRead = readOf(reference);

      if (!fieldReads.has(readKey(read))) {
        fieldReads.set(readKey(read), read);
      }
    }
  }

  if (!isReading) {
    return null;
  }

  const reader: TelemetryFieldReader = {
    id: record.id,
    name: record.name,
    reads: Array.from(fieldReads.values()).slice(0, MAX_READS_PER_READER),
  };

  if (record.list) {
    reader.list = record.list;
  }

  if (widgets.length > 0) {
    reader.widgets = widgets;
  }

  return reader;
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
 * Which of these records the person may read themselves: their ids, as
 * their own read answers. None when their role may read none of the
 * kind; null when that could not be told.
 */
async function findVisibleIds(data: {
  ids: Array<string>;
  read: (query: {
    ids: Array<string>;
    props: DatabaseCommonInteractionProps;
  }) => Promise<Array<{ id?: ObjectID | null | undefined }>>;
  props: DatabaseCommonInteractionProps;
  what: string;
}): Promise<Set<string> | null> {
  if (data.ids.length === 0) {
    return new Set();
  }

  try {
    const visible: Array<{ id?: ObjectID | null | undefined }> =
      await data.read({ ids: data.ids, props: data.props });

    return new Set(visible.map(idOf).filter(Boolean));
  } catch (error) {
    if (isPermissionRefusal(error)) {
      return new Set();
    }

    logger.warn(
      `Telemetry field readers: could not tell which ${data.what} the person asking may read:`,
    );
    logger.warn(error);

    return null;
  }
}

async function readRecords<T>(data: {
  what: string;
  projectId: ObjectID;
  readAll: () => Promise<Array<T>>;
  recordOf: (record: T) => ReadingRecord | null;
}): Promise<Array<ReadingRecord> | null> {
  let rows: Array<T>;

  try {
    rows = await data.readAll();
  } catch (error) {
    logger.warn(
      `Telemetry field readers: could not read the ${data.what} of project ${data.projectId.toString()}:`,
    );
    logger.warn(error);

    return null;
  }

  return rows
    .map(data.recordOf)
    .filter((record: ReadingRecord | null): record is ReadingRecord => {
      return record !== null && record.parts.length > 0;
    });
}

function dashboardRecord(
  dashboard: Dashboard,
  question: ReaderQuestion["of"],
): ReadingRecord | null {
  const id: string = idOf(dashboard);

  if (!id) {
    return null;
  }

  const found: DashboardFieldReferences = findDashboardFieldReferences(
    dashboard.dashboardViewConfig,
  );

  if (question === "field") {
    return {
      id,
      name: dashboard.name || "",
      parts: [
        ...found.widgets.map(
          (entry: {
            widget: TelemetryFieldReferenceWidget;
            references: Array<TelemetryFieldReference>;
          }): ReadingPart => {
            return { references: entry.references, widget: entry.widget };
          },
        ),
        { references: found.dashboard },
      ],
    };
  }

  /*
   * Of queries: every log and trace widget, one that filters nothing too -
   * it reads every record of its signal - each with the fields it reads.
   */
  const referencesOfWidget: Map<
    string,
    Array<TelemetryFieldReference>
  > = new Map<string, Array<TelemetryFieldReference>>(
    found.widgets.map(
      (entry: {
        widget: TelemetryFieldReferenceWidget;
        references: Array<TelemetryFieldReference>;
      }): [string, Array<TelemetryFieldReference>] => {
        return [entry.widget.id, entry.references];
      },
    ),
  );
  const queried: DashboardTelemetryQueries = findDashboardTelemetryQueries(
    dashboard.dashboardViewConfig,
  );

  return {
    id,
    name: dashboard.name || "",
    parts: queried.widgets.map(
      (entry: {
        widget: TelemetryFieldReferenceWidget;
        queries: Array<TelemetryReadQuery>;
      }): ReadingPart => {
        return {
          references: referencesOfWidget.get(entry.widget.id) || [],
          queries: entry.queries,
          widget: entry.widget,
        };
      },
    ),
  };
}

/*
 * The project's records of every kind, read as the server, each with the
 * fields it reads - and how the person's own read of each table is asked.
 */
async function readKinds(
  projectId: ObjectID,
  question: ReaderQuestion["of"],
): Promise<Array<KindRead>> {
  // The queries of a record, read only when the question is of queries.
  const queriesIf: (
    read: () => Array<TelemetryReadQuery>,
  ) => Array<TelemetryReadQuery> | undefined = (
    read: () => Array<TelemetryReadQuery>,
  ): Array<TelemetryReadQuery> | undefined => {
    return question === "query" ? read() : undefined;
  };

  const idsQuery: (ids: Array<string>) => {
    projectId: ObjectID;
    _id: ReturnType<typeof QueryHelper.any>;
  } = (ids: Array<string>) => {
    return { projectId, _id: QueryHelper.any(ids) };
  };

  const [
    monitors,
    dashboards,
    logViews,
    traceViews,
    exceptionViews,
    logRules,
    traceRules,
    slos,
  ]: Array<Array<ReadingRecord> | null> = await Promise.all([
    readRecords<Monitor>({
      what: "monitors",
      projectId,
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
              id: idOf(monitor),
              name: monitor.name || "",
              references: findMonitorFieldReferences(monitor.monitorSteps),
              queries: queriesIf((): Array<TelemetryReadQuery> => {
                return findMonitorTelemetryQueries(monitor.monitorSteps);
              }),
            })
          : null;
      },
    }),
    readRecords<Dashboard>({
      what: "dashboards",
      projectId,
      readAll: (): Promise<Array<Dashboard>> => {
        return DashboardService.findBy({
          query: { projectId },
          select: { _id: true, name: true, dashboardViewConfig: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: { isRoot: true },
        });
      },
      recordOf: (dashboard: Dashboard): ReadingRecord | null => {
        return dashboardRecord(dashboard, question);
      },
    }),
    readRecords<LogSavedView>({
      what: "log saved views",
      projectId,
      readAll: (): Promise<Array<LogSavedView>> => {
        return LogSavedViewService.findBy({
          query: { projectId },
          select: { _id: true, name: true, query: true, scope: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: { isRoot: true },
        });
      },
      recordOf: (view: LogSavedView): ReadingRecord | null => {
        return idOf(view)
          ? wholeRecord({
              id: idOf(view),
              name: view.name || "",
              list: TelemetryFieldReaderList.Logs,
              references: findLogSavedViewFieldReferences({
                query: view.query,
                scope: view.scope,
              }),
              queries: queriesIf((): Array<TelemetryReadQuery> => {
                return findLogSavedViewTelemetryQueries({
                  query: view.query,
                  scope: view.scope,
                });
              }),
            })
          : null;
      },
    }),
    readRecords<TraceSavedView>({
      what: "trace saved views",
      projectId,
      readAll: (): Promise<Array<TraceSavedView>> => {
        return TraceSavedViewService.findBy({
          query: { projectId },
          select: { _id: true, name: true, query: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: { isRoot: true },
        });
      },
      recordOf: (view: TraceSavedView): ReadingRecord | null => {
        return idOf(view)
          ? wholeRecord({
              id: idOf(view),
              name: view.name || "",
              list: TelemetryFieldReaderList.Traces,
              references: findTraceSavedViewFieldReferences({
                query: view.query,
              }),
              queries: queriesIf((): Array<TelemetryReadQuery> => {
                return findTraceSavedViewTelemetryQueries({
                  query: view.query,
                });
              }),
            })
          : null;
      },
    }),
    readRecords<ExceptionSavedView>({
      what: "exception saved views",
      projectId,
      readAll: (): Promise<Array<ExceptionSavedView>> => {
        return ExceptionSavedViewService.findBy({
          query: { projectId },
          select: { _id: true, name: true, query: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: { isRoot: true },
        });
      },
      recordOf: (view: ExceptionSavedView): ReadingRecord | null => {
        return idOf(view)
          ? wholeRecord({
              id: idOf(view),
              name: view.name || "",
              list: TelemetryFieldReaderList.Exceptions,
              references: findExceptionSavedViewFieldReferences({
                query: view.query,
              }),
              queries: queriesIf((): Array<TelemetryReadQuery> => {
                return findExceptionSavedViewTelemetryQueries({
                  query: view.query,
                });
              }),
            })
          : null;
      },
    }),
    readRecords<LogRecordingRule>({
      what: "log recording rules",
      projectId,
      readAll: (): Promise<Array<LogRecordingRule>> => {
        return LogRecordingRuleService.findBy({
          query: { projectId },
          select: { _id: true, name: true, definition: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: { isRoot: true },
        });
      },
      recordOf: (rule: LogRecordingRule): ReadingRecord | null => {
        return idOf(rule)
          ? wholeRecord({
              id: idOf(rule),
              name: rule.name || "",
              list: TelemetryFieldReaderList.Logs,
              references: findLogRecordingRuleFieldReferences(rule.definition),
              queries: queriesIf((): Array<TelemetryReadQuery> => {
                return findLogRecordingRuleTelemetryQueries(rule.definition);
              }),
            })
          : null;
      },
    }),
    readRecords<TraceRecordingRule>({
      what: "trace recording rules",
      projectId,
      readAll: (): Promise<Array<TraceRecordingRule>> => {
        return TraceRecordingRuleService.findBy({
          query: { projectId },
          select: { _id: true, name: true, definition: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: { isRoot: true },
        });
      },
      recordOf: (rule: TraceRecordingRule): ReadingRecord | null => {
        return idOf(rule)
          ? wholeRecord({
              id: idOf(rule),
              name: rule.name || "",
              list: TelemetryFieldReaderList.Traces,
              references: findTraceRecordingRuleFieldReferences(
                rule.definition,
              ),
              queries: queriesIf((): Array<TelemetryReadQuery> => {
                return findTraceRecordingRuleTelemetryQueries(rule.definition);
              }),
            })
          : null;
      },
    }),
    readRecords<ServiceLevelObjective>({
      what: "SLOs",
      projectId,
      readAll: (): Promise<Array<ServiceLevelObjective>> => {
        return ServiceLevelObjectiveService.findBy({
          query: {
            projectId,
            sliType: QueryHelper.any([
              SliType.RequestSuccess,
              SliType.RequestLatency,
            ]),
            isArchived: false,
          },
          select: {
            _id: true,
            name: true,
            sliType: true,
            requestFilter: true,
            services: { _id: true },
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: { isRoot: true },
        });
      },
      recordOf: (slo: ServiceLevelObjective): ReadingRecord | null => {
        const read: {
          sliType: ServiceLevelObjective["sliType"];
          requestFilter: unknown;
          serviceIds: Array<string>;
        } = {
          sliType: slo.sliType,
          requestFilter: slo.requestFilter,
          serviceIds: (slo.services || []).map((service: Service): string => {
            return service.id?.toString() || "";
          }),
        };

        return idOf(slo)
          ? wholeRecord({
              id: idOf(slo),
              name: slo.name || "",
              references: findSloFieldReferences(read),
              queries: queriesIf((): Array<TelemetryReadQuery> => {
                return findSloTelemetryQueries(read);
              }),
            })
          : null;
      },
    }),
  ]);

  return [
    {
      kind: TelemetryFieldReaderKind.Monitor,
      groups: [
        {
          name: "monitors",
          records: monitors!,
          readVisible: (query: {
            ids: Array<string>;
            props: DatabaseCommonInteractionProps;
          }): Promise<Array<Monitor>> => {
            return MonitorService.findBy({
              query: idsQuery(query.ids),
              select: { _id: true },
              skip: 0,
              limit: query.ids.length,
              props: query.props,
            });
          },
        },
      ],
    },
    {
      kind: TelemetryFieldReaderKind.Dashboard,
      groups: [
        {
          name: "dashboards",
          records: dashboards!,
          readVisible: (query: {
            ids: Array<string>;
            props: DatabaseCommonInteractionProps;
          }): Promise<Array<Dashboard>> => {
            return DashboardService.findBy({
              query: idsQuery(query.ids),
              select: { _id: true },
              skip: 0,
              limit: query.ids.length,
              props: query.props,
            });
          },
        },
      ],
    },
    {
      kind: TelemetryFieldReaderKind.SavedView,
      groups: [
        {
          name: "log saved views",
          records: logViews!,
          readVisible: (query: {
            ids: Array<string>;
            props: DatabaseCommonInteractionProps;
          }): Promise<Array<LogSavedView>> => {
            return LogSavedViewService.findBy({
              query: idsQuery(query.ids),
              select: { _id: true },
              skip: 0,
              limit: query.ids.length,
              props: query.props,
            });
          },
        },
        {
          name: "trace saved views",
          records: traceViews!,
          readVisible: (query: {
            ids: Array<string>;
            props: DatabaseCommonInteractionProps;
          }): Promise<Array<TraceSavedView>> => {
            return TraceSavedViewService.findBy({
              query: idsQuery(query.ids),
              select: { _id: true },
              skip: 0,
              limit: query.ids.length,
              props: query.props,
            });
          },
        },
        {
          name: "exception saved views",
          records: exceptionViews!,
          readVisible: (query: {
            ids: Array<string>;
            props: DatabaseCommonInteractionProps;
          }): Promise<Array<ExceptionSavedView>> => {
            return ExceptionSavedViewService.findBy({
              query: idsQuery(query.ids),
              select: { _id: true },
              skip: 0,
              limit: query.ids.length,
              props: query.props,
            });
          },
        },
      ],
    },
    {
      kind: TelemetryFieldReaderKind.RecordingRule,
      groups: [
        {
          name: "log recording rules",
          records: logRules!,
          readVisible: (query: {
            ids: Array<string>;
            props: DatabaseCommonInteractionProps;
          }): Promise<Array<LogRecordingRule>> => {
            return LogRecordingRuleService.findBy({
              query: idsQuery(query.ids),
              select: { _id: true },
              skip: 0,
              limit: query.ids.length,
              props: query.props,
            });
          },
        },
        {
          name: "trace recording rules",
          records: traceRules!,
          readVisible: (query: {
            ids: Array<string>;
            props: DatabaseCommonInteractionProps;
          }): Promise<Array<TraceRecordingRule>> => {
            return TraceRecordingRuleService.findBy({
              query: idsQuery(query.ids),
              select: { _id: true },
              skip: 0,
              limit: query.ids.length,
              props: query.props,
            });
          },
        },
      ],
    },
    {
      kind: TelemetryFieldReaderKind.ServiceLevelObjective,
      groups: [
        {
          name: "SLOs",
          records: slos!,
          readVisible: (query: {
            ids: Array<string>;
            props: DatabaseCommonInteractionProps;
          }): Promise<Array<ServiceLevelObjective>> => {
            return ServiceLevelObjectiveService.findBy({
              query: idsQuery(query.ids),
              select: { _id: true },
              skip: 0,
              limit: query.ids.length,
              props: query.props,
            });
          },
        },
      ],
    },
  ];
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name);
}

/*
 * The records of a project that read what is asked about, kind by kind:
 * each a reader when one of the fields it reads `reads` it. Named only
 * where the person asking (`props`) may read them; counted where they may
 * not.
 */
export async function findTelemetryFieldReaders(data: {
  projectId: ObjectID;
  reads: TelemetryFieldReferenceReads;
  props: DatabaseCommonInteractionProps;
}): Promise<TelemetryFieldReadersByKind> {
  return await findReaders({
    projectId: data.projectId,
    question: { of: "field", reads: data.reads },
    props: data.props,
  });
}

/*
 * The same, asked of each query a record keeps records by (#10436): a
 * reader when one of its queries `reads` - a monitor whose step keeps the
 * logs a drop filter would take. Each reader says the fields of those
 * queries.
 */
export async function findTelemetryQueryReaders(data: {
  projectId: ObjectID;
  reads: TelemetryReadQueryReads;
  props: DatabaseCommonInteractionProps;
}): Promise<TelemetryFieldReadersByKind> {
  return await findReaders({
    projectId: data.projectId,
    question: { of: "query", reads: data.reads },
    props: data.props,
  });
}

async function findReaders(data: {
  projectId: ObjectID;
  question: ReaderQuestion;
  props: DatabaseCommonInteractionProps;
}): Promise<TelemetryFieldReadersByKind> {
  const answer: TelemetryFieldReadersByKind =
    getEmptyTelemetryFieldReadersByKind(true);
  const kinds: Array<KindRead> = await readKinds(
    data.projectId,
    data.question.of,
  );

  await Promise.all(
    kinds.map(async (kindRead: KindRead): Promise<void> => {
      const readers: Array<TelemetryFieldReader> = [];
      let hiddenCount: number = 0;
      let isChecked: boolean = true;

      for (const group of kindRead.groups) {
        if (!group.records) {
          isChecked = false;
          continue;
        }

        const found: Array<TelemetryFieldReader> = group.records
          .map((record: ReadingRecord): TelemetryFieldReader | null => {
            return asReader(record, data.question);
          })
          .filter(
            (
              reader: TelemetryFieldReader | null,
            ): reader is TelemetryFieldReader => {
              return reader !== null;
            },
          );
        const visible: Set<string> | null = await findVisibleIds({
          ids: found.map((reader: TelemetryFieldReader): string => {
            return reader.id;
          }),
          read: group.readVisible,
          props: data.props,
          what: group.name,
        });

        if (!visible) {
          isChecked = false;
          continue;
        }

        for (const reader of found) {
          if (visible.has(reader.id)) {
            readers.push(reader);
          } else {
            hiddenCount++;
          }
        }
      }

      /*
       * A kind read from several tables keeps what the ones it could read
       * found, and says it could not check the rest.
       */
      answer[kindRead.kind] = {
        readers: readers.sort(byName),
        hiddenCount,
        isChecked,
      };
    }),
  );

  return answer;
}

// The kinds an answer lists, in the order a page lists them.
export { TELEMETRY_FIELD_READER_KINDS };
