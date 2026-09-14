import AnalyticsBaseModel from "./AnalyticsBaseModel/AnalyticsBaseModel";
import Route from "../../Types/API/Route";
import AnalyticsTableEngine from "../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import AnalyticsTableColumn, {
  SkipIndexType,
} from "../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import OwnedThrough from "../../Types/Database/AccessControl/OwnedThrough";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import OcsfSeverity from "../../Types/SecurityEvent/OcsfSeverity";
import Service from "../DatabaseModels/Service";
import ServiceType from "../../Types/Telemetry/ServiceType";

/*
 * Security events — SIEM signals stored beside logs/traces/metrics in
 * ClickHouse, normalized to OCSF at ingest whatever dialect they arrived
 * in (Google SecOps UDM, native OCSF, SecOps detection alerts, generic
 * security JSON).
 *
 * Layout mirrors Log deliberately: same tenant + primary-entity
 * attribution (billing and RBAC ride on it), same sort/partition/sharding
 * shape, per-row retentionDate TTL, and Map(String,String) attributes
 * with an attributeKeys sidecar so arbitrary source fields stay
 * filterable without schema changes. The typed entity columns
 * (principal / target / observables) are what make correlation queries
 * ("everything mentioning this host") cheap.
 */

/*
 * Security events read through the Security tiers and nothing broader.
 *
 * The layout mirrors Log, but the access list deliberately does not: Log names
 * ProjectMember, the project-wide Viewer and the three Telemetry tiers, and if
 * this table did the same then every principal in the project could read the
 * SIEM. A Telemetry Admin is trusted with logs, metrics and traces; that is not
 * the same decision as being trusted with authentication failures, privilege
 * escalations and the detections written over them, and an organisation running
 * a SIEM needs to be able to make the second decision separately from the first.
 *
 * ProjectOwner and ProjectAdmin stay so a project is never locked out of its own
 * data - they are the principals who can grant the Security tiers in the first
 * place, so excluding them would only mean nobody could open the door.
 */
const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadSecurityEvent,
];

/*
 * Rows normally arrive through the SecOps poller, the detection-rule evaluator
 * and the threat-intel matcher, all of which insert as root and never reach
 * this list. It gates the CRUD API only, which is why it stops at the tiers
 * that administer the SIEM.
 */
const createPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.CreateSecurityEvent,
];

const defaultColumnAccessControl: ColumnAccessControl = {
  read: readPermissions,
  create: createPermissions,
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

/*
 * Non-Nullable Text with a '' default, like Log's sessionId column:
 * StatementGenerator has to assumeNotNull-wrap Nullable columns for skip
 * indexes, and '' reads naturally as "source did not say".
 */
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
      name: `idx_${key.replace(/([A-Z])/g, "_$1").toLowerCase()}`,
      type: SkipIndexType.BloomFilter,
      params: [0.01],
      granularity: 1,
    },
  });
}

function numberColumn(
  key: string,
  title: string,
  description: string,
): AnalyticsTableColumn {
  return new AnalyticsTableColumn({
    key,
    title,
    description,
    required: true,
    defaultValue: 0,
    type: TableColumnType.Number,
    accessControl: defaultColumnAccessControl,
  });
}

function arrayTextColumn(
  key: string,
  title: string,
  description: string,
): AnalyticsTableColumn {
  return new AnalyticsTableColumn({
    key,
    title,
    description,
    required: true,
    defaultValue: [],
    type: TableColumnType.ArrayText,
    codec: { codec: "ZSTD", level: 3 },
    skipIndex: {
      name: `idx_${key.replace(/([A-Z])/g, "_$1").toLowerCase()}`,
      type: SkipIndexType.BloomFilter,
      params: [0.01],
      granularity: 1,
    },
    accessControl: defaultColumnAccessControl,
  });
}

/*
 * Not @OperationalResource, which Log and Span both are.
 *
 * That decorator's only effect on an analytics model is to widen the table's
 * permission list with the *AllOperationalResources wildcards - the grant whose
 * own description reads "all operational resources in this project (Monitor,
 * Incident, Alert, StatusPage, etc.)". Nobody handing that to an integration is
 * deciding to hand it the SIEM, and leaving it on would have left one door open
 * behind the Security tiers.
 *
 * @OwnedThrough stays: owned-scope filtering keys off it alone, so a Security
 * role granted with scope=Owned still narrows to the services it owns.
 */
@OwnedThrough("primaryEntityId", Service, { includeProjectScope: true })
export default class SecurityEvent extends AnalyticsBaseModel {
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

    const primaryEntityIdColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "primaryEntityId",
        title: "Source ID",
        description:
          "ID of the resource the security event is attributed to (a Telemetry Service representing the security source, e.g. 'Google SecOps')",
        required: true,
        type: TableColumnType.ObjectID,
        accessControl: defaultColumnAccessControl,
      });

    const primaryEntityTypeColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "primaryEntityType",
        isLowCardinality: true,
        title: "Source Type",
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
        accessControl: defaultColumnAccessControl,
      });

    const timeColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "time",
      codec: [{ codec: "DoubleDelta" }, { codec: "ZSTD", level: 1 }],
      title: "Time",
      description: "When the security event occurred (from the source payload)",
      required: true,
      type: TableColumnType.DateTime64,
      accessControl: defaultColumnAccessControl,
    });

    const eventUidColumn: AnalyticsTableColumn = bloomTextColumn(
      "eventUid",
      "Event UID",
      "Source-assigned unique event id (OCSF metadata.uid / UDM metadata.id), or a content hash when the source has none",
    );

    const categoryUidColumn: AnalyticsTableColumn = numberColumn(
      "categoryUid",
      "Category UID",
      "OCSF category uid (1 System Activity, 2 Findings, 3 IAM, 4 Network Activity, 5 Discovery, 6 Application Activity; 0 uncategorized)",
    );

    const categoryNameColumn: AnalyticsTableColumn = textColumn({
      key: "categoryName",
      title: "Category",
      description: "OCSF category name",
      isLowCardinality: true,
      skipIndex: {
        name: "idx_category_name",
        type: SkipIndexType.Set,
        params: [10],
        granularity: 4,
      },
    });

    const classUidColumn: AnalyticsTableColumn = numberColumn(
      "classUid",
      "Class UID",
      "OCSF event class uid (e.g. 3002 Authentication, 4003 DNS Activity, 2004 Detection Finding; 0 unmapped)",
    );

    const classNameColumn: AnalyticsTableColumn = textColumn({
      key: "className",
      title: "Event Class",
      description: "OCSF event class name",
      isLowCardinality: true,
      skipIndex: {
        name: "idx_class_name",
        type: SkipIndexType.Set,
        params: [100],
        granularity: 4,
      },
    });

    const activityNameColumn: AnalyticsTableColumn = textColumn({
      key: "activityName",
      title: "Activity",
      description: "OCSF activity within the event class (Logon, Create, ...)",
      isLowCardinality: true,
    });

    const severityIdColumn: AnalyticsTableColumn = numberColumn(
      "severityId",
      "Severity ID",
      "OCSF severity id (0 Unknown, 1 Informational, 2 Low, 3 Medium, 4 High, 5 Critical, 6 Fatal, 99 Other)",
    );

    const severityNameColumn: AnalyticsTableColumn = textColumn({
      key: "severityName",
      title: "Severity",
      description: "OCSF severity name",
      isLowCardinality: true,
      skipIndex: {
        name: "idx_severity_name",
        type: SkipIndexType.Set,
        params: [10],
        granularity: 4,
      },
    });

    const statusNameColumn: AnalyticsTableColumn = textColumn({
      key: "statusName",
      title: "Status",
      description:
        "Outcome of the activity: Success, Failure, Allowed, Blocked, ... ('' when the source does not say)",
      isLowCardinality: true,
    });

    const messageColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "message",
      title: "Message",
      description: "Human-readable one-line summary of the event",
      required: true,
      defaultValue: "",
      type: TableColumnType.Text,
      skipIndex: {
        name: "idx_message",
        type: SkipIndexType.TokenBF,
        params: [10240, 3, 0],
        granularity: 4,
      },
      codec: {
        codec: "ZSTD",
        level: 3,
      },
      accessControl: defaultColumnAccessControl,
    });

    const vendorNameColumn: AnalyticsTableColumn = textColumn({
      key: "vendorName",
      title: "Vendor",
      description: "Vendor of the product that produced the event",
      isLowCardinality: true,
    });

    const productNameColumn: AnalyticsTableColumn = textColumn({
      key: "productName",
      title: "Product",
      description: "Product that produced the event",
      isLowCardinality: true,
    });

    const ruleIdColumn: AnalyticsTableColumn = bloomTextColumn(
      "ruleId",
      "Rule ID",
      "Detection rule id, when the event is a finding produced by a rule",
    );

    const ruleNameColumn: AnalyticsTableColumn = textColumn({
      key: "ruleName",
      title: "Rule Name",
      description: "Detection rule name, when the event is a finding",
      isLowCardinality: true,
    });

    const mitreTacticsColumn: AnalyticsTableColumn = arrayTextColumn(
      "mitreTactics",
      "MITRE Tactics",
      "MITRE ATT&CK tactic ids referenced by the event (e.g. TA0006)",
    );

    const mitreTechniquesColumn: AnalyticsTableColumn = arrayTextColumn(
      "mitreTechniques",
      "MITRE Techniques",
      "MITRE ATT&CK technique ids referenced by the event (e.g. T1110)",
    );

    const principalUserColumn: AnalyticsTableColumn = bloomTextColumn(
      "principalUser",
      "Principal User",
      "Acting user (OCSF actor.user / UDM principal.user)",
    );

    const principalHostColumn: AnalyticsTableColumn = bloomTextColumn(
      "principalHost",
      "Principal Host",
      "Acting host (OCSF src_endpoint.hostname / UDM principal.hostname)",
    );

    const principalIpColumn: AnalyticsTableColumn = bloomTextColumn(
      "principalIp",
      "Principal IP",
      "Acting IP address",
    );

    const principalProcessColumn: AnalyticsTableColumn = textColumn({
      key: "principalProcess",
      title: "Principal Process",
      description: "Acting process (path or command line)",
    });

    const targetUserColumn: AnalyticsTableColumn = bloomTextColumn(
      "targetUser",
      "Target User",
      "User the activity was directed at",
    );

    const targetHostColumn: AnalyticsTableColumn = bloomTextColumn(
      "targetHost",
      "Target Host",
      "Host the activity was directed at",
    );

    const targetIpColumn: AnalyticsTableColumn = bloomTextColumn(
      "targetIp",
      "Target IP",
      "IP address the activity was directed at",
    );

    const targetPortColumn: AnalyticsTableColumn = numberColumn(
      "targetPort",
      "Target Port",
      "Port the activity was directed at (0 when not applicable)",
    );

    const targetResourceColumn: AnalyticsTableColumn = textColumn({
      key: "targetResource",
      title: "Target Resource",
      description: "Resource the activity was directed at (URL, file, ...)",
    });

    const observablesColumn: AnalyticsTableColumn = arrayTextColumn(
      "observables",
      "Observables",
      "Every extracted observable value (users, hosts, IPs, domains, hashes) — powers 'all events mentioning X' queries and the entity-neighborhood graph",
    );

    const attributesColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "attributes",
      codec: { codec: "ZSTD", level: 3 },
      title: "Attributes",
      description:
        "The full source payload flattened to dot-notation keys with string values",
      required: true,
      defaultValue: {},
      type: TableColumnType.MapStringString,
      mapKeysColumn: "attributeKeys",
      accessControl: defaultColumnAccessControl,
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
      accessControl: defaultColumnAccessControl,
    });

    const retentionDateColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "retentionDate",
      codec: [{ codec: "DoubleDelta" }, { codec: "ZSTD", level: 1 }],
      title: "Retention Date",
      description:
        "Date after which this row is eligible for TTL deletion, computed at ingest time from the securityEvents retention pillar",
      required: true,
      type: TableColumnType.Date,
      defaultValue: undefined,
    });

    super({
      tableName: AnalyticsTableName.SecurityEvent,
      tableEngine: AnalyticsTableEngine.MergeTree,
      singularName: "Security Event",
      accessControl: {
        read: readPermissions,
        create: createPermissions,
        update: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.SecurityAdmin,
          Permission.SecurityMember,
          Permission.EditSecurityEvent,
        ],
        /*
         * Deleting a security event destroys the record of something that
         * happened, which is the one thing a SIEM exists to keep. It sits on
         * the Admin tier rather than Member for the same reason the retention
         * policy does.
         */
        delete: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.SecurityAdmin,
          Permission.DeleteSecurityEvent,
        ],
      },
      pluralName: "Security Events",
      crudApiPath: new Route("/security-events"),
      enableMCP: true,
      enableDocumentation: true,
      tableDescription:
        "SIEM signals normalized to OCSF and stored beside your observability data. Query, filter, and correlate security events from Google SecOps and other sources across your project.",
      tableColumns: [
        projectIdColumn,
        primaryEntityIdColumn,
        primaryEntityTypeColumn,
        timeColumn,
        eventUidColumn,
        categoryUidColumn,
        categoryNameColumn,
        classUidColumn,
        classNameColumn,
        activityNameColumn,
        severityIdColumn,
        severityNameColumn,
        statusNameColumn,
        messageColumn,
        vendorNameColumn,
        productNameColumn,
        ruleIdColumn,
        ruleNameColumn,
        mitreTacticsColumn,
        mitreTechniquesColumn,
        principalUserColumn,
        principalHostColumn,
        principalIpColumn,
        principalProcessColumn,
        targetUserColumn,
        targetHostColumn,
        targetIpColumn,
        targetPortColumn,
        targetResourceColumn,
        observablesColumn,
        attributesColumn,
        attributeKeysColumn,
        retentionDateColumn,
      ],
      projections: [
        {
          name: "proj_severity_histogram",
          query:
            "SELECT projectId, severityName, className, toStartOfInterval(time, INTERVAL 1 MINUTE) AS minute, count() AS cnt GROUP BY projectId, severityName, className, minute",
        },
      ],
      sortKeys: ["projectId", "time", "primaryEntityId"],
      primaryKeys: ["projectId", "time", "primaryEntityId"],
      partitionKey: "toYYYYMMDD(time)",
      /*
       * Same sharding rationale as Log: these three columns are always
       * present (non-nullable) and `time` is high-entropy, so one very
       * noisy security source still spreads evenly across shards.
       */
      shardingKey: "cityHash64(projectId, primaryEntityId, time)",
      tableSettings:
        "ttl_only_drop_parts = 1, non_replicated_deduplication_window = 10000",
      ttlExpression: "retentionDate DELETE",
      defaultSortColumn: "time",
    });
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

  public get time(): Date | undefined {
    return this.getColumnValue("time") as Date | undefined;
  }

  public set time(v: Date | undefined) {
    this.setColumnValue("time", v);
  }

  public get eventUid(): string | undefined {
    return this.getColumnValue("eventUid") as string | undefined;
  }

  public set eventUid(v: string | undefined) {
    this.setColumnValue("eventUid", v);
  }

  public get categoryUid(): number | undefined {
    return this.getColumnValue("categoryUid") as number | undefined;
  }

  public set categoryUid(v: number | undefined) {
    this.setColumnValue("categoryUid", v);
  }

  public get categoryName(): string | undefined {
    return this.getColumnValue("categoryName") as string | undefined;
  }

  public set categoryName(v: string | undefined) {
    this.setColumnValue("categoryName", v);
  }

  public get classUid(): number | undefined {
    return this.getColumnValue("classUid") as number | undefined;
  }

  public set classUid(v: number | undefined) {
    this.setColumnValue("classUid", v);
  }

  public get className(): string | undefined {
    return this.getColumnValue("className") as string | undefined;
  }

  public set className(v: string | undefined) {
    this.setColumnValue("className", v);
  }

  public get activityName(): string | undefined {
    return this.getColumnValue("activityName") as string | undefined;
  }

  public set activityName(v: string | undefined) {
    this.setColumnValue("activityName", v);
  }

  public get severityId(): number | undefined {
    return this.getColumnValue("severityId") as number | undefined;
  }

  public set severityId(v: number | undefined) {
    this.setColumnValue("severityId", v);
  }

  public get severityName(): OcsfSeverity | undefined {
    return this.getColumnValue("severityName") as OcsfSeverity | undefined;
  }

  public set severityName(v: OcsfSeverity | undefined) {
    this.setColumnValue("severityName", v);
  }

  public get statusName(): string | undefined {
    return this.getColumnValue("statusName") as string | undefined;
  }

  public set statusName(v: string | undefined) {
    this.setColumnValue("statusName", v);
  }

  public get message(): string | undefined {
    return this.getColumnValue("message") as string | undefined;
  }

  public set message(v: string | undefined) {
    this.setColumnValue("message", v);
  }

  public get vendorName(): string | undefined {
    return this.getColumnValue("vendorName") as string | undefined;
  }

  public set vendorName(v: string | undefined) {
    this.setColumnValue("vendorName", v);
  }

  public get productName(): string | undefined {
    return this.getColumnValue("productName") as string | undefined;
  }

  public set productName(v: string | undefined) {
    this.setColumnValue("productName", v);
  }

  public get ruleId(): string | undefined {
    return this.getColumnValue("ruleId") as string | undefined;
  }

  public set ruleId(v: string | undefined) {
    this.setColumnValue("ruleId", v);
  }

  public get ruleName(): string | undefined {
    return this.getColumnValue("ruleName") as string | undefined;
  }

  public set ruleName(v: string | undefined) {
    this.setColumnValue("ruleName", v);
  }

  public get mitreTactics(): Array<string> | undefined {
    return this.getColumnValue("mitreTactics") as Array<string> | undefined;
  }

  public set mitreTactics(v: Array<string> | undefined) {
    this.setColumnValue("mitreTactics", v);
  }

  public get mitreTechniques(): Array<string> | undefined {
    return this.getColumnValue("mitreTechniques") as Array<string> | undefined;
  }

  public set mitreTechniques(v: Array<string> | undefined) {
    this.setColumnValue("mitreTechniques", v);
  }

  public get principalUser(): string | undefined {
    return this.getColumnValue("principalUser") as string | undefined;
  }

  public set principalUser(v: string | undefined) {
    this.setColumnValue("principalUser", v);
  }

  public get principalHost(): string | undefined {
    return this.getColumnValue("principalHost") as string | undefined;
  }

  public set principalHost(v: string | undefined) {
    this.setColumnValue("principalHost", v);
  }

  public get principalIp(): string | undefined {
    return this.getColumnValue("principalIp") as string | undefined;
  }

  public set principalIp(v: string | undefined) {
    this.setColumnValue("principalIp", v);
  }

  public get principalProcess(): string | undefined {
    return this.getColumnValue("principalProcess") as string | undefined;
  }

  public set principalProcess(v: string | undefined) {
    this.setColumnValue("principalProcess", v);
  }

  public get targetUser(): string | undefined {
    return this.getColumnValue("targetUser") as string | undefined;
  }

  public set targetUser(v: string | undefined) {
    this.setColumnValue("targetUser", v);
  }

  public get targetHost(): string | undefined {
    return this.getColumnValue("targetHost") as string | undefined;
  }

  public set targetHost(v: string | undefined) {
    this.setColumnValue("targetHost", v);
  }

  public get targetIp(): string | undefined {
    return this.getColumnValue("targetIp") as string | undefined;
  }

  public set targetIp(v: string | undefined) {
    this.setColumnValue("targetIp", v);
  }

  public get targetPort(): number | undefined {
    return this.getColumnValue("targetPort") as number | undefined;
  }

  public set targetPort(v: number | undefined) {
    this.setColumnValue("targetPort", v);
  }

  public get targetResource(): string | undefined {
    return this.getColumnValue("targetResource") as string | undefined;
  }

  public set targetResource(v: string | undefined) {
    this.setColumnValue("targetResource", v);
  }

  public get observables(): Array<string> | undefined {
    return this.getColumnValue("observables") as Array<string> | undefined;
  }

  public set observables(v: Array<string> | undefined) {
    this.setColumnValue("observables", v);
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

  public get retentionDate(): Date | undefined {
    return this.getColumnValue("retentionDate") as Date | undefined;
  }

  public set retentionDate(v: Date | undefined) {
    this.setColumnValue("retentionDate", v);
  }
}
