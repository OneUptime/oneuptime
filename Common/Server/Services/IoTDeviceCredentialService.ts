import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import IoTFleetService from "./IoTFleetService";
import IoTFleet from "../../Models/DatabaseModels/IoTFleet";
import GlobalCache from "../Infrastructure/GlobalCache";
import InMemoryTTLCache from "../Infrastructure/InMemoryTTLCache";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import PositiveNumber from "../../Types/PositiveNumber";
import BadDataException from "../../Types/Exception/BadDataException";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import Model from "../../Models/DatabaseModels/IoTDeviceCredential";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";

/*
 * Cache TTLs mirror TelemetryIngestionKeyService: the positive TTL is
 * the worst-case revocation lag on the MQTT hot path (the broker
 * re-validates each publish through this cache, so disabling or
 * deleting a credential cuts a connected device off within ~60s);
 * the shorter negative TTL keeps invalid-credential floods off
 * Postgres without pinning misses for long.
 */
const POSITIVE_TTL_MS: number = 60 * 1000;
const NEGATIVE_TTL_MS: number = 10 * 1000;

// lastConnectedAt heartbeat writes are throttled through Redis.
const LAST_CONNECTED_CACHE_NAMESPACE: string =
  "iot-device-credential-last-connected";
const LAST_CONNECTED_THROTTLE_SECONDS: number = 60;

/*
 * Everything the MQTT broker needs to authenticate and scope a
 * device-credential CONNECT: the tenant, and the (fleet, device)
 * identity the client is allowed to publish under.
 */
export interface IoTDeviceCredentialContext {
  credentialId: string;
  projectId: string;
  iotFleetId: string;
  fleetName: string;
  externalId: string;
  secretKey: string;
}

export class Service extends DatabaseService<Model> {
  private contextCache: InMemoryTTLCache<IoTDeviceCredentialContext | null> =
    new InMemoryTTLCache(10_000);

  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    /*
     * Always server-generate the secret. secretKey is a computed
     * column (create ACL []), and computed columns are skipped rather
     * than stripped by the create-permission check — so a
     * client-supplied value would otherwise survive verbatim and
     * defeat the unpredictability the MQTT password relies on.
     */
    createBy.data.secretKey = ObjectID.generate();

    /*
     * The tenant column (projectId) is forced to the caller's project
     * by the framework, but the iotFleetId relation is not — reject a
     * fleet that belongs to another project so a credential cannot be
     * attached to a victim fleet (which would let it steer that
     * fleet's inventory cleanup and mint a cross-tenant auth context).
     */
    await this.validateFleetBelongsToProject(createBy);

    /*
     * Byte-exact duplicate guard. The DB unique index is
     * case-sensitive (device.id labels are matched byte-exact), so the
     * check must be too — a case-insensitive @UniqueColumnBy would
     * wrongly reject two legitimately-distinct device ids that differ
     * only in case.
     */
    await this.validateDeviceIdIsUnique(createBy);

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  private async validateFleetBelongsToProject(
    createBy: CreateBy<Model>,
  ): Promise<void> {
    if (!createBy.data.iotFleetId || !createBy.data.projectId) {
      return;
    }

    const fleet: IoTFleet | null = await IoTFleetService.findOneById({
      id: createBy.data.iotFleetId,
      select: {
        _id: true,
        projectId: true,
      },
      props: { isRoot: true },
    });

    if (
      !fleet?.projectId ||
      fleet.projectId.toString() !== createBy.data.projectId.toString()
    ) {
      throw new BadDataException("IoT Fleet not found in this project.");
    }
  }

  @CaptureSpan()
  private async validateDeviceIdIsUnique(
    createBy: CreateBy<Model>,
  ): Promise<void> {
    if (
      !createBy.data.projectId ||
      !createBy.data.iotFleetId ||
      !createBy.data.externalId
    ) {
      return;
    }

    const existingCount: PositiveNumber = await this.countBy({
      query: {
        projectId: createBy.data.projectId,
        iotFleetId: createBy.data.iotFleetId,
        externalId: createBy.data.externalId,
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
    // isEnabled flips must reach the broker — same reasoning as delete.
    this.contextCache.clear();
    return { updateBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    _updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    /*
     * Clear again AFTER the write commits: the before-hook clear races
     * a concurrent getCredentialContext that could re-cache the stale
     * (pre-revocation) row before the UPDATE lands. A second clear on
     * success closes that window.
     */
    this.contextCache.clear();
    return onUpdate;
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    this.contextCache.clear();
    return onDelete;
  }

  /**
   * Resolve a credential id to its auth context, with a short-lived
   * in-process cache to keep the MQTT CONNECT/publish hot path off
   * Postgres. Returns null for unknown, disabled, or deleted
   * credentials (also cached, for a shorter TTL). The caller must
   * still compare the presented secret against context.secretKey.
   */
  @CaptureSpan()
  public async getCredentialContext(
    credentialId: string,
  ): Promise<IoTDeviceCredentialContext | null> {
    const cached: IoTDeviceCredentialContext | null | undefined =
      this.contextCache.get(credentialId);
    if (cached !== undefined) {
      return cached;
    }

    let idObject: ObjectID;
    try {
      idObject = new ObjectID(credentialId);
    } catch {
      this.contextCache.set(credentialId, null, NEGATIVE_TTL_MS);
      return null;
    }

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
      this.contextCache.set(credentialId, null, NEGATIVE_TTL_MS);
      return null;
    }

    const context: IoTDeviceCredentialContext = {
      credentialId: credentialId,
      projectId: credential.projectId.toString(),
      iotFleetId: credential.iotFleetId.toString(),
      fleetName: credential.iotFleet.name,
      externalId: credential.externalId,
      secretKey: credential.secretKey.toString(),
    };

    this.contextCache.set(credentialId, context, POSITIVE_TTL_MS);
    return context;
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
