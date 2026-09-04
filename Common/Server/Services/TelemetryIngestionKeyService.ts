import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import Query from "../Types/Database/Query";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import Model from "../../Models/DatabaseModels/TelemetryIngestionKey";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import InMemoryTTLCache from "../Infrastructure/InMemoryTTLCache";
import BadDataException from "../../Types/Exception/BadDataException";
import ColumnLength from "../../Types/Database/ColumnLength";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import TelemetryIngestionKeyPolicy from "../../Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "../../Types/Telemetry/TelemetryIngestionKeyType";
import OriginAllowList from "../../Utils/Telemetry/OriginAllowList";
import logger from "../Utils/Logger";
import { createHash } from "crypto";

/*
 * 60s is the worst-case staleness on any single API node after a key is
 * revoked from the dashboard. We invalidate in-process immediately on
 * delete/update; this TTL is the upper bound for *other* processes.
 *
 * This bound now covers more than "which project does this token belong to":
 * it also covers the kill switch, the expiry, the origin allowlist and the
 * rate limit. That is a deliberate trade. Turning a compromised key off still
 * takes effect within a minute everywhere, which is fast enough for a control
 * whose whole point is to stop a leak that has already happened, and paying a
 * Postgres round trip per ingest request to shave that to zero would cost far
 * more than it buys on a path that runs thousands of times a second.
 */
const POSITIVE_TTL_MS: number = 60 * 1000;
/*
 * Short TTL on misses so an invalid-token flood can't pin entries in the
 * bounded cache for long while still absorbing repeat hits.
 */
const NEGATIVE_TTL_MS: number = 10 * 1000;

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
}

export class Service extends DatabaseService<Model> {
  private policyCache: InMemoryTTLCache<CachedIngestionKeyPolicy | null> =
    new InMemoryTTLCache(10_000);

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
       * valid on both key types, and the overwhelmingly common update (rename,
       * toggle isEnabled, set an expiry) does not touch allowedOrigins at all
       * and therefore reads nothing extra.
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
     * Same reasoning as onBeforeDelete. The cached policy now carries the kill
     * switch, the expiry, the origin allowlist and the rate limit, so almost
     * any edit to this table invalidates it - clearing wholesale stays the
     * right call, and doing it after validation avoids churning the cache for
     * an update that is about to be rejected.
     */
    this.policyCache.clear();
    return { updateBy, carryForward: null };
  }

  /**
   * Resolve an ingestion token to the full policy the ingest guards need,
   * with a short-lived in-process cache to keep the hot ingest path off
   * Postgres. Returns null for unknown or malformed tokens (also cached, for a
   * shorter TTL).
   *
   * A returned policy is NOT a decision: a disabled or expired key still
   * resolves. Enforcement belongs to the caller, which knows which ingest
   * surface it is and can therefore say *why* a request was refused.
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

    const cached: CachedIngestionKeyPolicy | null | undefined =
      this.policyCache.get(cacheKey);
    if (cached !== undefined) {
      return cached === null ? null : this.hydratePolicy(cached);
    }

    let secretKeyObjectId: ObjectID;
    try {
      ObjectID.validateUUID(secretKey);
      secretKeyObjectId = new ObjectID(secretKey);
    } catch {
      this.policyCache.set(cacheKey, null, NEGATIVE_TTL_MS);
      return null;
    }

    const token: Model | null = await this.findOneBy({
      query: { secretKey: secretKeyObjectId },
      select: {
        _id: true,
        projectId: true,
        keyType: true,
        allowedOrigins: true,
        pinnedServiceName: true,
        isEnabled: true,
        expiresAt: true,
        requestsPerMinuteLimit: true,
      },
      props: { isRoot: true },
    });

    const projectId: ObjectID | undefined = token?.projectId as
      | ObjectID
      | undefined;

    if (!token || !projectId) {
      this.policyCache.set(cacheKey, null, NEGATIVE_TTL_MS);
      return null;
    }

    const snapshot: CachedIngestionKeyPolicy = this.toCachedPolicy(
      token,
      projectId,
    );

    this.policyCache.set(cacheKey, snapshot, POSITIVE_TTL_MS);
    return this.hydratePolicy(snapshot);
  }

  /**
   * Resolve an ingestion token to its projectId.
   *
   * Unchanged in signature and in meaning: it is a LOOKUP, and it answers
   * "which project owns this token" for any token that exists. It deliberately
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
     * that is not exactly "Browser" resolves to Server, which is the
     * historical behaviour in full: no origin checks, every ingest surface, no
     * default rate limit, no pinned service name.
     *
     * Written as an allowlist of the ONE restrictive value rather than a
     * lookup that falls back on failure, so that a typo, a truncated column, a
     * partially applied migration or a hand-edited row can never accidentally
     * relax a Browser key into a Server key. The failure direction here is
     * always towards "behaves like it always did", never towards "quietly
     * gained privileges".
     */
    const keyType: TelemetryIngestionKeyType =
      token.keyType === TelemetryIngestionKeyType.Browser
        ? TelemetryIngestionKeyType.Browser
        : TelemetryIngestionKeyType.Server;

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

    return {
      ingestionKeyId: ingestionKeyId,
      projectId: projectId.toString(),
      keyType: keyType,
      allowedOrigins: allowedOrigins,
      pinnedServiceName: pinnedServiceName,
      isEnabled: isEnabled,
      expiresAtIso: expiresAtIso,
      requestsPerMinuteLimit: requestsPerMinuteLimit,
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

    throw new BadDataException(
      `"${String(value)}" is not a valid ingestion key type. Use "${
        TelemetryIngestionKeyType.Server
      }" or "${TelemetryIngestionKeyType.Browser}".`,
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
   * The read runs as root because it is a policy check, not a data return: it
   * must see every row the update will actually touch, including ones the
   * caller could not read. The caller's tenant is still applied when the query
   * does not name a project itself, so a broad query cannot be tricked into
   * failing this check because of some other project's key.
   */
  private async assertNoBrowserKeyIsBeingUpdated(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const query: Query<Model> = { ...updateBy.query };

    if (!query.projectId && updateBy.props.tenantId) {
      query.projectId = updateBy.props.tenantId;
    }

    const affectedKeys: Array<Model> = await this.findBy({
      query: query,
      select: {
        _id: true,
        keyType: true,
      },
      props: {
        isRoot: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    });

    for (const affectedKey of affectedKeys) {
      if (affectedKey.keyType === TelemetryIngestionKeyType.Browser) {
        throw new BadDataException(
          `A Browser ingestion key must keep at least one allowed origin. Clearing the list would stop the key accepting any telemetry - turn the key off or delete it instead. (Key ID: ${affectedKey._id})`,
        );
      }
    }
  }
}

export default new Service();
