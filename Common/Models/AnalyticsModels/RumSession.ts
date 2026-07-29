import AnalyticsBaseModel from "./AnalyticsBaseModel/AnalyticsBaseModel";
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
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import ServiceType from "../../Types/Telemetry/ServiceType";
import RumApplication from "../DatabaseModels/RumApplication";

/*
 * Per-session header for session replay — one row per (session, version).
 *
 * This table is narrow on purpose. Every list, filter, correlation lookup
 * and metering aggregation reads ONLY this table; the recorded payload
 * lives in RumSessionChunk. That split is what makes the session list and
 * the monthly usage rollup cheap despite the payload table being the
 * fattest in the system.
 *
 * Engine is ReplacingMergeTree, which ClusterConfig resolves to
 * ReplicatedReplacingMergeTree(version) with the version column name
 * hardcoded — so a column literally named `version` is mandatory.
 *
 * IMPORTANT — aggregates are DERIVED, never accumulated. ReplacingMergeTree
 * is pure last-write-wins with no accumulation, so a read-modify-write
 * increment per arriving chunk is a lost-update bug at ingest concurrency.
 * Every count here is written once by the finalizer job from a single
 * GROUP BY over the chunk table's own key range.
 */

/*
 * Listing a session is a different privilege from watching one. Neither
 * reuses ReadRumApplication, whose ACL includes the project-wide read-only
 * Viewer role.
 */
const SESSION_READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.TelemetryAdmin,
  Permission.ReadRumSessionReplay,
];

const SESSION_CREATE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.TelemetryAdmin,
  Permission.CreateRumSessionReplay,
];

const sessionAccessControl: {
  read: Array<Permission>;
  create: Array<Permission>;
  update: Array<Permission>;
} = {
  read: SESSION_READ_PERMISSIONS,
  create: SESSION_CREATE_PERMISSIONS,
  update: [],
};

/*
 * The raw, un-hashed end-user identifier gets its own narrower read ACL:
 * knowing that *a* user had a bad session is triage, knowing *which named
 * person* it was is a further disclosure.
 */
const identityAccessControl: {
  read: Array<Permission>;
  create: Array<Permission>;
  update: Array<Permission>;
} = {
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ReadRumSessionReplayPayload,
  ],
  create: SESSION_CREATE_PERMISSIONS,
  update: [],
};

/* Homogeneous counters, all summed by the finalizer. */
const COUNTER_COLUMNS: Array<{ key: string; title: string; description: string }> =
  [
    {
      key: "errorCount",
      title: "Error Count",
      description: "Uncaught errors and unhandled rejections in this session",
    },
    {
      key: "rageClickCount",
      title: "Rage Click Count",
      description: "Bursts of >=3 clicks within 1s in a 30px radius",
    },
    {
      key: "deadClickCount",
      title: "Dead Click Count",
      description:
        "Clicks on a non-interactive element that produced no DOM change, navigation or request",
    },
    {
      key: "errorClickCount",
      title: "Error Click Count",
      description: "Clicks followed within 1s by an uncaught error",
    },
    {
      key: "refreshRageCount",
      title: "Refresh Rage Count",
      description: "Bursts of >=3 reloads of the same path within 60s",
    },
    {
      key: "pageCount",
      title: "Page Count",
      description: "Distinct route changes observed in this session",
    },
  ];

/* Low-cardinality device / policy descriptors, all Set-indexed. */
const LOW_CARDINALITY_COLUMNS: Array<{
  key: string;
  title: string;
  description: string;
  setParams?: number;
}> = [
  {
    key: "browserName",
    title: "Browser Name",
    description: "Browser family, derived server-side from the user agent",
    setParams: 64,
  },
  {
    key: "browserVersion",
    title: "Browser Version",
    description: "Major browser version",
  },
  {
    key: "osName",
    title: "OS Name",
    description: "Operating system family",
    setParams: 64,
  },
  {
    key: "deviceType",
    title: "Device Type",
    description: "desktop | mobile | tablet | ios | android",
    setParams: 8,
  },
  {
    key: "maskingMode",
    title: "Masking Mode",
    description:
      "Masking policy actually in force when this session was captured, not the current setting",
  },
  {
    key: "consentState",
    title: "Consent State",
    description: "Consent state asserted by the recorder at capture time",
  },
  {
    key: "recorderKind",
    title: "Recorder Kind",
    description: "dom for web, rn-view-tree for mobile",
  },
  {
    key: "recorderVersion",
    title: "Recorder Version",
    description: "Version of the OneUptime recorder that produced this session",
  },
  {
    key: "rrwebVersion",
    title: "rrweb Version",
    description: "Version of the underlying recording library",
  },
];

@OperationalResource()
@OwnedThrough("primaryEntityId", RumApplication, { includeProjectScope: true })
export default class RumSession extends AnalyticsBaseModel {
  public constructor() {
    const projectIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "projectId",
      title: "Project ID",
      description: "ID of project",
      required: true,
      type: TableColumnType.ObjectID,
      isTenantId: true,
      accessControl: sessionAccessControl,
    });

    const rumApplicationIdColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "rumApplicationId",
        title: "RUM Application ID",
        description: "RUM application this session belongs to",
        required: true,
        type: TableColumnType.ObjectID,
        skipIndex: {
          name: "idx_rum_application_id",
          type: SkipIndexType.Set,
          params: [512],
          granularity: 4,
        },
        accessControl: sessionAccessControl,
      });

    /*
     * Duplicate of rumApplicationId, kept because retention, metering and
     * the Owned-access scope all key on primaryEntityId across every
     * telemetry pillar. Diverging here would mean special-casing replay in
     * all three.
     */
    const primaryEntityIdColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "primaryEntityId",
        title: "Primary Entity ID",
        description:
          "Resource that owns this session — always the RUM application id",
        required: true,
        type: TableColumnType.ObjectID,
        accessControl: sessionAccessControl,
      });

    const primaryEntityTypeColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "primaryEntityType",
        title: "Primary Entity Type",
        description: "Always RealUserMonitor for session replay",
        required: true,
        isLowCardinality: true,
        type: TableColumnType.Text,
        skipIndex: {
          name: "idx_primary_entity_type",
          type: SkipIndexType.Set,
          params: [16],
          granularity: 4,
        },
        accessControl: sessionAccessControl,
      });

    /*
     * Server-clamped session start. Feeds the partition key, so it must be
     * identical on every write for a session and must never come straight
     * from a client clock — an end-user device set to 2035 would otherwise
     * create a partition that never expires.
     */
    const startTimeColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "startTime",
      title: "Start Time",
      description: "Server-clamped session start",
      required: true,
      type: TableColumnType.DateTime64,
      codec: [{ codec: "DoubleDelta" }, { codec: "ZSTD", level: 1 }],
      accessControl: sessionAccessControl,
    });

    const sessionIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "sessionId",
      title: "Session ID",
      description: "Client-generated 32-hex session identifier",
      required: true,
      type: TableColumnType.Text,
      codec: { codec: "ZSTD", level: 1 },
      skipIndex: {
        name: "idx_session_id",
        type: SkipIndexType.BloomFilter,
        params: [0.01],
        granularity: 1,
      },
      accessControl: sessionAccessControl,
    });

    /*
     * ReplacingMergeTree version. Unix MILLIseconds, not nanoseconds:
     * nanosecond epochs (~1.75e18) exceed Number.MAX_SAFE_INTEGER and
     * would lose precision crossing JSON, which would make the replace
     * ordering non-deterministic.
     */
    const versionColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "version",
      title: "Version",
      description:
        "Write version in unix milliseconds — ReplacingMergeTree keeps the highest",
      required: true,
      type: TableColumnType.UInt64,
      codec: [{ codec: "T64" }, { codec: "ZSTD", level: 1 }],
      accessControl: sessionAccessControl,
    });

    const isFinalizedColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "isFinalized",
      title: "Is Finalized",
      description:
        "False for a provisional header written on first chunk; true once the finalizer has computed authoritative aggregates",
      required: true,
      type: TableColumnType.Boolean,
      skipIndex: {
        name: "idx_is_finalized",
        type: SkipIndexType.Set,
        params: [2],
        granularity: 4,
      },
      accessControl: sessionAccessControl,
    });

    const sealedReasonColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "sealedReason",
      title: "Sealed Reason",
      description:
        "Why the session stopped accumulating chunks — lets the UI say 'still recording' vs 'browser closed' vs 'quota exhausted'",
      required: true,
      defaultValue: "",
      isLowCardinality: true,
      type: TableColumnType.Text,
      accessControl: sessionAccessControl,
    });

    /*
     * Plain ZSTD rather than DoubleDelta: end time is not monotonic across
     * rows, so a delta codec would expand rather than compress it.
     */
    const endTimeColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "endTime",
      title: "End Time",
      description: "Server-clamped time of the last chunk in this session",
      required: true,
      type: TableColumnType.DateTime64,
      codec: { codec: "ZSTD", level: 1 },
      accessControl: sessionAccessControl,
    });

    const clientReportedStartTimeColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "clientReportedStartTime",
        title: "Client Reported Start Time",
        description:
          "Raw unclamped client clock, retained so a skewed recording is diagnosable rather than silently misleading",
        required: true,
        type: TableColumnType.DateTime64,
        codec: { codec: "ZSTD", level: 1 },
        accessControl: sessionAccessControl,
      });

    const numericColumns: Array<AnalyticsTableColumn> = [
      {
        key: "durationMs",
        title: "Duration (ms)",
        description: "Wall-clock session duration",
        type: TableColumnType.LongNumber,
      },
      {
        key: "chunkCount",
        title: "Chunk Count",
        description: "Distinct chunks actually stored",
        type: TableColumnType.Number,
      },
      {
        key: "maxChunkIndex",
        title: "Max Chunk Index",
        description:
          "Highest chunk index seen — a maximum, not a counter, so gaps are detectable",
        type: TableColumnType.Number,
      },
      {
        key: "missingChunkCount",
        title: "Missing Chunk Count",
        description:
          "Chunks the recorder minted that never arrived; drives the gap bands on the scrubber",
        type: TableColumnType.Number,
      },
      {
        key: "eventCount",
        title: "Event Count",
        description: "Total recorded events across all chunks",
        type: TableColumnType.LongNumber,
      },
      {
        key: "payloadBytes",
        title: "Payload Bytes",
        description:
          "Total compressed payload bytes — this is the metering signal, read instead of byteSize(*)",
        type: TableColumnType.LongNumber,
      },
      {
        key: "viewportWidth",
        title: "Viewport Width",
        description: "Viewport width in CSS pixels",
        type: TableColumnType.Number,
      },
      {
        key: "viewportHeight",
        title: "Viewport Height",
        description: "Viewport height in CSS pixels",
        type: TableColumnType.Number,
      },
      {
        key: "clockSkewMs",
        title: "Clock Skew (ms)",
        description:
          "Observed client-minus-server clock skew, positive when the device runs ahead",
        type: TableColumnType.LongNumber,
      },
    ].map(
      (def: {
        key: string;
        title: string;
        description: string;
        type: TableColumnType;
      }): AnalyticsTableColumn => {
        return new AnalyticsTableColumn({
          key: def.key,
          title: def.title,
          description: def.description,
          required: true,
          type: def.type,
          codec: [{ codec: "T64" }, { codec: "ZSTD", level: 1 }],
          accessControl: sessionAccessControl,
        });
      },
    );

    const counterColumns: Array<AnalyticsTableColumn> = COUNTER_COLUMNS.map(
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
          accessControl: sessionAccessControl,
        });
      },
    );

    const lowCardinalityColumns: Array<AnalyticsTableColumn> =
      LOW_CARDINALITY_COLUMNS.map(
        (def: {
          key: string;
          title: string;
          description: string;
          setParams?: number;
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
            skipIndex: def.setParams
              ? {
                  name: `idx_${def.key.toLowerCase()}`,
                  type: SkipIndexType.Set,
                  params: [def.setParams],
                  granularity: 4,
                }
              : undefined,
            accessControl: sessionAccessControl,
          });
        },
      );

    /* hasError is the single most-used filter in the session list. */
    const hasErrorColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "hasError",
      title: "Has Error",
      description: "True when any error was observed during the session",
      required: true,
      type: TableColumnType.Boolean,
      skipIndex: {
        name: "idx_has_error",
        type: SkipIndexType.Set,
        params: [2],
        granularity: 4,
      },
      accessControl: sessionAccessControl,
    });

    const triggerReasonColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "triggerReason",
      title: "Trigger Reason",
      description: "Why this session was uploaded at all",
      required: true,
      defaultValue: "",
      isLowCardinality: true,
      type: TableColumnType.Text,
      skipIndex: {
        name: "idx_trigger_reason",
        type: SkipIndexType.Set,
        params: [8],
        granularity: 4,
      },
      accessControl: sessionAccessControl,
    });

    /*
     * Sample percentage in force at capture time. Without it, any
     * session-derived rate is un-un-biasable after the setting changes.
     */
    const samplePercentageAtCaptureColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "samplePercentageAtCapture",
        title: "Sample Percentage At Capture",
        description:
          "Sampling rate in force when this session was captured, so analytics can un-bias counts",
        required: true,
        type: TableColumnType.Decimal,
        accessControl: sessionAccessControl,
      });

    const urlColumns: Array<AnalyticsTableColumn> = [
      {
        key: "entryUrl",
        title: "Entry URL",
        description: "First URL of the session, already scrubbed client-side",
      },
      {
        key: "exitUrl",
        title: "Exit URL",
        description: "Last URL of the session, already scrubbed client-side",
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
          type: TableColumnType.Text,
          codec: { codec: "ZSTD", level: 3 },
          accessControl: sessionAccessControl,
        });
      },
    );

    const routesColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "routes",
      title: "Routes",
      description:
        "Distinct scrubbed paths visited, so 'sessions that reached /checkout' is a bloom-pruned lookup",
      required: true,
      defaultValue: [],
      type: TableColumnType.ArrayText,
      codec: { codec: "ZSTD", level: 3 },
      skipIndex: {
        name: "idx_routes",
        type: SkipIndexType.BloomFilter,
        params: [0.01],
        granularity: 1,
      },
      accessControl: sessionAccessControl,
    });

    /* Country only, derived server-side. The IP itself is never stored. */
    const countryCodeColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "countryCode",
      title: "Country Code",
      description:
        "ISO country code derived from the request IP at ingest. The IP itself is never stored.",
      required: true,
      defaultValue: "",
      isLowCardinality: true,
      type: TableColumnType.Text,
      skipIndex: {
        name: "idx_country_code",
        type: SkipIndexType.Set,
        params: [256],
        granularity: 4,
      },
      accessControl: sessionAccessControl,
    });

    /*
     * One-way HMAC of the customer-supplied user reference, using a
     * per-project salt. This is the erasure subject key: an erasure
     * request by user identity resolves through this column. Salt rotation
     * is explicitly unsupported — rotating would orphan every stored key
     * and silently break erasure.
     */
    const identifiedUserKeyColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "identifiedUserKey",
        title: "Identified User Key",
        description:
          "HMAC-SHA256 of the end user reference under a per-project salt. The erasure subject key.",
        required: true,
        defaultValue: "",
        type: TableColumnType.Text,
        codec: { codec: "ZSTD", level: 1 },
        skipIndex: {
          name: "idx_identified_user_key",
          type: SkipIndexType.BloomFilter,
          params: [0.01],
          granularity: 1,
        },
        accessControl: sessionAccessControl,
      });

    const identifiedUserLabelColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "identifiedUserLabel",
        title: "Identified User Label",
        description:
          "Raw end-user reference. Only populated when the application explicitly enables user-identity capture, and readable under a narrower ACL than the rest of the row.",
        required: true,
        defaultValue: "",
        type: TableColumnType.Text,
        codec: { codec: "ZSTD", level: 1 },
        accessControl: identityAccessControl,
      });

    /*
     * Reverse-direction correlation. Populated by the finalizer from a
     * single GROUP BY, never incrementally — an incremental array append
     * on a ReplacingMergeTree row loses updates. Capped, because an
     * unbounded array on a repeatedly-rewritten row is a merge
     * amplification trap.
     */
    const correlationArrayColumns: Array<AnalyticsTableColumn> = [
      {
        key: "traceIds",
        title: "Trace IDs",
        description:
          "Up to 50 trace ids observed in this session's network events, for session -> trace navigation",
      },
      {
        key: "exceptionFingerprints",
        title: "Exception Fingerprints",
        description:
          "Up to 50 exception fingerprints seen in this session, so 'show me replays of this error group' is a bloom-pruned lookup",
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
          defaultValue: [],
          type: TableColumnType.ArrayText,
          codec: { codec: "ZSTD", level: 3 },
          skipIndex: {
            name: `idx_${def.key.toLowerCase()}`,
            type: SkipIndexType.BloomFilter,
            params: [0.01],
            granularity: 1,
          },
          accessControl: sessionAccessControl,
        });
      },
    );

    const fidelityNoticesColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "fidelityNotices",
        title: "Fidelity Notices",
        description:
          "Machine-readable disclosures of what could not be captured (canvas, cross-origin iframes, inaccessible stylesheets). Surfaced on the player so a gap is acknowledged rather than silently blank.",
        required: true,
        defaultValue: [],
        type: TableColumnType.ArrayText,
        codec: { codec: "ZSTD", level: 1 },
        accessControl: sessionAccessControl,
      });

    const fullSnapshotChunkIndexesColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "fullSnapshotChunkIndexes",
        title: "Full Snapshot Chunk Indexes",
        description:
          "Chunk indexes that open on a full DOM snapshot — the seek anchors. Derived by the finalizer.",
        required: true,
        defaultValue: [],
        type: TableColumnType.ArrayNumber,
        codec: { codec: "ZSTD", level: 1 },
        accessControl: sessionAccessControl,
      });

    const schemaVersionColumns: Array<AnalyticsTableColumn> = [
      {
        key: "schemaVersion",
        title: "Schema Version",
        description: "Payload schema version, so playback can branch safely",
      },
      {
        key: "wireVersion",
        title: "Wire Version",
        description: "Envelope wire version the recorder posted with",
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
          type: TableColumnType.UInt8,
          codec: [{ codec: "T64" }, { codec: "ZSTD", level: 1 }],
          accessControl: sessionAccessControl,
        });
      },
    );

    const isLegalHoldColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "isLegalHold",
      title: "Is Legal Hold",
      description:
        "Session is exempt from ordinary retention because it is under legal hold",
      required: true,
      type: TableColumnType.Boolean,
      accessControl: sessionAccessControl,
    });

    const attributesColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "attributes",
      title: "Attributes",
      description: "Custom attributes attached by the host page",
      required: true,
      defaultValue: {},
      type: TableColumnType.MapStringString,
      codec: { codec: "ZSTD", level: 3 },
      mapKeysColumn: "attributeKeys",
      accessControl: sessionAccessControl,
    });

    /*
     * Mandatory sibling of the map column: without it the statement
     * generator emits no key-presence pre-filter and every attribute
     * query degrades to a full scan.
     */
    const attributeKeysColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "attributeKeys",
      title: "Attribute Keys",
      description:
        "Keys present in attributes, enabling the key-presence pre-filter that keeps attribute queries off a full scan",
      required: true,
      defaultValue: [],
      type: TableColumnType.ArrayText,
      codec: { codec: "ZSTD", level: 3 },
      skipIndex: {
        name: "idx_attribute_keys",
        type: SkipIndexType.BloomFilter,
        params: [0.01],
        granularity: 1,
      },
      accessControl: sessionAccessControl,
    });

    const entityKeysColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "entityKeys",
      title: "Entity Keys",
      description:
        "Stable keys of every OpenTelemetry entity this session belongs to, mirroring the other telemetry pillars",
      required: true,
      defaultValue: [],
      type: TableColumnType.ArrayText,
      codec: { codec: "ZSTD", level: 3 },
      skipIndex: {
        name: "idx_session_entity_keys",
        type: SkipIndexType.BloomFilter,
        params: [0.01],
        granularity: 1,
      },
      accessControl: sessionAccessControl,
    });

    /*
     * Derived from the server-clamped session START, not the ingest date.
     *
     * Every other pillar uses the ingest date, but for replay that would
     * mean a chunk buffered offline and flushed hours later gets full
     * retention from arrival — so one session's chunks would expire on
     * different days, TTL-drop mid-session, and leave an unplayable
     * fragment. Session-start derivation makes a session expire atomically
     * and keeps the header's retentionDate equal to its chunks'.
     */
    const retentionDateColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "retentionDate",
      title: "Retention Date",
      description:
        "Date after which this row is TTL-eligible, computed from the clamped session start plus the resolved replay retention",
      required: true,
      type: TableColumnType.Date,
      codec: [{ codec: "DoubleDelta" }, { codec: "ZSTD", level: 1 }],
      accessControl: sessionAccessControl,
    });

    super({
      tableName: AnalyticsTableName.RumSession,
      tableEngine: AnalyticsTableEngine.ReplacingMergeTree,
      singularName: "Session Replay",
      pluralName: "Session Replays",
      /*
       * No crudApiPath: reads go through a bespoke argMax endpoint because
       * this repo has no FINAL support, so generic CRUD would surface
       * un-collapsed ReplacingMergeTree duplicates — worst for the newest
       * sessions, which sort first.
       *
       * No enableMCP either: the MCP tool generator auto-generates tools
       * from that flag, and an LLM agent must not get a tool that reads
       * end users' screen recordings.
       */
      accessControl: {
        read: SESSION_READ_PERMISSIONS,
        create: SESSION_CREATE_PERMISSIONS,
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
        rumApplicationIdColumn,
        primaryEntityIdColumn,
        primaryEntityTypeColumn,
        startTimeColumn,
        sessionIdColumn,
        versionColumn,
        isFinalizedColumn,
        sealedReasonColumn,
        endTimeColumn,
        clientReportedStartTimeColumn,
        ...numericColumns,
        ...counterColumns,
        hasErrorColumn,
        triggerReasonColumn,
        samplePercentageAtCaptureColumn,
        ...urlColumns,
        routesColumn,
        ...lowCardinalityColumns,
        countryCodeColumn,
        identifiedUserKeyColumn,
        identifiedUserLabelColumn,
        ...correlationArrayColumns,
        fidelityNoticesColumn,
        fullSnapshotChunkIndexesColumn,
        ...schemaVersionColumns,
        isLegalHoldColumn,
        attributesColumn,
        attributeKeysColumn,
        entityKeysColumn,
        retentionDateColumn,
      ],
      /*
       * rumApplicationId precedes startTime because the session list is
       * always application-scoped. sessionId is the final element so the
       * ReplacingMergeTree replace key is unique per session.
       */
      sortKeys: ["projectId", "rumApplicationId", "startTime", "sessionId"],
      primaryKeys: ["projectId", "rumApplicationId", "startTime", "sessionId"],
      partitionKey: "toYYYYMMDD(startTime)",
      shardingKey: "cityHash64(projectId, sessionId)",
      tableSettings:
        "ttl_only_drop_parts = 1, non_replicated_deduplication_window = 10000",
      ttlExpression: "retentionDate DELETE",
      defaultSortColumn: "startTime",
      /*
       * Covers every column the session list filters or sorts on. A
       * projection missing browserName / deviceType / countryCode cannot
       * serve those filters, which is the usual way a projection ends up
       * paying for itself and then not being used.
       */
      projections: [
        {
          name: "proj_session_recent",
          query:
            "SELECT projectId, rumApplicationId, startTime, sessionId, version, isFinalized, hasError, durationMs, errorCount, rageClickCount, deadClickCount, browserName, osName, deviceType, countryCode, identifiedUserKey, triggerReason, payloadBytes ORDER BY (projectId, rumApplicationId, startTime)",
        },
      ],
    });
  }

  public get projectId(): ObjectID | undefined {
    return this.getColumnValue("projectId") as ObjectID | undefined;
  }

  public set projectId(v: ObjectID | undefined) {
    this.setColumnValue("projectId", v);
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

  public get startTime(): Date | undefined {
    return this.getColumnValue("startTime") as Date | undefined;
  }

  public set startTime(v: Date | undefined) {
    this.setColumnValue("startTime", v);
  }

  public get sessionId(): string | undefined {
    return this.getColumnValue("sessionId") as string | undefined;
  }

  public set sessionId(v: string | undefined) {
    this.setColumnValue("sessionId", v);
  }

  public get version(): number | undefined {
    return this.getColumnValue("version") as number | undefined;
  }

  public set version(v: number | undefined) {
    this.setColumnValue("version", v);
  }

  public get isFinalized(): boolean | undefined {
    return this.getColumnValue("isFinalized") as boolean | undefined;
  }

  public set isFinalized(v: boolean | undefined) {
    this.setColumnValue("isFinalized", v);
  }

  public get sealedReason(): string | undefined {
    return this.getColumnValue("sealedReason") as string | undefined;
  }

  public set sealedReason(v: string | undefined) {
    this.setColumnValue("sealedReason", v);
  }

  public get endTime(): Date | undefined {
    return this.getColumnValue("endTime") as Date | undefined;
  }

  public set endTime(v: Date | undefined) {
    this.setColumnValue("endTime", v);
  }

  public get clientReportedStartTime(): Date | undefined {
    return this.getColumnValue("clientReportedStartTime") as Date | undefined;
  }

  public set clientReportedStartTime(v: Date | undefined) {
    this.setColumnValue("clientReportedStartTime", v);
  }

  public get durationMs(): number | undefined {
    return this.getColumnValue("durationMs") as number | undefined;
  }

  public set durationMs(v: number | undefined) {
    this.setColumnValue("durationMs", v);
  }

  public get chunkCount(): number | undefined {
    return this.getColumnValue("chunkCount") as number | undefined;
  }

  public set chunkCount(v: number | undefined) {
    this.setColumnValue("chunkCount", v);
  }

  public get maxChunkIndex(): number | undefined {
    return this.getColumnValue("maxChunkIndex") as number | undefined;
  }

  public set maxChunkIndex(v: number | undefined) {
    this.setColumnValue("maxChunkIndex", v);
  }

  public get missingChunkCount(): number | undefined {
    return this.getColumnValue("missingChunkCount") as number | undefined;
  }

  public set missingChunkCount(v: number | undefined) {
    this.setColumnValue("missingChunkCount", v);
  }

  public get eventCount(): number | undefined {
    return this.getColumnValue("eventCount") as number | undefined;
  }

  public set eventCount(v: number | undefined) {
    this.setColumnValue("eventCount", v);
  }

  public get payloadBytes(): number | undefined {
    return this.getColumnValue("payloadBytes") as number | undefined;
  }

  public set payloadBytes(v: number | undefined) {
    this.setColumnValue("payloadBytes", v);
  }

  public get viewportWidth(): number | undefined {
    return this.getColumnValue("viewportWidth") as number | undefined;
  }

  public set viewportWidth(v: number | undefined) {
    this.setColumnValue("viewportWidth", v);
  }

  public get viewportHeight(): number | undefined {
    return this.getColumnValue("viewportHeight") as number | undefined;
  }

  public set viewportHeight(v: number | undefined) {
    this.setColumnValue("viewportHeight", v);
  }

  public get clockSkewMs(): number | undefined {
    return this.getColumnValue("clockSkewMs") as number | undefined;
  }

  public set clockSkewMs(v: number | undefined) {
    this.setColumnValue("clockSkewMs", v);
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

  public get pageCount(): number | undefined {
    return this.getColumnValue("pageCount") as number | undefined;
  }

  public set pageCount(v: number | undefined) {
    this.setColumnValue("pageCount", v);
  }

  public get hasError(): boolean | undefined {
    return this.getColumnValue("hasError") as boolean | undefined;
  }

  public set hasError(v: boolean | undefined) {
    this.setColumnValue("hasError", v);
  }

  public get triggerReason(): string | undefined {
    return this.getColumnValue("triggerReason") as string | undefined;
  }

  public set triggerReason(v: string | undefined) {
    this.setColumnValue("triggerReason", v);
  }

  public get samplePercentageAtCapture(): number | undefined {
    return this.getColumnValue("samplePercentageAtCapture") as
      | number
      | undefined;
  }

  public set samplePercentageAtCapture(v: number | undefined) {
    this.setColumnValue("samplePercentageAtCapture", v);
  }

  public get entryUrl(): string | undefined {
    return this.getColumnValue("entryUrl") as string | undefined;
  }

  public set entryUrl(v: string | undefined) {
    this.setColumnValue("entryUrl", v);
  }

  public get exitUrl(): string | undefined {
    return this.getColumnValue("exitUrl") as string | undefined;
  }

  public set exitUrl(v: string | undefined) {
    this.setColumnValue("exitUrl", v);
  }

  public get routes(): Array<string> | undefined {
    return this.getColumnValue("routes") as Array<string> | undefined;
  }

  public set routes(v: Array<string> | undefined) {
    this.setColumnValue("routes", v);
  }

  public get browserName(): string | undefined {
    return this.getColumnValue("browserName") as string | undefined;
  }

  public set browserName(v: string | undefined) {
    this.setColumnValue("browserName", v);
  }

  public get browserVersion(): string | undefined {
    return this.getColumnValue("browserVersion") as string | undefined;
  }

  public set browserVersion(v: string | undefined) {
    this.setColumnValue("browserVersion", v);
  }

  public get osName(): string | undefined {
    return this.getColumnValue("osName") as string | undefined;
  }

  public set osName(v: string | undefined) {
    this.setColumnValue("osName", v);
  }

  public get deviceType(): string | undefined {
    return this.getColumnValue("deviceType") as string | undefined;
  }

  public set deviceType(v: string | undefined) {
    this.setColumnValue("deviceType", v);
  }

  public get maskingMode(): string | undefined {
    return this.getColumnValue("maskingMode") as string | undefined;
  }

  public set maskingMode(v: string | undefined) {
    this.setColumnValue("maskingMode", v);
  }

  public get consentState(): string | undefined {
    return this.getColumnValue("consentState") as string | undefined;
  }

  public set consentState(v: string | undefined) {
    this.setColumnValue("consentState", v);
  }

  public get recorderKind(): string | undefined {
    return this.getColumnValue("recorderKind") as string | undefined;
  }

  public set recorderKind(v: string | undefined) {
    this.setColumnValue("recorderKind", v);
  }

  public get recorderVersion(): string | undefined {
    return this.getColumnValue("recorderVersion") as string | undefined;
  }

  public set recorderVersion(v: string | undefined) {
    this.setColumnValue("recorderVersion", v);
  }

  public get rrwebVersion(): string | undefined {
    return this.getColumnValue("rrwebVersion") as string | undefined;
  }

  public set rrwebVersion(v: string | undefined) {
    this.setColumnValue("rrwebVersion", v);
  }

  public get countryCode(): string | undefined {
    return this.getColumnValue("countryCode") as string | undefined;
  }

  public set countryCode(v: string | undefined) {
    this.setColumnValue("countryCode", v);
  }

  public get identifiedUserKey(): string | undefined {
    return this.getColumnValue("identifiedUserKey") as string | undefined;
  }

  public set identifiedUserKey(v: string | undefined) {
    this.setColumnValue("identifiedUserKey", v);
  }

  public get identifiedUserLabel(): string | undefined {
    return this.getColumnValue("identifiedUserLabel") as string | undefined;
  }

  public set identifiedUserLabel(v: string | undefined) {
    this.setColumnValue("identifiedUserLabel", v);
  }

  public get traceIds(): Array<string> | undefined {
    return this.getColumnValue("traceIds") as Array<string> | undefined;
  }

  public set traceIds(v: Array<string> | undefined) {
    this.setColumnValue("traceIds", v);
  }

  public get exceptionFingerprints(): Array<string> | undefined {
    return this.getColumnValue("exceptionFingerprints") as
      | Array<string>
      | undefined;
  }

  public set exceptionFingerprints(v: Array<string> | undefined) {
    this.setColumnValue("exceptionFingerprints", v);
  }

  public get fidelityNotices(): Array<string> | undefined {
    return this.getColumnValue("fidelityNotices") as Array<string> | undefined;
  }

  public set fidelityNotices(v: Array<string> | undefined) {
    this.setColumnValue("fidelityNotices", v);
  }

  public get fullSnapshotChunkIndexes(): Array<number> | undefined {
    return this.getColumnValue("fullSnapshotChunkIndexes") as
      | Array<number>
      | undefined;
  }

  public set fullSnapshotChunkIndexes(v: Array<number> | undefined) {
    this.setColumnValue("fullSnapshotChunkIndexes", v);
  }

  public get schemaVersion(): number | undefined {
    return this.getColumnValue("schemaVersion") as number | undefined;
  }

  public set schemaVersion(v: number | undefined) {
    this.setColumnValue("schemaVersion", v);
  }

  public get wireVersion(): number | undefined {
    return this.getColumnValue("wireVersion") as number | undefined;
  }

  public set wireVersion(v: number | undefined) {
    this.setColumnValue("wireVersion", v);
  }

  public get isLegalHold(): boolean | undefined {
    return this.getColumnValue("isLegalHold") as boolean | undefined;
  }

  public set isLegalHold(v: boolean | undefined) {
    this.setColumnValue("isLegalHold", v);
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

  public get retentionDate(): Date | undefined {
    return this.getColumnValue("retentionDate") as Date | undefined;
  }

  public set retentionDate(v: Date | undefined) {
    this.setColumnValue("retentionDate", v);
  }
}
