import ProjectReferencesService, {
  ProjectReferenceWrite,
} from "./ProjectReferencesService";
import StorageArrayService from "./StorageArrayService";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import Select from "../Types/Database/Select";
import UpdateBy from "../Types/Database/UpdateBy";
import StorageArrayConnectionRules, {
  STORAGE_ARRAY_CONNECTION_SAVED_SELECT,
  StorageArrayConnectionChange,
} from "../Utils/StorageArray/StorageArrayConnectionRules";
import StorageArrayProbeCollectionStore, {
  StorageArrayCollectionReportOutcome,
} from "../Utils/StorageArray/StorageArrayProbeCollectionStore";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import Model from "../../Models/DatabaseModels/StorageArrayConnection";
import StorageArray from "../../Models/DatabaseModels/StorageArray";
import ObjectID from "../../Types/ObjectID";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import {
  StorageArrayCollectionJob,
  StorageArrayCollectionReport,
} from "../../Types/StorageArray/Collection/StorageArrayProbeCollection";

/*
 * Storage array connections (#11004): the management servers - a Unisphere
 * for PowerMax - a probe reads every array behind. Each write of a setting
 * is checked and normalized before it is saved (StorageArrayConnectionRules),
 * and the columns only the server writes follow once it is saved.
 */

interface StorageArrayConnectionCarryForward {
  storageArrayConnectionChanges?:
    | Array<StorageArrayConnectionChange>
    | undefined;
}

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * The probe is checked here: it may be one of the instance's global
   * probes on a self-hosted install (StorageArrayConnectionRules
   * .assertProbeCanCollect).
   */
  protected override getRelationsCheckedByService(
    _write?: ProjectReferenceWrite,
  ): Array<string> {
    return ["collectionProbe"];
  }

  @CaptureSpan()
  public async claimForCollection(data: {
    probeId: ObjectID;
    runningStorageArrayConnectionIds: Array<string>;
    limit: number;
  }): Promise<Array<StorageArrayCollectionJob>> {
    return await StorageArrayProbeCollectionStore.claimDueConnections(
      this,
      data,
    );
  }

  // Record what a probe found for a connection it collected.
  @CaptureSpan()
  public async recordCollectionReport(data: {
    probeId: ObjectID;
    report: StorageArrayCollectionReport;
  }): Promise<StorageArrayCollectionReportOutcome> {
    return await StorageArrayProbeCollectionStore.recordCollectionReport(
      this,
      data,
    );
  }

  /*
   * The names in OneUptime of a project's arrays of one platform, by their
   * own identifier (StorageArray.systemId): what each array's batch is
   * stamped with, so an array renamed in OneUptime stays the same array.
   * An identifier with no row yet is left out: its batch is named after
   * the identifier, and the row is made under that name.
   */
  @CaptureSpan()
  public async getArrayNamesBySystemId(data: {
    projectId: ObjectID;
    storageSystem: string;
    systemIds: Array<string>;
  }): Promise<Map<string, string>> {
    const names: Map<string, string> = new Map();
    const systemIds: Array<string> = Array.from(
      new Set(
        data.systemIds.filter((id: string): boolean => {
          return typeof id === "string" && id.trim().length > 0;
        }),
      ),
    );
    if (systemIds.length === 0) {
      return names;
    }

    const arrays: Array<StorageArray> = await StorageArrayService.findBy({
      query: {
        projectId: data.projectId,
        storageSystem: data.storageSystem,
        systemId: QueryHelper.any(systemIds),
      },
      select: {
        _id: true,
        name: true,
        systemId: true,
        createdAt: true,
      },
      sort: {
        createdAt: SortOrder.Ascending,
      },
      limit: systemIds.length * 4,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    // The oldest row of an identifier wins: the first one ingest made.
    for (const array of arrays) {
      if (array.systemId && array.name && !names.has(array.systemId)) {
        names.set(array.systemId, array.name);
      }
    }

    return names;
  }

  // The server-only columns a settings write decides, written hook-free.
  private async writeConnectionServerColumns(write: {
    storageArrayConnectionId: ObjectID;
    values: Record<string, unknown>;
    bumpSettingsVersion: boolean;
  }): Promise<void> {
    if (write.bumpSettingsVersion) {
      await this.atomicAddToColumnsByIdWithoutHooks({
        id: write.storageArrayConnectionId,
        add: { collectionSettingsVersion: 1 },
        set: write.values as never,
      });
      return;
    }

    await this.updateColumnsByIdWithoutHooks({
      id: write.storageArrayConnectionId,
      data: write.values as never,
    });
  }

  private async afterConnectionWrites(
    changes: Array<StorageArrayConnectionChange>,
  ): Promise<void> {
    for (const change of changes) {
      await StorageArrayConnectionRules.afterWrite({
        change: change,
        writeServerColumns: async (write: {
          storageArrayConnectionId: ObjectID;
          values: Record<string, unknown>;
          bumpSettingsVersion: boolean;
        }): Promise<void> => {
          await this.writeConnectionServerColumns(write);
        },
      });
    }
  }

  /*
   * A create answers with the row it saved, serialized whole, and the row
   * holds the password, encrypted: nothing needs it back.
   */
  @CaptureSpan()
  public override async create(createBy: CreateBy<Model>): Promise<Model> {
    const created: Model = await super.create(createBy);
    (created as unknown as Record<string, unknown>)["password"] = undefined;
    return created;
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    const change: StorageArrayConnectionChange =
      await StorageArrayConnectionRules.prepareCreate(createBy);

    const carryForward: StorageArrayConnectionCarryForward = {
      storageArrayConnectionChanges: [change],
    };

    return { createBy, carryForward: carryForward };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const carryForward: StorageArrayConnectionCarryForward | null =
      (onCreate.carryForward as StorageArrayConnectionCarryForward | null) ||
      null;

    if (createdItem.id && carryForward?.storageArrayConnectionChanges) {
      await this.afterConnectionWrites(
        carryForward.storageArrayConnectionChanges.map(
          (change: StorageArrayConnectionChange) => {
            return {
              ...change,
              storageArrayConnectionId: createdItem.id!,
            };
          },
        ),
      );
    }

    return createdItem;
  }

  /*
   * Settings are checked against the row they change - the saved password
   * is bound to its address, probe and certificate - and normalized in
   * place.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    if (
      !StorageArrayConnectionRules.isConnectionWrite(
        updateBy.data as unknown as Record<string, unknown>,
      )
    ) {
      return { updateBy, carryForward: null };
    }

    const saved: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      STORAGE_ARRAY_CONNECTION_SAVED_SELECT as Select<Model>,
    );

    const changes: Array<StorageArrayConnectionChange> =
      await StorageArrayConnectionRules.prepareUpdate({
        updateBy: updateBy,
        saved: saved.map((row: Model) => {
          return {
            _id: row._id?.toString(),
            projectId: row.projectId,
            storageSystem: row.storageSystem,
            address: row.address,
            username: row.username,
            isPasswordSet: row.isPasswordSet,
            collectionProbeId: row.collectionProbeId,
            trustedCertificateFingerprint: row.trustedCertificateFingerprint,
            presentedCertificate: row.presentedCertificate,
          };
        }),
      });

    const carryForward: StorageArrayConnectionCarryForward = {
      storageArrayConnectionChanges: changes,
    };

    return { updateBy, carryForward: carryForward };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const carryForward: StorageArrayConnectionCarryForward | null =
      (onUpdate.carryForward as StorageArrayConnectionCarryForward | null) ||
      null;

    if (carryForward?.storageArrayConnectionChanges?.length) {
      const updatedIds: Set<string> = new Set(
        updatedItemIds.map((id: ObjectID): string => {
          return id.toString();
        }),
      );

      await this.afterConnectionWrites(
        carryForward.storageArrayConnectionChanges.filter(
          (change: StorageArrayConnectionChange): boolean => {
            return (
              Boolean(change.storageArrayConnectionId) &&
              updatedIds.has(change.storageArrayConnectionId!.toString())
            );
          },
        ),
      );
    }

    return onUpdate;
  }
}

export default new Service();
