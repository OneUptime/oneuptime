import AnalyticsBaseModel from "./AnalyticsBaseModel/AnalyticsBaseModel";
import Route from "../../Types/API/Route";
import AnalyticsTableEngine from "../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import AnalyticsTableColumn, {
  SkipIndexType,
} from "../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import OperationalResource from "../../Types/Database/AccessControl/OperationalResource";
import OwnedThrough from "../../Types/Database/AccessControl/OwnedThrough";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import Service from "../DatabaseModels/Service";
import ServiceType from "../../Types/Telemetry/ServiceType";
import {
  getClickhouseColdTierStoragePolicy,
  getTelemetryColdTierTtlExpression,
} from "../../Utils/Telemetry/ColdTier";

export enum SpanKind {
  Server = "SPAN_KIND_SERVER",
  Client = "SPAN_KIND_CLIENT",
  Producer = "SPAN_KIND_PRODUCER",
  Consumer = "SPAN_KIND_CONSUMER",
  Internal = "SPAN_KIND_INTERNAL",
}

export enum SpanEventType {
  Exception = "exception",
  Event = "event",
}

export enum SpanStatus {
  Unset = 0,
  Ok = 1,
  Error = 2,
}

export interface SpanEvent {
  name: string;
  time: Date;
  timeUnixNano: number;
  attributes: JSONObject;
}

export interface SpanLink {
  traceId: string;
  spanId: string;
  attributes?: JSONObject;
}

@OperationalResource()
@OwnedThrough("primaryEntityId", Service, { includeProjectScope: true })
export default class Span extends AnalyticsBaseModel {
  public constructor() {
    const projectIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "projectId",
      title: "Project ID",
      description: "ID of project",
      required: true,
      type: TableColumnType.ObjectID,
      isTenantId: true,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceTraces,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceTraces,
        ],
        update: [],
      },
    });

    const primaryEntityIdColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "primaryEntityId",
        title: "Service ID",
        description:
          "ID of the resource the span belongs to (Service / Host / DockerHost / KubernetesCluster / Monitor — disambiguated by primaryEntityType)",
        required: true,
        type: TableColumnType.ObjectID,
        accessControl: {
          read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.Viewer,
            Permission.TelemetryAdmin,
            Permission.TelemetryMember,
            Permission.TelemetryViewer,
            Permission.ReadTelemetryServiceTraces,
          ],
          create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.TelemetryAdmin,
            Permission.TelemetryMember,
            Permission.CreateTelemetryServiceTraces,
          ],
          update: [],
        },
      });

    const primaryEntityTypeColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "primaryEntityType",
        isLowCardinality: true,
        title: "Service Type",
        description:
          "Discriminator for primaryEntityId — tells the read side which resource table to dispatch to",
        required: false,
        type: TableColumnType.Text,
        skipIndex: {
          name: "idx_service_type",
          type: SkipIndexType.Set,
          params: [10],
          granularity: 4,
        },
        accessControl: {
          read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.Viewer,
            Permission.TelemetryAdmin,
            Permission.TelemetryMember,
            Permission.TelemetryViewer,
            Permission.ReadTelemetryServiceTraces,
          ],
          create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.TelemetryAdmin,
            Permission.TelemetryMember,
            Permission.CreateTelemetryServiceTraces,
          ],
          update: [],
        },
      });

    const startTimeColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "startTime",
      codec: [{ codec: "DoubleDelta" }, { codec: "ZSTD", level: 1 }],
      title: "Start Time",
      description: "When did the span start?",
      required: true,
      type: TableColumnType.DateTime64,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceTraces,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceTraces,
        ],
        update: [],
      },
    });

    const endTimeColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "endTime",
      /*
       * Plain ZSTD, deliberately NOT DoubleDelta: rows sort by startTime,
       * so consecutive endTime deltas jump with span duration and the
       * double-delta transform inflates instead of shrinking (measured
       * ~2.9x vs ~4-6x for plain ZSTD on endTimeUnixNano, same data).
       */
      codec: { codec: "ZSTD", level: 1 },
      title: "End Time",
      description: "When did the span end?",
      required: true,
      type: TableColumnType.DateTime64,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceTraces,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceTraces,
        ],
        update: [],
      },
    });

    const startTimeUnixNanoColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "startTimeUnixNano",
        title: "Start Time in Unix Nano",
        description: "When did the span start?",
        required: true,
        type: TableColumnType.UInt64,
        codec: [{ codec: "DoubleDelta" }, { codec: "ZSTD", level: 1 }],
        accessControl: {
          read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.Viewer,
            Permission.TelemetryAdmin,
            Permission.TelemetryMember,
            Permission.TelemetryViewer,
            Permission.ReadTelemetryServiceTraces,
          ],
          create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.TelemetryAdmin,
            Permission.TelemetryMember,
            Permission.CreateTelemetryServiceTraces,
          ],
          update: [],
        },
      });

    const durationUnixNanoColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "durationUnixNano",
        title: "Duration in Unix Nano",
        description: "How long did the span last?",
        required: true,
        /*
         * Kept as LongNumber (Int128): it is aggregated as
         * AggregateFunction(avg, Int128) in proj_agg_by_service, which
         * ClickHouse cannot convert to UInt64 in place.
         */
        type: TableColumnType.LongNumber,
        codec: { codec: "ZSTD", level: 1 },
        accessControl: {
          read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.Viewer,
            Permission.TelemetryAdmin,
            Permission.TelemetryMember,
            Permission.TelemetryViewer,
            Permission.ReadTelemetryServiceTraces,
          ],
          create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.TelemetryAdmin,
            Permission.TelemetryMember,
            Permission.CreateTelemetryServiceTraces,
          ],
          update: [],
        },
      });

    const endTimeUnixNanoColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "endTimeUnixNano",
        title: "End Time",
        description: "When did the span end?",
        required: true,
        type: TableColumnType.UInt64,
        /*
         * Plain ZSTD, deliberately NOT DoubleDelta: rows sort by
         * startTime, so endTime deltas jump with span duration and
         * double-delta inflates (measured compression ratio ~2.9 with
         * DoubleDelta vs ~4-6x plain ZSTD).
         */
        codec: { codec: "ZSTD", level: 1 },
        accessControl: {
          read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.Viewer,
            Permission.TelemetryAdmin,
            Permission.TelemetryMember,
            Permission.TelemetryViewer,
            Permission.ReadTelemetryServiceTraces,
          ],
          create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.TelemetryAdmin,
            Permission.TelemetryMember,
            Permission.CreateTelemetryServiceTraces,
          ],
          update: [],
        },
      });

    const traceIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "traceId",
      title: "Trace ID",
      description: "ID of the trace",
      required: true,
      type: TableColumnType.Text,
      codec: { codec: "ZSTD", level: 1 },
      skipIndex: {
        name: "idx_trace_id",
        type: SkipIndexType.BloomFilter,
        params: [0.01],
        granularity: 1,
      },
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceTraces,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceTraces,
        ],
        update: [],
      },
    });

    const spanIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "spanId",
      title: "Span ID",
      description: "ID of the span",
      required: true,
      type: TableColumnType.Text,
      codec: { codec: "ZSTD", level: 1 },
      skipIndex: {
        name: "idx_span_id",
        type: SkipIndexType.BloomFilter,
        params: [0.01],
        granularity: 1,
      },
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceTraces,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceTraces,
        ],
        update: [],
      },
    });

    const parentSpanIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "parentSpanId",
      title: "Parent Span ID",
      description: "ID of the parent span",
      required: false,
      type: TableColumnType.Text,
      codec: { codec: "ZSTD", level: 1 },
      skipIndex: {
        name: "idx_parent_span_id",
        type: SkipIndexType.BloomFilter,
        params: [0.01],
        granularity: 1,
      },
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceTraces,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceTraces,
        ],
        update: [],
      },
    });

    const traceStateColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "traceState",
      title: "Trace State",
      description: "Trace State",
      required: false,
      type: TableColumnType.Text,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceTraces,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceTraces,
        ],
        update: [],
      },
    });

    const attributesColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "attributes",
      codec: { codec: "ZSTD", level: 3 },
      title: "Attributes",
      description: "Attributes",
      required: true,
      defaultValue: {},
      type: TableColumnType.MapStringString,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceTraces,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceTraces,
        ],
        update: [],
      },
    });

    const attributeKeysColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "attributeKeys",
      codec: { codec: "ZSTD", level: 3 },
      title: "Attribute Keys",
      description: "Attribute keys extracted from attributes",
      required: true,
      defaultValue: [],
      type: TableColumnType.ArrayText,
      skipIndex: {
        name: "idx_attribute_keys",
        type: SkipIndexType.BloomFilter,
        params: [0.01],
        granularity: 1,
      },
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceTraces,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceTraces,
        ],
        update: [],
      },
    });

    const entityKeysColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "entityKeys",
      codec: { codec: "ZSTD", level: 3 },
      title: "Entity Keys",
      description:
        "Stable keys of every OpenTelemetry entity (service, host, k8s.pod, container, ...) this signal belongs to. A superset that includes the primary entity. Enables cross-cutting membership queries via has(entityKeys, :key).",
      required: true,
      defaultValue: [],
      type: TableColumnType.ArrayText,
      skipIndex: {
        name: "idx_entity_keys",
        type: SkipIndexType.BloomFilter,
        params: [0.01],
        granularity: 1,
      },
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceTraces,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceTraces,
        ],
        update: [],
      },
    });

    /*
     * Scalar per-entity-type key columns — denormalized single-value
     * siblings of `entityKeys`. Each holds the 16-hex key (see
     * Common/Utils/Telemetry/EntityKey) of the row's entity of that type,
     * or '' when the resource carries no such entity (non-Nullable String,
     * so old rows read the type default ''). Unlike the array column, a
     * scalar equality predicate is usable as an MV/sort key and gets a
     * cheaper bloom-filter probe; only the high-traffic keys
     * (service/host/k8s.pod) carry skip indexes. Stamped at ingest by the
     * same extractor that fills `entityKeys`; never part of identity.
     */
    const scalarEntityKeyColumns: Array<AnalyticsTableColumn> = [
      {
        key: "serviceEntityKey",
        title: "Service Entity Key",
        indexName: "idx_service_entity_key",
      },
      {
        key: "hostEntityKey",
        title: "Host Entity Key",
        indexName: "idx_host_entity_key",
      },
      {
        key: "k8sPodEntityKey",
        title: "Kubernetes Pod Entity Key",
        indexName: "idx_k8s_pod_entity_key",
      },
      { key: "k8sNodeEntityKey", title: "Kubernetes Node Entity Key" },
      { key: "k8sClusterEntityKey", title: "Kubernetes Cluster Entity Key" },
      { key: "containerEntityKey", title: "Container Entity Key" },
    ].map(
      (def: {
        key: string;
        title: string;
        indexName?: string | undefined;
      }): AnalyticsTableColumn => {
        return new AnalyticsTableColumn({
          key: def.key,
          title: def.title,
          description:
            "Scalar entity key for this entity type (see entityKeys); '' when the resource has no entity of this type.",
          required: true,
          defaultValue: "",
          type: TableColumnType.Text,
          codec: { codec: "ZSTD", level: 1 },
          skipIndex: def.indexName
            ? {
                name: def.indexName,
                type: SkipIndexType.BloomFilter,
                params: [0.01],
                granularity: 1,
              }
            : undefined,
          accessControl: entityKeysColumn.accessControl,
        });
      },
    );

    const eventsColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "events",
      title: "Events",
      description: "Span Events",
      required: true,
      defaultValue: [],
      type: TableColumnType.JSONArray,
      codec: { codec: "ZSTD", level: 3 },
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceTraces,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceTraces,
        ],
        update: [],
      },
    });

    const linksColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "links",
      title: "Links",
      description: "Span Links",
      required: true,
      defaultValue: [],
      type: TableColumnType.JSON,
      codec: { codec: "ZSTD", level: 3 },
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceTraces,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceTraces,
        ],
        update: [],
      },
    });

    const statusCodeColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "statusCode",
      title: "Status Code",
      description: "Status Code",
      required: false,
      type: TableColumnType.Number,
      skipIndex: {
        name: "idx_status_code",
        type: SkipIndexType.Set,
        params: [5],
        granularity: 4,
      },
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceTraces,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceTraces,
        ],
        update: [],
      },
    });

    const statusMessageColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "statusMessage",
      title: "Status Message",
      description: "Status Message",
      required: false,
      type: TableColumnType.Text,
      codec: { codec: "ZSTD", level: 1 },
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceTraces,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceTraces,
        ],
        update: [],
      },
    });

    const nameColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "name",
      codec: { codec: "ZSTD", level: 3 },
      title: "Name",
      description: "Name of the span",
      required: false,
      type: TableColumnType.Text,
      skipIndex: {
        name: "idx_name",
        type: SkipIndexType.TokenBF,
        params: [10240, 3, 0],
        granularity: 4,
      },
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceTraces,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceTraces,
        ],
        update: [],
      },
    });

    const kindColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "kind",
      isLowCardinality: true,
      title: "Kind",
      description: "Kind of the span",
      required: false,
      type: TableColumnType.Text,
      skipIndex: {
        name: "idx_kind",
        type: SkipIndexType.Set,
        params: [5],
        granularity: 4,
      },
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceTraces,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceTraces,
        ],
        update: [],
      },
    });

    const hasExceptionColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "hasException",
      title: "Has Exception",
      description:
        "Whether this span contains an exception event, populated at ingest time for fast error filtering",
      required: true,
      defaultValue: false,
      type: TableColumnType.Boolean,
      skipIndex: {
        name: "idx_has_exception",
        type: SkipIndexType.Set,
        params: [2],
        granularity: 4,
      },
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceTraces,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceTraces,
        ],
        update: [],
      },
    });

    const isRootSpanColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "isRootSpan",
      title: "Is Root Span",
      description:
        "Whether this span is a root span (has no parent), populated at ingest time for fast root-only filtering",
      required: true,
      defaultValue: false,
      type: TableColumnType.Boolean,
      skipIndex: {
        name: "idx_is_root_span",
        type: SkipIndexType.Set,
        params: [2],
        granularity: 4,
      },
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceTraces,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceTraces,
        ],
        update: [],
      },
    });

    const retentionDateColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "retentionDate",
      codec: [{ codec: "DoubleDelta" }, { codec: "ZSTD", level: 1 }],
      title: "Retention Date",
      description:
        "Date after which this row is eligible for TTL deletion, computed at ingest time as startTime + service.retainTelemetryDataForDays",
      required: true,
      type: TableColumnType.Date,
      defaultValue: undefined,
    });

    super({
      tableName: AnalyticsTableName.Span,
      tableEngine: AnalyticsTableEngine.MergeTree,
      singularName: "Span",
      pluralName: "Spans",
      crudApiPath: new Route("/span"),
      enableDocumentation: true,
      tableDescription:
        "OpenTelemetry distributed-tracing spans. Each span is one operation within a trace; query and aggregate them to analyze latency and errors.",
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceTraces,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceTraces,
        ],
        update: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.EditTelemetryServiceTraces,
        ],
        delete: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.DeleteTelemetryServiceTraces,
        ],
      },
      tableColumns: [
        projectIdColumn,
        primaryEntityIdColumn,
        primaryEntityTypeColumn,
        startTimeColumn,
        endTimeColumn,
        startTimeUnixNanoColumn,
        durationUnixNanoColumn,
        endTimeUnixNanoColumn,
        traceIdColumn,
        spanIdColumn,
        parentSpanIdColumn,
        traceStateColumn,
        attributesColumn,
        attributeKeysColumn,
        entityKeysColumn,
        ...scalarEntityKeyColumns,
        eventsColumn,
        linksColumn,
        statusCodeColumn,
        statusMessageColumn,
        nameColumn,
        kindColumn,
        hasExceptionColumn,
        isRootSpanColumn,
        retentionDateColumn,
      ],
      projections: [
        {
          name: "proj_agg_by_service",
          query:
            "SELECT projectId, primaryEntityId, toStartOfMinute(startTime) AS minute, count() AS cnt, avg(durationUnixNano) AS avg_duration, quantile(0.99)(durationUnixNano) AS p99_duration GROUP BY projectId, primaryEntityId, minute",
        },
        {
          name: "proj_trace_by_id",
          query:
            "SELECT projectId, traceId, startTime, primaryEntityId, spanId, parentSpanId, name, durationUnixNano, statusCode, hasException ORDER BY (projectId, traceId, startTime)",
        },
        {
          name: "proj_hist_by_minute",
          query:
            "SELECT projectId, toStartOfMinute(startTime) AS minute, primaryEntityId, statusCode, isRootSpan, count() AS cnt GROUP BY projectId, minute, primaryEntityId, statusCode, isRootSpan",
        },
      ],
      sortKeys: ["projectId", "startTime", "primaryEntityId", "traceId"],
      primaryKeys: ["projectId", "startTime", "primaryEntityId", "traceId"],
      partitionKey: "toYYYYMMDD(startTime)",
      /*
       * Shard by traceId: high-cardinality so a big project spreads evenly, and
       * it keeps every span of a trace on one shard for a fast single-trace view.
       */
      shardingKey: "cityHash64(traceId)",
      storagePolicy: getClickhouseColdTierStoragePolicy(),
      tableSettings:
        "ttl_only_drop_parts = 1, non_replicated_deduplication_window = 10000",
      ttlExpression: getTelemetryColdTierTtlExpression({
        signal: "traces",
        moveAfterExpression: "startTime",
      }),
      defaultSortColumn: "startTime",
    });
  }

  public get startTimeUnixNano(): number | undefined {
    return this.getColumnValue("startTimeUnixNano") as number | undefined;
  }

  public set startTimeUnixNano(v: number | undefined) {
    this.setColumnValue("startTimeUnixNano", v);
  }

  public get durationUnixNano(): number | undefined {
    return this.getColumnValue("durationUnixNano") as number | undefined;
  }

  public set durationUnixNano(v: number | undefined) {
    this.setColumnValue("durationUnixNano", v);
  }

  public get endTimeUnixNano(): number | undefined {
    return this.getColumnValue("endTimeUnixNano") as number | undefined;
  }

  public set endTimeUnixNano(v: number | undefined) {
    this.setColumnValue("endTimeUnixNano", v);
  }

  public get name(): string | undefined {
    return this.getColumnValue("name") as string | undefined;
  }

  public set name(v: string | undefined) {
    this.setColumnValue("name", v);
  }

  public get kind(): SpanKind | undefined {
    return this.getColumnValue("kind") as SpanKind | undefined;
  }

  public set kind(v: SpanKind | undefined) {
    this.setColumnValue("kind", v);
  }

  public get projectId(): ObjectID | undefined {
    return this.getColumnValue("projectId") as ObjectID | undefined;
  }

  public set projectId(v: ObjectID | undefined) {
    this.setColumnValue("projectId", v);
  }

  public get primaryEntityId(): ObjectID | undefined {
    return this.getColumnValue("primaryEntityId") as ObjectID | undefined;
  }

  public set primaryEntityId(v: ObjectID | undefined) {
    this.setColumnValue("primaryEntityId", v);
  }

  public get primaryEntityType(): ServiceType | undefined {
    return this.getColumnValue("primaryEntityType") as ServiceType | undefined;
  }

  public set primaryEntityType(v: ServiceType | undefined) {
    this.setColumnValue("primaryEntityType", v);
  }

  public get startTime(): Date | undefined {
    return this.getColumnValue("startTime") as Date | undefined;
  }

  public set startTime(v: Date | undefined) {
    this.setColumnValue("startTime", v);
  }

  public get endTime(): Date | undefined {
    return this.getColumnValue("endTime") as Date | undefined;
  }

  public set endTime(v: Date | undefined) {
    this.setColumnValue("endTime", v);
  }

  public get traceId(): string | undefined {
    return this.getColumnValue("traceId") as string | undefined;
  }

  public set traceId(v: string | undefined) {
    this.setColumnValue("traceId", v);
  }

  public get spanId(): string | undefined {
    return this.getColumnValue("spanId") as string | undefined;
  }

  public set spanId(v: string | undefined) {
    this.setColumnValue("spanId", v);
  }

  public get parentSpanId(): string | undefined {
    return this.getColumnValue("parentSpanId") as string | undefined;
  }

  public set parentSpanId(v: string | undefined) {
    this.setColumnValue("parentSpanId", v);
  }

  public get traceState(): string | undefined {
    return this.getColumnValue("traceState") as string | undefined;
  }

  public set traceState(v: string | undefined) {
    this.setColumnValue("traceState", v);
  }

  public get attributes(): JSONObject | undefined {
    return this.getColumnValue("attributes") as JSONObject | undefined;
  }

  public set attributes(v: JSONObject | undefined) {
    this.setColumnValue("attributes", v);
  }

  public get attributeKeys(): Array<string> | undefined {
    return this.getColumnValue("attributeKeys") as Array<string> | undefined;
  }

  public set attributeKeys(v: Array<string> | undefined) {
    this.setColumnValue("attributeKeys", v);
  }

  public get entityKeys(): Array<string> | undefined {
    return this.getColumnValue("entityKeys") as Array<string> | undefined;
  }

  public set entityKeys(v: Array<string> | undefined) {
    this.setColumnValue("entityKeys", v);
  }

  public get events(): Array<SpanEvent> | undefined {
    return this.getColumnValue("events") as Array<SpanEvent> | undefined;
  }

  public set events(v: Array<SpanEvent> | undefined) {
    this.setColumnValue("events", v as Array<JSONObject> | undefined);
  }

  public get links(): Array<SpanLink> | undefined {
    return this.getColumnValue("links") as Array<SpanLink> | undefined;
  }

  public set links(v: Array<SpanLink> | undefined) {
    this.setColumnValue("links", v as Array<JSONObject> | undefined);
  }

  public get statusCode(): SpanStatus | undefined {
    return this.getColumnValue("statusCode") as SpanStatus | undefined;
  }

  public set statusCode(v: SpanStatus | undefined) {
    this.setColumnValue("statusCode", v);
  }

  public get statusMessage(): string | undefined {
    return this.getColumnValue("statusMessage") as string | undefined;
  }

  public set statusMessage(v: string | undefined) {
    this.setColumnValue("statusMessage", v);
  }

  public get hasException(): boolean | undefined {
    return this.getColumnValue("hasException") as boolean | undefined;
  }

  public set hasException(v: boolean | undefined) {
    this.setColumnValue("hasException", v);
  }

  public get isRootSpan(): boolean | undefined {
    return this.getColumnValue("isRootSpan") as boolean | undefined;
  }

  public set isRootSpan(v: boolean | undefined) {
    this.setColumnValue("isRootSpan", v);
  }

  public get retentionDate(): Date | undefined {
    return this.getColumnValue("retentionDate") as Date | undefined;
  }

  public set retentionDate(v: Date | undefined) {
    this.setColumnValue("retentionDate", v);
  }
}
