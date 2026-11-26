import ProjectReferencesService, {
  ProjectReferenceWrite,
} from "./ProjectReferencesService";
import XcpNgConnectionService from "./XcpNgConnectionService";
import { IsBillingEnabled } from "../EnvironmentConfig";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import ProductBrandingText from "../Utils/ProductBrandingText";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import VMwareProbeCollectionStore from "../Utils/VMware/VMwareProbeCollectionStore";
import XcpNgConnectionRules, {
  getRequiredSecretName,
} from "../Utils/XcpNg/XcpNgConnectionRules";
import XcpNgProbeCollectionStore from "../Utils/XcpNg/XcpNgProbeCollectionStore";
import Model from "../../Models/DatabaseModels/XcpNgConnectionTest";
import XcpNgConnection from "../../Models/DatabaseModels/XcpNgConnection";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import XcpNgCollectionErrorCode, {
  XcpNgCollectionErrorUtil,
} from "../../Types/XcpNg/XcpNgCollectionError";
import XcpNgConnectionTestStatus, {
  MAX_ACTIVE_XCP_NG_CONNECTION_TESTS_PER_PROJECT,
  XCP_NG_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS,
  XCP_NG_CONNECTION_TEST_RUN_TIMEOUT_IN_SECONDS,
} from "../../Types/XcpNg/XcpNgConnectionTestStatus";
import XcpNgConnectionType, {
  XcpNgConnectionTypeUtil,
} from "../../Types/XcpNg/XcpNgConnectionType";
import {
  XcpNgConnectionTestJob,
  XcpNgConnectionTestReport,
} from "../../Types/XcpNg/XcpNgProbeCollection";
import VMwareCertificateFingerprint from "../../Utils/VMware/VMwareCertificateFingerprint";
import {
  MAX_XCP_NG_PASSWORD_LENGTH,
  MAX_XCP_NG_SECRET_LENGTH,
  MAX_XCP_NG_USERNAME_LENGTH,
} from "../../Utils/XcpNg/XcpNgCollectionSettings";
import XcpNgConnectionAddress, {
  XcpNgAddressResult,
} from "../../Utils/XcpNg/XcpNgConnectionAddress";

const PROBE_KEYS: Array<string> = ["probeId", "probe"];
const CONNECTION_KEYS: Array<string> = ["xcpNgConnectionId", "xcpNgConnection"];

// The secrets a test may carry, which no answer ever holds.
const SECRET_COLUMNS: Array<string> = ["openMetricsSecret", "apiToken", "password"];

/*
 * Why a test no probe picked up failed. It names the product, so the sweep
 * writes it through ProductBrandingText.
 */
export const XCP_NG_TEST_NOT_PICKED_UP_MESSAGE: string =
  "The probe did not pick up the test. It may be offline, or run a version of OneUptime older than XCP-ng collection - update it, or pick another probe.";

export const XCP_NG_TEST_NOT_REPORTED_MESSAGE: string =
  "The probe did not report back in time.";

function isGiven(value: unknown): boolean {
  return typeof value === "string" && value.length > 0;
}

/*
 * "Test connection" for an XCP-ng connection (XcpNgConnectionTest) - a
 * vCenter's (VMwareVCenterConnectionTestService), rule for rule: checked
 * like the connection it is about to become, handed once to the probe it
 * names - with its secrets wiped from the row as it is handed out - and
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
   * The probe and the connection are checked here: the probe may be one of
   * the instance's global probes on a self-hosted install, and another
   * project's connection or probe is answered like one that does not exist.
   */
  protected override getRelationsCheckedByService(
    _write?: ProjectReferenceWrite,
  ): Array<string> {
    return ["probe", "xcpNgConnection"];
  }

  /*
   * A create answers with the row it saved, serialized whole, and the row
   * holds the secrets, encrypted - for a test of a connection that is
   * already set up, its saved ones, which whoever may test never typed and
   * may not read. The probe reads them from the database, so what is handed
   * back here has no need of them.
   */
  @CaptureSpan()
  public override async create(createBy: CreateBy<Model>): Promise<Model> {
    const created: Model = await super.create(createBy);

    const row: Record<string, unknown> = created as unknown as Record<
      string,
      unknown
    >;

    for (const column of SECRET_COLUMNS) {
      row[column] = undefined;
    }

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

    const type: unknown = data["connectionType"];

    if (!XcpNgConnectionTypeUtil.isValid(type)) {
      throw new BadDataException(
        `Say what is tested: connectionType is one of ${XcpNgConnectionTypeUtil.getAll().join(", ")}.`,
      );
    }

    const address: XcpNgAddressResult = XcpNgConnectionAddress.normalize(
      typeof data["address"] === "string" ? (data["address"] as string) : "",
      type,
    );

    if (!address.address) {
      throw new BadDataException(address.error);
    }

    data["address"] = address.address.url;

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

    for (const [column, max, what] of [
      ["openMetricsSecret", MAX_XCP_NG_SECRET_LENGTH, "OpenMetrics secret"],
      ["apiToken", MAX_XCP_NG_SECRET_LENGTH, "API token"],
      ["password", MAX_XCP_NG_PASSWORD_LENGTH, "XAPI password"],
    ] as Array<[string, number, string]>) {
      const value: unknown = data[column];

      if (typeof value === "string" && value.length > max) {
        throw new BadDataException(
          `The ${what} may be at most ${max} characters.`,
        );
      }

      if (typeof value === "string" && column !== "password") {
        data[column] = value.trim();
      }
    }

    if (type === XcpNgConnectionType.Xapi) {
      const username: string =
        typeof data["username"] === "string"
          ? (data["username"] as string).trim()
          : "";

      if (username.length > MAX_XCP_NG_USERNAME_LENGTH) {
        throw new BadDataException(
          `The XAPI user name may be at most ${MAX_XCP_NG_USERNAME_LENGTH} characters.`,
        );
      }

      data["username"] = username || null;
      data["openMetricsSecret"] = null;
      data["apiToken"] = null;
    } else {
      data["username"] = null;
      data["password"] = null;
    }

    const probeId: ObjectID | null = RelationIdUtil.readIntoIdColumn(
      data,
      PROBE_KEYS,
      "Probe",
    );

    if (!probeId) {
      throw new BadDataException(
        "Pick the probe to test from: one in a network that reaches the address on its HTTPS port.",
      );
    }

    await XcpNgConnectionRules.assertProbeCanCollect({
      probeId: probeId,
      projectId: projectId,
    });

    const xcpNgConnectionId: ObjectID | null = RelationIdUtil.readIntoIdColumn(
      data,
      CONNECTION_KEYS,
      "XCP-ng Connection",
    );

    if (xcpNgConnectionId) {
      await this.fillSavedSecrets({
        data: data,
        type: type,
        xcpNgConnectionId: xcpNgConnectionId,
        projectId: projectId,
        probeId: probeId,
      });
    }

    if (type === XcpNgConnectionType.Xapi) {
      if (!data["username"]) {
        throw new BadDataException(
          "Enter the XAPI user name: root, or an Active Directory user with the read-only role.",
        );
      }

      if (!isGiven(data["password"])) {
        throw new BadDataException("Enter the XAPI password.");
      }
    } else if (!isGiven(data["openMetricsSecret"])) {
      throw new BadDataException(
        "Enter the OpenMetrics plugin's secret, from Settings, then Plugins, then openmetrics in Xen Orchestra.",
      );
    }

    const activeTests: PositiveNumber = await this.countBy({
      query: {
        projectId: projectId,
        status: QueryHelper.any([
          XcpNgConnectionTestStatus.Pending,
          XcpNgConnectionTestStatus.Running,
        ]),
      },
      props: {
        isRoot: true,
      },
    });

    if (
      activeTests.toNumber() >= MAX_ACTIVE_XCP_NG_CONNECTION_TESTS_PER_PROJECT
    ) {
      throw new BadDataException(
        "Several connection tests are still running in this project. Wait for them to finish, then test again.",
      );
    }

    return { createBy, carryForward: null };
  }

  /*
   * A test of an existing connection may use its saved secrets - under the
   * rule an update keeps them by: only for the address, probe and
   * certificate they were saved for (or the certificate the probe found
   * there). A test that brings its own still has to name a connection of
   * this project.
   */
  private async fillSavedSecrets(data: {
    data: Record<string, unknown>;
    type: XcpNgConnectionType;
    xcpNgConnectionId: ObjectID;
    projectId: ObjectID;
    probeId: ObjectID;
  }): Promise<void> {
    const connection: XcpNgConnection | null =
      await XcpNgConnectionService.findOneBy({
        query: {
          _id: data.xcpNgConnectionId,
          projectId: data.projectId,
        },
        select: {
          _id: true,
          connectionType: true,
          address: true,
          username: true,
          openMetricsSecret: true,
          apiToken: true,
          password: true,
          collectionProbeId: true,
          trustedCertificateFingerprint: true,
          presentedCertificate: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!connection) {
      throw new BadDataException("XCP-ng connection not found.");
    }

    if (connection.connectionType !== data.type) {
      throw new BadDataException(
        "Test the connection as what it reads: a Xen Orchestra, or a pool's XAPI.",
      );
    }

    const required: string = data.type === XcpNgConnectionType.Xapi ? "password" : "openMetricsSecret";
    const needsSaved: boolean = SECRET_COLUMNS.some((column: string): boolean => {
      return !isGiven(data.data[column]);
    });

    if (!needsSaved) {
      return;
    }

    const refusal: string | null = XcpNgConnectionRules.getRebindRefusal({
      saved: XcpNgConnectionRules.getBinding({
        address: connection.address,
        type: data.type,
        probeId: connection.collectionProbeId,
        trustedCertificateFingerprint: connection.trustedCertificateFingerprint,
      }),
      next: XcpNgConnectionRules.getBinding({
        address: data.data["address"] as string,
        type: data.type,
        probeId: data.probeId,
        trustedCertificateFingerprint: data.data[
          "trustedCertificateFingerprint"
        ] as string | null,
      }),
      presentedFingerprint: connection.presentedCertificate?.fingerprint256,
      secretName: getRequiredSecretName(data.type),
    });

    if (refusal) {
      // Only what is missing needs the saved one: a test bringing its own is fine.
      if (!isGiven(data.data[required])) {
        throw new BadDataException(refusal);
      }

      return;
    }

    if (data.type === XcpNgConnectionType.Xapi) {
      if (!isGiven(data.data["password"]) && connection.password) {
        data.data["password"] = connection.password;
      }

      if (!data.data["username"] && connection.username) {
        data.data["username"] = connection.username;
      }

      return;
    }

    if (!isGiven(data.data["openMetricsSecret"]) && connection.openMetricsSecret) {
      data.data["openMetricsSecret"] = connection.openMetricsSecret;
    }

    if (!isGiven(data.data["apiToken"]) && connection.apiToken) {
      data.data["apiToken"] = connection.apiToken;
    }
  }

  /*
   * Hand a probe the pending tests that name it, once each: claimed, the
   * secrets read, then wiped from the row - the vCenter test claim's
   * statement, on this table.
   */
  @CaptureSpan()
  public async claimPendingTests(data: {
    probeId: ObjectID;
    limit: number;
  }): Promise<Array<XcpNgConnectionTestJob>> {
    if (data.limit <= 0) {
      return [];
    }

    const now: Date = OneUptimeDate.getCurrentDate();
    const oldestPickup: Date = OneUptimeDate.addRemoveSeconds(
      now,
      -XCP_NG_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS,
    );

    const claimedRows: unknown = await this.getRepository().manager.query(
      `
      WITH "pending" AS (
        SELECT t."_id", t."createdAt"
        FROM "XcpNgConnectionTest" t
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
        UPDATE "XcpNgConnectionTest" AS t
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
        XcpNgConnectionTestStatus.Pending,
        oldestPickup,
        data.limit,
        IsBillingEnabled,
        XcpNgConnectionTestStatus.Running,
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
        connectionType: true,
        address: true,
        username: true,
        openMetricsSecret: true,
        apiToken: true,
        password: true,
        trustedCertificateFingerprint: true,
      },
      limit: claimedIds.length,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    // The secrets have been read for the probe: nothing keeps them now.
    for (const id of claimedIds) {
      await this.updateColumnsByIdWithoutHooks({
        id: new ObjectID(id),
        data: {
          openMetricsSecret: null,
          apiToken: null,
          password: null,
        } as never,
      });
    }

    const jobs: Array<XcpNgConnectionTestJob> = [];

    for (const test of VMwareProbeCollectionStore.inClaimOrder(
      tests,
      claimedIds,
    )) {
      if (
        !test._id ||
        !test.address ||
        !XcpNgConnectionTypeUtil.isValid(test.connectionType)
      ) {
        continue;
      }

      const job: XcpNgConnectionTestJob = {
        xcpNgConnectionTestId: test._id.toString(),
        connectionType: test.connectionType,
        address: test.address,
      };

      const fingerprint: string | null = VMwareCertificateFingerprint.normalize(
        test.trustedCertificateFingerprint,
      );

      if (fingerprint) {
        job.trustedCertificateFingerprint = fingerprint;
      }

      if (test.connectionType === XcpNgConnectionType.Xapi) {
        if (!test.username || !test.password) {
          continue;
        }

        job.username = test.username;
        job.password = test.password;
      } else {
        if (!test.openMetricsSecret) {
          continue;
        }

        job.openMetricsSecret = test.openMetricsSecret;

        if (test.apiToken) {
          job.apiToken = test.apiToken;
        }
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
    report: XcpNgConnectionTestReport;
  }): Promise<boolean> {
    const report: XcpNgConnectionTestReport = data.report;

    if (
      !report.xcpNgConnectionTestId ||
      !ObjectID.isValidUUID(report.xcpNgConnectionTestId)
    ) {
      return false;
    }

    const test: Model | null = await this.findOneBy({
      query: {
        _id: new ObjectID(report.xcpNgConnectionTestId),
        probeId: data.probeId,
        status: XcpNgConnectionTestStatus.Running,
      },
      select: {
        _id: true,
        xcpNgConnection: {
          apiTokenExpiresAt: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!test || !test.id) {
      return false;
    }

    const isSuccess: boolean = report.status === "Succeeded";
    let errorCode: XcpNgCollectionErrorCode | null = isSuccess
      ? null
      : XcpNgCollectionErrorUtil.isValid(report.errorCode)
        ? report.errorCode
        : XcpNgCollectionErrorCode.Internal;
    let errorMessage: string | null = isSuccess
      ? null
      : XcpNgProbeCollectionStore.getErrorText({
          errorCode: errorCode!,
          errorMessage: report.errorMessage,
        });

    /*
     * Xen Orchestra forgets an expired token, so a wrong one and an expired
     * one are refused alike: for a saved token, the expiry OneUptime last
     * read says which it is.
     */
    const savedExpiry: Date | undefined = (
      test.xcpNgConnection as XcpNgConnection | undefined
    )?.apiTokenExpiresAt;

    if (
      errorCode === XcpNgCollectionErrorCode.TokenRejected &&
      savedExpiry &&
      new Date(savedExpiry).getTime() <= OneUptimeDate.getCurrentDate().getTime()
    ) {
      errorCode = XcpNgCollectionErrorCode.TokenExpired;
      errorMessage =
        "The saved API token expired. Create a new one for the read-only user in Xen Orchestra and enter it here.";
    }

    await this.updateColumnsByIdWithoutHooks({
      id: test.id,
      data: {
        status: isSuccess
          ? XcpNgConnectionTestStatus.Succeeded
          : XcpNgConnectionTestStatus.Failed,
        errorCode: errorCode,
        errorMessage: errorMessage,
        presentedCertificate:
          !isSuccess &&
          XcpNgCollectionErrorUtil.isCertificateTrustProblem(errorCode)
            ? XcpNgProbeCollectionStore.sanitizePresentedCertificate(
                report.presentedCertificate,
              )
            : null,
        // What was seen tells the person something, whether or not it worked.
        summary: XcpNgProbeCollectionStore.sanitizeSummary(report.summary, {
          storedApiTokenExpiresAt: savedExpiry,
          now: OneUptimeDate.getCurrentDate(),
        }),
        completedAt: OneUptimeDate.getCurrentDate(),
        openMetricsSecret: null,
        apiToken: null,
        password: null,
      } as never,
    });

    return true;
  }

  /*
   * Answer the tests nobody will answer: waiting longer than a probe takes
   * to pick one up, or running longer than a test takes.
   */
  @CaptureSpan()
  public async expireStaleTests(): Promise<void> {
    const now: Date = OneUptimeDate.getCurrentDate();

    await this.getRepository().manager.query(
      `UPDATE "XcpNgConnectionTest"
       SET "status" = $1, "errorCode" = $2, "errorMessage" = $3, "completedAt" = $4::timestamptz, "openMetricsSecret" = NULL, "apiToken" = NULL, "password" = NULL
       WHERE "status" = $5 AND "deletedAt" IS NULL AND "createdAt" < $6::timestamptz`,
      [
        XcpNgConnectionTestStatus.Failed,
        XcpNgCollectionErrorCode.ProbeNotAvailable,
        ProductBrandingText.brandText(XCP_NG_TEST_NOT_PICKED_UP_MESSAGE),
        now,
        XcpNgConnectionTestStatus.Pending,
        OneUptimeDate.addRemoveSeconds(
          now,
          -XCP_NG_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS,
        ),
      ],
    );

    await this.getRepository().manager.query(
      `UPDATE "XcpNgConnectionTest"
       SET "status" = $1, "errorCode" = $2, "errorMessage" = $3, "completedAt" = $4::timestamptz, "openMetricsSecret" = NULL, "apiToken" = NULL, "password" = NULL
       WHERE "status" = $5 AND "deletedAt" IS NULL AND "claimedAt" < $6::timestamptz`,
      [
        XcpNgConnectionTestStatus.Failed,
        XcpNgCollectionErrorCode.TimedOut,
        XCP_NG_TEST_NOT_REPORTED_MESSAGE,
        now,
        XcpNgConnectionTestStatus.Running,
        OneUptimeDate.addRemoveSeconds(
          now,
          -XCP_NG_CONNECTION_TEST_RUN_TIMEOUT_IN_SECONDS,
        ),
      ],
    );
  }
}

export default new Service();
