import { Blue500, Gray500 } from "../../Types/BrandColors";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import {
  OpenStackApiCheckJob,
  OpenStackCheckReport,
  OpenStackLifecycleCheckJob,
} from "../../Types/OpenStack/OpenStackCheck";
import Model from "../../Models/DatabaseModels/OpenStackCloudCheck";
import { OpenStackCloudFeedEventType } from "../../Models/DatabaseModels/OpenStackCloudFeed";
import OpenStackCloud from "../../Models/DatabaseModels/OpenStackCloud";
import {
  OPENSTACK_CHECK_SETTING_COLUMNS,
  OpenStackCheckCloudFacts,
  OpenStackCheckSavedRow,
  OpenStackCheckWriteDecision,
  prepareOpenStackCheckWrite,
} from "../../Utils/OpenStack/OpenStackCheckSettings";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../Utils/Markdown/FeedMarkdown";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import Select from "../Types/Database/Select";
import UpdateBy from "../Types/Database/UpdateBy";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import logger from "../Utils/Logger";
import OpenStackCheckStore, {
  OpenStackCheckReportOutcome,
} from "../Utils/OpenStack/OpenStackCheckStore";
import OpenStackCloudConnection from "../Utils/OpenStack/OpenStackCloudConnection";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import OpenStackCloudFeedService from "./OpenStackCloudFeedService";
import OpenStackCloudService from "./OpenStackCloudService";
import ProjectReferencesService, {
  ProjectReferenceWrite,
} from "./ProjectReferencesService";

const PROBE_KEYS: Array<string> = ["probeId", "probe"];
const CLOUD_KEYS: Array<string> = ["openStackCloudId", "openStackCloud"];

const SAVED_SELECT: Record<string, true> = {
  _id: true,
  projectId: true,
  openStackCloudId: true,
  probeId: true,
  authUrl: true,
  endpointInterface: true,
  regions: true,
  trustedCertificateFingerprints: true,
  credentialKind: true,
  applicationCredentialId: true,
  keystoneUsername: true,
  userDomainName: true,
  credentialProjectName: true,
  credentialProjectDomainName: true,
  isCredentialSet: true,
  credentialBinding: true,
  isApiCheckEnabled: true,
  isLifecycleCheckEnabled: true,
  lifecycleProjectName: true,
  lastLifecycleCheckAt: true,
  isSweepPending: true,
  isOsProfilerKeySet: true,
};

// What a before-hook leaves for its success hook: what only the server writes.
interface OpenStackCheckCarryForward {
  serverColumns: Record<string, unknown>;
  changes: Array<string>;
  isSettingsChanged: boolean;
  openStackCloudId: ObjectID | null;
  projectId: ObjectID | null;
}

/*
 * A cloud's checks: held to the same rules as the cloud's connection, because they hold a credential
 * of their own and one of them writes to the cloud (Utils/OpenStack/OpenStackCheckSettings). What
 * only the server may say - whether a secret is saved, when the check is next due, what it was
 * entered for - is written after the save, as OneUptime. A feed line says what changed and who
 * changed it, because this is something people will want to find out who turned on.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * The probe and the cloud are checked here: the probe may be one of the instance's global probes
   * on a self-hosted install, and another project's cloud or probe is answered like one that does
   * not exist.
   */
  protected override getRelationsCheckedByService(
    _write?: ProjectReferenceWrite,
  ): Array<string> {
    return ["probe", "openStackCloud"];
  }

  public async claimApiChecks(data: {
    probeId: ObjectID;
    runningIds: Array<string>;
    limit: number;
  }): Promise<Array<OpenStackApiCheckJob>> {
    return await OpenStackCheckStore.claimApiChecks(this as never, data);
  }

  public async claimLifecycleChecks(data: {
    probeId: ObjectID;
    runningIds: Array<string>;
    limit: number;
  }): Promise<Array<OpenStackLifecycleCheckJob>> {
    return await OpenStackCheckStore.claimLifecycleChecks(this as never, data);
  }

  public async recordReport(data: {
    probeId: ObjectID;
    report: OpenStackCheckReport;
    scopeVersion: string;
  }): Promise<OpenStackCheckReportOutcome> {
    return await OpenStackCheckStore.recordReport(this as never, data);
  }

  private async readCloudFacts(data: {
    openStackCloudId: ObjectID;
    projectId: ObjectID;
  }): Promise<OpenStackCheckCloudFacts> {
    const cloud: OpenStackCloud | null =
      await OpenStackCloudService.findOneById({
        id: data.openStackCloudId,
        select: {
          _id: true,
          projectId: true,
          collectionMethod: true,
          authUrl: true,
          endpointInterface: true,
          collectionRegions: true,
          trustedCertificateFingerprints: true,
          collectionProbeId: true,
          isCredentialSet: true,
        },
        props: { isRoot: true },
      });

    if (
      !cloud ||
      cloud.projectId?.toString().toLowerCase() !==
        data.projectId.toString().toLowerCase()
    ) {
      throw new BadDataException("OpenStack cloud not found.");
    }

    return {
      collectionMethod: cloud.collectionMethod,
      authUrl: cloud.authUrl,
      endpointInterface: cloud.endpointInterface,
      collectionRegions: cloud.collectionRegions,
      trustedCertificateFingerprints: cloud.trustedCertificateFingerprints,
      collectionProbeId: cloud.collectionProbeId,
      isCredentialSet: cloud.isCredentialSet,
    };
  }

  // The rules, and the probe's: one of this project's own, or one of the instance's.
  private async decide(data: {
    values: Record<string, unknown>;
    saved: OpenStackCheckSavedRow | null;
    openStackCloudId: ObjectID;
    projectId: ObjectID;
  }): Promise<OpenStackCheckCarryForward> {
    const probeId: ObjectID | null = RelationIdUtil.readIntoIdColumn(
      data.values,
      PROBE_KEYS,
      "Probe",
    );

    if (probeId) {
      await OpenStackCloudConnection.assertProbeCanCollect({
        probeId: probeId,
        projectId: data.projectId,
      });
    }

    const decision: OpenStackCheckWriteDecision = prepareOpenStackCheckWrite({
      values: data.values,
      saved: data.saved,
      cloud: await this.readCloudFacts({
        openStackCloudId: data.openStackCloudId,
        projectId: data.projectId,
      }),
      now: new Date(),
    });

    if ("error" in decision) {
      throw new BadDataException(decision.error);
    }

    return {
      serverColumns: decision.serverColumns,
      changes: decision.changes,
      isSettingsChanged: decision.isSettingsChanged,
      openStackCloudId: data.openStackCloudId,
      projectId: data.projectId,
    };
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    const values: Record<string, unknown> = createBy.data as unknown as Record<
      string,
      unknown
    >;

    const projectId: ObjectID | null =
      (createBy.data.projectId as ObjectID | undefined) ||
      createBy.props.tenantId ||
      null;

    const openStackCloudId: ObjectID | null = RelationIdUtil.readIntoIdColumn(
      values,
      CLOUD_KEYS,
      "OpenStack Cloud",
    );

    if (!projectId || !openStackCloudId) {
      throw new BadDataException(
        "Say which OpenStack cloud these checks are of.",
      );
    }

    const existing: Model | null = await this.findOneBy({
      query: { openStackCloudId: openStackCloudId, projectId: projectId },
      select: { _id: true },
      props: { isRoot: true },
    });

    if (existing) {
      throw new BadDataException(
        "This OpenStack cloud has its checks already.",
      );
    }

    return {
      createBy,
      carryForward: await this.decide({
        values: values,
        saved: null,
        openStackCloudId: openStackCloudId,
        projectId: projectId,
      }),
    };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    const values: Record<string, unknown> = updateBy.data as unknown as Record<
      string,
      unknown
    >;

    const isSettingsWrite: boolean = OPENSTACK_CHECK_SETTING_COLUMNS.some(
      (column: string): boolean => {
        return values[column] !== undefined;
      },
    );

    if (!isSettingsWrite) {
      return { updateBy, carryForward: null };
    }

    const saved: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      SAVED_SELECT as Select<Model>,
    );

    if (saved.length === 0) {
      return { updateBy, carryForward: null };
    }

    if (saved.length > 1) {
      throw new BadDataException("Change one cloud's checks at a time.");
    }

    const row: Model = saved[0]!;

    if (!row.openStackCloudId || !row.projectId) {
      return { updateBy, carryForward: null };
    }

    return {
      updateBy,
      carryForward: await this.decide({
        values: values,
        saved: row as unknown as OpenStackCheckSavedRow,
        openStackCloudId: row.openStackCloudId,
        projectId: row.projectId,
      }),
    };
  }

  private async afterWrite(data: {
    id: ObjectID;
    carryForward: OpenStackCheckCarryForward | null | undefined;
    userId?: ObjectID | undefined;
  }): Promise<void> {
    const carry: OpenStackCheckCarryForward | null | undefined =
      data.carryForward;

    if (!carry) {
      return;
    }

    if (carry.isSettingsChanged) {
      await this.atomicAddToColumnsByIdWithoutHooks({
        id: data.id,
        add: { settingsVersion: 1 },
        set: carry.serverColumns as never,
      });
    } else if (Object.keys(carry.serverColumns).length > 0) {
      await this.updateColumnsByIdWithoutHooks({
        id: data.id,
        data: carry.serverColumns as never,
      });
    }

    if (
      carry.changes.length === 0 ||
      !carry.openStackCloudId ||
      !carry.projectId
    ) {
      return;
    }

    try {
      const feedLines: Array<MarkdownText> = carry.changes.map(
        (change: string): MarkdownText => {
          return mdText`${change}`;
        },
      );

      await OpenStackCloudFeedService.createOpenStackCloudFeedItem({
        openStackCloudId: carry.openStackCloudId,
        projectId: carry.projectId,
        openStackCloudFeedEventType:
          OpenStackCloudFeedEventType.OpenStackCloudUpdated,
        displayColor: carry.changes.some((change: string): boolean => {
          return change.endsWith("off");
        })
          ? Gray500
          : Blue500,
        feedInfoInMarkdown:
          mdText`**Checks from outside changed:** ${FeedMarkdown.join(
            feedLines,
            "; ",
          )}.`.toString(),
        userId: data.userId,
      });
    } catch (error) {
      // Never in the way of the write: the checks are set either way.
      logger.warn(
        `Could not write a feed line for a cloud's checks: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (createdItem.id) {
      await this.afterWrite({
        id: createdItem.id,
        carryForward:
          onCreate.carryForward as OpenStackCheckCarryForward | null,
        userId: onCreate.createBy.props.userId,
      });
    }

    return createdItem;
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    for (const id of updatedItemIds) {
      await this.afterWrite({
        id: id,
        carryForward:
          onUpdate.carryForward as OpenStackCheckCarryForward | null,
        userId: onUpdate.updateBy.props.userId,
      });
    }

    return onUpdate;
  }
}

export default new Service();
