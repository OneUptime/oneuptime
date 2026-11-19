import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import FindBy from "../Types/Database/FindBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnFind, OnUpdate } from "../Types/Database/Hooks";
import ApiKeyPermissionService from "./ApiKeyPermissionService";
import DatabaseService from "./DatabaseService";
import DatabaseRequestType from "../Types/BaseDatabase/DatabaseRequestType";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import HashedString from "../../Types/HashedString";
import ObjectID from "../../Types/ObjectID";
import QueryHelper from "../Types/Database/QueryHelper";
import Model from "../../Models/DatabaseModels/ApiKey";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import InMemoryTTLCache from "../Infrastructure/InMemoryTTLCache";
import HashedApiKey, {
  API_KEY_HINT_PATTERN,
} from "../Utils/APIKey/HashedApiKey";
import { TranslatedPostgresException } from "../Utils/Database/PostgresErrorTranslator";
import logger from "../Utils/Logger";

/*
 * 60s is the worst-case staleness on any single API node after a key is
 * revoked from the dashboard. We invalidate in-process immediately on
 * delete/update; this TTL is the upper bound for *other* processes.
 */
const POSITIVE_TTL_MS: number = 60 * 1000;
/*
 * Short TTL on misses so an invalid-key flood can't pin entries in the
 * bounded cache for long while still absorbing repeat hits.
 */
const NEGATIVE_TTL_MS: number = 10 * 1000;

/*
 * How long a process goes by what it last found about keys stored as they
 * were written (mayHoldKeysStoredAsWritten), before it asks again.
 */
export const KEYS_STORED_AS_WRITTEN_CHECK_TTL_MS: number = 60 * 1000;

/*
 * A key as it was stored before keys were hashed: a uuid, which the schema
 * migration ApiKeyHashedColumn turned into its text. A digest never is one
 * (HashedApiKey.isStoredAsWritten).
 */
export const KEY_STORED_AS_WRITTEN_SQL_PATTERN: string =
  "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

// What a write of an API key through the API is told.
export const API_KEY_WRITTEN_HERE_MESSAGE: string =
  "An API key cannot be set through the API. Reset it on its page under Project Settings > Advanced > API Keys, or with POST /api-key/:id/reset-key, which answers the new key once.";

// The columns a key is written in: its hash and its hint, always together.
const KEY_COLUMNS: ReadonlyArray<keyof Model> = ["apiKey", "apiKeyHint"];

// Postgres's refusal of a value it cannot read as a uuid (invalid_text_representation).
const INVALID_TEXT_REPRESENTATION: string = "22P02";

/*
 * Whether a lookup failed because the key column is still a uuid, which no
 * hash is: Postgres refuses the hash (22P02), as PostgresErrorTranslator
 * tags it, or the driver's own error says.
 */
const isRefusedAsNoUuid: (error: unknown) => boolean = (
  error: unknown,
): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const record: {
    postgresErrorCode?: unknown;
    code?: unknown;
    driverError?: { code?: unknown };
  } = error as TranslatedPostgresException & {
    code?: unknown;
    driverError?: { code?: unknown };
  };

  return [
    record.postgresErrorCode,
    record.code,
    record.driverError?.code,
  ].includes(INVALID_TEXT_REPRESENTATION);
};

interface CachedApiKey {
  id: string;
  projectId: string;
  name: string | null;
  // When the key stops working, in ms since the epoch: a hit past it is a miss.
  expiresAt: number | null;
}

export interface ResolvedApiKey {
  id: ObjectID;
  projectId: ObjectID;

  /*
   * The key's display name, for the audit trail: "which key did this" is
   * answered by a name an administrator recognises, not by an id. Never part
   * of an authorization decision. Up to a minute stale on other nodes after
   * a rename, like everything else this cache holds.
   */
  name?: string | undefined;
}

// A key just made: the key itself, answered once, and the hint kept of it.
export interface MadeApiKey {
  apiKey: string;
  apiKeyHint: string;
}

// What onBeforeCreate hands onCreateSuccess: the key it made.
interface CreateCarryForward {
  apiKey: string;
}

/*
 * A PROJECT'S API KEYS, STORED HASHED (#8902).
 *
 * A key is made here, on the server (HashedApiKey.generate), and stored as
 * its hash with its hint (its last four characters): when a key is created
 * (onBeforeCreate) and when it is reset (resetApiKey). The key itself is
 * answered once - to the create that made it (onCreateSuccess hands it on
 * the created record, which BaseAPI answers), and to the reset - and never
 * again: nobody reads it or its hash through the API (onBeforeFind), and
 * nobody but OneUptime writes either (assertKeyWrittenByOneUptime).
 *
 * A request's key is looked up by its hash (findApiKey). A key stored
 * before keys were hashed is its uuid, until the HashProjectApiKeys data
 * migration hashes it; until then, a key not found by its hash is looked up
 * as it was written - only while some key may still be stored so
 * (mayHoldKeysStoredAsWritten), so that once every key is hashed, no key a
 * request presents goes into a query.
 */
export class Service extends DatabaseService<Model> {
  /*
   * Cache of `hash(apiKey) -> { id, projectId, name }`. The project-auth
   * middleware hits this on every API-key-authenticated request; without it
   * that's a Postgres findOneBy per request for automated callers. Keyed by
   * the key's hash, so what the process keeps is no key.
   */
  private apiKeyCache: InMemoryTTLCache<CachedApiKey | null> =
    new InMemoryTTLCache(10_000);

  /*
   * What this process last found about keys stored as they were written,
   * and when: null until it first asks.
   */
  private keysStoredAsWritten: {
    mayRemain: boolean;
    checkedAt: number;
  } | null = null;

  public constructor() {
    super(Model);
  }

  /*
   * A new key for the record: its hash and its hint go into the write, and
   * the key itself is carried to onCreateSuccess, for the create's answer.
   * Whatever the caller sent for either is replaced: a key is the server's
   * to make.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const apiKey: string = HashedApiKey.generate();

    createBy.data.apiKey = new HashedString(HashedApiKey.hash(apiKey), true);
    createBy.data.apiKeyHint = HashedApiKey.getHint(apiKey);

    const carryForward: CreateCarryForward = { apiKey: apiKey };

    return { createBy, carryForward: carryForward };
  }

  /*
   * THE ONE ANSWER THAT HOLDS THE KEY. The record is written, with the key's
   * hash; the record handed back to the create's caller holds the key
   * itself in its place (a HashedString not yet hashed: the value whose hash
   * is stored), so BaseAPI's answer to POST /api-key carries it, once. It is
   * not written again: nothing after this saves the record, and the audit
   * log leaves the column out (nobody may read it).
   */
  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const carryForward: CreateCarryForward | null =
      (onCreate.carryForward as CreateCarryForward | null) || null;

    if (carryForward?.apiKey) {
      createdItem.apiKey = new HashedString(carryForward.apiKey);
    }

    return createdItem;
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    this.assertKeyWrittenByOneUptime(updateBy.data);

    /*
     * We don't know which keys are being updated without a query; updates
     * are rare so clearing is cheap.
     */
    this.apiKeyCache.clear();
    return { updateBy, carryForward: null };
  }

  /*
   * A KEY'S NEW VALUE GOES ONLY TO WHO COULD GIVE IT ALL IT HOLDS. A reset
   * (resetApiKey) answers the key's new value to whoever made it, and with
   * the value everything the key may do: its own permissions and the
   * copies of its custom roles. Someone who could not give a key those
   * permissions themselves would hold, through it, more than they were
   * given - a Project Admin resetting the project's Project Owner key, or
   * someone with Edit API Key using the key that gave a workflow its Run As
   * (#9765) to change that workflow, which only that permission's holders
   * may. So a write of the key is held to the grant ceiling each of the
   * key's permissions met when it was given
   * (ApiKeyPermissionService.assertCallerCanGrantPermission), for every
   * permission it allows - a block only takes away. A key resetting itself
   * holds all of its own. OneUptime's own writes, and a master admin, are
   * not held to it, as they are not when they give a key a permission.
   */
  @CaptureSpan()
  protected override async onUpdatePermitted(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const data: Record<string, unknown> = updateBy.data as Record<
      string,
      unknown
    >;

    if (
      updateBy.props.isRoot ||
      updateBy.props.isMasterAdmin ||
      data["apiKey"] === undefined
    ) {
      return;
    }

    const keys: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        projectId: true,
        name: true,
      },
    );

    for (const key of keys) {
      if (!key.id || !key.projectId) {
        continue;
      }

      await ApiKeyPermissionService.assertCallerCanTakeKey({
        apiKeyId: key.id,
        apiKeyName: key.name?.toString() || "",
        projectId: key.projectId,
        props: updateBy.props,
      });
    }
  }

  /*
   * And again once the change is written: a request between the clear above
   * and the write would have cached the key as it was - a reset key's old
   * value, an expiry pulled in - for another minute.
   */
  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    _updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    this.apiKeyCache.clear();
    return onUpdate;
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    this.apiKeyCache.clear();
    return { deleteBy, carryForward: null };
  }

  // See onUpdateSuccess: a deleted key is not cached again in between.
  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    this.apiKeyCache.clear();
    return onDelete;
  }

  @CaptureSpan()
  protected override async onBeforeFind(
    findBy: FindBy<Model>,
  ): Promise<OnFind<Model>> {
    return { findBy: this.dropKeyFromRead(findBy), carryForward: null };
  }

  /*
   * The key's hash, left out of what any caller but OneUptime selects: no
   * reader needs it - the key is shown once, when it is made - and a client
   * written when the key could be read back (an earlier Terraform provider,
   * a script) still selects it. Dropped rather than refused, so such a
   * client keeps working and is answered everything else. A filter on it is
   * refused by the read check (nobody may read the column): dropped, it
   * would widen the query to every key.
   */
  public dropKeyFromRead(findBy: FindBy<Model>): FindBy<Model> {
    if (
      findBy.props.isRoot ||
      !findBy.select ||
      typeof findBy.select !== "object" ||
      !Object.prototype.hasOwnProperty.call(findBy.select, "apiKey")
    ) {
      return findBy;
    }

    const select: Record<string, unknown> = {
      ...(findBy.select as Record<string, unknown>),
    };

    delete select["apiKey"];

    return { ...findBy, select: select as FindBy<Model>["select"] };
  }

  /*
   * Refuses a write of a key that OneUptime did not make: a key - or its
   * hint - is written only by onBeforeCreate and resetApiKey, which write
   * the key's hash, as a HashedString already hashed, with its hint. That
   * is something no request can send: a HashedString read from JSON is
   * still to be hashed, and the write path would hash it without the key's
   * own rules, as a key a client chose. An explicit null counts as a write:
   * clearing the key takes it away as surely as replacing it.
   */
  public assertKeyWrittenByOneUptime(data: unknown): void {
    const record: Record<string, unknown> | undefined = data as
      | Record<string, unknown>
      | undefined;

    const isWritten: boolean = KEY_COLUMNS.some(
      (column: keyof Model): boolean => {
        return record?.[column as string] !== undefined;
      },
    );

    if (!isWritten) {
      return;
    }

    const apiKey: unknown = record?.["apiKey"];

    if (
      !(apiKey instanceof HashedString) ||
      !apiKey.isValueHashed() ||
      !HashedApiKey.isHash(apiKey.toString())
    ) {
      throw new NotAuthorizedException(API_KEY_WRITTEN_HERE_MESSAGE);
    }

    const apiKeyHint: unknown = record?.["apiKeyHint"];

    if (
      typeof apiKeyHint !== "string" ||
      !API_KEY_HINT_PATTERN.test(apiKeyHint)
    ) {
      throw new BadDataException(
        "An API key is written with its hint, its last four characters. Make it with ApiKeyService.resetApiKey.",
      );
    }
  }

  /*
   * Makes the record's key a new one (Reset API Key on the key's page,
   * POST /api-key/:id/reset-key): a new random key in place of the one
   * before, which stops working - at once on this server, within a minute
   * on the others (POSITIVE_TTL_MS) - stored as its hash, with its hint.
   *
   * Written with the caller's props, so a reset asks what a change of the
   * key always asked: the record's update rule, the key column's own update
   * access (Project Owner, Project Admin or Edit API Key), the project's
   * plan, and the record being theirs to change. The audit log records who
   * reset it, and that the key changed - never the key.
   *
   * Answers the key: it is never stored, logged or sent again.
   */
  @CaptureSpan()
  public async resetApiKey(data: {
    id: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<MadeApiKey> {
    const apiKey: string = HashedApiKey.generate();
    const apiKeyHint: string = HashedApiKey.getHint(apiKey);

    const updated: number = await this.updateOneById({
      id: data.id,
      data: {
        apiKey: new HashedString(HashedApiKey.hash(apiKey), true),
        apiKeyHint: apiKeyHint,
      },
      props: data.props,
    });

    if (updated === 0) {
      throw await this.getUnwrittenByIdError({
        id: data.id,
        props: data.props,
        type: DatabaseRequestType.Update,
      });
    }

    return { apiKey: apiKey, apiKeyHint: apiKeyHint };
  }

  /**
   * Resolves an API key string to its row, with a short-lived in-process
   * cache. Returns null for unknown or expired keys (also cached, for a
   * shorter TTL). Use this from the auth middleware hot path instead of
   * calling `findOneBy` directly.
   *
   * The key is looked up by its hash: an indexed lookup of a high-entropy
   * value, so no constant-time compare is needed, and the query holds no
   * key. A key stored before keys were hashed is looked up as it was
   * written, only while one may still be stored so.
   */
  @CaptureSpan()
  public async findApiKey(apiKey: ObjectID): Promise<ResolvedApiKey | null> {
    const normalizedKey: string | null = HashedApiKey.normalize(apiKey);

    // No uuid is no key: nothing to read for it.
    if (!normalizedKey) {
      return null;
    }

    const keyHash: string = HashedApiKey.hash(normalizedKey);
    const cacheKey: string = keyHash;
    const cached: CachedApiKey | null | undefined =
      this.apiKeyCache.get(cacheKey);
    if (cached !== undefined) {
      if (cached === null) {
        return null;
      }

      /*
       * A key that expired while cached stops working when it expires, not
       * up to a minute later: it is looked up again, and found expired.
       */
      if (cached.expiresAt !== null && cached.expiresAt <= Date.now()) {
        this.apiKeyCache.delete(cacheKey);
        return await this.findApiKey(apiKey);
      }

      return {
        id: new ObjectID(cached.id),
        projectId: new ObjectID(cached.projectId),
        ...(cached.name ? { name: cached.name } : {}),
      };
    }

    let row: Model | null = await this.findLiveKeyByHash(keyHash);

    if (!row && (await this.mayHoldKeysStoredAsWritten())) {
      row = await this.findLiveKeyStoredAs(normalizedKey);
    }

    if (!row || !row.id || !row.projectId) {
      this.apiKeyCache.set(cacheKey, null, NEGATIVE_TTL_MS);
      return null;
    }

    const name: string | null = row.name ? row.name.toString() : null;

    this.apiKeyCache.set(
      cacheKey,
      {
        id: row.id.toString(),
        projectId: row.projectId.toString(),
        name,
        expiresAt: row.expiresAt
          ? OneUptimeDate.fromString(row.expiresAt).getTime()
          : null,
      },
      POSITIVE_TTL_MS,
    );
    return {
      id: row.id,
      projectId: row.projectId,
      ...(name ? { name } : {}),
    };
  }

  /*
   * The live key with this hash. A server that started before the schema
   * migration ApiKeyHashedColumn ran - one told not to wait for it
   * (DATABASE_MIGRATION_WAIT_TIMEOUT_MS=0) - still finds the key column a
   * uuid, which no hash is: Postgres refuses the hash, and no key is found
   * by it, so the key is looked up as written, as it is stored there.
   */
  private async findLiveKeyByHash(keyHash: string): Promise<Model | null> {
    try {
      return await this.findLiveKeyStoredAs(keyHash);
    } catch (err) {
      if (isRefusedAsNoUuid(err)) {
        return null;
      }

      throw err;
    }
  }

  // The live key stored as this value - a key's hash, or a key as written.
  private async findLiveKeyStoredAs(
    storedValue: string,
  ): Promise<Model | null> {
    return await this.findOneBy({
      query: {
        apiKey: new HashedString(storedValue, true),
        expiresAt: QueryHelper.greaterThan(OneUptimeDate.getCurrentDate()),
      },
      select: {
        _id: true,
        projectId: true,
        name: true,
        expiresAt: true,
      },
      props: { isRoot: true },
    });
  }

  /*
   * Whether a key may still be stored as it was written, before keys were
   * hashed: until the HashProjectApiKeys data migration has hashed them all
   * - and, through a rolling upgrade, while a server of the release before
   * may still make one. Asked of the database at most once a minute per
   * process, and only when a key is not found by its hash; once no key is
   * stored so, no key a request presents goes into a query. A question the
   * database does not answer counts as yes: an upgrade must not lock
   * anyone out.
   */
  public async mayHoldKeysStoredAsWritten(): Promise<boolean> {
    const now: number = Date.now();

    if (
      this.keysStoredAsWritten &&
      now - this.keysStoredAsWritten.checkedAt <
        KEYS_STORED_AS_WRITTEN_CHECK_TTL_MS
    ) {
      return this.keysStoredAsWritten.mayRemain;
    }

    let mayRemain: boolean = true;

    try {
      const rows: unknown = await this.getRepository().query(
        `SELECT 1 FROM "${this.getRepository().metadata.tableName}" WHERE "deletedAt" IS NULL AND "apiKey" ~* '${KEY_STORED_AS_WRITTEN_SQL_PATTERN}' LIMIT 1`,
      );

      mayRemain = Array.isArray(rows) && rows.length > 0;
    } catch (err) {
      logger.error(
        "ApiKeyService: could not tell whether an API key is still stored as it was written; keys are looked up as written too until it can:",
      );
      logger.error(err);
    }

    this.keysStoredAsWritten = { mayRemain: mayRemain, checkedAt: now };

    return mayRemain;
  }
}

export default new Service();
