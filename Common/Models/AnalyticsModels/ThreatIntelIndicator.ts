import AnalyticsBaseModel from "./AnalyticsBaseModel/AnalyticsBaseModel";
import Route from "../../Types/API/Route";
import AnalyticsTableEngine from "../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import AnalyticsTableColumn, {
  SkipIndexType,
} from "../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";

/*
 * Normalized IOC rows parsed from STIX 2.1 indicator objects on TAXII
 * feeds — the lookup table the threat-intel matcher joins security events
 * against, and the ingest-time enricher reads.
 *
 * ReplacingMergeTree keyed by (projectId, feedId, indicatorValue, stixId)
 * with `version` = the STIX object's modified timestamp: a re-polled or
 * updated indicator collapses to its latest version at merge time instead
 * of duplicating, and a revocation is just a later version with
 * revoked=true. Merges are asynchronous, so CURRENT-STATE READS MUST BE
 * VERSION-AWARE — argMax(column, version) GROUP BY the identity, the
 * MutableMetric/SloHistory precedent. ThreatIntelIndicatorService wraps
 * the correct statements; the generic findBy/countBy paths can
 * transiently see both versions of a re-polled indicator.
 *
 * "Active" is a query predicate (validFrom <= now < validUntil AND NOT
 * revoked), never the TTL: retentionDate TTL with ttl_only_drop_parts is
 * lazy garbage collection, not expiry enforcement.
 */

const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.TelemetryAdmin,
  Permission.TelemetryMember,
  Permission.TelemetryViewer,
  Permission.ReadProjectThreatIntelFeed,
];

/*
 * Rows are written only by the Workers poller (insertJsonRows, which
 * bypasses the API layer), so nobody can create or update rows via the
 * API. Delete stays open to admins so a mis-subscribed feed's rows can
 * be purged without waiting for TTL.
 */
const defaultColumnAccessControl: ColumnAccessControl = {
  read: readPermissions,
  create: [],
  update: [],
};

type TextColumnOptions = {
  key: string;
  title: string;
  description: string;
  isLowCardinality?: boolean | undefined;
  skipIndex?:
    | {
        name: string;
        type: SkipIndexType;
        params: Array<number>;
        granularity: number;
      }
    | undefined;
};

// Non-Nullable Text with a '' default, same rationale as SecurityEvent's.
function textColumn(options: TextColumnOptions): AnalyticsTableColumn {
  return new AnalyticsTableColumn({
    key: options.key,
    title: options.title,
    description: options.description,
    required: true,
    defaultValue: "",
    isLowCardinality: options.isLowCardinality,
    type: TableColumnType.Text,
    codec: { codec: "ZSTD", level: 1 },
    skipIndex: options.skipIndex,
    accessControl: defaultColumnAccessControl,
  });
}

function bloomTextColumn(
  key: string,
  title: string,
  description: string,
): AnalyticsTableColumn {
  return textColumn({
    key,
    title,
    description,
    skipIndex: {
      name: `idx_ti_${key.replace(/([A-Z])/g, "_$1").toLowerCase()}`,
      type: SkipIndexType.BloomFilter,
      params: [0.01],
      granularity: 1,
    },
  });
}

export default class ThreatIntelIndicator extends AnalyticsBaseModel {
  public constructor() {
    const projectIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "projectId",
      title: "Project ID",
      description: "ID of project",
      required: true,
      type: TableColumnType.ObjectID,
      isTenantId: true,
      accessControl: defaultColumnAccessControl,
    });

    const feedIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "feedId",
      title: "Feed ID",
      description: "ID of the ThreatIntelFeed this indicator came from.",
      required: true,
      type: TableColumnType.ObjectID,
      accessControl: defaultColumnAccessControl,
    });

    const feedNameColumn: AnalyticsTableColumn = textColumn({
      key: "feedName",
      title: "Feed",
      description:
        "Name of the feed at poll time, denormalized so enrichment and findings need no Postgres lookup.",
      isLowCardinality: true,
    });

    const stixIdColumn: AnalyticsTableColumn = bloomTextColumn(
      "stixId",
      "STIX ID",
      "The STIX indicator object's id, e.g. indicator--<uuid>.",
    );

    const indicatorTypeColumn: AnalyticsTableColumn = textColumn({
      key: "indicatorType",
      title: "Indicator Type",
      description:
        "Normalized indicator type: ipv4-addr, ipv6-addr, domain-name, url, email-addr, file-hash-sha256, file-hash-sha1, file-hash-md5.",
      isLowCardinality: true,
      skipIndex: {
        name: "idx_ti_indicator_type",
        type: SkipIndexType.Set,
        params: [10],
        granularity: 4,
      },
    });

    const indicatorValueColumn: AnalyticsTableColumn = bloomTextColumn(
      "indicatorValue",
      "Indicator Value",
      "The IOC value in canonical (lowercased) form — the join key against security-event observables.",
    );

    const indicatorNameColumn: AnalyticsTableColumn = textColumn({
      key: "indicatorName",
      title: "Name",
      description: "The STIX indicator's name, '' when the feed sets none.",
    });

    const confidenceColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "confidence",
      title: "Confidence",
      description:
        "STIX confidence 0-100; 0 when the feed does not score the indicator.",
      required: true,
      defaultValue: 0,
      type: TableColumnType.Number,
      accessControl: defaultColumnAccessControl,
    });

    const stixLabelsColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "stixLabels",
      title: "Labels",
      description:
        "The STIX indicator's labels, e.g. malicious-activity, phishing.",
      required: true,
      defaultValue: [],
      type: TableColumnType.ArrayText,
      codec: { codec: "ZSTD", level: 1 },
      accessControl: defaultColumnAccessControl,
    });

    const validFromColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "validFrom",
      codec: [{ codec: "DoubleDelta" }, { codec: "ZSTD", level: 1 }],
      title: "Valid From",
      description: "When the indicator becomes valid (STIX valid_from).",
      required: true,
      type: TableColumnType.DateTime64,
      accessControl: defaultColumnAccessControl,
    });

    const validUntilColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "validUntil",
      codec: [{ codec: "DoubleDelta" }, { codec: "ZSTD", level: 1 }],
      title: "Valid Until",
      description:
        "When the indicator stops being valid (STIX valid_until, defaulted forward when the feed omits it). Matching filters on this; TTL only garbage-collects after it.",
      required: true,
      type: TableColumnType.DateTime64,
      accessControl: defaultColumnAccessControl,
    });

    const revokedColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "revoked",
      title: "Revoked",
      description:
        "True when the STIX object was revoked by its producer. A revocation arrives as a later version of the same identity.",
      required: true,
      defaultValue: false,
      type: TableColumnType.Boolean,
      accessControl: defaultColumnAccessControl,
    });

    /*
     * ClusterConfig.getStorageEngine renders ReplacingMergeTree(version),
     * so this column MUST be named `version` (RumSession precedent).
     * Value: the STIX object's modified timestamp in unix millis.
     */
    const versionColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "version",
      codec: [{ codec: "DoubleDelta" }, { codec: "ZSTD", level: 1 }],
      title: "Version",
      description:
        "Monotonic version for ReplacingMergeTree and version-aware reads — the STIX modified timestamp in unix milliseconds.",
      required: true,
      type: TableColumnType.UInt64,
      accessControl: defaultColumnAccessControl,
    });

    const retentionDateColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "retentionDate",
      codec: [{ codec: "DoubleDelta" }, { codec: "ZSTD", level: 1 }],
      title: "Retention Date",
      description:
        "Date after which this row is eligible for TTL deletion — validUntil plus a day of grace.",
      required: true,
      type: TableColumnType.Date,
      defaultValue: undefined,
      accessControl: defaultColumnAccessControl,
    });

    super({
      tableName: AnalyticsTableName.ThreatIntelIndicator,
      tableEngine: AnalyticsTableEngine.ReplacingMergeTree,
      singularName: "Threat Intel Indicator",
      pluralName: "Threat Intel Indicators",
      accessControl: {
        read: readPermissions,
        create: [],
        update: [],
        delete: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.DeleteProjectThreatIntelFeed,
        ],
      },
      crudApiPath: new Route("/threat-intel-indicators"),
      enableMCP: true,
      enableDocumentation: true,
      tableDescription:
        "Normalized indicators of compromise (IOCs) ingested from STIX/TAXII threat-intelligence feeds. Matched against security-event observables to enrich events and open findings.",
      tableColumns: [
        projectIdColumn,
        feedIdColumn,
        feedNameColumn,
        stixIdColumn,
        indicatorTypeColumn,
        indicatorValueColumn,
        indicatorNameColumn,
        confidenceColumn,
        stixLabelsColumn,
        validFromColumn,
        validUntilColumn,
        revokedColumn,
        versionColumn,
        retentionDateColumn,
      ],
      projections: [],
      sortKeys: ["projectId", "feedId", "indicatorValue", "stixId"],
      primaryKeys: ["projectId", "feedId", "indicatorValue", "stixId"],
      /*
       * Monthly partitions on retentionDate, the MutableMetric shape:
       * indicators live by their validity window, not by ingest time, and
       * ttl_only_drop_parts wants whole partitions to age out together.
       */
      partitionKey: "toYYYYMM(retentionDate)",
      shardingKey: "cityHash64(projectId, feedId, indicatorValue)",
      tableSettings:
        "ttl_only_drop_parts = 1, non_replicated_deduplication_window = 10000",
      ttlExpression: "retentionDate DELETE",
      defaultSortColumn: "validFrom",
    });
  }

  public get projectId(): ObjectID | undefined {
    return this.getColumnValue("projectId") as ObjectID | undefined;
  }

  public set projectId(v: ObjectID | undefined) {
    this.setColumnValue("projectId", v);
  }

  public get feedId(): ObjectID | undefined {
    return this.getColumnValue("feedId") as ObjectID | undefined;
  }

  public set feedId(v: ObjectID | undefined) {
    this.setColumnValue("feedId", v);
  }

  public get feedName(): string | undefined {
    return this.getColumnValue("feedName") as string | undefined;
  }

  public set feedName(v: string | undefined) {
    this.setColumnValue("feedName", v);
  }

  public get stixId(): string | undefined {
    return this.getColumnValue("stixId") as string | undefined;
  }

  public set stixId(v: string | undefined) {
    this.setColumnValue("stixId", v);
  }

  public get indicatorType(): string | undefined {
    return this.getColumnValue("indicatorType") as string | undefined;
  }

  public set indicatorType(v: string | undefined) {
    this.setColumnValue("indicatorType", v);
  }

  public get indicatorValue(): string | undefined {
    return this.getColumnValue("indicatorValue") as string | undefined;
  }

  public set indicatorValue(v: string | undefined) {
    this.setColumnValue("indicatorValue", v);
  }

  public get indicatorName(): string | undefined {
    return this.getColumnValue("indicatorName") as string | undefined;
  }

  public set indicatorName(v: string | undefined) {
    this.setColumnValue("indicatorName", v);
  }

  public get confidence(): number | undefined {
    return this.getColumnValue("confidence") as number | undefined;
  }

  public set confidence(v: number | undefined) {
    this.setColumnValue("confidence", v);
  }

  public get stixLabels(): Array<string> | undefined {
    return this.getColumnValue("stixLabels") as Array<string> | undefined;
  }

  public set stixLabels(v: Array<string> | undefined) {
    this.setColumnValue("stixLabels", v);
  }

  public get validFrom(): Date | undefined {
    return this.getColumnValue("validFrom") as Date | undefined;
  }

  public set validFrom(v: Date | undefined) {
    this.setColumnValue("validFrom", v);
  }

  public get validUntil(): Date | undefined {
    return this.getColumnValue("validUntil") as Date | undefined;
  }

  public set validUntil(v: Date | undefined) {
    this.setColumnValue("validUntil", v);
  }

  public get revoked(): boolean | undefined {
    return this.getColumnValue("revoked") as boolean | undefined;
  }

  public set revoked(v: boolean | undefined) {
    this.setColumnValue("revoked", v);
  }

  public get version(): number | undefined {
    return this.getColumnValue("version") as number | undefined;
  }

  public set version(v: number | undefined) {
    this.setColumnValue("version", v);
  }

  public get retentionDate(): Date | undefined {
    return this.getColumnValue("retentionDate") as Date | undefined;
  }

  public set retentionDate(v: Date | undefined) {
    this.setColumnValue("retentionDate", v);
  }
}
