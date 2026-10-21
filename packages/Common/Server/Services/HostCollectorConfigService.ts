import ProjectReferencesService from "./ProjectReferencesService";
import HostCollectorConfigVersionService from "./HostCollectorConfigVersionService";
import Model from "../../Models/DatabaseModels/HostCollectorConfig";
import HostCollectorConfigVersion from "../../Models/DatabaseModels/HostCollectorConfigVersion";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import {
  HOST_COLLECTOR_CONFIG_CHANGED_NOTE,
  HOST_COLLECTOR_CONFIG_CREATED_NOTE,
  HostCollectorOsType,
  getHostCollectorConfigRestoredNote,
  isHostCollectorOsType,
} from "../../Types/HostCollector/HostCollector";
import { getHostCollectorDefaultConfig } from "../../Utils/HostCollector/HostCollectorDefaultConfig";
import HostCollectorConfigPolicy, {
  HostCollectorConfigCheckResult,
} from "../Utils/HostCollector/HostCollectorConfigPolicy";
import { getHostCollectorConfigHash } from "../Utils/HostCollector/HostCollectorConfigHash";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import HostCollectorProjectConfigsMemo from "../Utils/HostCollector/HostCollectorProjectConfigsMemo";
import DeleteBy from "../Types/Database/DeleteBy";
import logger from "../Utils/Logger";

// The columns of an update this service reads and writes.
interface ConfigWrite {
  name?: string | undefined;
  osType?: unknown;
  configYaml?: string | null | undefined;
  currentVersionNumber?: number | undefined;
  configHash?: string | undefined;
}

// The version an update writes, handed from onUpdatePermitted to onUpdateSuccess.
interface PendingVersion {
  configId: ObjectID;
  projectId: ObjectID;
  versionNumber: number;
  configYaml: string;
  configHash: string;
  changeNote: string;
  userId: ObjectID | undefined;
}

/*
 * Collector Configs: their YAML is checked on every save
 * (HostCollectorConfigPolicy) and every change to it becomes a version.
 *
 *   - Create: an empty config starts as OneUptime's default for its system;
 *     it is version 1.
 *   - Update: a changed YAML is version n + 1. Saving the YAML of an older
 *     version is how that version is put back, and the new version says so.
 *     The number and the hash are written once the caller has passed every
 *     check (onCreatePermitted, onUpdatePermitted): no caller may write them.
 *
 * Hosts read the configs through HostCollectorAgentService, which picks the
 * one each host runs.
 */
export class Service extends ProjectReferencesService<Model> {
  private pendingVersions: WeakMap<UpdateBy<Model>, PendingVersion> =
    new WeakMap<UpdateBy<Model>, PendingVersion>();

  public constructor() {
    super(Model);
  }

  // The config's YAML, or a refusal that says what is wrong with it.
  public static checkConfigYaml(configYaml: string): void {
    const result: HostCollectorConfigCheckResult =
      HostCollectorConfigPolicy.check(configYaml);

    if (!result.isValid) {
      throw new BadDataException(
        `This config cannot be sent to hosts. ${HostCollectorConfigPolicy.describeProblems(
          result.problems,
        )}`,
      );
    }
  }

  private static checkOsType(osType: unknown): void {
    if (
      osType !== undefined &&
      osType !== null &&
      !isHostCollectorOsType(osType)
    ) {
      throw new BadDataException(
        "System must be linux, windows, darwin (macOS) or any.",
      );
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    const data: Model = createBy.data;

    Service.checkOsType(data.osType);

    if (!data.name || !data.name.trim()) {
      throw new BadDataException("Name is required.");
    }
    data.name = data.name.trim();

    if (!data.configYaml || !data.configYaml.trim()) {
      data.configYaml = getHostCollectorDefaultConfig(
        (data.osType as HostCollectorOsType | undefined) ||
          HostCollectorOsType.Linux,
      );
    }

    Service.checkConfigYaml(data.configYaml);

    return { createBy: createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onCreatePermitted(
    onCreate: OnCreate<Model>,
  ): Promise<void> {
    const data: Model = onCreate.createBy.data;
    data.currentVersionNumber = 1;
    data.configHash = getHostCollectorConfigHash(data.configYaml || "");
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const configYaml: string =
      createdItem.configYaml || onCreate.createBy.data.configYaml || "";

    if (createdItem.projectId) {
      HostCollectorProjectConfigsMemo.forget(createdItem.projectId.toString());
    }

    if (createdItem.id && createdItem.projectId && configYaml) {
      await this.writeVersion({
        configId: createdItem.id,
        projectId: createdItem.projectId,
        versionNumber: 1,
        configYaml: configYaml,
        configHash: getHostCollectorConfigHash(configYaml),
        changeNote: HOST_COLLECTOR_CONFIG_CREATED_NOTE,
        userId: onCreate.createBy.props.userId,
      });
    }

    return createdItem;
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    const data: ConfigWrite = updateBy.data as unknown as ConfigWrite;

    Service.checkOsType(data.osType);

    if (data.name !== undefined) {
      if (!data.name || !data.name.trim()) {
        throw new BadDataException("Name is required.");
      }
      data.name = data.name.trim();
    }

    if (data.configYaml !== undefined) {
      if (!data.configYaml || !data.configYaml.trim()) {
        throw new BadDataException(
          "A config cannot be empty. To go back to OneUptime's default, delete the config.",
        );
      }

      Service.checkConfigYaml(data.configYaml);
    }

    return { updateBy: updateBy, carryForward: null };
  }

  /*
   * A changed YAML becomes the next version. One config at a time: each
   * config's next number is its own.
   */
  @CaptureSpan()
  protected override async onUpdatePermitted(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const data: ConfigWrite = updateBy.data as unknown as ConfigWrite;

    if (typeof data.configYaml !== "string") {
      return;
    }

    const rows: Array<Model> = await this.findBy({
      query: updateBy.query,
      select: {
        _id: true,
        projectId: true,
        currentVersionNumber: true,
        configHash: true,
      },
      limit: 2,
      skip: 0,
      props: { isRoot: true },
    });

    if (rows.length > 1) {
      throw new BadDataException(
        "Change the config of one Collector Config at a time.",
      );
    }

    const row: Model | undefined = rows[0];
    if (!row || !row.id || !row.projectId) {
      return;
    }

    const configHash: string = getHostCollectorConfigHash(data.configYaml);

    if (configHash === row.configHash) {
      return;
    }

    const versionNumber: number = (row.currentVersionNumber || 1) + 1;

    data.currentVersionNumber = versionNumber;
    data.configHash = configHash;

    this.pendingVersions.set(updateBy, {
      configId: row.id,
      projectId: row.projectId,
      versionNumber: versionNumber,
      configYaml: data.configYaml,
      configHash: configHash,
      changeNote: await this.getChangeNote(row.id, configHash),
      userId: updateBy.props.userId,
    });
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const pending: PendingVersion | undefined = this.pendingVersions.get(
      onUpdate.updateBy,
    );

    if (pending) {
      this.pendingVersions.delete(onUpdate.updateBy);
      await this.writeVersion(pending);
    }

    await this.forgetConfigsOf(updatedItemIds);

    return super.onUpdateSuccess(onUpdate, updatedItemIds);
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const onDelete: OnDelete<Model> = await super.onBeforeDelete(deleteBy);
    const rows: Array<Model> = await this.findBy({
      query: deleteBy.query,
      select: { projectId: true },
      limit: 1000,
      skip: 0,
      props: { isRoot: true },
    });

    return {
      deleteBy: onDelete.deleteBy,
      carryForward: {
        projectIds: rows
          .map((row: Model): string => {
            return row.projectId?.toString() || "";
          })
          .filter((id: string): boolean => {
            return Boolean(id);
          }),
      },
    };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const projectIds: Array<string> =
      (onDelete.carryForward?.projectIds as Array<string> | undefined) || [];

    for (const projectId of projectIds) {
      HostCollectorProjectConfigsMemo.forget(projectId);
    }

    return super.onDeleteSuccess(onDelete, itemIdsBeforeDelete);
  }

  // A saved config reaches its hosts with their next poll in this process.
  private async forgetConfigsOf(configIds: Array<ObjectID>): Promise<void> {
    if (configIds.length === 0) {
      return;
    }

    const rows: Array<Model> = await this.findBy({
      query: { _id: configIds[0]! },
      select: { projectId: true },
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    });

    for (const row of rows) {
      if (row.projectId) {
        HostCollectorProjectConfigsMemo.forget(row.projectId.toString());
      }
    }
  }

  // "Put version 3 back" when the YAML is an older version's, else "Changed".
  private async getChangeNote(
    configId: ObjectID,
    configHash: string,
  ): Promise<string> {
    const older: HostCollectorConfigVersion | null =
      await HostCollectorConfigVersionService.findOneBy({
        query: {
          hostCollectorConfigId: configId,
          configHash: configHash,
        },
        select: {
          versionNumber: true,
        },
        sort: {
          versionNumber: SortOrder.Descending,
        },
        props: { isRoot: true },
      });

    if (older?.versionNumber) {
      return getHostCollectorConfigRestoredNote(older.versionNumber);
    }

    return HOST_COLLECTOR_CONFIG_CHANGED_NOTE;
  }

  private async writeVersion(pending: PendingVersion): Promise<void> {
    try {
      const version: HostCollectorConfigVersion =
        new HostCollectorConfigVersion();
      version.projectId = pending.projectId;
      version.hostCollectorConfigId = pending.configId;
      version.versionNumber = pending.versionNumber;
      version.configYaml = pending.configYaml;
      version.configHash = pending.configHash;
      version.changeNote = pending.changeNote;
      if (pending.userId) {
        version.createdByUserId = pending.userId;
      }

      await HostCollectorConfigVersionService.create({
        data: version,
        props: { isRoot: true },
      });
    } catch (err) {
      /*
       * The config itself is saved; only its history missed a line (two
       * saves of one config at the same moment both claimed the same
       * number). Hosts still get the config by its hash.
       */
      logger.error(
        `HostCollectorConfigService: could not record version ${pending.versionNumber} of config ${pending.configId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

export default new Service();
