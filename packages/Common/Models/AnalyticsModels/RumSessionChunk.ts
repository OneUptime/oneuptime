import AnalyticsBaseModel from "./AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsTableEngine from "../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import AnalyticsTableColumn, {
  SkipIndexType,
} from "../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import OperationalResource from "../../Types/Database/AccessControl/OperationalResource";
import OwnedThrough from "../../Types/Database/AccessControl/OwnedThrough";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import ServiceType from "../../Types/Telemetry/ServiceType";
import RumApplication from "../DatabaseModels/RumApplication";

/*
 * The recorded payload for session replay — one row per ~15s frame.
 *
 * This is the fattest table in the system and the most sensitive: a row's
 * `payload` column is a serialised recording of what a real person had on
 * screen. Several deliberate departures from the house pattern follow, all
 * because of that.
 *
 * The only read that exists is
 *   WHERE projectId = ? AND sessionId = ? AND tabId = ? AND chunkIndex IN (...)
 * so the sort key carries no timestamp at all. A time-first key would
 * scatter one session's dozen rows across a whole day of marks.
 */

/*
 * Chunk *metadata* is readable by anyone who may list sessions — it is
 * what draws the timeline. The payload itself is not; see below.
 */
const CHUNK_METADATA_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.TelemetryAdmin,
  Permission.ReadRumSessionReplay,
];

const CHUNK_CREATE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.TelemetryAdmin,
  Permission.CreateRumSessionReplay,
];

const chunkAccessControl: {
  read: Array<Permission>;
  create: Array<Permission>;
  update: Array<Permission>;
} = {
  read: CHUNK_METADATA_PERMISSIONS,
  create: CHUNK_CREATE_PERMISSIONS,
  update: [],
};

/*
 * Watching a recording is its own privilege, deliberately narrower than
 * listing sessions and narrower still than reading the RUM application.
 *
 * Note this column ACL is defence in depth, NOT the primary control: with
 * crudApiPath omitted, the only reader is a bespoke endpoint that never
 * invokes ModelPermission. The handler-level guard is the real gate.
 */
const payloadAccessControl: {
  read: Array<Permission>;
  create: Array<Permission>;
  update: Array<Permission>;
} = {
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.TelemetryAdmin,
    Permission.ReadRumSessionReplayPayload,
  ],
  create: CHUNK_CREATE_PERMISSIONS,
  update: [],
};

@OperationalResource()
@OwnedThrough("primaryEntityId", RumApplication, { includeProjectScope: true })
export default class RumSessionChunk extends AnalyticsBaseModel {
  public constructor() {
    const projectIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "projectId",
      title: "Project ID",
      description: "ID of project",
      required: true,
      type: TableColumnType.ObjectID,
      isTenantId: true,
      accessControl: chunkAccessControl,
    });

    /*
     * Sort-key element 2, so an equality predicate on it is served by the
     * primary index. No skip index — one would only inflate the part.
     */
    const sessionIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "sessionId",
      title: "Session ID",
      description: "Session this chunk belongs to",
      required: true,
      type: TableColumnType.Text,
      codec: { codec: "ZSTD", level: 1 },
      accessControl: chunkAccessControl,
    });

    /*
     * In the sort key from the first commit, and not addable later.
     *
     * sessionStorage is COPIED when a tab is duplicated, so two live tabs
     * can share one sessionId and both mint chunkIndex from 0. Without
     * tabId the sort key cannot represent both streams and read-time
     * dedup silently discards one tab's entire recording.
     */
    const tabIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "tabId",
      title: "Tab ID",
      description:
        "Per-tab discriminator, so concurrent duplicated tabs do not collide on chunkIndex",
      required: true,
      type: TableColumnType.Text,
      codec: { codec: "ZSTD", level: 1 },
      accessControl: chunkAccessControl,
    });

    const chunkIndexColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "chunkIndex",
      title: "Chunk Index",
      description: "Monotonic frame index within the (session, tab)",
      required: true,
      type: TableColumnType.Number,
      codec: [{ codec: "T64" }, { codec: "ZSTD", level: 1 }],
      accessControl: chunkAccessControl,
    });

    /* ReplacingMergeTree version. Unix milliseconds — see RumSession. */
    const versionColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "version",
      title: "Version",
      description:
        "Write version in unix milliseconds. A redelivered chunk collapses at merge rather than double-inserting.",
      required: true,
      type: TableColumnType.UInt64,
      codec: [{ codec: "T64" }, { codec: "ZSTD", level: 1 }],
      accessControl: chunkAccessControl,
    });

    const rumApplicationIdColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "rumApplicationId",
        title: "RUM Application ID",
        description: "RUM application this chunk belongs to",
        required: true,
        type: TableColumnType.ObjectID,
        skipIndex: {
          name: "idx_chunk_rum_application_id",
          type: SkipIndexType.Set,
          params: [512],
          granularity: 4,
        },
        accessControl: chunkAccessControl,
      });

    const primaryEntityIdColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "primaryEntityId",
        title: "Primary Entity ID",
        description: "Owning resource — always the RUM application id",
        required: true,
        type: TableColumnType.ObjectID,
        skipIndex: {
          name: "idx_chunk_primary_entity_id",
          type: SkipIndexType.Set,
          params: [512],
          granularity: 4,
        },
        accessControl: chunkAccessControl,
      });

    const primaryEntityTypeColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "primaryEntityType",
        title: "Primary Entity Type",
        description: "Always RealUserMonitor",
        required: true,
        isLowCardinality: true,
        type: TableColumnType.Text,
        skipIndex: {
          name: "idx_chunk_primary_entity_type",
          type: SkipIndexType.Set,
          params: [16],
          granularity: 4,
        },
        accessControl: chunkAccessControl,
      });

    /* Identical on every chunk of a session — server-clamped, never client. */
    const sessionStartTimeColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "sessionStartTime",
        title: "Session Start Time",
        description:
          "Server-clamped session start, identical across every chunk of a session",
        required: true,
        type: TableColumnType.DateTime64,
        codec: [{ codec: "DoubleDelta" }, { codec: "ZSTD", level: 1 }],
        accessControl: chunkAccessControl,
      });

    const offsetColumns: Array<AnalyticsTableColumn> = [
      {
        key: "chunkStartOffsetMs",
        title: "Chunk Start Offset (ms)",
        description: "Offset of this chunk's first event from session start",
      },
      {
        key: "chunkEndOffsetMs",
        title: "Chunk End Offset (ms)",
        description: "Offset of this chunk's last event from session start",
      },
    ].map(
      (def: {
        key: string;
        title: string;
        description: string;
      }): AnalyticsTableColumn => {
        return new AnalyticsTableColumn({
          key: def.key,
          title: def.title,
          description: def.description,
          required: true,
          type: TableColumnType.Number,
          codec: [{ codec: "T64" }, { codec: "ZSTD", level: 1 }],
          accessControl: chunkAccessControl,
        });
      },
    );

    const timeColumns: Array<AnalyticsTableColumn> = [
      {
        key: "chunkStartTime",
        title: "Chunk Start Time",
        description: "Absolute time of this chunk's first event",
      },
      {
        key: "chunkEndTime",
        title: "Chunk End Time",
        description: "Absolute time of this chunk's last event",
      },
    ].map(
      (def: {
        key: string;
        title: string;
        description: string;
      }): AnalyticsTableColumn => {
        return new AnalyticsTableColumn({
          key: def.key,
          title: def.title,
          description: def.description,
          required: true,
          type: TableColumnType.DateTime64,
          codec: { codec: "ZSTD", level: 1 },
          accessControl: chunkAccessControl,
        });
      },
    );

    const eventCountColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "eventCount",
      title: "Event Count",
      description: "Recorded events in this chunk",
      required: true,
      type: TableColumnType.Number,
      codec: [{ codec: "T64" }, { codec: "ZSTD", level: 1 }],
      accessControl: chunkAccessControl,
    });

    /*
     * Marks this chunk as a valid seek anchor. Set from rrweb's own
     * isCheckout flag rather than inferred, and — when a large snapshot is
     * split across parts — only on the final part, so a seek anchor never
     * points into the middle of a snapshot.
     */
    const hasFullSnapshotColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "hasFullSnapshot",
        title: "Has Full Snapshot",
        description:
          "Chunk opens on a complete DOM snapshot and is therefore a valid seek anchor",
        required: true,
        type: TableColumnType.Boolean,
        skipIndex: {
          name: "idx_has_full_snapshot",
          type: SkipIndexType.Set,
          params: [2],
          granularity: 4,
        },
        accessControl: chunkAccessControl,
      });

    const isFinalColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "isFinal",
      title: "Is Final",
      description: "Recorder marked this as the last chunk of the session",
      required: true,
      type: TableColumnType.Boolean,
      accessControl: chunkAccessControl,
    });

    const isPinnedCopyColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "isPinnedCopy",
      title: "Is Pinned Copy",
      description:
        "Written by the pin materializer: a re-insert of this chunk with a far-future retentionDate, landing in its own retention partition so a pinned recording survives while the original partition is TTL-dropped. Same sessionId, so erasure still catches it.",
      required: true,
      type: TableColumnType.Boolean,
      accessControl: chunkAccessControl,
    });

    const snapshotPartColumns: Array<AnalyticsTableColumn> = [
      {
        key: "snapshotPartIndex",
        title: "Snapshot Part Index",
        description: "Part index when a full snapshot is split across chunks",
      },
      {
        key: "snapshotPartTotal",
        title: "Snapshot Part Total",
        description: "Total parts a split full snapshot was divided into",
      },
    ].map(
      (def: {
        key: string;
        title: string;
        description: string;
      }): AnalyticsTableColumn => {
        return new AnalyticsTableColumn({
          key: def.key,
          title: def.title,
          description: def.description,
          required: true,
          defaultValue: 0,
          type: TableColumnType.UInt8,
          codec: [{ codec: "T64" }, { codec: "ZSTD", level: 1 }],
          accessControl: chunkAccessControl,
        });
      },
    );

    const descriptorColumns: Array<AnalyticsTableColumn> = [
      {
        key: "recorderKind",
        title: "Recorder Kind",
        description: "dom for web, rn-view-tree for mobile",
      },
      {
        key: "payloadEncoding",
        title: "Payload Encoding",
        description:
          "How the stored payload is encoded. Stored decompressed, so this records what arrived on the wire.",
      },
    ].map(
      (def: {
        key: string;
        title: string;
        description: string;
      }): AnalyticsTableColumn => {
        return new AnalyticsTableColumn({
          key: def.key,
          title: def.title,
          description: def.description,
          required: true,
          defaultValue: "",
          isLowCardinality: true,
          type: TableColumnType.Text,
          codec: { codec: "ZSTD", level: 1 },
          accessControl: chunkAccessControl,
        });
      },
    );

    const schemaVersionColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "schemaVersion",
      title: "Schema Version",
      description:
        "Payload schema version, so a player can refuse gracefully instead of rendering a wrong DOM",
      required: true,
      type: TableColumnType.UInt8,
      codec: [{ codec: "T64" }, { codec: "ZSTD", level: 1 }],
      accessControl: chunkAccessControl,
    });

    /*
     * The recording itself.
     *
     * Stored DECOMPRESSED as JSON text under ZSTD(3), not as base64 of the
     * gzip the recorder sent: base64 inflates 33% and hands ZSTD
     * incompressible input, so the naive approach is both bigger on disk
     * and more CPU. There is no binary column type in this layer, so Text
     * is the only option.
     *
     * No skip index of any kind: chunks are fetched by key, and an index
     * over multi-hundred-KB values would only inflate the part.
     */
    const payloadColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "payload",
      title: "Payload",
      description:
        "Serialised recorded event array for this chunk. Reading this is watching a real end user's screen and is gated on its own permission.",
      required: true,
      type: TableColumnType.Text,
      codec: { codec: "ZSTD", level: 3 },
      accessControl: payloadAccessControl,
    });

    const payloadBytesColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "payloadBytes",
      title: "Payload Bytes",
      description:
        "Compressed wire size of this chunk, summed by the finalizer into the header's metering signal",
      required: true,
      type: TableColumnType.UInt64,
      codec: [{ codec: "T64" }, { codec: "ZSTD", level: 1 }],
      accessControl: chunkAccessControl,
    });

    /*
     * Per-chunk counters carried on the envelope, so the ingest worker can
     * populate them WITHOUT decompressing the payload. The finalizer sums
     * them into the header.
     */
    const counterColumns: Array<AnalyticsTableColumn> = [
      "errorCount",
      "rageClickCount",
      "deadClickCount",
      "errorClickCount",
      "refreshRageCount",
      "routeCount",
      /*
       * Engagement counters, added after the table shipped. Optional on
       * the wire (SessionReplaySignalCounts) and read as 0 when absent, so
       * they carry an explicit 0 default here: a row from an older
       * recorder and a row that predates the column both mean "no clicks
       * counted", and the manifest reports them only when measured.
       */
      "clickCount",
      "customEventCount",
    ].map((key: string): AnalyticsTableColumn => {
      const isEngagementCounter: boolean =
        key === "clickCount" || key === "customEventCount";

      return new AnalyticsTableColumn({
        key: key,
        title: key,
        description: `Per-chunk ${key}, summed into the session header by the finalizer`,
        required: true,
        ...(isEngagementCounter && { defaultValue: 0 }),
        type: TableColumnType.Number,
        codec: [{ codec: "T64" }, { codec: "ZSTD", level: 1 }],
        accessControl: chunkAccessControl,
      });
    });

    /*
     * WHERE the page was while this chunk was open.
     *
     * The chunk table used to carry routeCount but not the routes, so the
     * session header's entryUrl / exitUrl / routes[] could only ever be
     * whatever chunk 0 happened to know - which for a single-page app is the
     * landing page, forever. pageCount said "7 pages" on the same row where
     * routes[] held one element, and the "Exit page URL (exact)" filter
     * could not match a page the user demonstrably reached.
     *
     * Both are already scrubbed on the client AND re-scrubbed at ingest:
     * these render under the wider session-metadata ACL, so an unscrubbed
     * `/reset-password?token=...` here reaches more readers than the payload
     * itself does.
     */
    const urlColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "url",
      title: "URL",
      description:
        "Scrubbed URL the page was on when this chunk was flushed. The session's exit URL is the latest of these.",
      /*
       * Required with an empty default rather than nullable. Chunks written
       * before this column existed read back as "", which is what the
       * finalizer's argMinIf/argMaxIf skip over so a pre-migration session
       * falls back to its provisional header instead of losing its URLs.
       */
      required: true,
      defaultValue: "",
      type: TableColumnType.Text,
      codec: [{ codec: "ZSTD", level: 1 }],
      accessControl: chunkAccessControl,
    });

    const routesColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "routes",
      title: "Routes",
      description:
        "Distinct scrubbed URLs visited while this chunk was open, in order. The session's routes[] is the union of these.",
      /*
       * Required, like RumSession.routes. ClickHouse refuses
       * Nullable(Array(String)) outright, so an array column can never be
       * optional - it is empty or it is absent.
       */
      required: true,
      defaultValue: [],
      type: TableColumnType.ArrayText,
      codec: [{ codec: "ZSTD", level: 1 }],
      accessControl: chunkAccessControl,
    });

    const retentionDateColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "retentionDate",
      title: "Retention Date",
      description:
        "TTL date, derived from the clamped session start so every chunk of a session expires on the same day and the partition can be dropped whole",
      required: true,
      type: TableColumnType.Date,
      codec: [{ codec: "DoubleDelta" }, { codec: "ZSTD", level: 1 }],
      accessControl: chunkAccessControl,
    });

    super({
      tableName: AnalyticsTableName.RumSessionChunk,
      tableEngine: AnalyticsTableEngine.ReplacingMergeTree,
      singularName: "Session Replay Chunk",
      pluralName: "Session Replay Chunks",
      /*
       * crudApiPath is deliberately omitted so the payload column is
       * unreachable through generic CRUD, and enableMCP is deliberately
       * unset so no auto-generated LLM tool can read recordings.
       */
      accessControl: {
        read: CHUNK_METADATA_PERMISSIONS,
        create: CHUNK_CREATE_PERMISSIONS,
        update: [],
        delete: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.TelemetryAdmin,
          Permission.DeleteRumSessionReplay,
        ],
      },
      tableBillingAccessControl: {
        create: PlanType.Growth,
        read: PlanType.Growth,
        update: PlanType.Growth,
        delete: PlanType.Growth,
      },
      tableColumns: [
        projectIdColumn,
        sessionIdColumn,
        tabIdColumn,
        chunkIndexColumn,
        versionColumn,
        rumApplicationIdColumn,
        primaryEntityIdColumn,
        primaryEntityTypeColumn,
        sessionStartTimeColumn,
        ...offsetColumns,
        ...timeColumns,
        eventCountColumn,
        hasFullSnapshotColumn,
        isFinalColumn,
        isPinnedCopyColumn,
        ...snapshotPartColumns,
        ...descriptorColumns,
        schemaVersionColumn,
        payloadColumn,
        payloadBytesColumn,
        ...counterColumns,
        urlColumn,
        routesColumn,
        retentionDateColumn,
      ],
      sortKeys: ["projectId", "sessionId", "tabId", "chunkIndex"],
      primaryKeys: ["projectId", "sessionId", "tabId", "chunkIndex"],
      /*
       * Partitioned by EXPIRY, not by event time.
       *
       * ttl_only_drop_parts means a part is removed only once every row in
       * it has expired. Partitioned by session date, a single day holding
       * both a 7-day and a 90-day application survives 90 days — a ~4x
       * disk multiplier on the fattest table in the system. Partitioned by
       * expiry, each partition is "everything that dies on day X" and TTL
       * drops it whole with zero mutations.
       *
       * Losing time-based pruning costs nothing here: the only read is by
       * (session, chunk index), served by the sort key, and metering reads
       * the header table instead. Retention is clamped to a closed set so
       * this yields a handful of partitions per ingest day rather than one
       * per distinct configured value.
       */
      partitionKey: "toYYYYMMDD(retentionDate)",
      shardingKey: "cityHash64(projectId, sessionId)",
      /*
       * index_granularity = 128 rather than the default 8192.
       *
       * At the default, one granule of the payload column is ~10MB, so
       * extracting a single 500KB session decompresses ~10MB — 20x read
       * amplification on the hottest read in the feature. At 128 rows a
       * granule is well under a megabyte, for a few MB of extra primary
       * index per month.
       */
      tableSettings:
        "index_granularity = 128, ttl_only_drop_parts = 1, non_replicated_deduplication_window = 10000",
      ttlExpression: "retentionDate DELETE",
      defaultSortColumn: "chunkIndex",
    });
  }

  public get projectId(): ObjectID | undefined {
    return this.getColumnValue("projectId") as ObjectID | undefined;
  }

  public set projectId(v: ObjectID | undefined) {
    this.setColumnValue("projectId", v);
  }

  public get sessionId(): string | undefined {
    return this.getColumnValue("sessionId") as string | undefined;
  }

  public set sessionId(v: string | undefined) {
    this.setColumnValue("sessionId", v);
  }

  public get tabId(): string | undefined {
    return this.getColumnValue("tabId") as string | undefined;
  }

  public set tabId(v: string | undefined) {
    this.setColumnValue("tabId", v);
  }

  public get chunkIndex(): number | undefined {
    return this.getColumnValue("chunkIndex") as number | undefined;
  }

  public set chunkIndex(v: number | undefined) {
    this.setColumnValue("chunkIndex", v);
  }

  public get version(): number | undefined {
    return this.getColumnValue("version") as number | undefined;
  }

  public set version(v: number | undefined) {
    this.setColumnValue("version", v);
  }

  public get rumApplicationId(): ObjectID | undefined {
    return this.getColumnValue("rumApplicationId") as ObjectID | undefined;
  }

  public set rumApplicationId(v: ObjectID | undefined) {
    this.setColumnValue("rumApplicationId", v);
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

  public get sessionStartTime(): Date | undefined {
    return this.getColumnValue("sessionStartTime") as Date | undefined;
  }

  public set sessionStartTime(v: Date | undefined) {
    this.setColumnValue("sessionStartTime", v);
  }

  public get chunkStartOffsetMs(): number | undefined {
    return this.getColumnValue("chunkStartOffsetMs") as number | undefined;
  }

  public set chunkStartOffsetMs(v: number | undefined) {
    this.setColumnValue("chunkStartOffsetMs", v);
  }

  public get chunkEndOffsetMs(): number | undefined {
    return this.getColumnValue("chunkEndOffsetMs") as number | undefined;
  }

  public set chunkEndOffsetMs(v: number | undefined) {
    this.setColumnValue("chunkEndOffsetMs", v);
  }

  public get chunkStartTime(): Date | undefined {
    return this.getColumnValue("chunkStartTime") as Date | undefined;
  }

  public set chunkStartTime(v: Date | undefined) {
    this.setColumnValue("chunkStartTime", v);
  }

  public get chunkEndTime(): Date | undefined {
    return this.getColumnValue("chunkEndTime") as Date | undefined;
  }

  public set chunkEndTime(v: Date | undefined) {
    this.setColumnValue("chunkEndTime", v);
  }

  public get eventCount(): number | undefined {
    return this.getColumnValue("eventCount") as number | undefined;
  }

  public set eventCount(v: number | undefined) {
    this.setColumnValue("eventCount", v);
  }

  public get hasFullSnapshot(): boolean | undefined {
    return this.getColumnValue("hasFullSnapshot") as boolean | undefined;
  }

  public set hasFullSnapshot(v: boolean | undefined) {
    this.setColumnValue("hasFullSnapshot", v);
  }

  public get isFinal(): boolean | undefined {
    return this.getColumnValue("isFinal") as boolean | undefined;
  }

  public set isFinal(v: boolean | undefined) {
    this.setColumnValue("isFinal", v);
  }

  public get isPinnedCopy(): boolean | undefined {
    return this.getColumnValue("isPinnedCopy") as boolean | undefined;
  }

  public set isPinnedCopy(v: boolean | undefined) {
    this.setColumnValue("isPinnedCopy", v);
  }

  public get snapshotPartIndex(): number | undefined {
    return this.getColumnValue("snapshotPartIndex") as number | undefined;
  }

  public set snapshotPartIndex(v: number | undefined) {
    this.setColumnValue("snapshotPartIndex", v);
  }

  public get snapshotPartTotal(): number | undefined {
    return this.getColumnValue("snapshotPartTotal") as number | undefined;
  }

  public set snapshotPartTotal(v: number | undefined) {
    this.setColumnValue("snapshotPartTotal", v);
  }

  public get recorderKind(): string | undefined {
    return this.getColumnValue("recorderKind") as string | undefined;
  }

  public set recorderKind(v: string | undefined) {
    this.setColumnValue("recorderKind", v);
  }

  public get payloadEncoding(): string | undefined {
    return this.getColumnValue("payloadEncoding") as string | undefined;
  }

  public set payloadEncoding(v: string | undefined) {
    this.setColumnValue("payloadEncoding", v);
  }

  public get schemaVersion(): number | undefined {
    return this.getColumnValue("schemaVersion") as number | undefined;
  }

  public set schemaVersion(v: number | undefined) {
    this.setColumnValue("schemaVersion", v);
  }

  public get payload(): string | undefined {
    return this.getColumnValue("payload") as string | undefined;
  }

  public set payload(v: string | undefined) {
    this.setColumnValue("payload", v);
  }

  public get payloadBytes(): number | undefined {
    return this.getColumnValue("payloadBytes") as number | undefined;
  }

  public set payloadBytes(v: number | undefined) {
    this.setColumnValue("payloadBytes", v);
  }

  public get errorCount(): number | undefined {
    return this.getColumnValue("errorCount") as number | undefined;
  }

  public set errorCount(v: number | undefined) {
    this.setColumnValue("errorCount", v);
  }

  public get rageClickCount(): number | undefined {
    return this.getColumnValue("rageClickCount") as number | undefined;
  }

  public set rageClickCount(v: number | undefined) {
    this.setColumnValue("rageClickCount", v);
  }

  public get deadClickCount(): number | undefined {
    return this.getColumnValue("deadClickCount") as number | undefined;
  }

  public set deadClickCount(v: number | undefined) {
    this.setColumnValue("deadClickCount", v);
  }

  public get errorClickCount(): number | undefined {
    return this.getColumnValue("errorClickCount") as number | undefined;
  }

  public set errorClickCount(v: number | undefined) {
    this.setColumnValue("errorClickCount", v);
  }

  public get refreshRageCount(): number | undefined {
    return this.getColumnValue("refreshRageCount") as number | undefined;
  }

  public set refreshRageCount(v: number | undefined) {
    this.setColumnValue("refreshRageCount", v);
  }

  public get routeCount(): number | undefined {
    return this.getColumnValue("routeCount") as number | undefined;
  }

  public set routeCount(v: number | undefined) {
    this.setColumnValue("routeCount", v);
  }

  public get retentionDate(): Date | undefined {
    return this.getColumnValue("retentionDate") as Date | undefined;
  }

  public set retentionDate(v: Date | undefined) {
    this.setColumnValue("retentionDate", v);
  }
}
