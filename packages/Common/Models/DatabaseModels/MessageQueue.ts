import Label from "./Label";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import AccessControlColumn from "../../Types/Database/AccessControlColumn";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import SlugifyColumn from "../../Types/Database/SlugifyColumn";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
} from "typeorm";

/*
 * Where a queue's evidence comes from: the messaging spans of instrumented
 * applications, the broker's own health metrics (an OpenTelemetry Collector
 * receiver, a Prometheus scrape, a cloud provider's monitoring API), or a
 * person adding it by hand. Stored verbatim in MessageQueue.discoverySource
 * (first creator wins); the first two are also what a sighting reports
 * (MessageQueueService.recordSighting).
 */
export type MessageQueueSightingSource = "traces" | "broker-metrics";

export type MessageQueueDiscoverySource = MessageQueueSightingSource | "manual";

export const MESSAGE_QUEUE_DISCOVERY_SOURCES: ReadonlyArray<MessageQueueDiscoverySource> =
  ["traces", "broker-metrics", "manual"];

const DISCOVERY_SOURCE_LABELS: ReadonlyMap<string, string> = new Map<
  string,
  string
>([
  ["traces", "Application traces"],
  ["broker-metrics", "Broker metrics"],
  ["manual", "Added manually"],
]);

/**
 * "Application traces", "Broker metrics" or "Added manually" for a stored
 * discoverySource, the trimmed raw value for anything else, "" for nothing.
 * A Map, so a value such as "constructor" is shown as it is.
 */
export function getMessageQueueDiscoverySourceLabel(source: unknown): string {
  if (typeof source !== "string") {
    return "";
  }
  const value: string = source.trim();
  return DISCOVERY_SOURCE_LABELS.get(value.toLowerCase()) || value;
}

/*
 * A message queue, topic or subscription - a "destination" in OpenTelemetry
 * terms - of any broker: Kafka, RabbitMQ, ActiveMQ / JMS, Amazon SQS / SNS,
 * Google Pub/Sub, Azure Service Bus / Event Hubs / Event Grid, Pulsar,
 * RocketMQ, NATS, BullMQ and the long tail (Types/MessageQueue/MessagingSystem).
 *
 * Not called `Queue`: Server/Infrastructure/Queue.ts is the BullMQ job
 * queue every worker imports. The display names are still "Queue" /
 * "Queues".
 *
 * Rows come from three sources (discoverySource, first creator wins): the
 * discovery step of the service-dependency job, from messaging spans
 * ("traces") and from broker metrics ("broker-metrics"), both writing as
 * root; and a person adding one ("manual").
 *
 * IDENTITY is queueIdentifier - `${system}|${brokerScope}|${destination}`,
 * canonical (Types/MessageQueue/MessageQueueIdentity) and keyed on the
 * system's identity FAMILY, so the JMS spans of a Java client and the JMX
 * Scraper metrics of its ActiveMQ broker are one queue (`jms||orders`).
 * messagingSystem keeps the SPECIFIC system, refined within the family as
 * evidence arrives (jms -> activemq, never back). Telemetry is selected by
 * the entity key built from the parsed identifier (keyForMessageQueue),
 * never by a column here.
 *
 * COLUMN ACCESS: DatabaseService.create runs onBeforeCreate BEFORE the column
 * permission check, so every column MessageQueueService.onBeforeCreate sets
 * during a manual (non-root) create - name, description, queueIdentifier,
 * messagingSystem, destinationName, brokerScope, discoverySource - carries
 * create permission for the table's create roles, or a manual create is
 * refused with "User is not allowed to Create on <column>". Columns only
 * discovery writes are create: [] and update: [].
 */
@AccessControlColumn("labels")
@EnableDocumentation()
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.CreateMessageQueue,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.SettingsViewer,
    Permission.ReadMessageQueue,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.DeleteMessageQueue,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.EditMessageQueue,
  ],
})
@CrudApiEndpoint(new Route("/message-queue"))
@SlugifyColumn("name", "slug")
/*
 * DB-level identity guard. Discovery find-or-creates by queueIdentifier, and
 * two worker runs (or a run and a person) can race on the same queue - only
 * this index collapses them into one row; the loser re-reads the winner.
 * Named and partial (live rows only), declared here by name for the same
 * reason as IDX_message_queue_slug. The display name is deliberately NOT
 * unique: "orders" in Kafka and "orders" in RabbitMQ are two queues.
 */
@Index("IDX_message_queue_identifier", ["projectId", "queueIdentifier"], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
@Index(["projectId", "isArchived"])
@Index(["projectId", "messagingSystem"])
/*
 * Named for the same reason as IDX_database_server_slug: TypeORM's schema
 * builder matches database indexes to entity metadata by name and drops every
 * one it cannot find, so a partial unique index must be declared here, by
 * name, to survive the next generated migration.
 */
@Index("IDX_message_queue_slug", ["slug"], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
@TableMetadata({
  tableName: "MessageQueue",
  singularName: "Queue",
  pluralName: "Queues",
  icon: IconProp.QueueList,
  tableDescription:
    "Message queues, topics and subscriptions this project's applications publish to and consume from. Each queue is discovered from the OpenTelemetry messaging spans of instrumented applications and from broker metrics sent by an OpenTelemetry Collector, or added manually.",
})
@Entity({
  name: "MessageQueue",
})
export default class MessageQueue extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateMessageQueue,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadMessageQueue,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to Project Resource in which this object belongs",
  })
  @ManyToOne(
    () => {
      return Project;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "projectId" })
  public project?: Project = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateMessageQueue,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadMessageQueue,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of your OneUptime Project in which this object belongs",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  /*
   * Display name only - identity lives in queueIdentifier. Discovered rows are
   * named after their destination as applications spell it
   * (buildMessageQueueDisplayName: clamped to this column with a trailing
   * "…"). The auto-archive sweep reads a name that no longer matches that
   * form as a person's rename, which counts as investment.
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateMessageQueue,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadMessageQueue,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditMessageQueue,
    ],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description:
      "Name of this queue. Discovered queues are named after their destination, e.g. orders.created. Not unique - two brokers may each have a queue of the same name. Rename freely.",
    example: "orders.created",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadMessageQueue,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    unique: true,
    type: TableColumnType.Slug,
    computed: true,
    title: "Slug",
    description: "Friendly globally unique name for your object",
  })
  @Column({
    nullable: false,
    type: ColumnType.Slug,
    length: ColumnLength.Slug,
  })
  public slug?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateMessageQueue,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadMessageQueue,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditMessageQueue,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    title: "Description",
    description: "Friendly description for this queue",
    example: "Order events from checkout to fulfilment",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

  /*
   * Creatable, never updatable - see the identical note on
   * DatabaseServer.databaseIdentifier. For a manual create
   * MessageQueueService.onBeforeCreate computes it from messagingSystem,
   * brokerScope and destinationName, which is exactly why it must stay
   * user-creatable: the column permission check runs after that hook.
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateMessageQueue,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadMessageQueue,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    title: "Queue Identifier",
    description:
      "Stable identity of this queue within the project: the messaging system's identity family, the broker scope (the Azure Service Bus / Event Hubs namespace, empty for every other system) and the destination, canonicalized and joined with '|' (e.g. kafka||orders.created, servicebus|orders-prod|orders). An ActiveMQ queue keys as jms, like the JMS clients that use it, so both are one queue. Computed by the server for manually added queues.",
    example: "kafka||orders.created",
  })
  @Column({
    nullable: false,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public queueIdentifier?: string = undefined;

  /*
   * The SPECIFIC system (activemq, not its jms family), as the OpenTelemetry
   * messaging.system value. Creatable (a manual create sets it) but never
   * user-updatable: discovery refines it within its family as evidence
   * arrives (MessageQueueService.findOrCreateByIdentity), writing as root.
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateMessageQueue,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadMessageQueue,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Messaging System",
    description:
      "The broker this queue lives on, as an OpenTelemetry messaging.system value, e.g. kafka, rabbitmq, activemq, jms, aws_sqs, aws.sns, gcp_pubsub, servicebus, eventhubs, pulsar, rocketmq, nats or bullmq. A queue first seen through JMS is refined to its broker (activemq) once that broker's metrics are seen.",
    example: "kafka",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public messagingSystem?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateMessageQueue,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadMessageQueue,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    title: "Destination Name",
    description:
      "The queue, topic or subscription name as applications and the broker name it (the OpenTelemetry messaging.destination.name value), normalized the way discovery normalizes it: an SQS queue URL or an SNS topic ARN becomes its name, a Pub/Sub resource path its id, a Pulsar short name its persistent://public/default/ topic, and each UUID {uuid}.",
    example: "orders.created",
  })
  @Column({
    nullable: false,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public destinationName?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateMessageQueue,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadMessageQueue,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Broker Scope",
    description:
      "The Azure Service Bus or Event Hubs namespace this queue lives in, lowercased (the first part of <namespace>.servicebus.windows.net). Part of the queue's identity, because two namespaces can each hold a queue of the same name. Empty for every other messaging system.",
    example: "orders-prod",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public brokerScope?: string = undefined;

  // Display only - never identity (a Kafka topic is reached at many brokers).
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadMessageQueue,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Broker Address",
    description:
      "The broker address (host[:port]) last reported for this queue by its telemetry, with any credentials removed. Display only - it is not part of the queue's identity.",
    example: "kafka-1.internal:9092",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public brokerAddress?: string = undefined;

  /*
   * Which path created the row: traces, broker-metrics or manual
   * (MessageQueueDiscoverySource). First creator wins; it is never
   * overwritten. Creatable because onBeforeCreate stamps "manual".
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateMessageQueue,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadMessageQueue,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Discovery Source",
    description:
      "How this queue was first discovered: traces (messaging spans of instrumented applications), broker-metrics (the broker's own metrics) or manual.",
    example: "traces",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public discoverySource?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadMessageQueue,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    title: "Last Seen At",
    description:
      "When this queue was last seen by any discovery source - application messaging spans or broker metrics.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public lastSeenAt?: Date = undefined;

  /*
   * Broker-metrics liveness ONLY: application spans keep lastSeenAt fresh,
   * which must not hide a broker whose metrics stopped arriving.
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadMessageQueue,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Broker Metrics Last Seen At",
    description:
      "When the broker's own metrics for this queue (backlog, lag, dead letters, ...) were last received. Empty when they never were.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public brokerMetricsLastSeenAt?: Date = undefined;

  /*
   * Set only by the auto-archive sweep (MessageQueue:CleanupStaleResources) and
   * cleared when the queue is seen again. It is what lets discovery un-archive
   * a row it archived itself while never touching one a person archived.
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadMessageQueue,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Auto Archived At",
    description:
      "When this queue was archived automatically because no discovery source had seen it for a while. Empty when it was archived by a person or is not archived.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public autoArchivedAt?: Date = undefined;

  /*
   * Set when a PERSON restores the row from the archive (a hooked update to
   * isArchived=false), cleared when a person archives it. The auto-archive
   * sweep leaves such a row alone until discovery sees it again or a long
   * grace period passes - otherwise a Restore of a stale discovered queue
   * would be undone by the next five-minute sweep.
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadMessageQueue,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Manually Restored At",
    description:
      "When a person last restored this queue from the archive. Automatic archiving leaves it alone until it is seen again or a grace period passes.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public manuallyRestoredAt?: Date = undefined;

  /*
   * The labels and owners that rules attached to this row on their own
   * ({ labelIds, ownerUserIds, ownerTeamIds }, ids as lowercase strings).
   * The auto-archive sweep counts only the OTHER labels and owners as a sign
   * that somebody cares about the row, so a catch-all label or owner rule
   * cannot keep every discovered queue alive forever. A person adding one of
   * these labels or owners again takes it off the list.
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadMessageQueue,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Automatic Assignments",
    description:
      "Label and owner ids that label rules or owner rules attached automatically. Maintained by OneUptime.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public automaticAssignments?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateMessageQueue,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadMessageQueue,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created by User",
    description:
      "Relation to User who created this object (if this object was created by a User)",
  })
  @ManyToOne(
    () => {
      return User;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "createdByUserId" })
  public createdByUser?: User = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateMessageQueue,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadMessageQueue,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description:
      "User ID who created this object (if this object was created by a User)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateMessageQueue,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadMessageQueue,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditMessageQueue,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Boolean,
    title: "Is Archived",
    description:
      "Is this queue archived? Archived queues are hidden from lists but their telemetry is still collected.",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isArchived?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadMessageQueue,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Archived At",
    description: "When was this queue archived?",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public archivedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadMessageQueue,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "archivedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Archived by User",
    description:
      "Relation to User who archived this object (if this object was archived by a User)",
  })
  @ManyToOne(
    () => {
      return User;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "archivedByUserId" })
  public archivedByUser?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadMessageQueue,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Archived by User ID",
    description:
      "User ID who archived this object (if this object was archived by a User)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public archivedByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadMessageQueue,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    title: "Deleted by User",
    modelType: User,
    description:
      "Relation to User who deleted this object (if this object was deleted by a User)",
  })
  @ManyToOne(
    () => {
      return User;
    },
    {
      cascade: false,
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "deletedByUserId" })
  public deletedByUser?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadMessageQueue,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted by User ID",
    description:
      "User ID who deleted this object (if this object was deleted by a User)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateMessageQueue,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadMessageQueue,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditMessageQueue,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Label,
    title: "Labels",
    description:
      "Relation to Labels Array where this object is categorized in.",
  })
  @ManyToMany(
    () => {
      return Label;
    },
    { eager: false },
  )
  @JoinTable({
    name: "MessageQueueLabel",
    inverseJoinColumn: {
      name: "labelId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "messageQueueId",
      referencedColumnName: "_id",
    },
  })
  public labels?: Array<Label> = undefined;
}
