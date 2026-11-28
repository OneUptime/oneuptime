import ProjectReferencesService, {
  ProjectReferenceWrite,
} from "./ProjectReferencesService";
import StorageArrayConnectionService from "./StorageArrayConnectionService";
import { IsBillingEnabled } from "../EnvironmentConfig";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import ProductBrandingText from "../Utils/ProductBrandingText";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import StorageArrayConnectionRules from "../Utils/StorageArray/StorageArrayConnectionRules";
import StorageArrayProbeCollectionStore from "../Utils/StorageArray/StorageArrayProbeCollectionStore";
import VMwareProbeCollectionStore from "../Utils/VMware/VMwareProbeCollectionStore";
import Model from "../../Models/DatabaseModels/StorageArrayConnectionTest";
import StorageArrayConnection from "../../Models/DatabaseModels/StorageArrayConnection";
import ColumnLength from "../../Types/Database/ColumnLength";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import StorageArrayCollectionErrorCode, {
  StorageArrayCollectionErrorCodeUtil,
} from "../../Types/StorageArray/Collection/StorageArrayCollectionErrorCode";
import StorageArrayConnectionTestStatus, {
  MAX_ACTIVE_STORAGE_ARRAY_CONNECTION_TESTS_PER_PROJECT,
  STORAGE_ARRAY_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS,
  STORAGE_ARRAY_CONNECTION_TEST_RUN_TIMEOUT_IN_SECONDS,
} from "../../Types/StorageArray/Collection/StorageArrayConnectionTestStatus";
import {
  StorageArrayConnectionTestJob,
  StorageArrayConnectionTestReport,
} from "../../Types/StorageArray/Collection/StorageArrayProbeCollection";
import { StorageArrayProbeCollector } from "../../Types/StorageArray/Collection/StorageArrayProbeCollector";
import StorageArrayProbeCollectors from "../../Types/StorageArray/Collection/StorageArrayProbeCollectors";
import StorageArrayConnectionAddress, {
  StorageArrayAddressResult,
} from "../../Utils/StorageArray/StorageArrayConnectionAddress";
import {
  MAX_STORAGE_ARRAY_PASSWORD_LENGTH,
  MAX_STORAGE_ARRAY_USERNAME_LENGTH,
} from "../../Utils/StorageArray/StorageArrayConnectionSettings";
import VMwareCertificateFingerprint from "../../Utils/VMware/VMwareCertificateFingerprint";

const PROBE_KEYS: Array<string> = ["probeId", "probe"];
const CONNECTION_KEYS: Array<string> = [
  "storageArrayConnectionId",
  "storageArrayConnection",
];

export const STORAGE_ARRAY_TEST_NOT_PICKED_UP_MESSAGE: string =
  "No probe picked this test up. Check that the probe is connected and runs a OneUptime version that collects storage arrays, then test again.";

export const STORAGE_ARRAY_TEST_NOT_REPORTED_MESSAGE: string =
  "The probe took this test but did not answer in time. Test again; if it keeps happening, check the probe's logs.";

/*
 * "Test connection" (#11004), as VMware's (VMwareVCenterConnectionTestService):
 * the address, account and certificate a person is about to save, tried by
 * the probe they picked. A test is created from the dashboard, handed to
 * its probe once (the password read, then wiped from the row), and
 * answered when the probe reports - or as failed when no probe picks it up
 * in time.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
    // A test is a moment's question: nothing of it is kept past a day.
    this.hardDeleteItemsOlderThanInDays("createdAt", 1);
  }

  /*
   * The probe and the connection are checked here: the probe may be one of
   * the instance's global probes on a self-hosted install, and another
   * project's connection or probe is answered like one that does not exist.
   */
  protected override getRelationsCheckedByService(
    _write?: ProjectReferenceWrite,
  ): Array<string> {
    return ["probe", "storageArrayConnection"];
  }

  /*
   * A create answers with the row it saved, serialized whole, and the row
   * holds the password, encrypted - for a test of a saved connection, the
   * saved password, which whoever may test never typed and may not read.
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

    const collector: StorageArrayProbeCollector =
      StorageArrayConnectionRules.getCollector(
        data["storageSystem"] === undefined || data["storageSystem"] === null
          ? StorageArrayProbeCollectors.getDefault().storageSystem
          : data["storageSystem"],
      );
    data["storageSystem"] = collector.storageSystem;

    const address: StorageArrayAddressResult =
      StorageArrayConnectionAddress.normalize(
        typeof data["address"] === "string" ? (data["address"] as string) : "",
        collector,
      );
    if (!address.address) {
      throw new BadDataException(address.error);
    }
    data["address"] = address.address.url;

    const username: string =
      typeof data["username"] === "string"
        ? (data["username"] as string).trim()
        : "";
    if (!username) {
      throw new BadDataException("Enter the user name.");
    }
    if (username.length > MAX_STORAGE_ARRAY_USERNAME_LENGTH) {
      throw new BadDataException(
        `The user name may be at most ${MAX_STORAGE_ARRAY_USERNAME_LENGTH} characters.`,
      );
    }
    data["username"] = username;

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
        `Pick the probe to test from: one in a network that reaches ${collector.serverShortName} on TCP ${collector.defaultPort}.`,
      );
    }

    await StorageArrayConnectionRules.assertProbeCanCollect({
      probeId: probeId,
      projectId: projectId,
    });

    const password: unknown = data["password"];
    const isPasswordGiven: boolean =
      StorageArrayConnectionRules.isPasswordGiven(password);

    if (
      isPasswordGiven &&
      (password as string).length > MAX_STORAGE_ARRAY_PASSWORD_LENGTH
    ) {
      throw new BadDataException(
        `The password may be at most ${MAX_STORAGE_ARRAY_PASSWORD_LENGTH} characters.`,
      );
    }

    const connectionId: ObjectID | null = RelationIdUtil.readIntoIdColumn(
      data,
      CONNECTION_KEYS,
      "Connection",
    );

    if (connectionId) {
      const savedPassword: string | null = await this.readUsableSavedPassword(
        {
          storageArrayConnectionId: connectionId,
          projectId: projectId,
          needsPassword: !isPasswordGiven,
          collector: collector,
          next: {
            address: address.address.url,
            probeId: probeId,
            trustedCertificateFingerprint: data[
              "trustedCertificateFingerprint"
            ] as string | null,
          },
        },
      );
      if (!isPasswordGiven) {
        data["password"] = savedPassword;
      }
    } else if (!isPasswordGiven) {
      throw new BadDataException("Enter the password.");
    }

    // Nothing a person writes on create decides the outcome.
    for (const column of [
      "status",
      "errorCode",
      "errorMessage",
      "presentedCertificate",
      "summary",
      "claimedAt",
      "completedAt",
    ]) {
      delete data[column];
    }

    const activeTests: PositiveNumber = await this.countBy({
      query: {
        projectId: projectId,
        status: QueryHelper.any([
          StorageArrayConnectionTestStatus.Pending,
          StorageArrayConnectionTestStatus.Running,
        ]),
      },
      props: {
        isRoot: true,
      },
    });

    if (
      activeTests.toNumber() >=
      MAX_ACTIVE_STORAGE_ARRAY_CONNECTION_TESTS_PER_PROJECT
    ) {
      throw new BadDataException(
        "Several connection tests are still running in this project. Wait for them to finish, then test again.",
      );
    }

    return { createBy, carryForward: null };
  }

  /*
   * A test of a saved connection may use its saved password - under the
   * rule an update keeps it by: only for the address, probe and
   * certificate it was saved for (or the certificate the probe found
   * there). A test that brings its own password still has to name a
   * connection of this project.
   */
  private async readUsableSavedPassword(data: {
    storageArrayConnectionId: ObjectID;
    projectId: ObjectID;
    needsPassword: boolean;
    collector: StorageArrayProbeCollector;
    next: {
      address: string;
      probeId: ObjectID;
      trustedCertificateFingerprint: string | null;
    };
  }): Promise<string | null> {
    const connection: StorageArrayConnection | null =
      await StorageArrayConnectionService.findOneBy({
        query: {
          _id: data.storageArrayConnectionId,
          projectId: data.projectId,
        },
        select: {
          _id: true,
          storageSystem: true,
          address: true,
          password: true,
          isPasswordSet: true,
          collectionProbeId: true,
          trustedCertificateFingerprint: true,
          presentedCertificate: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!connection) {
      throw new BadDataException("Connection not found.");
    }

    if (connection.storageSystem !== data.collector.storageSystem) {
      throw new BadDataException(
        "The test is for another platform than the connection.",
      );
    }

    if (!data.needsPassword) {
      return null;
    }

    if (!connection.isPasswordSet || !connection.password) {
      throw new BadDataException("Enter the password.");
    }

    const refusal: string | null = StorageArrayConnectionRules.getRebindRefusal(
      {
        saved: StorageArrayConnectionRules.getBinding({
          address: connection.address,
          probeId: connection.collectionProbeId,
          trustedCertificateFingerprint:
            connection.trustedCertificateFingerprint,
          collector: data.collector,
        }),
        next: StorageArrayConnectionRules.getBinding({
          address: data.next.address,
          probeId: data.next.probeId,
          trustedCertificateFingerprint: data.next.trustedCertificateFingerprint,
          collector: data.collector,
        }),
        presentedFingerprint: connection.presentedCertificate?.fingerprint256,
      },
    );

    if (refusal) {
      throw new BadDataException(refusal);
    }

    return connection.password;
  }

  /*
   * Hand a probe the pending tests that name it, once each: claimed, the
   * password read, then wiped from the row - one self-committing statement,
   * the shape of VMware's claimPendingTests.
   */
  @CaptureSpan()
  public async claimPendingTests(data: {
    probeId: ObjectID;
    limit: number;
  }): Promise<Array<StorageArrayConnectionTestJob>> {
    if (data.limit <= 0) {
      return [];
    }

    const now: Date = OneUptimeDate.getCurrentDate();
    const oldestPickup: Date = OneUptimeDate.addRemoveSeconds(
      now,
      -STORAGE_ARRAY_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS,
    );

    const claimedRows: unknown = await this.getRepository().manager.query(
      `
      WITH "pending" AS (
        SELECT t."_id", t."createdAt"
        FROM "StorageArrayConnectionTest" t
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
        FOR NO KEY UPDATE OF t SKIP LOCKED
      ),
      "claimed" AS (
        UPDATE "StorageArrayConnectionTest" AS t
        SET "status" = $6,
            "claimedAt" = $7::timestamptz
        FROM "pending"
        WHERE t."_id" = "pending"."_id"
        RETURNING t."_id"
      )
      SELECT "pending"."_id"
      FROM "pending"
      INNER JOIN "claimed" ON "claimed"."_id" = "pending"."_id"
      ORDER BY "pending"."createdAt" ASC
    `,
      [
        data.probeId.toString(),
        StorageArrayConnectionTestStatus.Pending,
        oldestPickup,
        data.limit,
        IsBillingEnabled,
        StorageArrayConnectionTestStatus.Running,
        now,
      ],
    );

    const claimedIds: Array<string> = Array.isArray(claimedRows)
      ? claimedRows.map((row: { _id: string }): string => {
          return row._id;
        })
      : [];

    if (claimedIds.length === 0) {
      return [];
    }

    const tests: Array<Model> = await this.findBy({
      query: {
        _id: QueryHelper.any(claimedIds),
      },
      select: {
        _id: true,
        storageSystem: true,
        address: true,
        username: true,
        password: true,
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
        data: { password: null } as never,
      });
    }

    const jobs: Array<StorageArrayConnectionTestJob> = [];

    for (const test of VMwareProbeCollectionStore.inClaimOrder(
      tests,
      claimedIds,
    )) {
      if (
        !test._id ||
        !test.storageSystem ||
        !test.address ||
        !test.username ||
        !test.password
      ) {
        continue;
      }

      const job: StorageArrayConnectionTestJob = {
        storageArrayConnectionTestId: test._id.toString(),
        storageSystem: test.storageSystem,
        address: test.address,
        username: test.username,
        password: test.password,
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
    report: StorageArrayConnectionTestReport;
  }): Promise<boolean> {
    const report: StorageArrayConnectionTestReport = data.report;

    if (
      !report.storageArrayConnectionTestId ||
      typeof report.storageArrayConnectionTestId !== "string" ||
      !ObjectID.isValidUUID(report.storageArrayConnectionTestId)
    ) {
      return false;
    }

    const test: Model | null = await this.findOneBy({
      query: {
        _id: new ObjectID(report.storageArrayConnectionTestId),
        probeId: data.probeId,
        status: StorageArrayConnectionTestStatus.Running,
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
    const errorCode: StorageArrayCollectionErrorCode | null = isSuccess
      ? null
      : StorageArrayCollectionErrorCodeUtil.isValid(report.errorCode)
        ? report.errorCode
        : StorageArrayCollectionErrorCode.Internal;

    await this.updateColumnsByIdWithoutHooks({
      id: test.id,
      data: {
        status: isSuccess
          ? StorageArrayConnectionTestStatus.Succeeded
          : StorageArrayConnectionTestStatus.Failed,
        errorCode: errorCode,
        errorMessage: isSuccess
          ? null
          : VMwareProbeCollectionStore.boundText(
              report.errorMessage,
              ColumnLength.LongText,
            ),
        presentedCertificate:
          !isSuccess &&
          StorageArrayCollectionErrorCodeUtil.isCertificateProblem(errorCode)
            ? StorageArrayProbeCollectionStore.sanitizePresentedCertificate(
                report.presentedCertificate,
              )
            : null,
        summary: isSuccess
          ? StorageArrayProbeCollectionStore.sanitizeSummary(report.summary)
          : null,
        completedAt: OneUptimeDate.getCurrentDate(),
        password: null,
      } as never,
    });

    return true;
  }

  /*
   * Answer the tests nobody will answer: waiting longer than a probe takes
   * to pick one up (the probe is offline, or too old to test storage
   * connections), or running longer than a test takes.
   */
  @CaptureSpan()
  public async expireStaleTests(): Promise<void> {
    const now: Date = OneUptimeDate.getCurrentDate();

    await this.getRepository().manager.query(
      `UPDATE "StorageArrayConnectionTest"
       SET "status" = $1, "errorCode" = $2, "errorMessage" = $3, "completedAt" = $4::timestamptz, "password" = NULL
       WHERE "status" = $5 AND "deletedAt" IS NULL AND "createdAt" < $6::timestamptz`,
      [
        StorageArrayConnectionTestStatus.Failed,
        StorageArrayCollectionErrorCode.ProbeNotAvailable,
        ProductBrandingText.brandText(STORAGE_ARRAY_TEST_NOT_PICKED_UP_MESSAGE),
        now,
        StorageArrayConnectionTestStatus.Pending,
        OneUptimeDate.addRemoveSeconds(
          now,
          -STORAGE_ARRAY_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS,
        ),
      ],
    );

    await this.getRepository().manager.query(
      `UPDATE "StorageArrayConnectionTest"
       SET "status" = $1, "errorCode" = $2, "errorMessage" = $3, "completedAt" = $4::timestamptz, "password" = NULL
       WHERE "status" = $5 AND "deletedAt" IS NULL AND "claimedAt" < $6::timestamptz`,
      [
        StorageArrayConnectionTestStatus.Failed,
        StorageArrayCollectionErrorCode.TimedOut,
        STORAGE_ARRAY_TEST_NOT_REPORTED_MESSAGE,
        now,
        StorageArrayConnectionTestStatus.Running,
        OneUptimeDate.addRemoveSeconds(
          now,
          -STORAGE_ARRAY_CONNECTION_TEST_RUN_TIMEOUT_IN_SECONDS,
        ),
      ],
    );
  }
}

export default new Service();
