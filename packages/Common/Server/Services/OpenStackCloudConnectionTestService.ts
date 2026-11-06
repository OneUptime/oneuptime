import OpenStackCloudService from "./OpenStackCloudService";
import ProjectReferencesService, {
  ProjectReferenceWrite,
} from "./ProjectReferencesService";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import OpenStackConnectionTestStore, {
  OpenStackSavedCloudForTest,
} from "../Utils/OpenStack/OpenStackConnectionTestStore";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import OpenStackCloud from "../../Models/DatabaseModels/OpenStackCloud";
import Model from "../../Models/DatabaseModels/OpenStackCloudConnectionTest";
import ObjectID from "../../Types/ObjectID";
import OpenStackConnectionTestStatus from "../../Types/OpenStack/OpenStackConnectionTestStatus";
import {
  OpenStackConnectionTestJob,
  OpenStackConnectionTestReport,
} from "../../Types/OpenStack/OpenStackProbeCollection";
import PositiveNumber from "../../Types/PositiveNumber";

const PROBE_KEYS: Array<string> = ["probeId", "probe"];
const CLOUD_KEYS: Array<string> = ["openStackCloudId", "openStackCloud"];

/*
 * "Test connection" for a cloud (OpenStackCloudConnectionTest): checked like the connection
 * it is about to become, handed once to the probe it names, with the secret wiped from the
 * row as it is handed out, and answered when the probe reports, or as failed when no probe
 * picks it up in time. The rules are OpenStackConnectionTestStore's.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
    // A test is a moment's question, so nothing of it is kept past a day.
    this.hardDeleteItemsOlderThanInDays("createdAt", 1);
  }

  /*
   * The probe and the cloud are checked here: the probe may be one of the instance's global
   * probes on a self-hosted install, and another project's cloud or probe is answered like
   * one that does not exist.
   */
  protected override getRelationsCheckedByService(
    _write?: ProjectReferenceWrite,
  ): Array<string> {
    return ["probe", "openStackCloud"];
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    const data: Record<string, unknown> = createBy.data as unknown as Record<
      string,
      unknown
    >;

    const projectId: ObjectID | null =
      (createBy.data.projectId as ObjectID | undefined) ||
      createBy.props.tenantId ||
      null;

    await OpenStackConnectionTestStore.prepareCreate({
      values: data,
      projectId: projectId,
      probeId: RelationIdUtil.readIntoIdColumn(data, PROBE_KEYS, "Probe"),
      openStackCloudId: RelationIdUtil.readIntoIdColumn(
        data,
        CLOUD_KEYS,
        "OpenStack Cloud",
      ),
      readSavedCloud: async (
        openStackCloudId: ObjectID,
      ): Promise<OpenStackSavedCloudForTest | null> => {
        return await this.readSavedCloud({
          openStackCloudId: openStackCloudId,
          projectId: projectId!,
        });
      },
      countActiveTests: async (): Promise<number> => {
        return await this.countActiveTests(projectId!);
      },
    });

    return { createBy, carryForward: null };
  }

  /*
   * Read as OneUptime, so the secret is decrypted, and within the test's project, so a cloud
   * of another project reads as one that does not exist.
   */
  private async readSavedCloud(data: {
    openStackCloudId: ObjectID;
    projectId: ObjectID;
  }): Promise<OpenStackCloud | null> {
    return await OpenStackCloudService.findOneBy({
      query: {
        _id: data.openStackCloudId,
        projectId: data.projectId,
      },
      select: {
        _id: true,
        collectionMethod: true,
        authUrl: true,
        credentialKind: true,
        applicationCredentialId: true,
        keystoneUsername: true,
        userDomainName: true,
        projectName: true,
        projectDomainName: true,
        credentialSecret: true,
        isCredentialSet: true,
        collectionProbeId: true,
        trustedCertificateFingerprints: true,
        presentedCertificate: true,
      },
      props: {
        isRoot: true,
      },
    });
  }

  private async countActiveTests(projectId: ObjectID): Promise<number> {
    const activeTests: PositiveNumber = await this.countBy({
      query: {
        projectId: projectId,
        status: QueryHelper.any([
          OpenStackConnectionTestStatus.Pending,
          OpenStackConnectionTestStatus.Running,
        ]),
      },
      props: {
        isRoot: true,
      },
    });

    return activeTests.toNumber();
  }

  // Hand a probe the pending tests that name it, once each, wiping each secret as it goes.
  @CaptureSpan()
  public async claimPendingTests(data: {
    probeId: ObjectID;
    limit: number;
  }): Promise<Array<OpenStackConnectionTestJob>> {
    return await OpenStackConnectionTestStore.claimPendingTests(this, data);
  }

  // What the probe found. Only the probe a test was handed to answers it, and only while it runs.
  @CaptureSpan()
  public async recordTestReport(data: {
    probeId: ObjectID;
    report: OpenStackConnectionTestReport;
  }): Promise<boolean> {
    return await OpenStackConnectionTestStore.recordTestReport(this, data);
  }

  /*
   * Answer the tests nobody will answer, so the dashboard stops waiting and says why, and no
   * secret waits in the table for a probe that is not coming.
   */
  @CaptureSpan()
  public async expireStaleTests(): Promise<void> {
    await OpenStackConnectionTestStore.expireStaleTests(
      this.getRepository().manager,
    );
  }
}

export default new Service();
