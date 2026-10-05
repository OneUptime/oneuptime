import ProjectReferencesService from "./ProjectReferencesService";
import MessageQueueLabelRuleEngineService from "./MessageQueueLabelRuleEngineService";
import MessageQueueOwnerRuleEngineService from "./MessageQueueOwnerRuleEngineService";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Model, {
  MessageQueueDiscoverySource,
  MessageQueueSightingSource,
} from "../../Models/DatabaseModels/MessageQueue";
import DatabaseConfig from "../DatabaseConfig";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import ModelPermission from "../Types/Database/Permissions/Index";
import Select from "../Types/Database/Select";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import {
  truncateLongText,
  truncateShortText,
} from "../Utils/Database/TruncateColumnValue";
import InProcessMemo from "../Utils/InProcessMemo";
import logger, { LogAttributes } from "../Utils/Logger";
import ResourceFeedUtil from "../Utils/ResourceFeed/ResourceFeedUtil";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ResourceHeartbeat from "../Utils/Telemetry/ResourceHeartbeat";
import URL from "../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PartialEntity from "../../Types/Database/PartialEntity";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import {
  MESSAGE_QUEUE_DISPLAY_NAME_MAX_LENGTH,
  MessageQueueIdentity,
  buildMessageQueueDisplayName,
  buildMessageQueueIdentifier,
  hasControlCharacter,
  toMessageQueueIdentity,
} from "../../Types/MessageQueue/MessageQueueIdentity";
import {
  ManualMessageQueue,
  quoteManualMessageQueueInput,
  resolveManualMessageQueue,
} from "../../Types/MessageQueue/MessageQueueManualIdentity";
import {
  getMessagingIdentitySystem,
  getMessagingSystemDisplayName,
  getMoreSpecificMessagingSystem,
  normalizeMessagingSystem,
} from "../../Types/MessageQueue/MessagingSystem";
import ObjectID from "../../Types/ObjectID";
import { canonicalizeEntityValue } from "../../Utils/Telemetry/EntityKey";
import crypto from "crypto";

/*
 * Two sightings, two namespaces: a queue named in an application's spans is a
 * different fact from the broker reporting on it, and one must never be able
 * to suppress the other inside a window - brokerMetricsLastSeenAt would stop
 * moving while spans keep arriving.
 */
const TRACE_SIGHTING_CACHE_NAMESPACE: string = "message-queue-trace-sighting";
const BROKER_METRICS_SIGHTING_CACHE_NAMESPACE: string =
  "message-queue-broker-metrics-sighting";
const SIGHTING_THROTTLE_SECONDS: number = 60;

const DEFAULT_AUTO_ARCHIVE_DAYS: number = 7;
const MIN_AUTO_ARCHIVE_DAYS: number = 1;
// Rows archived per sweep; the rest wait for the next five-minute run.
const AUTO_ARCHIVE_BATCH_SIZE: number = 500;

/*
 * A person's Restore holds the sweep off this long (or the archive window,
 * if that is longer) unless discovery sees the queue again first.
 */
const MANUAL_RESTORE_GRACE_DAYS: number = 30;

const DEFAULT_AUTO_CREATE_BUDGET: number = 500;

/*
 * The auto-create budget as the discovery path reads it: one count per
 * project per minute per process, bumped locally by every create in
 * between, so a burst of new destinations stops at the budget instead of a
 * minute's worth past it.
 */
const AUTO_CREATE_BUDGET_CACHE_MS: number = 60 * 1000;
// One "budget reached" warning per project per ten minutes per process.
const AUTO_CREATE_BUDGET_WARNING_MS: number = 10 * 60 * 1000;

const MANUAL_DISCOVERY_SOURCE: MessageQueueDiscoverySource = "manual";

/*
 * The columns discovery reads back: enough to key telemetry (id, project,
 * identifier), name it, refine its system and decide on archive handling.
 */
const DISCOVERY_SELECT: Select<Model> = {
  _id: true,
  projectId: true,
  name: true,
  queueIdentifier: true,
  messagingSystem: true,
  destinationName: true,
  brokerScope: true,
  discoverySource: true,
  isArchived: true,
  autoArchivedAt: true,
};

/*
 * A discovered row's name as discovery wrote it (buildMessageQueueDisplayName
 * of its destinationName): the destination itself, or - past the name
 * column's width - its first characters, trailing spaces trimmed, and "…".
 * A person renaming a queue is investing in it; this is how the sweep tells.
 * Postgres counts code points and trims only spaces where the TypeScript
 * counts UTF-16 units and trims any whitespace, so a long destination full
 * of astral characters can read as renamed - never archived - which is the
 * safe side to err on.
 */
const DISCOVERY_NAMED_PREDICATE: string = `(mq."name" = mq."destinationName"
            OR (
              char_length(mq."destinationName") > ${MESSAGE_QUEUE_DISPLAY_NAME_MAX_LENGTH}
              AND mq."name" = rtrim(left(mq."destinationName", ${
                MESSAGE_QUEUE_DISPLAY_NAME_MAX_LENGTH - 1
              })) || '…'
            ))`;

/*
 * "Nobody invested in this row", as one SQL predicate over `mq` (a
 * MessageQueue row): no description, still the name discovery gave it, and
 * no label or owner a person added - each checked against the row's own
 * project and live rows only. Labels and owners that rules attached on
 * their own (automaticAssignments) do not count: a catch-all rule would
 * otherwise keep every discovered queue alive forever.
 */
const UNTOUCHED_MESSAGE_QUEUE_PREDICATE: string = `(mq."description" IS NULL OR btrim(mq."description") = '')
            AND ${DISCOVERY_NAMED_PREDICATE}
            AND NOT EXISTS (
              SELECT 1 FROM "MessageQueueLabel" l
              INNER JOIN "Label" lbl ON lbl."_id" = l."labelId"
              WHERE l."messageQueueId" = mq."_id"
                AND lbl."projectId" = mq."projectId"
                AND lbl."deletedAt" IS NULL
                AND NOT (COALESCE(mq."automaticAssignments" -> 'labelIds', '[]'::jsonb) @> jsonb_build_array(l."labelId"::text))
            )
            AND NOT EXISTS (
              SELECT 1 FROM "MessageQueueOwnerUser" ou
              WHERE ou."messageQueueId" = mq."_id"
                AND ou."projectId" = mq."projectId"
                AND ou."deletedAt" IS NULL
                AND NOT (COALESCE(mq."automaticAssignments" -> 'ownerUserIds', '[]'::jsonb) @> jsonb_build_array(ou."userId"::text))
            )
            AND NOT EXISTS (
              SELECT 1 FROM "MessageQueueOwnerTeam" ot
              WHERE ot."messageQueueId" = mq."_id"
                AND ot."projectId" = mq."projectId"
                AND ot."deletedAt" IS NULL
                AND NOT (COALESCE(mq."automaticAssignments" -> 'ownerTeamIds', '[]'::jsonb) @> jsonb_build_array(ot."teamId"::text))
            )`;

/*
 * The labels and owners rules attach on their own, recorded per row in
 * MessageQueue.automaticAssignments under these keys.
 */
export type MessageQueueAutomaticAssignmentKind =
  | "labelIds"
  | "ownerUserIds"
  | "ownerTeamIds";

const AUTOMATIC_ASSIGNMENT_KINDS: ReadonlyArray<MessageQueueAutomaticAssignmentKind> =
  ["labelIds", "ownerUserIds", "ownerTeamIds"];

export interface FindOrCreateMessageQueueByIdentityData {
  projectId: ObjectID;
  /*
   * The canonical identity (toMessageQueueIdentity): keyed on the system's
   * identity FAMILY - an ActiveMQ queue's identity says "jms".
   */
  identity: MessageQueueIdentity;
  /*
   * The sighting's SPECIFIC canonical system ("activemq" while
   * identity.system is the "jms" family). A new row stores it; an existing
   * row is refined to it when it is more specific within the family.
   */
  system: string;
  // The destination for display, as the sighting spells it (original casing).
  destination: string;
  // Display only; a new row starts with it, later sightings go through recordSighting.
  brokerAddress?: string | null | undefined;
  source: MessageQueueSightingSource;
  // False: only an existing row is returned (and sighted) - nothing is created.
  allowCreate: boolean;
}

export interface MessageQueueFindOrCreateResult {
  queue: Model | null;
  // True only for the call whose insert won: it ran the rule engines.
  created: boolean;
}

export interface RecordMessageQueueSightingData {
  projectId: ObjectID;
  queueId: ObjectID;
  source: MessageQueueSightingSource;
  brokerAddress?: string | null | undefined;
  /*
   * Broker metrics only: when the newest datapoint the pass saw was taken,
   * stored as brokerMetricsLastSeenAt. Defaults to now, never later than
   * now. lastSeenAt is always the time of the call (see recordSighting).
   */
  at?: Date | undefined;
}

interface AutoCreateCount {
  count: number;
  readAtMs: number;
}

/*
 * A manual create's identity. The create form previews it in the browser,
 * so it is resolved in Common/Types/MessageQueue (MessageQueueManualIdentity)
 * and re-exported here, where the service's callers have always found it.
 */
export type { ManualMessageQueue };
export { resolveManualMessageQueue };

/*
 * The Queues product's root service. A MessageQueue row is found and created
 * by IDENTITY (queueIdentifier - system family, Azure namespace and
 * destination, canonical), never by name: "orders" can be a Kafka topic and
 * a RabbitMQ queue, and a person can rename any row.
 *
 * Invariants every discovery path relies on:
 *   - the (projectId, queueIdentifier) unique index is the only arbiter of a
 *     race: the loser of an insert re-reads the winner's row, and only the
 *     winner runs the rule engines;
 *   - a row's messagingSystem stays inside the identity family its
 *     identifier names, and only ever becomes more specific (jms ->
 *     activemq, never back);
 *   - discovery only ever un-archives a row it archived itself
 *     (autoArchivedAt), never one a person archived;
 *   - discovery stops creating rows once a project holds
 *     getAutoCreateBudget() live, non-archived discovered queues.
 */
export class Service extends ProjectReferencesService<Model> {
  // Per project: its auto-created row count, as last read.
  private autoCreateCountMemo: InProcessMemo<AutoCreateCount> =
    new InProcessMemo<AutoCreateCount>({
      ttlInMs: AUTO_CREATE_BUDGET_CACHE_MS,
      maxEntries: 10_000,
    });

  // Per project: a "budget reached" warning was logged recently.
  private autoCreateBudgetWarningMemo: InProcessMemo<boolean> =
    new InProcessMemo<boolean>({
      ttlInMs: AUTO_CREATE_BUDGET_WARNING_MS,
      maxEntries: 10_000,
    });

  public constructor() {
    super(Model);
  }

  // Its refusals name what it looks up: the create permission comes first.
  protected override checksCreatePermissionFirst(): boolean {
    return true;
  }

  /*
   * A person adding a queue from the dashboard or the API. Root creates -
   * discovery - pass through untouched: they compute identity themselves.
   *
   * Everything set here is a user-creatable column on the model (name,
   * messagingSystem, destinationName, brokerScope, queueIdentifier,
   * discoverySource), because the column permission check runs after this
   * hook. Setting a root-only column here would refuse every manual create.
   *
   * The create permission is checked FIRST, before any lookup: the refusal
   * for a duplicate names a queue, and a caller who may not add a queue must
   * not be able to use it to learn what exists.
   *
   * The typed system and destination go through the same normalization
   * discovery applies (resolveManualMessageQueue), so the row keys the same
   * identity the queue's own telemetry builds - an SQS queue URL is keyed by
   * its name, a Pulsar short name by its persistent:// topic, a RabbitMQ
   * queue by its whole name, as its broker's metrics key it.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    if (createBy.props.isRoot) {
      return { createBy: createBy, carryForward: null };
    }

    const data: Model = createBy.data;

    ModelPermission.checkCreatePermissions(Model, data, createBy.props);

    // The tenant column is stamped from props.tenantId only after this hook.
    const projectId: ObjectID | undefined =
      createBy.props.tenantId || data.projectId || undefined;

    if (!projectId) {
      throw new BadDataException("Project ID is required to add a queue.");
    }

    const manual: ManualMessageQueue = resolveManualMessageQueue({
      messagingSystem: data.messagingSystem,
      destinationName: data.destinationName,
      brokerScope: data.brokerScope,
    });

    /*
     * The unique index would otherwise answer a duplicate with a raw
     * constraint error.
     */
    const sameIdentity: Model | null = await this.findOneBy({
      query: {
        projectId: projectId,
        queueIdentifier: manual.queueIdentifier,
      },
      select: {
        _id: true,
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (sameIdentity) {
      // Named only when the caller may read it.
      const sameIdentityName: string = sameIdentity.id
        ? await this.getMessageQueueNameIfReadable({
            messageQueueId: sameIdentity.id,
            props: createBy.props,
          })
        : "";

      throw new BadDataException(
        `The ${getMessagingSystemDisplayName(
          manual.system,
        )} queue ${quoteManualMessageQueueInput(manual.destination)}${
          manual.brokerScope
            ? ` in the ${quoteManualMessageQueueInput(
                manual.brokerScope,
              )} namespace`
            : ""
        } already exists${sameIdentityName ? `: "${sameIdentityName}"` : ""}.`,
      );
    }

    const name: string = typeof data.name === "string" ? data.name.trim() : "";

    data.messagingSystem = manual.system;
    data.destinationName = manual.destination;
    if (manual.brokerScope) {
      data.brokerScope = manual.brokerScope;
    } else {
      delete data.brokerScope;
    }
    data.queueIdentifier = manual.queueIdentifier;
    // First creator wins, and a person creating it is "manual" - whatever was sent.
    data.discoverySource = MANUAL_DISCOVERY_SOURCE;
    data.name =
      name || buildMessageQueueDisplayName({ destination: manual.destination });

    return { createBy: createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    this.runCreatedSideEffects(createdItem);

    return createdItem;
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const updateData: JSONObject = onUpdate.updateBy
      .data as unknown as JSONObject;

    /*
     * A person archiving or restoring a row takes it out of discovery's
     * hands: from now on only a person restores it. A person's Restore also
     * holds off the auto-archive sweep (manuallyRestoredAt), which would
     * otherwise re-archive a stale row within minutes. Discovery's own
     * archive and restore are raw writes, so they never reach this hook.
     */
    if (
      ResourceFeedUtil.isArchiveChange(updateData) &&
      !("autoArchivedAt" in updateData)
    ) {
      await this.recordArchiveDecisionByPerson(
        updatedItemIds,
        !updateData["isArchived"],
      );
    }

    /*
     * Labels a person saves on a row are theirs, whichever rule first
     * attached them: they now count as investment.
     */
    if ("labels" in updateData) {
      const labelIds: Array<string> = readRelationIds(updateData["labels"]);

      for (const messageQueueId of updatedItemIds) {
        await this.forgetAutomaticAssignments({
          messageQueueId: messageQueueId,
          kind: "labelIds",
          ids: labelIds,
        });
      }
    }

    return onUpdate;
  }

  /**
   * The queue a sighting names, found by its identity - or, when none exists
   * and creating is allowed, a new one.
   *
   * Lookup first, by (projectId, queueIdentifier) - the identifier built
   * from `identity`, which is canonicalized again here. An existing row is
   * told about the sighting: its messagingSystem is refined to `system` when
   * that is more specific within the row's family (jms -> activemq, never
   * back; getMoreSpecificMessagingSystem), and a row the auto-archive sweep
   * archived is restored - never one a person archived. That happens whether
   * or not creating is allowed.
   *
   * When no row exists: `{ queue: null, created: false }` if `allowCreate` is
   * false, if the identity is invalid, or if the project holds
   * getAutoCreateBudget() live, non-archived discovered queues already (or
   * the count cannot be read - fail closed). Otherwise a row is created as
   * root, without hooks, storing the sighting's SPECIFIC system (a `system`
   * outside the identity's family falls back to the family itself), the
   * display destination, the Azure namespace, the broker address, the
   * discovery source and lastSeenAt (now). brokerMetricsLastSeenAt stays
   * empty: the recordSighting call that follows every find or create sets
   * it to the broker's datapoint time.
   *
   * Races: two writers can both miss the lookup. The unique index lets one
   * insert win; the loser re-reads the winner's row, sights it as above and
   * answers `created: false`. Only the winner runs the label and owner rule
   * engines (fire and forget). A create failure that is not a lost race is
   * thrown.
   */
  @CaptureSpan()
  public async findOrCreateByIdentity(
    data: FindOrCreateMessageQueueByIdentityData,
  ): Promise<MessageQueueFindOrCreateResult> {
    const nothing: MessageQueueFindOrCreateResult = {
      queue: null,
      created: false,
    };

    if (!data || !data.projectId || !data.identity) {
      return nothing;
    }

    const identity: MessageQueueIdentity | null = toMessageQueueIdentity(
      data.identity,
    );
    const queueIdentifier: string | null = identity
      ? buildMessageQueueIdentifier(identity)
      : null;

    if (!identity || !queueIdentifier) {
      return nothing;
    }

    const system: string = getSightingSystem(data.system, identity);

    const existing: Model | null = await this.findByQueueIdentifier(
      data.projectId,
      queueIdentifier,
    );

    if (existing) {
      await this.recordIdentitySighting(existing, system);
      return { queue: existing, created: false };
    }

    if (!data.allowCreate) {
      return nothing;
    }

    if (!(await this.allowsAutoCreate(data.projectId, queueIdentifier))) {
      return nothing;
    }

    const source: MessageQueueSightingSource =
      data.source === "broker-metrics" ? "broker-metrics" : "traces";
    const now: Date = OneUptimeDate.getCurrentDate();
    const destination: string = getDisplayDestination(
      data.destination,
      identity,
    );

    const newRow: Model = new Model();
    newRow.projectId = data.projectId;
    newRow.name = truncateShortText(
      buildMessageQueueDisplayName({ destination: destination }),
    );
    newRow.queueIdentifier = queueIdentifier;
    newRow.messagingSystem = truncateShortText(system);
    newRow.destinationName = truncateLongText(destination);
    if (identity.brokerScope) {
      newRow.brokerScope = truncateShortText(identity.brokerScope);
    }
    const brokerAddress: string | null = cleanBrokerAddress(data.brokerAddress);
    if (brokerAddress) {
      newRow.brokerAddress = brokerAddress;
    }
    newRow.discoverySource = source;
    /*
     * No brokerMetricsLastSeenAt: only the broker-metrics sighting knows when
     * the newest datapoint was taken (recordSighting, its only writer).
     * Stamped now, it would move back to that older time moments later.
     */
    newRow.lastSeenAt = now;

    let created: Model;

    try {
      /*
       * Without hooks: the rule engines run below, and only for the insert
       * that won - a racing writer's loser never reaches them.
       */
      created = await this.create({
        data: newRow,
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });
    } catch (error) {
      // The same identity created by a racing writer.
      const winner: Model | null = await this.findByQueueIdentifier(
        data.projectId,
        queueIdentifier,
      );

      if (!winner) {
        throw error;
      }

      await this.recordIdentitySighting(winner, system);
      return { queue: winner, created: false };
    }

    this.noteAutoCreated(data.projectId);
    this.runCreatedSideEffects(created);

    return { queue: created, created: true };
  }

  /**
   * Liveness: a queue was seen - in application spans (`traces`) or in the
   * broker's own metrics (`broker-metrics`). One gated, non-blocking
   * ResourceHeartbeat write per queue per source per window: lastSeenAt
   * always, brokerMetricsLastSeenAt too for broker metrics, and the broker
   * address (sanitized, clamped) only when it is non-empty and has changed
   * since this source last wrote one. The two sources use separate cache
   * namespaces, so neither can suppress the other.
   *
   * lastSeenAt is when discovery saw the queue - now - whichever source saw
   * it, as DatabaseServerService.recordSighting writes it. Both sources
   * write it, one after the other in every pass, each a plain SET, and
   * their newest data can be minutes apart (Azure Monitor, CloudWatch and
   * Cloud Monitoring deliver datapoints late; a source can also stop). A
   * datapoint's own time from whichever source wrote last would move the
   * column back behind the other's sighting - and a new row's behind its
   * own creation.
   *
   * brokerMetricsLastSeenAt is `at`: when the newest broker datapoint the
   * pass saw was taken (default now; a future or invalid value is read as
   * now). Broker-metrics sightings are its only writer, and each pass's
   * window ends later than the last one's, so it only moves forward.
   * findOrCreateByIdentity leaves it empty on a new row: call this for
   * every sighted row, created or found. A traces sighting ignores `at`.
   *
   * It restores nothing: findOrCreateByIdentity, which every discovery pass
   * calls first, is what brings an auto-archived queue back.
   */
  @CaptureSpan()
  public async recordSighting(
    data: RecordMessageQueueSightingData,
  ): Promise<void> {
    if (!data || !data.queueId) {
      return;
    }

    const isBrokerMetrics: boolean = data.source === "broker-metrics";
    const now: Date = OneUptimeDate.getCurrentDate();

    const liveness: PartialEntity<Model> = {
      lastSeenAt: now,
    };

    if (isBrokerMetrics) {
      liveness.brokerMetricsLastSeenAt = getSightingTime(data.at, now);
    }

    const metadata: PartialEntity<Model> = {};
    const brokerAddress: string | null = cleanBrokerAddress(data.brokerAddress);

    if (brokerAddress) {
      metadata.brokerAddress = brokerAddress;
    }

    await ResourceHeartbeat.write({
      service: this,
      id: data.queueId,
      cacheNamespace: isBrokerMetrics
        ? BROKER_METRICS_SIGHTING_CACHE_NAMESPACE
        : TRACE_SIGHTING_CACHE_NAMESPACE,
      throttleInSeconds: SIGHTING_THROTTLE_SECONDS,
      liveness: liveness,
      metadata: metadata,
      fingerprint: brokerAddress
        ? crypto.createHash("sha256").update(brokerAddress).digest("hex")
        : "",
      describe: `queue ${data.queueId.toString()} (${
        isBrokerMetrics ? "broker-metrics" : "traces"
      } sighting, project ${data.projectId?.toString() || "unknown"})`,
    });
  }

  /*
   * Days a discovered queue may go unseen before the sweep archives it
   * (MESSAGE_QUEUE_AUTO_ARCHIVE_DAYS). Default 7, at least 1.
   */
  public getAutoArchiveDays(): number {
    return readIntegerEnv({
      name: "MESSAGE_QUEUE_AUTO_ARCHIVE_DAYS",
      defaultValue: DEFAULT_AUTO_ARCHIVE_DAYS,
      min: MIN_AUTO_ARCHIVE_DAYS,
    });
  }

  /**
   * Archive discovered queues nobody has seen - and nobody has touched - for
   * getAutoArchiveDays(). Discovery creates rows on its own, so without this
   * a queue a decommissioned service used, or a per-run topic seen once in a
   * trace, would sit in the list forever.
   *
   * "Untouched" is what makes this safe to do unasked: a manually added
   * queue is never archived, and neither is one somebody invested in - a
   * description, a rename, labels or owners a PERSON added (not the ones
   * rules attached on their own). Every one of those checks is done in SQL,
   * scoped to the row's project and to live rows
   * (UNTOUCHED_MESSAGE_QUEUE_PREDICATE). A row a person restored from the
   * archive is left alone until discovery sees it again or the grace period
   * passes - their Restore must stick.
   *
   * The row is marked autoArchivedAt, which is what lets discovery restore
   * it the moment it is seen again - and never restore one a person
   * archived. At most AUTO_ARCHIVE_BATCH_SIZE rows per run, oldest first,
   * in one statement. Returns how many rows were archived.
   */
  @CaptureSpan()
  public async autoArchiveStaleMessageQueues(): Promise<number> {
    const days: number = this.getAutoArchiveDays();
    const now: Date = OneUptimeDate.getCurrentDate();
    const cutoff: Date = OneUptimeDate.addRemoveDays(now, -days);
    const restoreGraceCutoff: Date = OneUptimeDate.addRemoveDays(
      now,
      -Math.max(MANUAL_RESTORE_GRACE_DAYS, days),
    );

    const archived: unknown = await this.getRepository().manager.query(
      `WITH "candidates" AS (
          SELECT mq."_id"
          FROM "MessageQueue" mq
          WHERE mq."deletedAt" IS NULL
            AND mq."isArchived" = false
            AND mq."discoverySource" IS NOT NULL
            AND mq."discoverySource" <> $3
            AND COALESCE(mq."lastSeenAt", mq."createdAt") < $1
            AND (
              mq."manuallyRestoredAt" IS NULL
              OR mq."manuallyRestoredAt" < $5
              OR COALESCE(mq."lastSeenAt", mq."createdAt") > mq."manuallyRestoredAt"
            )
            AND ${UNTOUCHED_MESSAGE_QUEUE_PREDICATE}
          ORDER BY COALESCE(mq."lastSeenAt", mq."createdAt") ASC
          LIMIT $4
        ),
        "archived" AS (
          UPDATE "MessageQueue" stale
          SET "isArchived" = true,
            "archivedAt" = $2,
            "autoArchivedAt" = $2,
            "archivedByUserId" = NULL,
            "updatedAt" = CURRENT_TIMESTAMP
          FROM "candidates"
          WHERE stale."_id" = "candidates"."_id"
            AND stale."isArchived" = false
          RETURNING stale."_id" AS "_id", stale."projectId" AS "projectId"
        )
        SELECT "_id", "projectId" FROM "archived"`,
      [
        cutoff,
        now,
        MANUAL_DISCOVERY_SOURCE,
        AUTO_ARCHIVE_BATCH_SIZE,
        restoreGraceCutoff,
      ],
    );

    return Array.isArray(archived) ? archived.length : 0;
  }

  /*
   * How many discovered queues (traces, broker metrics) a project may
   * accumulate before discovery stops creating more on its own
   * (MESSAGE_QUEUE_AUTO_CREATE_BUDGET). Manual rows do not count and are
   * never blocked; archived rows do not count, so the auto-archive sweep
   * frees budget. Default 500, at least 0 (0 turns auto-creation off).
   */
  public getAutoCreateBudget(): number {
    return readIntegerEnv({
      name: "MESSAGE_QUEUE_AUTO_CREATE_BUDGET",
      defaultValue: DEFAULT_AUTO_CREATE_BUDGET,
      min: 0,
    });
  }

  /**
   * True while the project holds fewer live, non-archived discovered queues
   * than getAutoCreateBudget(). Always reads the count.
   */
  @CaptureSpan()
  public async isUnderAutoCreateBudget(projectId: ObjectID): Promise<boolean> {
    const budget: number = this.getAutoCreateBudget();

    if (budget <= 0) {
      return false;
    }

    return (await this.countAutoCreatedMessageQueues(projectId)) < budget;
  }

  /**
   * isUnderAutoCreateBudget as findOrCreateByIdentity asks it: the count is
   * read at most once a minute per project in this process, and every row
   * this process creates in between is added to it, so a burst of new
   * destinations stops at the budget instead of a minute's worth past it.
   */
  @CaptureSpan()
  public async isUnderAutoCreateBudgetCached(
    projectId: ObjectID,
  ): Promise<boolean> {
    const budget: number = this.getAutoCreateBudget();

    if (budget <= 0) {
      return false;
    }

    const key: string = projectId.toString();
    let cached: AutoCreateCount | undefined = this.autoCreateCountMemo.get(key);

    if (!cached) {
      cached = {
        count: await this.countAutoCreatedMessageQueues(projectId),
        readAtMs: Date.now(),
      };
      this.autoCreateCountMemo.set(key, cached);
    }

    return cached.count < budget;
  }

  // Live, non-archived, non-manual rows of one project.
  @CaptureSpan()
  public async countAutoCreatedMessageQueues(
    projectId: ObjectID,
  ): Promise<number> {
    const rows: unknown = await this.getRepository().manager.query(
      `SELECT COUNT(*)::int AS "count"
        FROM "MessageQueue"
        WHERE "projectId" = $1
          AND "deletedAt" IS NULL
          AND "isArchived" = false
          AND COALESCE("discoverySource", '') <> $2`,
      [projectId.toString(), MANUAL_DISCOVERY_SOURCE],
    );

    return readCount(rows);
  }

  /**
   * Display name for this queue, or an empty string when the row is gone.
   * Callers use it on a best-effort basis, so a missing row must not throw.
   */
  @CaptureSpan()
  public async getMessageQueueName(data: {
    messageQueueId: ObjectID;
  }): Promise<string> {
    const messageQueue: Model | null = await this.findOneById({
      id: data.messageQueueId,
      select: {
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    return messageQueue?.name || "";
  }

  /**
   * The queue's name - but only when `props` may read that row (project,
   * label and Owned scopes applied); "" otherwise, or on any error. Refusal
   * messages use it, so a caller with scoped permissions is never told the
   * name of a queue they cannot see. Without props (or as root) the name is
   * read as root.
   */
  @CaptureSpan()
  public async getMessageQueueNameIfReadable(data: {
    messageQueueId: ObjectID;
    props?: DatabaseCommonInteractionProps | undefined;
  }): Promise<string> {
    if (!data.props || data.props.isRoot) {
      return await this.getMessageQueueName({
        messageQueueId: data.messageQueueId,
      });
    }

    try {
      const readable: Model | null = await this.findOneBy({
        query: {
          _id: data.messageQueueId.toString(),
        },
        select: {
          name: true,
        },
        props: data.props,
      });

      return readable?.name || "";
    } catch {
      return "";
    }
  }

  /**
   * Validate the queue a child row (an owner) is created for by a caller:
   * the FK column and the relation object must agree (TypeORM would persist
   * the relation object's id over the column's), and the queue must be in
   * the caller's project. Leaves the validated FK column as the only
   * reference. Root creates are the caller's business.
   */
  @CaptureSpan()
  public async assertMessageQueueReferenceInProject<TModel extends BaseModel>(
    createBy: CreateBy<TModel>,
  ): Promise<ObjectID> {
    const data: TModel = createBy.data;

    const projectId: ObjectID | undefined =
      createBy.props.tenantId ||
      (data.getColumnValue("projectId") as ObjectID | undefined) ||
      undefined;

    if (!projectId) {
      throw new BadDataException("Project ID is required.");
    }

    const messageQueueId: ObjectID | null = RelationIdUtil.readConsistent(
      data as unknown as Record<string, unknown>,
      ["messageQueueId", "messageQueue"],
      "queue",
    );

    data.setColumnValue("messageQueue", undefined);

    if (!messageQueueId) {
      throw new BadDataException("Select a queue.");
    }

    const messageQueue: Model | null = await this.findOneBy({
      query: {
        _id: messageQueueId.toString(),
        projectId: projectId,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!messageQueue) {
      throw new BadDataException("Queue not found.");
    }

    data.setColumnValue("messageQueueId", messageQueueId);

    return messageQueueId;
  }

  /**
   * Record labels or owners that a rule attached to a queue on its own
   * (MessageQueue.automaticAssignments), so the auto-archive sweep does not
   * mistake them for a person's investment. One atomic statement; ids
   * deduped. Never throws - it only annotates a write that happened.
   */
  @CaptureSpan()
  public async recordAutomaticAssignments(data: {
    messageQueueId: ObjectID;
    kind: MessageQueueAutomaticAssignmentKind;
    ids: Array<ObjectID | string>;
  }): Promise<void> {
    const ids: Array<string> = normalizeAssignmentIds(data.ids);

    if (ids.length === 0 || !AUTOMATIC_ASSIGNMENT_KINDS.includes(data.kind)) {
      return;
    }

    try {
      await this.getRepository().manager.query(
        `UPDATE "MessageQueue"
        SET "automaticAssignments" =
          (CASE WHEN jsonb_typeof("automaticAssignments") = 'object' THEN "automaticAssignments" ELSE '{}'::jsonb END)
          || jsonb_build_object(
            $2::text,
            (
              SELECT COALESCE(jsonb_agg(DISTINCT assigned.id), '[]'::jsonb)
              FROM jsonb_array_elements_text(
                (CASE WHEN jsonb_typeof("automaticAssignments" -> $2::text) = 'array' THEN "automaticAssignments" -> $2::text ELSE '[]'::jsonb END)
                || $3::jsonb
              ) AS assigned(id)
            )
          )
        WHERE "_id" = $1`,
        [data.messageQueueId.toString(), data.kind, JSON.stringify(ids)],
      );
    } catch (error) {
      logger.warn(
        `MessageQueueService: could not record automatic ${data.kind} on queue ${data.messageQueueId.toString()}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * The opposite of recordAutomaticAssignments: a person (re)added these
   * labels or owners, so from now on they count as investment. Never throws.
   */
  @CaptureSpan()
  public async forgetAutomaticAssignments(data: {
    messageQueueId: ObjectID;
    kind: MessageQueueAutomaticAssignmentKind;
    ids: Array<ObjectID | string>;
  }): Promise<void> {
    const ids: Array<string> = normalizeAssignmentIds(data.ids);

    if (ids.length === 0 || !AUTOMATIC_ASSIGNMENT_KINDS.includes(data.kind)) {
      return;
    }

    try {
      await this.getRepository().manager.query(
        `UPDATE "MessageQueue"
        SET "automaticAssignments" = "automaticAssignments" || jsonb_build_object(
          $2::text,
          (
            SELECT COALESCE(jsonb_agg(assigned.id), '[]'::jsonb)
            FROM jsonb_array_elements_text("automaticAssignments" -> $2::text) AS assigned(id)
            WHERE NOT (assigned.id = ANY($3::text[]))
          )
        )
        WHERE "_id" = $1
          AND jsonb_typeof("automaticAssignments") = 'object'
          AND jsonb_typeof("automaticAssignments" -> $2::text) = 'array'`,
        [data.messageQueueId.toString(), data.kind, ids],
      );
    } catch (error) {
      logger.warn(
        `MessageQueueService: could not forget automatic ${data.kind} on queue ${data.messageQueueId.toString()}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  @CaptureSpan()
  public async getMessageQueueLinkInDashboard(
    projectId: ObjectID,
    messageQueueId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/queues/${messageQueueId.toString()}`,
    );
  }

  // "[Queue orders.created](https://…)" - the form a markdown message names a queue by.
  @CaptureSpan()
  public async getMessageQueueMarkdownLink(
    projectId: ObjectID,
    messageQueueId: ObjectID,
  ): Promise<string> {
    const name: string = await this.getMessageQueueName({
      messageQueueId: messageQueueId,
    });
    const link: URL = await this.getMessageQueueLinkInDashboard(
      projectId,
      messageQueueId,
    );

    return `[Queue ${name}](${link.toString()})`;
  }

  // For tests: forget the cached auto-create counts and budget warnings.
  public clearAutoCreateBudgetMemo(): void {
    this.autoCreateCountMemo.clear();
    this.autoCreateBudgetWarningMemo.clear();
  }

  // One live row by identifier, with the columns discovery reads back.
  private async findByQueueIdentifier(
    projectId: ObjectID,
    queueIdentifier: string,
  ): Promise<Model | null> {
    return await this.findOneBy({
      query: {
        projectId: projectId,
        queueIdentifier: queueIdentifier,
      },
      select: DISCOVERY_SELECT,
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * What a sighting tells the row it names: the system is refined within its
   * family, and a row the sweep archived is restored.
   */
  private async recordIdentitySighting(
    row: Model,
    system: string,
  ): Promise<void> {
    await this.refineMessagingSystem(row, system);
    await this.restoreIfAutoArchived(row);
  }

  /*
   * The more specific system of the row's family (jms -> activemq), written
   * only while the row still says what was read - a compare-and-set, so two
   * sightings cannot interleave - and never outside the family: the
   * identifier (and so the entity key telemetry is joined on) never moves.
   * Never throws: a refinement must not fail the discovery that saw it.
   */
  private async refineMessagingSystem(
    row: Model,
    system: string,
  ): Promise<void> {
    const current: string | undefined = row.messagingSystem;
    const next: string | null = getMoreSpecificMessagingSystem(current, system);

    if (!next || next === current || !row.id || !row.projectId) {
      return;
    }

    try {
      const refined: unknown = await this.getRepository().manager.query(
        `WITH "refined" AS (
          UPDATE "MessageQueue"
          SET "messagingSystem" = $1,
            "updatedAt" = CURRENT_TIMESTAMP
          WHERE "_id" = $2
            AND "projectId" = $3
            AND "deletedAt" IS NULL
            AND "messagingSystem" IS NOT DISTINCT FROM $4
          RETURNING "_id"
        )
        SELECT "_id" FROM "refined"`,
        [
          truncateShortText(next),
          row.id.toString(),
          row.projectId.toString(),
          current === undefined ? null : current,
        ],
      );

      if (Array.isArray(refined) && refined.length > 0) {
        row.messagingSystem = next;
      }
    } catch (error) {
      logger.warn(
        `MessageQueueService: could not refine the messaging system of queue ${row.id.toString()} to ${next}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { projectId: row.projectId.toString() } as LogAttributes,
      );
    }
  }

  /*
   * Restore a row the auto-archive sweep archived, now that it was seen
   * again. The conditions live in the UPDATE itself, so a row a person
   * archived (autoArchivedAt cleared - see onUpdateSuccess) or a row a person
   * restored in the meantime is never touched. Never throws: a restore must
   * not fail the discovery that triggered it.
   */
  private async restoreIfAutoArchived(row: Model): Promise<boolean> {
    if (!row.isArchived || !row.autoArchivedAt || !row.id || !row.projectId) {
      return false;
    }

    try {
      const restored: unknown = await this.getRepository().manager.query(
        `WITH "restored" AS (
            UPDATE "MessageQueue"
            SET "isArchived" = false,
              "archivedAt" = NULL,
              "archivedByUserId" = NULL,
              "autoArchivedAt" = NULL,
              "updatedAt" = CURRENT_TIMESTAMP
            WHERE "_id" = $1
              AND "projectId" = $2
              AND "isArchived" = true
              AND "autoArchivedAt" IS NOT NULL
              AND "deletedAt" IS NULL
            RETURNING "_id"
          )
          SELECT "_id" FROM "restored"`,
        [row.id.toString(), row.projectId.toString()],
      );

      /*
       * Nothing matched: a person restored it, or archived it themselves, in
       * the meantime. Their state stands - the in-memory row is left as read.
       */
      if (!Array.isArray(restored) || restored.length === 0) {
        return false;
      }

      row.isArchived = false;
      delete row.autoArchivedAt;

      return true;
    } catch (error) {
      logger.warn(
        `MessageQueueService: could not restore auto-archived queue ${row.id.toString()}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { projectId: row.projectId.toString() } as LogAttributes,
      );

      return false;
    }
  }

  /*
   * A person archived (restored = false) or restored a row: it is no longer
   * discovery's archive (autoArchivedAt cleared), and a restore is stamped
   * so the sweep leaves the row alone until it is seen again or the grace
   * period passes (manuallyRestoredAt; cleared again on an archive).
   */
  private async recordArchiveDecisionByPerson(
    messageQueueIds: Array<ObjectID>,
    restored: boolean,
  ): Promise<void> {
    const now: Date = OneUptimeDate.getCurrentDate();

    for (const messageQueueId of messageQueueIds) {
      try {
        await this.updateColumnsByIdWithoutHooks({
          id: messageQueueId,
          data: {
            autoArchivedAt: null,
            manuallyRestoredAt: restored ? now : null,
          },
          skipUpdateDateColumn: true,
        });
      } catch (error) {
        logger.warn(
          `MessageQueueService: could not record the ${
            restored ? "restore" : "archive"
          } of queue ${messageQueueId.toString()}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  /*
   * The discovery path's budget gate: false when the project has reached its
   * auto-create budget - warned about once per project per ten minutes,
   * since every discovery pass would otherwise repeat it for every new
   * destination - or when the count cannot be read (fail closed).
   */
  private async allowsAutoCreate(
    projectId: ObjectID,
    queueIdentifier: string,
  ): Promise<boolean> {
    let underBudget: boolean = false;

    try {
      underBudget = await this.isUnderAutoCreateBudgetCached(projectId);
    } catch (error) {
      logger.error(
        `MessageQueueService: auto-create budget check failed for project ${projectId.toString()}; not creating queue ${queueIdentifier}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { projectId: projectId.toString() } as LogAttributes,
      );

      return false;
    }

    if (!underBudget) {
      const key: string = projectId.toString();

      if (!this.autoCreateBudgetWarningMemo.get(key)) {
        this.autoCreateBudgetWarningMemo.set(key, true);

        logger.warn(
          `MessageQueueService: project ${key} reached its auto-create budget (MESSAGE_QUEUE_AUTO_CREATE_BUDGET=${this.getAutoCreateBudget()}); not creating queue ${queueIdentifier}, nor any other new queue until the project is under the budget again (this warning repeats at most every ten minutes). Raise the budget, archive or delete queues nobody needs, or add the queue manually.`,
          { projectId: key } as LogAttributes,
        );
      }
    }

    return underBudget;
  }

  // A row was auto-created: count it against the cached budget straight away.
  private noteAutoCreated(projectId: ObjectID): void {
    const key: string = projectId.toString();
    const cached: AutoCreateCount | undefined =
      this.autoCreateCountMemo.get(key);

    if (!cached) {
      return;
    }

    const remainingMs: number =
      cached.readAtMs + AUTO_CREATE_BUDGET_CACHE_MS - Date.now();

    if (remainingMs <= 0) {
      this.autoCreateCountMemo.delete(key);
      return;
    }

    this.autoCreateCountMemo.set(
      key,
      { count: cached.count + 1, readAtMs: cached.readAtMs },
      remainingMs,
    );
  }

  /*
   * Rules run once, on creation only - exact parity with the other resource
   * types. Label engine first: it syncs the in-memory labels so the owner
   * engine can match rule-added labels. Fire and forget: they may not fail
   * the create they follow.
   */
  private runCreatedSideEffects(createdItem: Model): void {
    if (!createdItem.projectId || !createdItem.id) {
      return;
    }

    Promise.resolve()
      .then(async () => {
        await MessageQueueLabelRuleEngineService.applyRulesToMessageQueue(
          createdItem,
        );
      })
      .then(async () => {
        await MessageQueueOwnerRuleEngineService.applyRulesToMessageQueue(
          createdItem,
        );
      })
      .catch((error: Error) => {
        logger.error(
          `Error applying queue rules in MessageQueueService: ${error}`,
          {
            projectId: createdItem.projectId?.toString(),
            messageQueueId: createdItem.id?.toString(),
          } as LogAttributes,
        );
      });
  }
}

/**
 * The values a label or owner rule's messaging system pattern is matched
 * against: the canonical messaging.system value ("kafka") and its display
 * name ("Apache Kafka"), deduped, empty ones dropped - so both `^kafka$`
 * and `Kafka` say "every Kafka topic". An unknown system is matched as
 * stored.
 */
export function getMessagingSystemRuleMatchValues(
  system: unknown,
): Array<string> {
  const raw: string = typeof system === "string" ? system.trim() : "";
  const canonical: string = normalizeMessagingSystem(raw) || raw;
  const values: Array<string> = [];

  for (const value of [canonical, getMessagingSystemDisplayName(canonical)]) {
    if (value && !values.includes(value)) {
      values.push(value);
    }
  }

  return values;
}

/*
 * The system a sighting stores: its own specific system when that belongs
 * to the identity's family (activemq for a jms identity), else the family
 * itself - a row never stores a system outside the family its identifier
 * names.
 */
function getSightingSystem(
  system: unknown,
  identity: MessageQueueIdentity,
): string {
  const specific: string | null = normalizeMessagingSystem(system);

  if (specific && getMessagingIdentitySystem(specific) === identity.system) {
    return specific;
  }

  return identity.system;
}

/*
 * The destination as the sighting spells it, trimmed - when it is the one
 * the identity names; the identity's canonical destination otherwise.
 */
function getDisplayDestination(
  destination: unknown,
  identity: MessageQueueIdentity,
): string {
  const display: string =
    typeof destination === "string" ? destination.trim() : "";

  return display && canonicalizeEntityValue(display) === identity.destination
    ? display
    : identity.destination;
}

/*
 * A broker address as the row may store it: trimmed, clamped to the column,
 * null when blank or when it holds a control character.
 */
function cleanBrokerAddress(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const address: string = value.trim();

  if (!address || hasControlCharacter(address)) {
    return null;
  }

  return truncateLongText(address);
}

/*
 * A broker datapoint's time as a sighting reports it: `now`, unless a valid
 * time no later than `now` was given.
 */
function getSightingTime(at: unknown, now: Date): Date {
  if (!(at instanceof Date) || !Number.isFinite(at.getTime())) {
    return now;
  }

  return at.getTime() > now.getTime() ? now : at;
}

/*
 * A positive-integer env setting: unset or unparseable → the default, below
 * the floor → the floor.
 */
function readIntegerEnv(data: {
  name: string;
  defaultValue: number;
  min: number;
}): number {
  const raw: string | undefined = process.env[data.name];

  if (raw === undefined || raw.trim() === "") {
    return data.defaultValue;
  }

  const parsed: number = Number(raw.trim());

  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return data.defaultValue;
  }

  return Math.max(parsed, data.min);
}

function readCount(rows: unknown): number {
  if (!Array.isArray(rows) || rows.length === 0) {
    return 0;
  }

  const count: number = Number((rows[0] as { count?: unknown })?.count);

  return Number.isFinite(count) ? count : 0;
}

/*
 * The ids in a relation payload (an update's `labels`): model instances,
 * `{ _id }` / `{ id }` objects, ObjectIDs or id strings. Anything else is
 * skipped.
 */
function readRelationIds(value: unknown): Array<string> {
  const ids: Array<string> = [];

  for (const item of Array.isArray(value) ? value : []) {
    let id: unknown = item;

    if (item && typeof item === "object" && !(item instanceof ObjectID)) {
      id =
        (item as { _id?: unknown; id?: unknown })._id ||
        (item as { _id?: unknown; id?: unknown }).id;
    }

    const text: string =
      id instanceof ObjectID || typeof id === "string" ? id.toString() : "";

    if (text) {
      ids.push(text);
    }
  }

  return ids;
}

/*
 * Assignment ids as automaticAssignments stores them: lowercase UUID strings
 * (what Postgres prints for a uuid column), deduped, invalid ones dropped.
 */
function normalizeAssignmentIds(ids: Array<ObjectID | string>): Array<string> {
  const result: Array<string> = [];

  for (const id of Array.isArray(ids) ? ids : []) {
    const text: string = (id ? id.toString() : "").trim().toLowerCase();

    if (text && ObjectID.isValidUUID(text) && !result.includes(text)) {
      result.push(text);
    }
  }

  return result;
}

export default new Service();
