import ProjectReferencesService, {
  ProjectReferenceWrite,
} from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/XcpNgConnection";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import Select from "../Types/Database/Select";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import XcpNgConnectionRules, {
  XCP_NG_CONNECTION_SAVED_SELECT,
  XcpNgConnectionChange,
} from "../Utils/XcpNg/XcpNgConnectionRules";
import XcpNgProbeCollectionStore, {
  XcpNgCollectionReportOutcome,
} from "../Utils/XcpNg/XcpNgProbeCollectionStore";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import OneUptimeDate from "../../Types/Date";
import ObjectID from "../../Types/ObjectID";
import XcpNgConnectionType from "../../Types/XcpNg/XcpNgConnectionType";
import {
  XcpNgCollectionJob,
  XcpNgCollectionReport,
  XcpNgCollectionSummary,
} from "../../Types/XcpNg/XcpNgProbeCollection";
import { XCP_NG_API_TOKEN_WARNING_DAYS } from "../../Utils/XcpNg/XcpNgCollectionSettings";

/*
 * What XcpNgConnectionService's write hooks hand on to their success hooks.
 */
interface XcpNgConnectionWriteCarryForward {
  xcpNgConnectionChanges?: Array<XcpNgConnectionChange> | undefined;
}

/*
 * XCP-ng connections (#10996, #10999): a Xen Orchestra, or a pool's own
 * XAPI, read by one of the project's probes. Its settings are held to the
 * rules of XcpNgConnectionRules - a vCenter's probe collection rules, rule
 * for rule - and what a probe finds is recorded by
 * XcpNgProbeCollectionStore.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * The collection probe is checked by XcpNgConnectionRules: a probe of the
   * project's own - or, on a self-hosted install, one of the instance's
   * global probes - with another project's probe answered like one that
   * does not exist. The generic check would refuse every global probe.
   */
  protected override getRelationsCheckedByService(
    _write?: ProjectReferenceWrite,
  ): Array<string> {
    return ["collectionProbe"];
  }

  /*
   * Claim the connections a probe reads that are due, and hand them out
   * with their secrets (XcpNgProbeCollectionStore).
   */
  public async claimForCollection(data: {
    probeId: ObjectID;
    runningXcpNgConnectionIds: Array<string>;
    limit: number;
  }): Promise<Array<XcpNgCollectionJob>> {
    return await XcpNgProbeCollectionStore.claimDueConnections(this, data);
  }

  // Record what a probe found for a connection it read.
  public async recordCollectionReport(data: {
    probeId: ObjectID;
    report: XcpNgCollectionReport;
  }): Promise<XcpNgCollectionReportOutcome> {
    return await XcpNgProbeCollectionStore.recordCollectionReport(this, data);
  }

  /*
   * What the server itself has to add to the last read's summary: the pools
   * it left alone, because another connection reads them or a person
   * switched them back to the agent. Written only when there are some.
   */
  @CaptureSpan()
  public async addCollectionWarnings(data: {
    xcpNgConnectionId: ObjectID;
    warnings: Array<string>;
  }): Promise<void> {
    if (data.warnings.length === 0) {
      return;
    }

    const connection: Model | null = await this.findOneById({
      id: data.xcpNgConnectionId,
      select: {
        _id: true,
        collectionSummary: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!connection?.collectionSummary) {
      return;
    }

    const summary: XcpNgCollectionSummary = connection.collectionSummary;
    const warnings: Array<string> = [...(summary.warnings || [])];

    for (const warning of data.warnings) {
      if (!warnings.includes(warning)) {
        warnings.push(warning);
      }
    }

    await this.updateColumnsByIdWithoutHooks({
      id: data.xcpNgConnectionId,
      data: {
        collectionSummary: {
          ...summary,
          warnings: warnings.slice(0, 40),
        },
      } as never,
    });
  }

  /*
   * The Xen Orchestra connections whose API token expires within the
   * warning window and whose owners were not warned yet (#10996): what the
   * daily warning job writes to.
   */
  @CaptureSpan()
  public async findApiTokensExpiringSoon(): Promise<Array<Model>> {
    const now: Date = OneUptimeDate.getCurrentDate();

    return await this.findBy({
      query: {
        connectionType: XcpNgConnectionType.XenOrchestra,
        isApiTokenSet: true,
        apiTokenExpiresAt: QueryHelper.inBetween(
          now,
          OneUptimeDate.addRemoveDays(now, XCP_NG_API_TOKEN_WARNING_DAYS),
        ),
        apiTokenExpiryWarnedAt: QueryHelper.isNull(),
      },
      select: {
        _id: true,
        projectId: true,
        name: true,
        apiTokenExpiresAt: true,
        collectionSummary: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });
  }

  // Once its owners were warned of a token, they are not warned again.
  @CaptureSpan()
  public async markApiTokenExpiryWarned(
    xcpNgConnectionId: ObjectID,
  ): Promise<void> {
    await this.updateColumnsByIdWithoutHooks({
      id: xcpNgConnectionId,
      data: {
        apiTokenExpiryWarnedAt: OneUptimeDate.getCurrentDate(),
      } as never,
    });
  }

  /*
   * The server-only columns a settings write decides, written after the
   * save without hooks (see XcpNgConnectionRules.afterWrite).
   */
  private async writeConnectionServerColumns(write: {
    xcpNgConnectionId: ObjectID;
    values: Record<string, unknown>;
    bumpSettingsVersion: boolean;
  }): Promise<void> {
    if (write.bumpSettingsVersion) {
      await this.atomicAddToColumnsByIdWithoutHooks({
        id: write.xcpNgConnectionId,
        add: { collectionSettingsVersion: 1 },
        set: write.values as never,
      });
      return;
    }

    await this.updateColumnsByIdWithoutHooks({
      id: write.xcpNgConnectionId,
      data: write.values as never,
    });
  }

  private async afterConnectionWrites(
    changes: Array<XcpNgConnectionChange>,
  ): Promise<void> {
    for (const change of changes) {
      await XcpNgConnectionRules.afterWrite({
        change: change,
        writeServerColumns: async (write: {
          xcpNgConnectionId: ObjectID;
          values: Record<string, unknown>;
          bumpSettingsVersion: boolean;
        }): Promise<void> => {
          await this.writeConnectionServerColumns(write);
        },
      });
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    const change: XcpNgConnectionChange =
      await XcpNgConnectionRules.prepareCreate(createBy);

    const carryForward: XcpNgConnectionWriteCarryForward = {
      xcpNgConnectionChanges: [change],
    };

    return { createBy, carryForward: carryForward };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const carryForward: XcpNgConnectionWriteCarryForward | null =
      (onCreate.carryForward as XcpNgConnectionWriteCarryForward | null) ||
      null;

    if (createdItem.id && carryForward?.xcpNgConnectionChanges?.length) {
      await this.afterConnectionWrites(
        carryForward.xcpNgConnectionChanges.map(
          (change: XcpNgConnectionChange): XcpNgConnectionChange => {
            return { ...change, xcpNgConnectionId: createdItem.id! };
          },
        ),
      );
    }

    return createdItem;
  }

  /*
   * A settings write is checked against the row it changes (the saved
   * secrets are bound to its address, probe and certificate), and
   * normalized in place.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    if (
      !XcpNgConnectionRules.isConnectionWrite(
        updateBy.data as unknown as Record<string, unknown>,
      )
    ) {
      return { updateBy, carryForward: null };
    }

    const saved: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      XCP_NG_CONNECTION_SAVED_SELECT as Select<Model>,
    );

    const changes: Array<XcpNgConnectionChange> =
      await XcpNgConnectionRules.prepareUpdate({
        updateBy: updateBy,
        saved: saved.map((row: Model) => {
          return {
            _id: row._id?.toString(),
            projectId: row.projectId,
            connectionType: row.connectionType,
            address: row.address,
            username: row.username,
            isOpenMetricsSecretSet: row.isOpenMetricsSecretSet,
            isApiTokenSet: row.isApiTokenSet,
            isPasswordSet: row.isPasswordSet,
            collectionProbeId: row.collectionProbeId,
            trustedCertificateFingerprint: row.trustedCertificateFingerprint,
            presentedCertificate: row.presentedCertificate,
          };
        }),
      });

    if (changes.length === 0) {
      return { updateBy, carryForward: null };
    }

    const carryForward: XcpNgConnectionWriteCarryForward = {
      xcpNgConnectionChanges: changes,
    };

    return { updateBy, carryForward: carryForward };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const carryForward: XcpNgConnectionWriteCarryForward | null =
      (onUpdate.carryForward as XcpNgConnectionWriteCarryForward | null) ||
      null;

    if (carryForward?.xcpNgConnectionChanges?.length) {
      const updatedIds: Set<string> = new Set(
        updatedItemIds.map((id: ObjectID): string => {
          return id.toString();
        }),
      );

      await this.afterConnectionWrites(
        carryForward.xcpNgConnectionChanges.filter(
          (change: XcpNgConnectionChange): boolean => {
            return (
              Boolean(change.xcpNgConnectionId) &&
              updatedIds.has(change.xcpNgConnectionId!.toString())
            );
          },
        ),
      );
    }

    return onUpdate;
  }
}

export default new Service();
