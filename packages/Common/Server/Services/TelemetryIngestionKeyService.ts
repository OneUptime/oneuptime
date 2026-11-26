import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import PayAsYouGoBillingService from "./PayAsYouGoBillingService";
import ProjectService from "./ProjectService";
import { IsBillingEnabled } from "../EnvironmentConfig";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import Model from "../../Models/DatabaseModels/TelemetryIngestionKey";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import InMemoryTTLCache from "../Infrastructure/InMemoryTTLCache";
import CacheGenerations from "../Infrastructure/CacheGenerations";
import BadDataException from "../../Types/Exception/BadDataException";
import ProjectBlockedException from "../../Types/Exception/ProjectBlockedException";
import ColumnLength from "../../Types/Database/ColumnLength";
import TelemetryIngestionKeyPolicy from "../../Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType, {
  readTelemetryIngestionKeyType,
} from "../../Types/Telemetry/TelemetryIngestionKeyType";
import OriginAllowList from "../../Utils/Telemetry/OriginAllowList";
import logger from "../Utils/Logger";
import TelemetryIngestionBudgetValidation, {
  isTelemetryIngestionBudgetColumnTouched,
} from "../Utils/Telemetry/TelemetryIngestionBudgetValidation";
import {
  hasAnyTelemetryIngestionBudgetSetting,
  readTelemetryIngestionBudgetStoredSettings,
  TELEMETRY_INGESTION_BUDGET_COLUMN_NAMES,
  TelemetryIngestionBudgetStoredSettings,
} from "../../Types/Telemetry/TelemetryIngestionBudget";
import { noteTelemetryIngestRefusalKey } from "../Utils/Telemetry/TelemetryIngestRefusalRecorder";
import TelemetryIngestionKeySecretDigest from "../Utils/Telemetry/TelemetryIngestionKeySecretDigest";
import { createHash } from "crypto";

/*
 * How long the lookup by secret (getPolicyFromSecretKey: the HTTP and gRPC
 * ingest paths, and MQTT's CONNECT) keeps a key it read.
 *
 * A key's entry is kept under the key's generation (CacheGenerations), which
 * an update or a delete through this service renews (forgetKeys): the
 * process that made the change reads the key again at once, and every other
 * one within CacheGenerations.SHARED_READ_TTL_MS - a second - through Redis
 * (issue #8370). So turning a leaked key off, resetting its secret or
 * deleting it stops HTTP and gRPC senders on every server within about a
 * second, at the cost of one in-memory generation read per request (Redis is
 * asked at most once per key per second per process, by all the requests
 * that ask together) - never a Postgres read per request.
 *
 * This TTL is the bound for what the generation cannot reach: Redis being
 * down, and a key deleted with its project, which the database does without
 * hooks. A minute: the kill switch, the expiry, the origin allowlist and the
 * rate limit all live in the entry, and paying a Postgres round trip per
 * ingest request to shave even that to zero would cost far more than it
 * buys on a path that runs thousands of times a second.
 */
const POSITIVE_TTL_MS: number = 60 * 1000;
/*
 * Short TTL on misses so an invalid-token flood can't pin entries in the
 * bounded cache for long while still absorbing repeat hits.
 */
const NEGATIVE_TTL_MS: number = 10 * 1000;

/*
 * How long the lookup by secret keeps a key it read for the first time in
 * this process for that secret. Which key a secret opens is only known once
 * the row is read, so the key's generation can only be read after that read,
 * not before it - and a change that landed between the two would be kept
 * under the generation after it. So a first read is kept only this long, and
 * then read again under the generation the key had before that second read:
 * a second, the time a change takes to reach this process through Redis
 * anyway. It costs one more read per key per process, once.
 */
const FIRST_READ_TTL_MS: number = CacheGenerations.SHARED_READ_TTL_MS;

/*
 * How long a process goes by a key's current state before it reads the key
 * again. The state is read by the key's id, for a sender that proved it holds
 * the key's secret once and keeps sending on that proof: an MQTT session,
 * which is checked at CONNECT and may then stay open for weeks
 * (getCurrentPolicyById, issue #8147).
 *
 * An update or a delete through this service starts a new generation of the
 * key (forgetKeys), so this process reads the key again at once, and every
 * other process within CacheGenerations.SHARED_READ_TTL_MS, through Redis.
 * This bound covers what that cannot reach: Redis being down, and a key
 * deleted with its project, which the database does without hooks. It is a
 * few seconds, so turning a leaked key off stops a session that is already
 * open within seconds. It costs one indexed read per connected key per
 * process per window, whatever the publish rate, so the publish path never
 * reads Postgres for each message.
 */
export const CURRENT_STATE_FRESH_MS: number = 5 * 1000;

/*
 * How long a process may keep serving a key's state as it last read it,
 * while reading it again fails (Postgres down, or failing over). A blip must
 * not throw a whole connected fleet off, but a key must not be trusted on an
 * old read for ever either: a minute, the bound every other ingest path's
 * cache holds a key for. Past it, the publish fails.
 */
export const CURRENT_STATE_STALE_GRACE_MS: number = POSITIVE_TTL_MS;

// The Redis namespace of the keys' generations, and how long one is kept.
export const TELEMETRY_INGESTION_KEY_GENERATION_NAMESPACE: string =
  "telemetry-ingestion-key-generation";
const GENERATION_TTL_SECONDS: number = 24 * 60 * 60;

/*
 * How long this process remembers which key a secret opened, by the
 * secret's digest: so the next read of that secret reads the key's
 * generation before it reads the row (FIRST_READ_TTL_MS). As long as a
 * generation is kept: a secret opens one key for as long as it opens any.
 */
const KEY_ID_BY_SECRET_TTL_MS: number = GENERATION_TTL_SECONDS * 1000;

/*
 * How often a single key's lastUsedAt column may be rewritten, per process.
 *
 * lastUsedAt answers one question - "is anything still using this key, so can
 * I rotate or delete it?" - and five minutes of resolution answers it
 * perfectly. Writing on every ingest request would put a single-row UPDATE on
 * the hottest path in the product and turn the busiest keys into a Postgres
 * lock convoy, which is a real outage in exchange for a column nobody reads
 * more than once a quarter.
 */
const LAST_USED_THROTTLE_MS: number = 5 * 60 * 1000;

/*
 * Ceiling on the number of distinct key ids the throttle map tracks.
 *
 * Only ids that resolved from a real row ever reach markUsed, so this map
 * cannot be grown by an attacker throwing junk tokens at the ingest endpoint -
 * those never authenticate. It is bounded anyway because "the input is
 * trusted" is exactly the assumption that ages badly: a future caller that
 * stamps on a different id, or an installation with an unusual number of keys,
 * must not be able to turn a bookkeeping optimisation into an unbounded
 * process-lifetime leak. Overflowing the bound costs one extra UPDATE per
 * evicted key, which is nothing.
 */
const LAST_USED_THROTTLE_MAX_KEYS: number = 5000;

/*
 * Postgres `integer` upper bound. requestsPerMinuteLimit is a Number column,
 * so anything above this is a database-level error; catching it here turns an
 * ugly 500 into a sentence the customer can act on.
 */
const MAX_REQUESTS_PER_MINUTE_LIMIT: number = 2147483647;

/*
 * What actually lives in the cache: a flat, primitive-only snapshot rather
 * than the policy object itself.
 *
 * Two reasons, both learned from the previous shape of this cache (which
 * stored `projectId.toString()` and rebuilt an ObjectID on read, for the same
 * reason):
 *
 *   1. Callers get a fresh object every time, so nothing on the ingest path
 *      can mutate a cached entry - pushing onto `allowedOrigins`, say - and
 *      silently change the policy every other request on that pod sees for the
 *      next minute.
 *   2. It keeps the entries small and free of live model instances, so a
 *      cached policy cannot accidentally keep a whole hydrated entity (or a
 *      column nobody meant to expose, such as the secret) alive in memory.
 */
interface CachedIngestionKeyPolicy {
  ingestionKeyId: string;
  projectId: string;
  keyType: TelemetryIngestionKeyType;
  allowedOrigins: Array<string>;
  pinnedServiceName: string | null;
  isEnabled: boolean;
  expiresAtIso: string | null;
  requestsPerMinuteLimit: number | null;
  // The key's own ingestion budgets, or null when it sets none.
  ingestionBudgets: TelemetryIngestionBudgetStoredSettings | null;
}

/*
 * A key as the lookup by secret keeps it: the key's policy, and the key's
 * generation (CacheGenerations) it was read under. It is served only while
 * the key still has that generation: an update or a delete of the key
 * through any server starts a new one, and the key is read again.
 */
interface CachedIngestionKeyLookup {
  policy: CachedIngestionKeyPolicy;
  generation: string;
}

/*
 * A key's current state as getCurrentPolicyById keeps it: the key's policy
 * and a digest of its secret, never the secret itself
 * (TelemetryIngestionKeySecretDigest).
 */
interface CachedIngestionKeyCurrentState {
  // The key as read, or null when no key has the id: it was deleted.
  policy: CachedIngestionKeyPolicy | null;
  // A digest of the key's secret as read; null when there is no key.
  secretKeyDigest: string | null;
  // When it was read (ms), and when it is read again.
  readAt: number;
  readAgainAt: number;
}

// The budget columns, for the policy read's select.
const INGESTION_BUDGET_SELECT: Record<string, boolean> = Object.fromEntries(
  TELEMETRY_INGESTION_BUDGET_COLUMN_NAMES.map(
    (column: string): [string, boolean] => {
      return [column, true];
    },
  ),
);

// Every column a policy is built from (toCachedPolicy).
const POLICY_SELECT: Record<string, boolean> = {
  _id: true,
  projectId: true,
  keyType: true,
  allowedOrigins: true,
  pinnedServiceName: true,
  isEnabled: true,
  expiresAt: true,
  requestsPerMinuteLimit: true,
  ...INGESTION_BUDGET_SELECT,
};

export class Service extends DatabaseService<Model> {
  /*
   * The lookup by secret, keyed on a digest of the secret: each key under
   * the generation it was read under, and null for a secret no key has
   * (kept for NEGATIVE_TTL_MS, with no generation: no key to have one).
   */
  private policyCache: InMemoryTTLCache<CachedIngestionKeyLookup | null> =
    new InMemoryTTLCache(10_000);

  /*
   * Which key each secret opened, by the secret's digest - never the
   * secret - so a secret read again has its key's generation read first
   * (FIRST_READ_TTL_MS).
   */
  private keyIdBySecret: InMemoryTTLCache<string> = new InMemoryTTLCache(
    10_000,
  );

  /*
   * Reads by secret under way (issue #8426), so the lookups that miss a
   * secret together share one read of its row rather than each reading
   * Postgres: a pod's first requests for a busy key, a key's entry running
   * out, or every entry missing at once after a key changed or Redis came
   * back. Keyed on the secret's digest - never the secret - and on the key
   * and generation the read started under (policyReadKeyOf), so a lookup
   * only ever takes a read of its own secret, started under the generation
   * it saw. Each entry is removed when its read settles, landed or failed:
   * the map holds the reads in flight, nothing more.
   */
  private policyReads: Map<string, Promise<CachedIngestionKeyPolicy | null>> =
    new Map();

  /*
   * How many writes through this service this process has finished
   * (forgetLookupsBySecret): a first read by secret that a write landed
   * during is not kept, since it cannot tell which side of the write it
   * read (findPolicyBySecret).
   */
  private writesSeen: number = 0;

  /*
   * Per-key throttle for the lastUsedAt stamp. Deliberately in-process rather
   * than in GlobalCache/Redis (which is how RumApplicationService throttles
   * its equivalent health columns): the cost of getting it wrong here is one
   * extra single-row UPDATE per pod per five minutes, and that is not worth
   * putting a Redis round trip - or a Redis dependency - in front of a
   * bookkeeping write on the ingest path. The ingest path must keep working
   * when Redis is down.
   */
  private lastUsedWriteThrottle: InMemoryTTLCache<boolean> =
    new InMemoryTTLCache(LAST_USED_THROTTLE_MAX_KEYS);

  /*
   * Each key's current state, under `<key id>|<generation>`, for
   * getCurrentPolicyById: served for CURRENT_STATE_FRESH_MS, and kept for
   * CURRENT_STATE_STALE_GRACE_MS in case reading it again fails.
   */
  private currentStateCache: InMemoryTTLCache<CachedIngestionKeyCurrentState> =
    new InMemoryTTLCache(10_000);

  // Reads of a key's current state under way: publishes that ask together share one.
  private currentStateReads: Map<
    string,
    Promise<CachedIngestionKeyCurrentState>
  > = new Map();

  /*
   * Each key's generation of current state: the shared part, from Redis, and
   * this process's own (CacheGenerations). An update or a delete of a key
   * starts a new one (forgetKeys), so nothing read before it is served
   * again: in this process at once, and in every other within a second.
   */
  private generations: CacheGenerations = new CacheGenerations({
    namespace: TELEMETRY_INGESTION_KEY_GENERATION_NAMESPACE,
    ttlSeconds: GENERATION_TTL_SECONDS,
    maxKeys: 10_000,
    description: "telemetry ingestion keys",
  });

  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.data.secretKey) {
      createBy.data.secretKey = ObjectID.generate();
    }

    /*
     * The typed model surface (PartialEntity/QueryDeepPartialEntity) widens
     * every property into a union with `() => string` and `null`, which makes
     * reading a value for validation a pile of casts at each site. Read the
     * payload once as an untyped bag instead; every value is checked before it
     * is used, and every value written back is the checked, normalised one.
     */
    const data: Record<string, unknown> = createBy.data as unknown as Record<
      string,
      unknown
    >;

    const keyType: TelemetryIngestionKeyType = this.resolveKeyTypeForCreate(
      data["keyType"],
    );
    data["keyType"] = keyType;

    const allowedOrigins: Array<string> = this.validateAllowedOrigins(
      data["allowedOrigins"],
    );

    /*
     * A Browser key with no origin allowlist is precisely the credential this
     * feature exists to stop shipping: a bearer token sitting in public page
     * source that anyone who views source may write telemetry with. There is
     * no permissive default that would be safe, so it is refused at creation
     * rather than defaulted to one.
     *
     * A Server key keeps the historical behaviour - no origin binding at all,
     * because a collector or a backend process does not send an Origin header
     * in the first place - but its patterns are still validated so that a list
     * typed in "for later" is not quietly full of entries that can never
     * match.
     */
    if (
      keyType === TelemetryIngestionKeyType.Browser &&
      allowedOrigins.length === 0
    ) {
      throw new BadDataException(
        "A Browser ingestion key must list at least one allowed origin. A key that is published in a web page can be copied by anyone who views the source, so the origins it may be used from are the only thing that makes it safe to publish.",
      );
    }

    /*
     * A Mobile key (issue #6457) is published in every copy of an app, so
     * the one thing that keeps a copied key to that app's telemetry is its
     * pin: everything it writes is filed under that service name. A Mobile
     * key without one would let a copy write as any service, so it is
     * refused at creation, as a Browser key without origins is.
     *
     * It has no origins to list: a mobile SDK sends no Origin header, and
     * the ingest guard refuses a Mobile key on a request that has one. A
     * list given at creation would read as a protection that is not there,
     * so it is refused; one set later (the key page edits every key's list)
     * is ignored at ingest, as a Server key's is, without the read of the
     * keys' types that refusing it would cost every edit of a list.
     */
    if (keyType === TelemetryIngestionKeyType.Mobile) {
      if (allowedOrigins.length > 0) {
        throw new BadDataException(
          "A Mobile ingestion key has no allowed origins, because a mobile app sends no Origin header. Leave Allowed Origins empty, or create a Browser key for a web page.",
        );
      }

      if (!this.validatePinnedServiceName(data["pinnedServiceName"])) {
        throw new BadDataException(
          "A Mobile ingestion key must be pinned to its app's service name. Set Pinned Service Name to the service.name your app sends, so a key copied out of the app can only write that app's telemetry.",
        );
      }
    }

    if (Object.prototype.hasOwnProperty.call(data, "allowedOrigins")) {
      data["allowedOrigins"] = allowedOrigins;
    }

    if (Object.prototype.hasOwnProperty.call(data, "pinnedServiceName")) {
      data["pinnedServiceName"] = this.validatePinnedServiceName(
        data["pinnedServiceName"],
      );
    }

    if (Object.prototype.hasOwnProperty.call(data, "requestsPerMinuteLimit")) {
      data["requestsPerMinuteLimit"] = this.validateRequestsPerMinuteLimit(
        data["requestsPerMinuteLimit"],
      );
    }

    if (Object.prototype.hasOwnProperty.call(data, "expiresAt")) {
      data["expiresAt"] = this.validateExpiresAt(data["expiresAt"]);
    }

    /*
     * The key's own ingestion budgets: valid numbers, and no more than its
     * project may send - a key budget only subdivides the project's.
     */
    TelemetryIngestionBudgetValidation.applyBudgetColumnRules(data, {
      allowZero: false,
    });

    if (isTelemetryIngestionBudgetColumnTouched(data)) {
      const budgetProjectId: ObjectID | undefined =
        createBy.props.tenantId || createBy.data.projectId;

      if (budgetProjectId) {
        await TelemetryIngestionBudgetValidation.assertIngestionKeyBudgetsWithinProject(
          {
            projectId: new ObjectID(budgetProjectId.toString()),
            patch: data,
          },
        );
      }
    }

    if (IsBillingEnabled) {
      const projectId: ObjectID | undefined =
        createBy.props.tenantId || createBy.data.projectId;

      if (!projectId) {
        throw new BadDataException(
          "ProjectId required to create a telemetry ingestion key.",
        );
      }

      await PayAsYouGoBillingService.requirePayAsYouGo(projectId);
    }

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    /*
     * We don't know which secretKey(s) are being deleted without an extra
     * query; clear the whole cache. Key deletes are rare so this is cheap.
     */
    this.policyCache.clear();
    return { deleteBy, carryForward: null };
  }

  /*
   * The keys are gone: a session that connected with one is cut off on its
   * next publish, in this process at once and in every other within a
   * second (getCurrentPolicyById). The policy cache is cleared again too: a
   * lookup that started before the DELETE landed may have put the row back
   * after onBeforeDelete cleared it.
   */
  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    this.forgetLookupsBySecret();
    await this.forgetKeys(itemIdsBeforeDelete);
    return onDelete;
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const data: Record<string, unknown> = updateBy.data as unknown as Record<
      string,
      unknown
    >;

    /*
     * "Touched" means the property is present in the patch with a value that
     * is not `undefined`. An explicit `null` IS a touch - it is how a cleared
     * form field arrives - and must be validated and normalised like any other
     * value, not skipped as if it were absent.
     */
    const isTouched: (key: string) => boolean = (key: string): boolean => {
      return (
        Object.prototype.hasOwnProperty.call(data, key) &&
        data[key] !== undefined
      );
    };

    /*
     * Service-layer backstop for the immutability of keyType.
     *
     * @ColumnAccessControl already declares `update: []` on the column, but
     * that is an API-layer control: it stops a dashboard or API caller, not an
     * internal service that reaches for updateOneById directly. Since flipping
     * a live key's type silently changes what a credential already deployed in
     * production is allowed to do - in either direction, and in the
     * Browser -> Server direction it strips the origin binding off a key that
     * is still sitting in a public page - the rule is enforced here too, where
     * every write path passes through and where it can be tested.
     */
    if (isTouched("keyType")) {
      throw new BadDataException(
        "The key type cannot be changed after the key is created. Create a new ingestion key instead.",
      );
    }

    if (isTouched("allowedOrigins")) {
      const allowedOrigins: Array<string> = this.validateAllowedOrigins(
        data["allowedOrigins"],
      );

      /*
       * Only an EMPTY new list needs to know what kind of keys are being
       * updated, so the extra read is paid for only then. A non-empty list is
       * valid on both key types. Renaming, disabling, or setting an expiry
       * does not need this lookup; re-enabling has a separate billing check.
       */
      if (allowedOrigins.length === 0) {
        await this.assertNoBrowserKeyIsBeingUpdated(updateBy);
      }

      data["allowedOrigins"] = allowedOrigins;
    }

    if (isTouched("pinnedServiceName")) {
      data["pinnedServiceName"] = this.validatePinnedServiceName(
        data["pinnedServiceName"],
      );

      /*
       * Unpinning a Mobile key would let every copy of the app write as any
       * service (issue #6457). Only a cleared pin needs the keys' types, so
       * the read is paid for only then.
       */
      if (!data["pinnedServiceName"]) {
        await this.assertNoMobileKeyIsBeingUpdated(
          updateBy,
          "A Mobile ingestion key must stay pinned to its app's service name, so a key copied out of the app can only write that app's telemetry. To retire the key, turn it off or delete it.",
        );
      }
    }

    if (isTouched("requestsPerMinuteLimit")) {
      data["requestsPerMinuteLimit"] = this.validateRequestsPerMinuteLimit(
        data["requestsPerMinuteLimit"],
      );
    }

    if (isTouched("expiresAt")) {
      data["expiresAt"] = this.validateExpiresAt(data["expiresAt"]);
    }

    /*
     * The key's own ingestion budgets, checked against each updated key's
     * project: a key budget may only subdivide its project's.
     */
    TelemetryIngestionBudgetValidation.applyBudgetColumnRules(data, {
      allowZero: false,
    });

    if (isTelemetryIngestionBudgetColumnTouched(data)) {
      const keys: Array<Model> = await this.findRowsAndHoldUpdateToThem(
        updateBy,
        { projectId: true },
      );
      const checkedProjects: Set<string> = new Set<string>();

      for (const key of keys) {
        if (!key.projectId || checkedProjects.has(key.projectId.toString())) {
          continue;
        }

        checkedProjects.add(key.projectId.toString());

        await TelemetryIngestionBudgetValidation.assertIngestionKeyBudgetsWithinProject(
          {
            projectId: key.projectId,
            patch: data,
          },
        );
      }
    }

    if (IsBillingEnabled && data["isEnabled"] === true) {
      const keys: Array<Model> = await this.findRowsAndHoldUpdateToThem(
        updateBy,
        { projectId: true },
      );
      const checkedProjects: Set<string> = new Set<string>();

      for (const key of keys) {
        if (!key.projectId) {
          throw new BadDataException(
            "ProjectId required to enable a telemetry ingestion key.",
          );
        }

        if (!checkedProjects.has(key.projectId.toString())) {
          await PayAsYouGoBillingService.requirePayAsYouGo(key.projectId);
          checkedProjects.add(key.projectId.toString());
        }
      }
    }

    /*
     * Same reasoning as onBeforeDelete. The cached policy now carries the kill
     * switch, the expiry, the origin allowlist and the rate limit, so almost
     * any edit to this table invalidates it - clearing wholesale stays the
     * right call, and doing it after validation avoids churning the cache for
     * an update that is about to be rejected.
     */
    this.policyCache.clear();
    return { updateBy, carryForward: null };
  }

  /*
   * The keys changed - switched off, a new expiry, a new secret, or any
   * other edit: a session that connected with one is checked against the
   * key as it is now on its next publish, in this process at once and in
   * every other within a second (getCurrentPolicyById). The policy cache is
   * cleared again too, for the same reason as after a delete.
   */
  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    this.forgetLookupsBySecret();
    await this.forgetKeys(updatedItemIds);
    return onUpdate;
  }

  /*
   * After a write through this service: nothing the lookup by secret read
   * before it is served again here. The keys it kept are dropped, a lookup
   * from now on starts a read of its own rather than taking one under way
   * (policyReads), and a first read under way when the write landed is not
   * kept once it lands (writesSeen): it may have read the row from before
   * the write, under the generation from after it.
   */
  private forgetLookupsBySecret(): void {
    this.policyCache.clear();
    this.policyReads.clear();
    this.writesSeen++;
  }

  /*
   * Starts a new generation of each key, so nothing read of it before is
   * served again - its current state (getCurrentPolicyById) nor the lookup
   * by secret (getPolicyFromSecretKey): in this process at once, and in
   * every other through Redis within CacheGenerations.SHARED_READ_TTL_MS.
   * Never throws (CacheGenerations): a change Redis does not take still
   * counts here, and CURRENT_STATE_FRESH_MS and POSITIVE_TTL_MS bound it
   * everywhere else.
   */
  private async forgetKeys(ingestionKeyIds: Array<ObjectID>): Promise<void> {
    const keys: Array<string> = ingestionKeyIds
      .map((ingestionKeyId: ObjectID): string => {
        return ingestionKeyId ? ingestionKeyId.toString().toLowerCase() : "";
      })
      .filter((key: string): boolean => {
        return Boolean(key);
      });

    if (keys.length === 0) {
      return;
    }

    await this.generations.bump(keys);
  }

  /**
   * Resolve an ingestion token to the full policy the ingest guards need,
   * with a short-lived in-process cache to keep the hot ingest path off
   * Postgres, and one read shared by the lookups that miss it together
   * (readPolicyBySecret). Returns null for unknown or malformed tokens (also
   * cached, for a shorter TTL).
   *
   * A disabled or expired key still resolves so the caller can explain that
   * refusal. An otherwise usable key requires payment setup here, so every
   * transport and validation endpoint shares the same billing admission rule.
   */
  @CaptureSpan()
  public async getPolicyFromSecretKey(
    secretKey: string,
  ): Promise<TelemetryIngestionKeyPolicy | null> {
    /*
     * The cache is keyed on a hash of the token, never the token itself. An
     * in-memory map is dumped by a heap snapshot, a core file or a debugger,
     * and a live ingestion secret is not something to leave lying in one.
     */
    const cacheKey: string = createHash("sha256")
      .update(secretKey)
      .digest("hex");

    const cached: CachedIngestionKeyLookup | null | undefined =
      this.policyCache.get(cacheKey);

    if (cached === null) {
      return null;
    }

    /*
     * Served only while the key has the generation it was read under: a key
     * switched off, reset or deleted through any server since is read again
     * (issue #8370). The generation is in memory, asked of Redis at most
     * once a second per key (CacheGenerations), and never throws.
     */
    if (
      cached !== undefined &&
      (await this.generations.get(
        Service.generationKeyOf(cached.policy.ingestionKeyId),
      )) === cached.generation
    ) {
      return this.requireBillingForPolicy(this.hydratePolicy(cached.policy));
    }

    let secretKeyObjectId: ObjectID;
    try {
      ObjectID.validateUUID(secretKey);
      secretKeyObjectId = new ObjectID(secretKey);
    } catch {
      this.policyCache.set(cacheKey, null, NEGATIVE_TTL_MS);
      return null;
    }

    const snapshot: CachedIngestionKeyPolicy | null =
      await this.readPolicyBySecret({
        cacheKey: cacheKey,
        secretKey: secretKeyObjectId,
        knownKeyId: cached?.policy.ingestionKeyId,
      });

    if (!snapshot) {
      return null;
    }

    return this.requireBillingForPolicy(this.hydratePolicy(snapshot));
  }

  /*
   * Reads the key a secret opens, and keeps it under the generation the key
   * had BEFORE the read: a change that lands during the read starts a newer
   * generation, so what the read saw is never served after the change. The
   * key is known before the read when this process read the secret before
   * (keyIdBySecret); the first time, its generation can only be read after,
   * and it is kept for FIRST_READ_TTL_MS only.
   *
   * The lookups that miss together share one read (issue #8426): a lookup
   * takes a read under way when it is of the same secret, and started under
   * the key and generation this lookup sees. A lookup that sees a newer
   * generation - the key changed while that read was in flight - never takes
   * what the read saw: it reads again, and the lookups that see what it saw
   * share that read in turn.
   */
  private async readPolicyBySecret(data: {
    cacheKey: string;
    secretKey: ObjectID;
    knownKeyId: string | undefined;
  }): Promise<CachedIngestionKeyPolicy | null> {
    const knownKeyId: string | undefined = data.knownKeyId
      ? Service.generationKeyOf(data.knownKeyId)
      : this.keyIdBySecret.get(data.cacheKey);

    const generationBefore: string | null = knownKeyId
      ? await this.generations.get(knownKeyId)
      : null;

    const readKey: string = Service.policyReadKeyOf({
      cacheKey: data.cacheKey,
      knownKeyId: knownKeyId,
      generationBefore: generationBefore,
    });

    const underWay: Promise<CachedIngestionKeyPolicy | null> | undefined =
      this.policyReads.get(readKey);

    if (underWay) {
      return underWay;
    }

    const read: Promise<CachedIngestionKeyPolicy | null> =
      this.findPolicyBySecret({
        cacheKey: data.cacheKey,
        secretKey: data.secretKey,
        knownKeyId: knownKeyId,
        generationBefore: generationBefore,
      }).finally(() => {
        if (this.policyReads.get(readKey) === read) {
          this.policyReads.delete(readKey);
        }
      });

    this.policyReads.set(readKey, read);

    return read;
  }

  /*
   * A read by secret's place in policyReads: the secret's digest, and the
   * key and generation the read started under ("" for a first read, which
   * knows neither). A digest is hex, a key id a uuid and a generation
   * tokens joined by "." (CacheGenerations), so "|" never occurs in any.
   */
  private static policyReadKeyOf(data: {
    cacheKey: string;
    knownKeyId: string | undefined;
    generationBefore: string | null;
  }): string {
    return [
      data.cacheKey,
      data.knownKeyId || "",
      data.generationBefore ?? "",
    ].join("|");
  }

  /*
   * One read of the row a secret opens, kept once it lands (readPolicyBySecret
   * says under which generation). Nothing is kept when it fails: every lookup
   * that shared it fails, and the next one reads again.
   */
  private async findPolicyBySecret(data: {
    cacheKey: string;
    secretKey: ObjectID;
    knownKeyId: string | undefined;
    generationBefore: string | null;
  }): Promise<CachedIngestionKeyPolicy | null> {
    const knownKeyId: string | undefined = data.knownKeyId;
    const generationBefore: string | null = data.generationBefore;
    const writesSeenBefore: number = this.writesSeen;

    /*
     * The secret is kept encrypted (#9012): the key is found by its lookup
     * hash, then held to the secret itself (findOneByPresentedKey).
     */
    const token: Model | null = await this.findOneByPresentedKey({
      column: "secretKey",
      presentedKey: data.secretKey,
      select: POLICY_SELECT,
      props: { isRoot: true },
    });

    const projectId: ObjectID | undefined = token?.projectId as
      | ObjectID
      | undefined;

    if (!token || !projectId) {
      /*
       * Not kept when a write here landed during the read: it may be the
       * write that gave a key this secret.
       */
      if (this.writesSeen === writesSeenBefore) {
        this.policyCache.set(data.cacheKey, null, NEGATIVE_TTL_MS);
      }
      return null;
    }

    const snapshot: CachedIngestionKeyPolicy = this.toCachedPolicy(
      token,
      projectId,
    );
    const keyId: string = Service.generationKeyOf(snapshot.ingestionKeyId);

    this.keyIdBySecret.set(data.cacheKey, keyId, KEY_ID_BY_SECRET_TTL_MS);

    if (generationBefore !== null && keyId === knownKeyId) {
      this.policyCache.set(
        data.cacheKey,
        { policy: snapshot, generation: generationBefore },
        POSITIVE_TTL_MS,
      );
      return snapshot;
    }

    // The first read of this secret here: kept briefly, then read again.
    const generationAfter: string = await this.generations.get(keyId);

    /*
     * Unless a write through this process landed while it was read: the
     * generation after the read is the write's, and the row may be from
     * before it. The lookups that shared it get what it read - they asked
     * before the write - and the next one reads again.
     */
    if (this.writesSeen !== writesSeenBefore) {
      return snapshot;
    }

    this.policyCache.set(
      data.cacheKey,
      { policy: snapshot, generation: generationAfter },
      FIRST_READ_TTL_MS,
    );
    return snapshot;
  }

  // A key's id as its generation is kept under: lower-cased (forgetKeys).
  private static generationKeyOf(ingestionKeyId: string): string {
    return ingestionKeyId.toLowerCase();
  }

  private async requireBillingForPolicy(
    policy: TelemetryIngestionKeyPolicy,
  ): Promise<TelemetryIngestionKeyPolicy> {
    try {
      await this.requireBillingForUsableKey(policy);
    } catch (err) {
      /*
       * The caller that catches a billing refusal never holds the policy
       * (this throws instead of returning it), so note which key it was
       * thrown for: the ingest guards count it against that key (issue
       * #6378, TelemetryIngestRefusalRecorder). The validation endpoint
       * and other callers ignore the note.
       */
      noteTelemetryIngestRefusalKey(err, {
        projectId: policy.projectId,
        ingestionKeyId: policy.ingestionKeyId,
      });

      throw err;
    }

    return policy;
  }

  private async requireBillingForUsableKey(
    policy: TelemetryIngestionKeyPolicy,
  ): Promise<void> {
    if (
      policy.isEnabled &&
      (!policy.expiresAt || policy.expiresAt.getTime() > Date.now())
    ) {
      /*
       * A project a master admin blocked ingests nothing until it is
       * unblocked, whatever it pays: every transport that resolves a key
       * here (HTTP, gRPC, MQTT, validation, session replay) refuses it with
       * a 403. Asked on key-cache hits too; the answer has its own cache
       * (ProjectService.isProjectBlocked), forgotten when the block changes.
       */
      if (await ProjectService.isProjectBlocked(policy.projectId)) {
        throw new ProjectBlockedException();
      }

      /*
       * Check even on key-cache hits. Billing eligibility has its own bounded
       * cache, and must not remain enabled for the lifetime of a live key.
       *
       * This runs for every ingested batch, so it is the one caller that may
       * answer from a recently cached denial rather than re-reading the
       * payment provider. Without that, an unpaid project ingesting telemetry
       * turns every batch into provider reads and holds the whole Stripe
       * account at its rate limit. The client retries, so a few seconds
       * between adding a card and ingest being admitted costs nothing - and
       * BillingPaymentMethodService clears the entry as soon as the card is
       * read, which is what the billing page does right after one is added.
       */
      await PayAsYouGoBillingService.requirePayAsYouGo(policy.projectId, {
        allowStaleDenial: true,
      });
    }
  }

  /**
   * Resolve an ingestion token to its projectId.
   *
   * Shares billing admission with getPolicyFromSecretKey. It deliberately
   * does NOT enforce the kill switch or the expiry.
   *
   * That restraint is the point. Several callers (gRPC, MQTT, session replay,
   * OTLP) use this to decide whether a connection is authenticated at all, and
   * each of them refuses disabled/expired keys explicitly, with a message that
   * names the surface. Quietly folding those checks into a method whose name
   * promises only a lookup would make "key not found" and "key switched off"
   * indistinguishable in every one of those call sites - and would change the
   * behaviour of any caller that has not been updated yet.
   */
  @CaptureSpan()
  public async getProjectIdFromSecretKey(
    secretKey: string,
  ): Promise<ObjectID | null> {
    const policy: TelemetryIngestionKeyPolicy | null =
      await this.getPolicyFromSecretKey(secretKey);

    if (!policy) {
      return null;
    }

    return policy.projectId;
  }

  /**
   * The key's policy as it is now, for a sender that proved it held the
   * key's secret earlier and is still sending on that proof: an MQTT session,
   * checked at CONNECT and then open for as long as the device keeps it
   * (issue #8147). `secretKeyDigest` is the digest of the secret the sender
   * presented (TelemetryIngestionKeySecretDigest.of).
   *
   * Null when the key was deleted, or its secret was reset since: the sender
   * no longer holds a secret that opens it. A disabled or expired key still
   * resolves, so the caller refuses it as it refuses it at CONNECT
   * (TelemetryIngestionKeyGuard), naming why. Billing and a blocked project
   * are the caller's to ask, as on every publish.
   *
   * Kept per process for CURRENT_STATE_FRESH_MS under the key's generation,
   * which an update or delete through this service renews: in this process
   * at once, and in every other within a second. Reads that ask together
   * share one. When reading again fails, the state last read is served for
   * up to CURRENT_STATE_STALE_GRACE_MS, and asked for again once each
   * CURRENT_STATE_FRESH_MS; with nothing read, or past that, it throws.
   */
  @CaptureSpan()
  public async getCurrentPolicyById(data: {
    ingestionKeyId: ObjectID;
    secretKeyDigest: string;
  }): Promise<TelemetryIngestionKeyPolicy | null> {
    const state: CachedIngestionKeyCurrentState = await this.getCurrentState(
      data.ingestionKeyId,
    );

    if (
      !state.policy ||
      !state.secretKeyDigest ||
      !TelemetryIngestionKeySecretDigest.matches(
        state.secretKeyDigest,
        data.secretKeyDigest,
      )
    ) {
      return null;
    }

    return this.hydratePolicy(state.policy);
  }

  private async getCurrentState(
    ingestionKeyId: ObjectID,
  ): Promise<CachedIngestionKeyCurrentState> {
    const generationKey: string = ingestionKeyId.toString().toLowerCase();

    // The key's generation as it stands before the read: never throws.
    const generation: string = await this.generations.get(generationKey);
    const cacheKey: string = `${generationKey}|${generation}`;

    const kept: CachedIngestionKeyCurrentState | undefined =
      this.currentStateCache.get(cacheKey);

    if (kept && Date.now() < kept.readAgainAt) {
      return kept;
    }

    try {
      return await this.readCurrentState(cacheKey, ingestionKeyId);
    } catch (err) {
      const now: number = Date.now();
      const keptForMs: number = kept
        ? kept.readAt + CURRENT_STATE_STALE_GRACE_MS - now
        : 0;

      if (!kept || keptForMs <= 0) {
        throw err;
      }

      /*
       * Served as last read, and not asked for again until the next
       * window: while Postgres is down, every publish must not wait on a
       * read that fails.
       */
      const stillKept: CachedIngestionKeyCurrentState = {
        ...kept,
        readAgainAt: now + CURRENT_STATE_FRESH_MS,
      };

      this.currentStateCache.set(cacheKey, stillKept, keptForMs);

      logger.warn(
        `TelemetryIngestionKeyService: could not read ingestion key ${generationKey} again; serving what was read ${Math.round(
          (now - kept.readAt) / 1000,
        )}s ago.`,
      );
      logger.warn(err);

      return stillKept;
    }
  }

  // One read of a key's current state at a time, kept once it lands.
  private readCurrentState(
    cacheKey: string,
    ingestionKeyId: ObjectID,
  ): Promise<CachedIngestionKeyCurrentState> {
    const underWay: Promise<CachedIngestionKeyCurrentState> | undefined =
      this.currentStateReads.get(cacheKey);

    if (underWay) {
      return underWay;
    }

    const read: Promise<CachedIngestionKeyCurrentState> = this.findCurrentState(
      ingestionKeyId,
    )
      .then(
        (
          state: CachedIngestionKeyCurrentState,
        ): CachedIngestionKeyCurrentState => {
          this.currentStateCache.set(
            cacheKey,
            state,
            CURRENT_STATE_STALE_GRACE_MS,
          );
          return state;
        },
      )
      .finally(() => {
        if (this.currentStateReads.get(cacheKey) === read) {
          this.currentStateReads.delete(cacheKey);
        }
      });

    this.currentStateReads.set(cacheKey, read);

    return read;
  }

  private async findCurrentState(
    ingestionKeyId: ObjectID,
  ): Promise<CachedIngestionKeyCurrentState> {
    const token: Model | null = await this.findOneBy({
      query: { _id: ingestionKeyId },
      select: {
        ...POLICY_SELECT,
        secretKey: true,
      },
      props: { isRoot: true },
    });

    const readAt: number = Date.now();
    const projectId: ObjectID | undefined = token?.projectId as
      | ObjectID
      | undefined;
    const secretKey: ObjectID | undefined = token?.secretKey as
      | ObjectID
      | undefined;

    if (!token || !projectId || !secretKey) {
      return {
        policy: null,
        secretKeyDigest: null,
        readAt: readAt,
        readAgainAt: readAt + CURRENT_STATE_FRESH_MS,
      };
    }

    return {
      policy: this.toCachedPolicy(token, projectId),
      secretKeyDigest: TelemetryIngestionKeySecretDigest.of(
        secretKey.toString(),
      ),
      readAt: readAt,
      readAgainAt: readAt + CURRENT_STATE_FRESH_MS,
    };
  }

  /**
   * Record that this key was just used, at most once per key per
   * LAST_USED_THROTTLE_MS per process.
   *
   * Fire-and-forget in the strongest sense: it swallows every error it can
   * produce. A failure to write a bookkeeping timestamp must never be able to
   * reject telemetry that was otherwise accepted - dropped spans are not
   * replayed, so turning "the UPDATE failed" into "the customer lost data" is
   * the worst possible trade for a column that exists to help with key
   * rotation hygiene.
   *
   * Modelled on RumApplicationService.markSessionReplayChunkReceived, with the
   * same three properties: throttled, hook-free, and updatedAt-preserving.
   */
  @CaptureSpan()
  public async markUsed(ingestionKeyId: ObjectID): Promise<void> {
    if (!ingestionKeyId) {
      return;
    }

    const throttleKey: string = ingestionKeyId.toString();

    try {
      if (this.lastUsedWriteThrottle.get(throttleKey) !== undefined) {
        return; // written recently by this process
      }

      /*
       * Claim the throttle slot BEFORE the write, not after. Ingest is
       * concurrent, so a dozen requests for the same key can be in this method
       * at once; claiming first means they collapse to one UPDATE instead of a
       * dozen. If the write then fails, the cost is a missing stamp for five
       * minutes, which is exactly the resolution this column has anyway.
       */
      this.lastUsedWriteThrottle.set(throttleKey, true, LAST_USED_THROTTLE_MS);

      /*
       * Hook-free single-statement UPDATE:
       *
       *  - no hooks, so this does not clear the policy cache. That is
       *    deliberate: lastUsedAt is not part of the policy, and invalidating
       *    every cached key every five minutes because of a passive stamp
       *    would send the ingest path back to Postgres for nothing.
       *  - skipUpdateDateColumn, so a liveness stamp does not masquerade as a
       *    configuration change to anything watching updatedAt.
       */
      await this.updateColumnsByIdWithoutHooks({
        id: ingestionKeyId,
        data: {
          lastUsedAt: OneUptimeDate.getCurrentDate(),
        },
        skipUpdateDateColumn: true,
      });
    } catch (err) {
      logger.warn(
        `TelemetryIngestionKeyService: could not stamp lastUsedAt for ingestion key ${throttleKey}`,
      );
      logger.warn(err);
    }
  }

  /*
   * Build the cacheable snapshot from a row.
   *
   * Every field is normalised here rather than at the point of use, so there
   * is exactly one place that decides what a missing or malformed column
   * means, and so the ingest guards can be written against a total type
   * instead of a pile of optionals.
   */
  private toCachedPolicy(
    token: Model,
    projectId: ObjectID,
  ): CachedIngestionKeyPolicy {
    /*
     * THE BACKWARDS-COMPATIBILITY HINGE.
     *
     * Every TelemetryIngestionKey that exists today was written before the
     * keyType column did, so it reads back as NULL (or, on a node whose model
     * metadata is momentarily behind a rolling deploy, as absent). Anything
     * that is not exactly "Browser" or "Mobile" resolves to Server, which is
     * the historical behaviour in full: no origin checks, every ingest
     * surface, no default rate limit, no pinned service name.
     *
     * Written as an allowlist of the ONE restrictive value rather than a
     * lookup that falls back on failure, so that a typo, a truncated column, a
     * partially applied migration or a hand-edited row can never accidentally
     * relax a Browser key into a Server key. The failure direction here is
     * always towards "behaves like it always did", never towards "quietly
     * gained privileges".
     */
    const keyType: TelemetryIngestionKeyType = readTelemetryIngestionKeyType(
      token.keyType,
    );

    /*
     * Blank entries are dropped, not just non-strings. OriginAllowList.matches
     * skips a blank pattern, so a list of [""] would match nothing while still
     * being non-empty - and "non-empty" is what the ingest guard checks before
     * it decides a Browser key is configured at all. Dropping blanks here
     * makes those two agree: a non-empty list always contains at least one
     * pattern that can actually match.
     */
    const rawAllowedOrigins: unknown = token.allowedOrigins;
    const allowedOrigins: Array<string> = Array.isArray(rawAllowedOrigins)
      ? (rawAllowedOrigins as Array<unknown>)
          .filter((entry: unknown): boolean => {
            return typeof entry === "string" && entry.trim().length > 0;
          })
          .map((entry: unknown): string => {
            return entry as string;
          })
      : [];

    const rawPinnedServiceName: unknown = token.pinnedServiceName;
    const pinnedServiceName: string | null =
      typeof rawPinnedServiceName === "string" &&
      rawPinnedServiceName.trim().length > 0
        ? rawPinnedServiceName.trim()
        : null;

    /*
     * Only an explicit `false` disables a key. A row that predates the column
     * reads back NULL and must stay enabled - the alternative would take every
     * existing installation's telemetry offline the moment this ships, which
     * is the one outcome this whole change is not allowed to have.
     */
    const isEnabled: boolean = token.isEnabled !== false;

    /*
     * A value that will not parse is treated as "no expiry" rather than "expired".
     * It cannot arise from a TIMESTAMPTZ column, so the only way to get here is
     * a corrupt or hand-written row, and refusing a customer's live telemetry
     * because a date column is unreadable is a worse failure than honouring the
     * historical never-expires behaviour.
     */
    let expiresAtIso: string | null = null;
    if (token.expiresAt) {
      const expiresAt: Date = OneUptimeDate.fromString(token.expiresAt);
      if (expiresAt instanceof Date && !Number.isNaN(expiresAt.getTime())) {
        expiresAtIso = expiresAt.toISOString();
      }
    }

    /*
     * 0, a negative number or garbage all resolve to null - "no explicit limit
     * configured" - not to "block everything". Neither can be written through
     * this service (create/update reject them), so reaching here means a
     * legacy or hand-edited row, and reading such a row as a total block would
     * silently black out a customer's ingest. Null instead means a Browser key
     * falls back to the shipped default and a Server key stays unlimited,
     * which is what the column's own documentation promises.
     */
    const rawRequestsPerMinuteLimit: unknown = token.requestsPerMinuteLimit;
    const requestsPerMinuteLimit: number | null =
      typeof rawRequestsPerMinuteLimit === "number" &&
      Number.isFinite(rawRequestsPerMinuteLimit) &&
      rawRequestsPerMinuteLimit > 0
        ? Math.floor(rawRequestsPerMinuteLimit)
        : null;

    /*
     * `_id` is the primary key and is always selected, so a row without one
     * cannot come back from a real query. The resolver still has to be total,
     * though, and returning null for a row that plainly exists would turn a
     * shape surprise into a complete ingest outage for that key. Falling back
     * to the zero id keeps the key working and degrades only the two things
     * that are keyed on the id: the rate-limit bucket (which would be shared)
     * and the lastUsedAt stamp (whose UPDATE would match no row). Neither is a
     * security control - the kill switch, the expiry and the origin allowlist
     * all come from the row's own columns.
     */
    const ingestionKeyId: string = token._id
      ? token._id.toString()
      : ObjectID.getZeroObjectID().toString();

    const ingestionBudgets: TelemetryIngestionBudgetStoredSettings =
      readTelemetryIngestionBudgetStoredSettings(token);

    return {
      ingestionKeyId: ingestionKeyId,
      projectId: projectId.toString(),
      keyType: keyType,
      allowedOrigins: allowedOrigins,
      pinnedServiceName: pinnedServiceName,
      isEnabled: isEnabled,
      expiresAtIso: expiresAtIso,
      requestsPerMinuteLimit: requestsPerMinuteLimit,
      /*
       * Garbage reads as "not set", as everywhere on the read side: a bad
       * row lifts a key's own limit (the project's still holds) rather than
       * blocking the key.
       */
      ingestionBudgets: hasAnyTelemetryIngestionBudgetSetting(ingestionBudgets)
        ? ingestionBudgets
        : null,
    };
  }

  /*
   * Rebuild a live policy from a snapshot. The array is copied and the
   * ObjectIDs/Date are reconstructed so that a caller holding a policy cannot
   * reach back into the cache and mutate what every other request on this pod
   * will see for the rest of the TTL.
   */
  private hydratePolicy(
    cached: CachedIngestionKeyPolicy,
  ): TelemetryIngestionKeyPolicy {
    return {
      ingestionKeyId: new ObjectID(cached.ingestionKeyId),
      projectId: new ObjectID(cached.projectId),
      keyType: cached.keyType,
      allowedOrigins: [...cached.allowedOrigins],
      pinnedServiceName: cached.pinnedServiceName,
      isEnabled: cached.isEnabled,
      expiresAt: cached.expiresAtIso ? new Date(cached.expiresAtIso) : null,
      requestsPerMinuteLimit: cached.requestsPerMinuteLimit,
      ingestionBudgets: cached.ingestionBudgets
        ? (JSON.parse(
            JSON.stringify(cached.ingestionBudgets),
          ) as TelemetryIngestionBudgetStoredSettings)
        : null,
    };
  }

  /*
   * Unlike the read path - which forgives anything, because an existing row
   * must keep working - the write path is strict. A key type it does not
   * recognise is refused rather than silently coerced to Server, because
   * "I asked for a Browser key and got a Server key" is a security surprise,
   * not a typo the system should paper over.
   */
  private resolveKeyTypeForCreate(value: unknown): TelemetryIngestionKeyType {
    if (value === undefined || value === null || value === "") {
      return TelemetryIngestionKeyType.Server;
    }

    if (value === TelemetryIngestionKeyType.Browser) {
      return TelemetryIngestionKeyType.Browser;
    }

    if (value === TelemetryIngestionKeyType.Server) {
      return TelemetryIngestionKeyType.Server;
    }

    if (value === TelemetryIngestionKeyType.Mobile) {
      return TelemetryIngestionKeyType.Mobile;
    }

    throw new BadDataException(
      `"${String(value)}" is not a valid ingestion key type. Use "${
        TelemetryIngestionKeyType.Server
      }", "${TelemetryIngestionKeyType.Browser}" or "${
        TelemetryIngestionKeyType.Mobile
      }".`,
    );
  }

  /*
   * Validate and canonicalise an allowlist.
   *
   * Entries are stored in the same normalised form the matcher compares
   * against (trimmed, lowercased, no trailing slash) and exact duplicates are
   * collapsed, so what the customer sees listed in the dashboard is exactly
   * what will be matched at ingest time. An origin's scheme and host are
   * case-insensitive, so lowercasing changes nothing about what the entry
   * means - it only removes a class of "why doesn't this match?" support
   * question that has no visible cause.
   */
  private validateAllowedOrigins(value: unknown): Array<string> {
    if (value === undefined || value === null) {
      return [];
    }

    if (!Array.isArray(value)) {
      throw new BadDataException(
        'Allowed origins must be a list of origins, for example ["https://app.example.com"].',
      );
    }

    const normalized: Array<string> = [];
    const seen: Set<string> = new Set();

    for (const entry of value as Array<unknown>) {
      if (typeof entry !== "string") {
        throw new BadDataException(
          "Every allowed origin must be text, with one origin per entry.",
        );
      }

      if (!entry.trim()) {
        continue;
      }

      const validationError: string | null =
        OriginAllowList.validateOriginPattern(entry);

      if (validationError) {
        throw new BadDataException(validationError);
      }

      const canonical: string = OriginAllowList.normalizeOrigin(entry);

      if (seen.has(canonical)) {
        continue;
      }

      seen.add(canonical);
      normalized.push(canonical);
    }

    return normalized;
  }

  /*
   * Blank means "clear it", not "reject it". An emptied text field arrives as
   * "" or null, and refusing that would leave a customer who pinned a service
   * name unable to ever unpin it through the dashboard. Anything non-blank has
   * to fit the column, since a silently truncated service name would pin
   * telemetry to a name that matches nothing the customer expects.
   */
  private validatePinnedServiceName(value: unknown): string | null {
    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value !== "string") {
      throw new BadDataException("The pinned service name must be text.");
    }

    const trimmed: string = value.trim();

    if (!trimmed) {
      return null;
    }

    if (trimmed.length > ColumnLength.ShortText) {
      throw new BadDataException(
        `The pinned service name cannot be longer than ${ColumnLength.ShortText} characters.`,
      );
    }

    return trimmed;
  }

  private validateRequestsPerMinuteLimit(value: unknown): number | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    const limit: number = typeof value === "number" ? value : Number(value);

    if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit <= 0) {
      throw new BadDataException(
        "The requests per minute limit must be a whole number greater than 0. Leave it empty to use the default for the key type.",
      );
    }

    if (limit > MAX_REQUESTS_PER_MINUTE_LIMIT) {
      throw new BadDataException(
        `The requests per minute limit cannot be greater than ${MAX_REQUESTS_PER_MINUTE_LIMIT}.`,
      );
    }

    return limit;
  }

  private validateExpiresAt(value: unknown): Date | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    let expiresAt: Date;

    try {
      expiresAt = OneUptimeDate.fromString(value as string | Date);
    } catch {
      throw new BadDataException("The expiry date is not a valid date.");
    }

    if (!(expiresAt instanceof Date) || Number.isNaN(expiresAt.getTime())) {
      throw new BadDataException("The expiry date is not a valid date.");
    }

    /*
     * Refused rather than accepted-and-immediately-dead. Saving an expiry in
     * the past silently bricks the key, and the symptom - telemetry stops
     * arriving, with a key that still looks fine in the list - is exactly the
     * kind of failure that costs an afternoon to diagnose.
     */
    if (!OneUptimeDate.isInTheFuture(expiresAt)) {
      throw new BadDataException(
        "The expiry date must be in the future. A key that expires in the past would stop accepting telemetry as soon as it is saved.",
      );
    }

    return expiresAt;
  }

  /*
   * Refuse to empty the allowlist when any row the update matches is a Browser
   * key.
   *
   * The database cannot express "non-empty only when keyType is Browser", and
   * an update patch does not carry the key type (it cannot - keyType is
   * immutable and therefore never in the patch), so the affected rows have to
   * be read. Only _id and keyType are selected; nothing here needs anything
   * else.
   *
   * The read runs as root because it is a policy check, not a data return.
   * The rows are the ones the update writes, and the update is held to them
   * (findRowsAndHoldUpdateToThem): the check sees every row the write
   * touches and no other - for a teammate, only keys they may write - and
   * the update never writes a key the check did not see.
   */
  private async assertNoBrowserKeyIsBeingUpdated(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const affectedKeys: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        keyType: true,
      },
    );

    for (const affectedKey of affectedKeys) {
      if (affectedKey.keyType === TelemetryIngestionKeyType.Browser) {
        throw new BadDataException(
          `A Browser ingestion key must keep at least one allowed origin. Clearing the list would stop the key accepting any telemetry - turn the key off or delete it instead. The key's ID is ${affectedKey._id}.`,
        );
      }
    }
  }

  /*
   * Refuse an update that would loosen a Mobile key (issue #6457) - its pin
   * cleared, or origins it cannot use listed - when any row the update
   * matches is one. Read and held as assertNoBrowserKeyIsBeingUpdated is.
   */
  private async assertNoMobileKeyIsBeingUpdated(
    updateBy: UpdateBy<Model>,
    message: string,
  ): Promise<void> {
    const affectedKeys: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        keyType: true,
      },
    );

    for (const affectedKey of affectedKeys) {
      if (affectedKey.keyType === TelemetryIngestionKeyType.Mobile) {
        throw new BadDataException(message);
      }
    }
  }
}

export default new Service();
