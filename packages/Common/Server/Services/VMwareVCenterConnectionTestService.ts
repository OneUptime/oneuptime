import { EntityManager } from "./DatabaseService";
import ProjectReferencesService, {
  ProjectReferenceWrite,
} from "./ProjectReferencesService";
import VMwareVCenterService from "./VMwareVCenterService";
import { IsBillingEnabled } from "../EnvironmentConfig";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import VMwareProbeCollectionStore from "../Utils/VMware/VMwareProbeCollectionStore";
import VMwareVCenterConnection from "../Utils/VMware/VMwareVCenterConnection";
import Model from "../../Models/DatabaseModels/VMwareVCenterConnectionTest";
import VMwareVCenter from "../../Models/DatabaseModels/VMwareVCenter";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import VMwareCollectionErrorCode, {
  VMwareCollectionErrorUtil,
} from "../../Types/VMware/VMwareCollectionError";
import VMwareCollectionMethod from "../../Types/VMware/VMwareCollectionMethod";
import VMwareConnectionTestStatus, {
  MAX_ACTIVE_VMWARE_CONNECTION_TESTS_PER_PROJECT,
  VMWARE_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS,
  VMWARE_CONNECTION_TEST_RUN_TIMEOUT_IN_SECONDS,
} from "../../Types/VMware/VMwareConnectionTestStatus";
import {
  VMwareConnectionTestJob,
  VMwareConnectionTestReport,
} from "../../Types/VMware/VMwareProbeCollection";
import VMwareCertificateFingerprint from "../../Utils/VMware/VMwareCertificateFingerprint";
import {
  MAX_VMWARE_PASSWORD_LENGTH,
  MAX_VMWARE_USERNAME_LENGTH,
} from "../../Utils/VMware/VMwareCollectionSettings";
import VMwareVCenterAddress, {
  VCenterAddressResult,
} from "../../Utils/VMware/VMwareVCenterAddress";

const PROBE_KEYS: Array<string> = ["probeId", "probe"];
const VCENTER_KEYS: Array<string> = ["vmwareVCenterId", "vmwareVCenter"];

/*
 * "Test connection" for a vCenter (VMwareVCenterConnectionTest): checked
 * like the connection it is about to become, handed once to the probe it
 * names - with the password wiped from the row as it is handed out - and
 * answered when the probe reports, or as failed when no probe picks it up
 * in time.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
    // A test is a moment's question: nothing of it is kept past a day.
    this.hardDeleteItemsOlderThanInDays("createdAt", 1);
  }

  /*
   * The probe and the vCenter are checked here: the probe may be one of the
   * instance's global probes on a self-hosted install, and another project's
   * vCenter or probe is answered like one that does not exist.
   */
  protected override getRelationsCheckedByService(
    _write?: ProjectReferenceWrite,
  ): Array<string> {
    return ["probe", "vmwareVCenter"];
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

    if (!projectId) {
      throw new BadDataException("The test's project is missing.");
    }

    const address: VCenterAddressResult = VMwareVCenterAddress.normalize(
      typeof data["vcenterUrl"] === "string"
        ? (data["vcenterUrl"] as string)
        : "",
    );

    if (!address.address) {
      throw new BadDataException(address.error);
    }

    data["vcenterUrl"] = address.address.url;

    const username: string =
      typeof data["vcenterUsername"] === "string"
        ? (data["vcenterUsername"] as string).trim()
        : "";

    if (!username) {
      throw new BadDataException(
        "Enter the vCenter user name, such as oneuptime@vsphere.local.",
      );
    }

    if (username.length > MAX_VMWARE_USERNAME_LENGTH) {
      throw new BadDataException(
        `The vCenter user name may be at most ${MAX_VMWARE_USERNAME_LENGTH} characters.`,
      );
    }

    data["vcenterUsername"] = username;

    const rawFingerprint: unknown = data["trustedCertificateFingerprint"];

    if (
      rawFingerprint === undefined ||
      rawFingerprint === null ||
      (typeof rawFingerprint === "string" && !rawFingerprint.trim())
    ) {
      data["trustedCertificateFingerprint"] = null;
    } else {
      const fingerprint: string | null = VMwareCertificateFingerprint.normalize(
        String(rawFingerprint),
      );

      if (!fingerprint) {
        throw new BadDataException(
          "The trusted certificate fingerprint must be a SHA-256 fingerprint: 64 hexadecimal characters, such as AB:CD:EF:... .",
        );
      }

      data["trustedCertificateFingerprint"] = fingerprint;
    }

    const probeId: ObjectID | null = RelationIdUtil.readIntoIdColumn(
      data,
      PROBE_KEYS,
      "Probe",
    );

    if (!probeId) {
      throw new BadDataException(
        "Pick the probe to test from: one in a network that can reach vCenter on TCP 443.",
      );
    }

    await VMwareVCenterConnection.assertProbeCanCollect({
      probeId: probeId,
      projectId: projectId,
    });

    const password: unknown = data["vcenterPassword"];
    const isPasswordGiven: boolean =
      typeof password === "string" && password.length > 0;

    if (
      isPasswordGiven &&
      (password as string).length > MAX_VMWARE_PASSWORD_LENGTH
    ) {
      throw new BadDataException(
        `The vCenter password may be at most ${MAX_VMWARE_PASSWORD_LENGTH} characters.`,
      );
    }

    const vmwareVCenterId: ObjectID | null = RelationIdUtil.readIntoIdColumn(
      data,
      VCENTER_KEYS,
      "vCenter",
    );

    if (vmwareVCenterId) {
      const savedPassword: string | null = await this.readUsableSavedPassword({
        vmwareVCenterId: vmwareVCenterId,
        projectId: projectId,
        needsPassword: !isPasswordGiven,
        next: {
          vcenterUrl: address.address.url,
          probeId: probeId,
          trustedCertificateFingerprint: data[
            "trustedCertificateFingerprint"
          ] as string | null,
        },
      });

      if (!isPasswordGiven) {
        data["vcenterPassword"] = savedPassword;
      }
    } else if (!isPasswordGiven) {
      throw new BadDataException("Enter the vCenter password.");
    }

    const activeTests: PositiveNumber = await this.countBy({
      query: {
        projectId: projectId,
        status: QueryHelper.any([
          VMwareConnectionTestStatus.Pending,
          VMwareConnectionTestStatus.Running,
        ]),
      },
      props: {
        isRoot: true,
      },
    });

    if (
      activeTests.toNumber() >= MAX_ACTIVE_VMWARE_CONNECTION_TESTS_PER_PROJECT
    ) {
      throw new BadDataException(
        "Several connection tests are still running in this project. Wait for them to finish, then test again.",
      );
    }

    return { createBy, carryForward: null };
  }

  /*
   * A test of an existing vCenter may use its saved password - under the rule
   * an update keeps it by: only for the address, probe and certificate it was
   * saved for (or the certificate the probe found there). A test that brings
   * its own password still has to name a vCenter of this project.
   */
  private async readUsableSavedPassword(data: {
    vmwareVCenterId: ObjectID;
    projectId: ObjectID;
    needsPassword: boolean;
    next: {
      vcenterUrl: string;
      probeId: ObjectID;
      trustedCertificateFingerprint: string | null;
    };
  }): Promise<string | null> {
    const vcenter: VMwareVCenter | null = await VMwareVCenterService.findOneBy({
      query: {
        _id: data.vmwareVCenterId,
        projectId: data.projectId,
      },
      select: {
        _id: true,
        collectionMethod: true,
        vcenterUrl: true,
        vcenterPassword: true,
        isVCenterPasswordSet: true,
        collectionProbeId: true,
        trustedCertificateFingerprint: true,
        presentedCertificate: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!vcenter) {
      throw new BadDataException("vCenter not found.");
    }

    if (!data.needsPassword) {
      return null;
    }

    if (
      vcenter.collectionMethod !== VMwareCollectionMethod.Probe ||
      !vcenter.isVCenterPasswordSet ||
      !vcenter.vcenterPassword
    ) {
      throw new BadDataException("Enter the vCenter password.");
    }

    const refusal: string | null = VMwareVCenterConnection.getRebindRefusal({
      saved: VMwareVCenterConnection.getBinding({
        vcenterUrl: vcenter.vcenterUrl,
        probeId: vcenter.collectionProbeId,
        trustedCertificateFingerprint: vcenter.trustedCertificateFingerprint,
      }),
      next: VMwareVCenterConnection.getBinding({
        vcenterUrl: data.next.vcenterUrl,
        probeId: data.next.probeId,
        trustedCertificateFingerprint: data.next.trustedCertificateFingerprint,
      }),
      presentedFingerprint: vcenter.presentedCertificate?.fingerprint256,
    });

    if (refusal) {
      throw new BadDataException(refusal);
    }

    return vcenter.vcenterPassword;
  }

  /*
   * Hand a probe the pending tests that name it, once each: claimed, the
   * password read, then wiped from the row. Tests that waited longer than a
   * person would are left for expireStaleTests.
   */
  @CaptureSpan()
  public async claimPendingTests(data: {
    probeId: ObjectID;
    limit: number;
  }): Promise<Array<VMwareConnectionTestJob>> {
    if (data.limit <= 0) {
      return [];
    }

    const now: Date = OneUptimeDate.getCurrentDate();
    const oldestPickup: Date = OneUptimeDate.addRemoveSeconds(
      now,
      -VMWARE_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS,
    );

    const claimedIds: Array<string> = await this.executeTransaction(
      async (transactionalEntityManager: EntityManager) => {
        const selectedRows: Array<{ _id: string }> =
          await transactionalEntityManager.query(
            `
          SELECT t."_id"
          FROM "VMwareVCenterConnectionTest" t
          INNER JOIN "Probe" pr ON t."probeId" = pr."_id"
          WHERE t."probeId" = $1
            AND t."status" = $2
            AND t."deletedAt" IS NULL
            AND t."createdAt" >= $3
            AND (
              (pr."isGlobalProbe" = false AND pr."projectId" = t."projectId")
              OR (pr."isGlobalProbe" = true AND $5::boolean = false)
            )
          ORDER BY t."createdAt" ASC
          LIMIT $4
          FOR UPDATE OF t SKIP LOCKED
        `,
            [
              data.probeId.toString(),
              VMwareConnectionTestStatus.Pending,
              oldestPickup,
              data.limit,
              IsBillingEnabled,
            ],
          );

        if (selectedRows.length === 0) {
          return [];
        }

        const ids: Array<string> = selectedRows.map(
          (row: { _id: string }): string => {
            return row._id;
          },
        );

        await transactionalEntityManager.query(
          `UPDATE "VMwareVCenterConnectionTest" SET "status" = $1, "claimedAt" = $2::timestamptz WHERE "_id" = ANY($3::uuid[])`,
          [VMwareConnectionTestStatus.Running, now, ids],
        );

        return ids;
      },
    );

    if (claimedIds.length === 0) {
      return [];
    }

    const tests: Array<Model> = await this.findBy({
      query: {
        _id: QueryHelper.any(claimedIds),
      },
      select: {
        _id: true,
        vcenterUrl: true,
        vcenterUsername: true,
        vcenterPassword: true,
        trustedCertificateFingerprint: true,
      },
      limit: claimedIds.length,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    // The password has been read for the probe: nothing keeps it now.
    for (const id of claimedIds) {
      await this.updateColumnsByIdWithoutHooks({
        id: new ObjectID(id),
        data: { vcenterPassword: null } as never,
      });
    }

    const jobs: Array<VMwareConnectionTestJob> = [];

    // In the order they were claimed: the oldest first.
    for (const test of VMwareProbeCollectionStore.inClaimOrder(
      tests,
      claimedIds,
    )) {
      if (
        !test._id ||
        !test.vcenterUrl ||
        !test.vcenterUsername ||
        !test.vcenterPassword
      ) {
        continue;
      }

      const job: VMwareConnectionTestJob = {
        vmwareVCenterConnectionTestId: test._id.toString(),
        vcenterUrl: test.vcenterUrl,
        username: test.vcenterUsername,
        password: test.vcenterPassword,
      };

      const fingerprint: string | null = VMwareCertificateFingerprint.normalize(
        test.trustedCertificateFingerprint,
      );

      if (fingerprint) {
        job.trustedCertificateFingerprint = fingerprint;
      }

      jobs.push(job);
    }

    return jobs;
  }

  /*
   * What the probe found. Only the probe a test was handed to answers it,
   * and only while it runs.
   */
  @CaptureSpan()
  public async recordTestReport(data: {
    probeId: ObjectID;
    report: VMwareConnectionTestReport;
  }): Promise<boolean> {
    const report: VMwareConnectionTestReport = data.report;

    if (
      !report.vmwareVCenterConnectionTestId ||
      !ObjectID.isValidUUID(report.vmwareVCenterConnectionTestId)
    ) {
      return false;
    }

    const test: Model | null = await this.findOneBy({
      query: {
        _id: new ObjectID(report.vmwareVCenterConnectionTestId),
        probeId: data.probeId,
        status: VMwareConnectionTestStatus.Running,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!test || !test.id) {
      return false;
    }

    const isSuccess: boolean = report.status === "Succeeded";
    const errorCode: VMwareCollectionErrorCode | null = isSuccess
      ? null
      : VMwareCollectionErrorUtil.isValid(report.errorCode)
        ? report.errorCode
        : VMwareCollectionErrorCode.Internal;

    await this.updateColumnsByIdWithoutHooks({
      id: test.id,
      data: {
        status: isSuccess
          ? VMwareConnectionTestStatus.Succeeded
          : VMwareConnectionTestStatus.Failed,
        errorCode: errorCode,
        errorMessage: isSuccess
          ? null
          : VMwareProbeCollectionStore.getErrorText({
              errorCode: errorCode!,
              errorMessage: report.errorMessage,
            }),
        presentedCertificate:
          !isSuccess &&
          VMwareCollectionErrorUtil.isCertificateTrustProblem(errorCode)
            ? VMwareProbeCollectionStore.sanitizePresentedCertificate(
                report.presentedCertificate,
              )
            : null,
        summary: isSuccess
          ? VMwareProbeCollectionStore.sanitizeSummary(report.summary)
          : null,
        completedAt: OneUptimeDate.getCurrentDate(),
        vcenterPassword: null,
      } as never,
    });

    return true;
  }

  /*
   * Answer the tests nobody will answer: waiting longer than a probe takes
   * to pick one up (the probe is offline, or too old to test vCenters), or
   * running longer than a test takes. The dashboard stops waiting for them
   * and says why.
   */
  @CaptureSpan()
  public async expireStaleTests(): Promise<void> {
    const now: Date = OneUptimeDate.getCurrentDate();

    await this.getRepository().manager.query(
      `UPDATE "VMwareVCenterConnectionTest"
       SET "status" = $1, "errorCode" = $2, "errorMessage" = $3, "completedAt" = $4::timestamptz, "vcenterPassword" = NULL
       WHERE "status" = $5 AND "deletedAt" IS NULL AND "createdAt" < $6::timestamptz`,
      [
        VMwareConnectionTestStatus.Failed,
        VMwareCollectionErrorCode.ProbeNotAvailable,
        "The probe did not pick up the test. It may be offline, or run a OneUptime version older than VMware collection - update it, or pick another probe.",
        now,
        VMwareConnectionTestStatus.Pending,
        OneUptimeDate.addRemoveSeconds(
          now,
          -VMWARE_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS,
        ),
      ],
    );

    await this.getRepository().manager.query(
      `UPDATE "VMwareVCenterConnectionTest"
       SET "status" = $1, "errorCode" = $2, "errorMessage" = $3, "completedAt" = $4::timestamptz, "vcenterPassword" = NULL
       WHERE "status" = $5 AND "deletedAt" IS NULL AND "claimedAt" < $6::timestamptz`,
      [
        VMwareConnectionTestStatus.Failed,
        VMwareCollectionErrorCode.TimedOut,
        "The probe did not report back in time.",
        now,
        VMwareConnectionTestStatus.Running,
        OneUptimeDate.addRemoveSeconds(
          now,
          -VMWARE_CONNECTION_TEST_RUN_TIMEOUT_IN_SECONDS,
        ),
      ],
    );
  }
}

export default new Service();
