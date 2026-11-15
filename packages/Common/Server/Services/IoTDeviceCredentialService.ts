import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import ProjectReferencesService from "./ProjectReferencesService";
import IoTFleetService from "./IoTFleetService";
import IoTFleet from "../../Models/DatabaseModels/IoTFleet";
import GlobalCache from "../Infrastructure/GlobalCache";
import InMemoryTTLCache from "../Infrastructure/InMemoryTTLCache";
import CacheGenerations from "../Infrastructure/CacheGenerations";
import SecretDigest from "../Utils/Telemetry/SecretDigest";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import PositiveNumber from "../../Types/PositiveNumber";
import BadDataException from "../../Types/Exception/BadDataException";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import Model from "../../Models/DatabaseModels/IoTDeviceCredential";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";

/*
 * How long a process keeps a credential it read (getCredentialContext), as
 * TelemetryIngestionKeyService keeps a key: the broker checks the credential
 * again on every publish, through this cache, so a publish never reads
 * Postgres.
 *
 * Each entry is kept under the credential's generation (CacheGenerations),
 * which an update or a delete through this service renews (forgetCredentials):
 * the process that made the change reads the credential again at once, and
 * every other one within CacheGenerations.SHARED_READ_TTL_MS - a second -
 * through Redis (issue #8371). So a credential switched off or deleted cuts
 * its device off within about a second on every server. These TTLs bound
 * what the generation cannot reach: Redis being down, and a credential
 * deleted with its project or fleet, which the database does without hooks.
 * A minute, the same bound the ingestion keys' lookup holds: shorter, and a
 * device that publishes every few seconds would read Postgres on most of
 * its publishes. The shorter negative TTL keeps invalid-credential floods
 * off Postgres without pinning misses for long.
 */
const POSITIVE_TTL_MS: number = 60 * 1000;
const NEGATIVE_TTL_MS: number = 10 * 1000;

// The Redis namespace of the credentials' generations, and how long one is kept.
export const IOT_DEVICE_CREDENTIAL_GENERATION_NAMESPACE: string =
  "iot-device-credential-generation";
const GENERATION_TTL_SECONDS: number = 24 * 60 * 60;

// lastConnectedAt heartbeat writes are throttled through Redis.
const LAST_CONNECTED_CACHE_NAMESPACE: string =
  "iot-device-credential-last-connected";
const LAST_CONNECTED_THROTTLE_SECONDS: number = 60;

// The fleet's two names, ID column first: a write may use either.
const IOT_FLEET_KEYS: Array<string> = ["iotFleetId", "iotFleet"];

/*
 * Everything the MQTT broker needs to authenticate and scope a
 * device-credential CONNECT: the tenant, and the (fleet, device)
 * identity the client is allowed to publish under.
 *
 * The device's secret is kept as its digest (SecretDigest.of), never the
 * secret itself (issue #8371): every credential that connected in the last
 * minute is in this cache, and a heap snapshot, a core file or a debugger
 * reads whatever is in it. The broker compares the digest of the password a
 * device presents with this one.
 */
export interface IoTDeviceCredentialContext {
  credentialId: string;
  projectId: string;
  iotFleetId: string;
  fleetName: string;
  externalId: string;
  secretKeyDigest: string;
}

export class Service extends ProjectReferencesService<Model> {
  /*
   * Each credential's context, under `<credential id>|<generation>`: the
   * context, or null for a credential that is unknown, switched off or
   * incomplete. A change to the credential starts a new generation, so
   * nothing kept from before it is served again.
   */
  private contextCache: InMemoryTTLCache<IoTDeviceCredentialContext | null> =
    new InMemoryTTLCache(10_000);

  /*
   * Each credential's generation: the shared part, from Redis, and this
   * process's own (CacheGenerations). An update or a delete of a credential
   * starts a new one (forgetCredentials): in this process at once, and in
   * every other within a second.
   */
  private generations: CacheGenerations = new CacheGenerations({
    namespace: IOT_DEVICE_CREDENTIAL_GENERATION_NAMESPACE,
    ttlSeconds: GENERATION_TTL_SECONDS,
    maxKeys: 10_000,
    description: "IoT device credentials",
  });

  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    /*
     * Always server-generate the secret. secretKey is a computed
     * column (create ACL []), and computed columns are skipped rather
     * than stripped by the create-permission check — so a
     * client-supplied value would otherwise survive verbatim and
     * defeat the unpredictability the MQTT password relies on.
     */
    createBy.data.secretKey = ObjectID.generate();

    /*
     * The fleet under either of its names, kept in the ID column for the
     * checks below and for the saved row.
     */
    const iotFleetId: ObjectID | null = RelationIdUtil.readIntoIdColumn(
      createBy.data as unknown as Record<string, unknown>,
      IOT_FLEET_KEYS,
      "IoT Fleet",
    );

    /*
     * The project the credential is saved in: the request's - which
     * DatabaseService has written on the row before the hooks, and writes
     * again after them - else the one a write without a project on the
     * request names.
     */
    const projectId: ObjectID | undefined =
      createBy.props.tenantId || createBy.data.projectId || undefined;

    /*
     * The tenant column (projectId) is forced to the caller's project
     * by the framework, but the iotFleetId relation is not — reject a
     * fleet that belongs to another project so a credential cannot be
     * attached to a victim fleet (which would let it steer that
     * fleet's inventory cleanup and mint a cross-tenant auth context).
     */
    await this.validateFleetBelongsToProject({ projectId, iotFleetId });

    /*
     * Byte-exact duplicate guard. The DB unique index is
     * case-sensitive (device.id labels are matched byte-exact), so the
     * check must be too — a case-insensitive @UniqueColumnBy would
     * wrongly reject two legitimately-distinct device ids that differ
     * only in case.
     */
    await this.validateDeviceIdIsUnique({
      projectId,
      iotFleetId,
      externalId: createBy.data.externalId,
    });

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  private async validateFleetBelongsToProject(data: {
    projectId: ObjectID | undefined;
    iotFleetId: ObjectID | null;
  }): Promise<void> {
    if (!data.iotFleetId || !data.projectId) {
      return;
    }

    const fleet: IoTFleet | null = await IoTFleetService.findOneById({
      id: data.iotFleetId,
      select: {
        _id: true,
        projectId: true,
      },
      props: { isRoot: true },
    });

    if (
      !fleet?.projectId ||
      fleet.projectId.toString() !== data.projectId.toString()
    ) {
      throw new BadDataException("IoT Fleet not found in this project.");
    }
  }

  @CaptureSpan()
  private async validateDeviceIdIsUnique(data: {
    projectId: ObjectID | undefined;
    iotFleetId: ObjectID | null;
    externalId: string | undefined;
  }): Promise<void> {
    if (!data.projectId || !data.iotFleetId || !data.externalId) {
      return;
    }

    const existingCount: PositiveNumber = await this.countBy({
      query: {
        projectId: data.projectId,
        iotFleetId: data.iotFleetId,
        externalId: data.externalId,
      },
      props: { isRoot: true },
    });

    if (existingCount.toNumber() > 0) {
      throw new BadDataException(
        "A device with this Device ID is already registered in this fleet.",
      );
    }
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    /*
     * We don't know which credential(s) are being deleted without an
     * extra query; clear the whole cache so revocation-by-delete takes
     * effect on the broker within one cache miss.
     */
    this.contextCache.clear();
    return { deleteBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    // isEnabled flips must reach the broker — same reasoning as delete.
    this.contextCache.clear();
    return { updateBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    /*
     * Clear again AFTER the write commits: the before-hook clear races
     * a concurrent getCredentialContext that could re-cache the stale
     * (pre-revocation) row before the UPDATE lands. A second clear on
     * success closes that window here, and a new generation of each
     * credential closes it on every other server within a second
     * (issue #8371).
     */
    this.contextCache.clear();
    await this.forgetCredentials(updatedItemIds);
    return onUpdate;
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    this.contextCache.clear();
    await this.forgetCredentials(itemIdsBeforeDelete);
    return onDelete;
  }

  /*
   * Starts a new generation of each credential, so nothing read of it
   * before is served again: in this process at once, and in every other
   * through Redis within CacheGenerations.SHARED_READ_TTL_MS. Never throws
   * (CacheGenerations): a change Redis does not take still counts here,
   * and POSITIVE_TTL_MS bounds it everywhere else.
   */
  private async forgetCredentials(
    credentialIds: Array<ObjectID>,
  ): Promise<void> {
    const keys: Array<string> = credentialIds
      .map((credentialId: ObjectID): string => {
        return credentialId ? Service.generationKeyOf(credentialId) : "";
      })
      .filter((key: string): boolean => {
        return Boolean(key);
      });

    if (keys.length === 0) {
      return;
    }

    await this.generations.bump(keys);
  }

  // A credential's id as its generation is kept under: lower-cased.
  private static generationKeyOf(credentialId: ObjectID | string): string {
    return credentialId.toString().trim().toLowerCase();
  }

  /**
   * Resolve a credential id to its auth context, with an in-process cache
   * to keep the MQTT CONNECT/publish hot path off Postgres. Returns null
   * for unknown, disabled, or deleted credentials (also cached, for a
   * shorter TTL). The caller must still compare the digest of the presented
   * secret with context.secretKeyDigest (SecretDigest.matches).
   *
   * Kept under the credential's generation, which an update or delete
   * through this service renews: a credential switched off or deleted is
   * refused at once in the process that made the change, and within
   * CacheGenerations.SHARED_READ_TTL_MS in every other (issue #8371). The
   * generation is read before the row, so a change that lands during the
   * read is never kept under the generation after it.
   */
  @CaptureSpan()
  public async getCredentialContext(
    credentialId: string,
  ): Promise<IoTDeviceCredentialContext | null> {
    /*
     * Validated rather than caught. ObjectID's constructor stores whatever
     * string it is handed and never throws, so the try/catch this replaced
     * caught nothing: a malformed id reached Postgres as an invalid uuid
     * literal, which errors on every attempt AND skipped the negative cache
     * below, because the row was never absent - the query failed. credentialId
     * is an MQTT username, so it is attacker-controlled, and that made the
     * negative cache bypassable with random garbage. Same guard, and the same
     * reason for it, as ProjectAuthorization's API-key check. Nothing is kept
     * for a malformed id: refusing it costs less than looking it up, and an
     * attacker's username never becomes a cache entry, nor a Redis read.
     */
    if (!ObjectID.isValidUUID(credentialId)) {
      return null;
    }

    const generationKey: string = Service.generationKeyOf(credentialId);

    // The credential's generation as it stands before the read: never throws.
    const generation: string = await this.generations.get(generationKey);
    const cacheKey: string = `${generationKey}|${generation}`;

    const cached: IoTDeviceCredentialContext | null | undefined =
      this.contextCache.get(cacheKey);
    if (cached !== undefined) {
      return cached ? { ...cached } : null;
    }

    const idObject: ObjectID = new ObjectID(generationKey);

    const credential: Model | null = await this.findOneBy({
      query: { _id: idObject },
      select: {
        projectId: true,
        iotFleetId: true,
        externalId: true,
        secretKey: true,
        isEnabled: true,
        iotFleet: {
          name: true,
        },
      },
      props: { isRoot: true },
    });

    if (
      !credential ||
      credential.isEnabled === false ||
      !credential.projectId ||
      !credential.iotFleetId ||
      !credential.externalId ||
      !credential.secretKey ||
      !credential.iotFleet?.name
    ) {
      this.contextCache.set(cacheKey, null, NEGATIVE_TTL_MS);
      return null;
    }

    const context: IoTDeviceCredentialContext = {
      credentialId: generationKey,
      projectId: credential.projectId.toString(),
      iotFleetId: credential.iotFleetId.toString(),
      fleetName: credential.iotFleet.name,
      externalId: credential.externalId,
      secretKeyDigest: SecretDigest.of(credential.secretKey.toString()),
    };

    this.contextCache.set(cacheKey, context, POSITIVE_TTL_MS);
    return { ...context };
  }

  /**
   * Stamp lastConnectedAt for a credential, throttled to one write
   * per minute per credential (heartbeat write — same hot-row
   * pattern as IoTFleetService.updateLastSeen).
   */
  @CaptureSpan()
  public async markConnected(credentialId: ObjectID): Promise<void> {
    const cacheKey: string = credentialId.toString();

    let cached: string | null = null;
    try {
      cached = await GlobalCache.getString(
        LAST_CONNECTED_CACHE_NAMESPACE,
        cacheKey,
      );
    } catch {
      /*
       * Fail open: a Redis blip must never skip the DB write —
       * lastConnectedAt drives the registry UI's liveness column.
       */
      cached = null;
    }

    if (cached === "1") {
      return;
    }

    try {
      await GlobalCache.setString(
        LAST_CONNECTED_CACHE_NAMESPACE,
        cacheKey,
        "1",
        {
          expiresInSeconds: LAST_CONNECTED_THROTTLE_SECONDS,
        },
      );
    } catch (err) {
      logger.debug(
        `IoTDeviceCredential markConnected cache write failed: ${err}`,
      );
    }

    /*
     * Single no-hooks, no-version-bump UPDATE — a heartbeat write must
     * not contend on hooks or lock convoys at connect storms.
     */
    await this.updateColumnsByIdWithoutHooks({
      id: credentialId,
      data: {
        lastConnectedAt: OneUptimeDate.getCurrentDate(),
      },
    });
  }

  /**
   * The expected-device set for a fleet — ENABLED registered device
   * ids, VERBATIM (device.id labels are matched byte-exact; do not
   * canonicalize). Feeds ONLY the absent-series injection in IoT
   * Device monitor evaluation.
   *
   * Note: stale-cleanup preservation (IoTDeviceService.deleteStaleForFleet)
   * deliberately does NOT use this method — it preserves any
   * non-deleted credential row regardless of isEnabled, so a revoked
   * (disabled) device stays in the inventory as Offline until its
   * credential row is deleted, while its silent-death alerting pauses.
   */
  @CaptureSpan()
  public async getExpectedDeviceExternalIds(data: {
    projectId: ObjectID;
    iotFleetId: ObjectID;
  }): Promise<Array<string>> {
    const credentials: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
        iotFleetId: data.iotFleetId,
        isEnabled: true,
      },
      select: {
        externalId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });

    const externalIds: Array<string> = [];
    for (const credential of credentials) {
      if (credential.externalId) {
        externalIds.push(credential.externalId);
      }
    }
    return externalIds;
  }
}

export default new Service();
