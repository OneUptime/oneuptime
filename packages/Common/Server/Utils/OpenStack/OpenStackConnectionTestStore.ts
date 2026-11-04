import { IsBillingEnabled } from "../../EnvironmentConfig";
import QueryHelper from "../../Types/Database/QueryHelper";
import ProductBrandingText from "../ProductBrandingText";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import OpenStackCollectionErrorCode, {
  OpenStackCollectionErrorUtil,
} from "../../../Types/OpenStack/OpenStackCollectionError";
import OpenStackCollectionMethod from "../../../Types/OpenStack/OpenStackCollectionMethod";
import OpenStackConnectionTestStatus, {
  MAX_ACTIVE_OPENSTACK_CONNECTION_TESTS_PER_PROJECT,
  OPENSTACK_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS,
  OPENSTACK_CONNECTION_TEST_RUN_TIMEOUT_IN_SECONDS,
} from "../../../Types/OpenStack/OpenStackConnectionTestStatus";
import {
  DEFAULT_OPENSTACK_ENDPOINT_INTERFACE,
  OpenStackConnectionTestJob,
  OpenStackConnectionTestReport,
  OpenStackCredential,
} from "../../../Types/OpenStack/OpenStackProbeCollection";
import OpenStackAuthUrl, {
  OpenStackAddressResult,
} from "../../../Utils/OpenStack/OpenStackAuthUrl";
import OpenStackCollectionSettings from "../../../Utils/OpenStack/OpenStackCollectionSettings";
import OpenStackCloudConnection from "./OpenStackCloudConnection";
import OpenStackProbeCollectionStore, {
  OpenStackSqlManager,
} from "./OpenStackProbeCollectionStore";

/*
 * "Test connection" for a cloud (OpenStackCloudConnectionTest): checked like the
 * connection it is about to become, handed once to the probe it names, with the secret
 * wiped from the row as it is handed out, and answered when the probe reports, or as
 * failed when no probe picks it up in time.
 *
 * It is VMware's service (VMwareVCenterConnectionTestService) with the database taken
 * out, so it is here in the store's terms and a thin service can sit on it the moment the
 * model is registered. The two service methods this needs are named by
 * OpenStackConnectionTestService; nothing here knows the table beyond its SQL.
 */

/*
 * Why a test no probe picked up failed. It names the product, so the sweep writes it
 * through ProductBrandingText: an installation with its own name reads that name.
 */
export const OPENSTACK_TEST_NOT_PICKED_UP_MESSAGE: string =
  "The probe did not pick up the test. It may be offline, or run a version of OneUptime older than OpenStack collection. Update it, or pick another probe.";

export const OPENSTACK_TEST_NOT_REPORTED_MESSAGE: string =
  "The probe did not report back in time.";

export interface OpenStackConnectionTestRecord {
  _id?: string | undefined;
  id?: ObjectID | null | undefined;
  authUrl?: string | undefined;
  endpointInterface?: string | undefined;
  collectionRegions?: Array<string> | undefined;
  credentialKind?: string | undefined;
  applicationCredentialId?: string | undefined;
  keystoneUsername?: string | undefined;
  userDomainName?: string | undefined;
  projectName?: string | undefined;
  projectDomainName?: string | undefined;
  credentialSecret?: string | undefined;
  trustedCertificateFingerprints?: Array<string> | undefined;
}

// What the store needs of the service that owns the table.
export interface OpenStackConnectionTestService {
  executeTransaction: <T>(
    run: (manager: OpenStackSqlManager) => Promise<T>,
  ) => Promise<T>;
  countBy: (options: {
    query: Record<string, unknown>;
    props: { isRoot: boolean };
  }) => Promise<{ toNumber: () => number }>;
  findBy: (options: {
    query: Record<string, unknown>;
    select: Record<string, unknown>;
    limit: number;
    skip: number;
    props: { isRoot: boolean };
  }) => Promise<Array<OpenStackConnectionTestRecord>>;
  findOneBy: (options: {
    query: Record<string, unknown>;
    select: Record<string, unknown>;
    props: { isRoot: boolean };
  }) => Promise<OpenStackConnectionTestRecord | null>;
  updateColumnsByIdWithoutHooks: (options: {
    id: ObjectID;
    data: Record<string, unknown>;
  }) => Promise<unknown>;
}

// What a test of a saved cloud reads of that cloud, to use its saved credential.
export interface OpenStackSavedCloudForTest {
  collectionMethod?: OpenStackCollectionMethod | undefined;
  authUrl?: string | undefined;
  credentialKind?: string | undefined;
  applicationCredentialId?: string | undefined;
  keystoneUsername?: string | undefined;
  userDomainName?: string | undefined;
  projectName?: string | undefined;
  projectDomainName?: string | undefined;
  credentialSecret?: string | undefined;
  isCredentialSet?: boolean | undefined;
  collectionProbeId?: ObjectID | undefined;
  trustedCertificateFingerprints?: Array<string> | undefined;
  presentedCertificate?: { fingerprint256?: string | undefined } | undefined;
}

export default class OpenStackConnectionTestStore {
  /*
   * A new test's settings, checked and normalized in place. `readSavedCloud` reads the
   * saved cloud a test names, of this project: null is one that does not exist, however
   * it does not. A test that brings its own secret still has to name a cloud of this
   * project, if it names one.
   */
  public static async prepareCreate(data: {
    values: Record<string, unknown>;
    projectId: ObjectID | null;
    probeId: ObjectID | null;
    openStackCloudId: ObjectID | null;
    readSavedCloud: (
      openStackCloudId: ObjectID,
    ) => Promise<OpenStackSavedCloudForTest | null>;
    countActiveTests: () => Promise<number>;
    assertProbeCanCollect?:
      | ((probe: { probeId: ObjectID; projectId: ObjectID }) => Promise<void>)
      | undefined;
  }): Promise<void> {
    const values: Record<string, unknown> = data.values;

    if (!data.projectId) {
      throw new BadDataException("The test's project is missing.");
    }

    const address: OpenStackAddressResult = OpenStackAuthUrl.normalize(
      typeof values["authUrl"] === "string"
        ? (values["authUrl"] as string)
        : "",
    );

    if (!address.address) {
      throw new BadDataException(address.error);
    }

    values["authUrl"] = address.address.url;

    const endpointInterface: unknown = values["endpointInterface"];

    if (endpointInterface === undefined || endpointInterface === null) {
      values["endpointInterface"] = DEFAULT_OPENSTACK_ENDPOINT_INTERFACE;
    } else if (
      !OpenStackCollectionSettings.isEndpointInterface(endpointInterface)
    ) {
      throw new BadDataException(
        "The endpoint interface is public, internal or admin.",
      );
    }

    const regions: ReturnType<
      typeof OpenStackCollectionSettings.normalizeRegions
    > = OpenStackCollectionSettings.normalizeRegions(
      values["collectionRegions"] ?? [],
    );

    if (regions.error) {
      throw new BadDataException(regions.error);
    }

    values["collectionRegions"] = regions.regions;

    const fingerprints: ReturnType<
      typeof OpenStackCollectionSettings.normalizeFingerprints
    > = OpenStackCollectionSettings.normalizeFingerprints(
      values["trustedCertificateFingerprints"],
    );

    if (fingerprints.error) {
      throw new BadDataException(fingerprints.error);
    }

    values["trustedCertificateFingerprints"] = fingerprints.fingerprints;

    if (!data.probeId) {
      throw new BadDataException(
        "Pick the probe to test from: one in a network that can reach the cloud's APIs.",
      );
    }

    await (
      data.assertProbeCanCollect ||
      OpenStackCloudConnection.assertProbeCanCollect
    )({
      probeId: data.probeId,
      projectId: data.projectId,
    });

    const secret: unknown = values["credentialSecret"];
    const isSecretGiven: boolean =
      typeof secret === "string" && secret.length > 0;

    if (data.openStackCloudId) {
      const saved: OpenStackSavedCloudForTest | null =
        await data.readSavedCloud(data.openStackCloudId);

      if (!saved) {
        throw new BadDataException("Cloud not found.");
      }

      if (!isSecretGiven) {
        OpenStackConnectionTestStore.useSavedCredential({
          values: values,
          saved: saved,
          probeId: data.probeId,
          authUrl: address.address.url,
          fingerprints: fingerprints.fingerprints,
        });
      } else {
        OpenStackConnectionTestStore.readGivenCredential(values, saved);
      }
    } else if (!isSecretGiven) {
      throw new BadDataException(
        "Enter an application credential's ID and secret.",
      );
    } else {
      OpenStackConnectionTestStore.readGivenCredential(values);
    }

    if (
      (await data.countActiveTests()) >=
      MAX_ACTIVE_OPENSTACK_CONNECTION_TESTS_PER_PROJECT
    ) {
      throw new BadDataException(
        "Several connection tests are still running in this project. Wait for them to finish, then test again.",
      );
    }
  }

  // A new secret, with what names it: what the test says, then what the cloud has saved.
  private static readGivenCredential(
    values: Record<string, unknown>,
    saved?: OpenStackSavedCloudForTest | undefined,
  ): void {
    const read: ReturnType<typeof OpenStackCollectionSettings.readCredential> =
      OpenStackCollectionSettings.readCredentialColumns({
        written: values,
        saved: saved,
        secret: values["credentialSecret"] as string,
      });

    if (!read.credential) {
      throw new BadDataException(read.error);
    }

    OpenStackConnectionTestStore.writeCredential(values, read.credential);
  }

  private static writeCredential(
    values: Record<string, unknown>,
    credential: OpenStackCredential,
  ): void {
    values["credentialKind"] = credential.kind;

    if (credential.kind === "applicationCredential") {
      values["applicationCredentialId"] = credential.id;
      values["credentialSecret"] = credential.secret;
      return;
    }

    values["keystoneUsername"] = credential.username;
    values["userDomainName"] = credential.userDomainName;
    values["projectName"] = credential.projectName;
    values["projectDomainName"] = credential.projectDomainName;
    values["credentialSecret"] = credential.password;
  }

  /*
   * A test of an existing cloud may use its saved credential, under the rule an update
   * keeps it by: only for the address, probe and certificates it was saved for (or the
   * certificate the probe found there).
   */
  private static useSavedCredential(data: {
    values: Record<string, unknown>;
    saved: OpenStackSavedCloudForTest;
    probeId: ObjectID;
    authUrl: string;
    fingerprints: Array<string>;
  }): void {
    const { saved } = data;

    const credential: OpenStackCredential | null =
      saved.collectionMethod === OpenStackCollectionMethod.Probe &&
      saved.isCredentialSet
        ? OpenStackProbeCollectionStore.readCredential(saved)
        : null;

    if (!credential) {
      throw new BadDataException(
        "Enter an application credential's ID and secret.",
      );
    }

    const refusal: string | null = OpenStackCloudConnection.getRebindRefusal({
      saved: OpenStackCloudConnection.getBinding({
        authUrl: saved.authUrl,
        probeId: saved.collectionProbeId,
        trustedCertificateFingerprints: saved.trustedCertificateFingerprints,
      }),
      next: OpenStackCloudConnection.getBinding({
        authUrl: data.authUrl,
        probeId: data.probeId,
        trustedCertificateFingerprints: data.fingerprints,
      }),
      presentedFingerprint: saved.presentedCertificate?.fingerprint256,
    });

    if (refusal) {
      throw new BadDataException(refusal);
    }

    OpenStackConnectionTestStore.writeCredential(data.values, credential);
  }

  /*
   * Hand a probe the pending tests that name it, once each: claimed, the secret read, then
   * wiped from the row. Tests that waited longer than a person would are left for
   * expireStaleTests.
   */
  public static async claimPendingTests(
    service: OpenStackConnectionTestService,
    data: {
      probeId: ObjectID;
      limit: number;
    },
  ): Promise<Array<OpenStackConnectionTestJob>> {
    if (data.limit <= 0) {
      return [];
    }

    const now: Date = OneUptimeDate.getCurrentDate();
    const oldestPickup: Date = OneUptimeDate.addRemoveSeconds(
      now,
      -OPENSTACK_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS,
    );

    const claimedIds: Array<string> = await service.executeTransaction(
      async (manager: OpenStackSqlManager): Promise<Array<string>> => {
        const selectedRows: Array<{ _id: string }> = (await manager.query(
          `
          SELECT t."_id"
          FROM "OpenStackCloudConnectionTest" t
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
            OpenStackConnectionTestStatus.Pending,
            oldestPickup,
            data.limit,
            IsBillingEnabled,
          ],
        )) as Array<{ _id: string }>;

        if (selectedRows.length === 0) {
          return [];
        }

        const ids: Array<string> = selectedRows.map(
          (row: { _id: string }): string => {
            return row._id;
          },
        );

        await manager.query(
          `UPDATE "OpenStackCloudConnectionTest" SET "status" = $1, "claimedAt" = $2::timestamptz WHERE "_id" = ANY($3::uuid[])`,
          [OpenStackConnectionTestStatus.Running, now, ids],
        );

        return ids;
      },
    );

    if (claimedIds.length === 0) {
      return [];
    }

    const tests: Array<OpenStackConnectionTestRecord> = await service.findBy({
      query: {
        _id: QueryHelper.any(claimedIds),
      },
      select: {
        _id: true,
        authUrl: true,
        endpointInterface: true,
        collectionRegions: true,
        credentialKind: true,
        applicationCredentialId: true,
        keystoneUsername: true,
        userDomainName: true,
        projectName: true,
        projectDomainName: true,
        credentialSecret: true,
        trustedCertificateFingerprints: true,
      },
      limit: claimedIds.length,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    // The secret has been read for the probe, so nothing keeps it now.
    for (const id of claimedIds) {
      await service.updateColumnsByIdWithoutHooks({
        id: new ObjectID(id),
        data: { credentialSecret: null },
      });
    }

    const jobs: Array<OpenStackConnectionTestJob> = [];

    // In the order they were claimed: the oldest first.
    for (const test of OpenStackProbeCollectionStore.inClaimOrder(
      tests,
      claimedIds,
    )) {
      const credential: OpenStackCredential | null =
        OpenStackProbeCollectionStore.readCredential(test);

      if (!test._id || !test.authUrl || !credential) {
        continue;
      }

      jobs.push({
        openStackCloudConnectionTestId: test._id.toString(),
        authUrl: test.authUrl,
        credential: credential,
        regions: Array.isArray(test.collectionRegions)
          ? test.collectionRegions
          : [],
        endpointInterface: OpenStackCollectionSettings.isEndpointInterface(
          test.endpointInterface,
        )
          ? test.endpointInterface
          : DEFAULT_OPENSTACK_ENDPOINT_INTERFACE,
        trustedCertificateFingerprints:
          OpenStackProbeCollectionStore.readFingerprints(
            test.trustedCertificateFingerprints,
          ),
      });
    }

    return jobs;
  }

  /*
   * What the probe found. Only the probe a test was handed to answers it, and only while
   * it runs.
   */
  public static async recordTestReport(
    service: OpenStackConnectionTestService,
    data: {
      probeId: ObjectID;
      report: OpenStackConnectionTestReport;
    },
  ): Promise<boolean> {
    const report: OpenStackConnectionTestReport = data.report;

    if (
      !report.openStackCloudConnectionTestId ||
      !ObjectID.isValidUUID(report.openStackCloudConnectionTestId)
    ) {
      return false;
    }

    const test: OpenStackConnectionTestRecord | null = await service.findOneBy({
      query: {
        _id: new ObjectID(report.openStackCloudConnectionTestId),
        probeId: data.probeId,
        status: OpenStackConnectionTestStatus.Running,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!test) {
      return false;
    }

    const isSuccess: boolean = report.status === "Succeeded";
    const errorCode: OpenStackCollectionErrorCode | null = isSuccess
      ? null
      : OpenStackCollectionErrorUtil.isValid(report.errorCode)
        ? report.errorCode
        : OpenStackCollectionErrorCode.Internal;

    await service.updateColumnsByIdWithoutHooks({
      id: test.id || new ObjectID(report.openStackCloudConnectionTestId),
      data: {
        status: isSuccess
          ? OpenStackConnectionTestStatus.Succeeded
          : OpenStackConnectionTestStatus.Failed,
        errorCode: errorCode,
        errorMessage: isSuccess
          ? null
          : OpenStackProbeCollectionStore.getErrorText({
              errorCode: errorCode!,
              errorMessage: report.errorMessage,
            }),
        presentedCertificate:
          !isSuccess &&
          OpenStackCollectionErrorUtil.isCertificateTrustProblem(errorCode)
            ? OpenStackProbeCollectionStore.sanitizePresentedCertificate(
                report.presentedCertificate,
              )
            : null,
        // A failed test still says what it found before it stopped.
        summary: OpenStackProbeCollectionStore.sanitizeTestSummary(
          report.summary,
        ),
        completedAt: OneUptimeDate.getCurrentDate(),
        credentialSecret: null,
      },
    });

    return true;
  }

  /*
   * Answer the tests nobody will answer: waiting longer than a probe takes to pick one up
   * (the probe is offline, or too old to test clouds), or running longer than a test
   * takes. The dashboard stops waiting for them and says why, and no secret waits in the
   * table for a probe that is not coming.
   */
  public static async expireStaleTests(
    manager: OpenStackSqlManager,
  ): Promise<void> {
    const now: Date = OneUptimeDate.getCurrentDate();

    await manager.query(
      `UPDATE "OpenStackCloudConnectionTest"
       SET "status" = $1, "errorCode" = $2, "errorMessage" = $3, "completedAt" = $4::timestamptz, "credentialSecret" = NULL
       WHERE "status" = $5 AND "deletedAt" IS NULL AND "createdAt" < $6::timestamptz`,
      [
        OpenStackConnectionTestStatus.Failed,
        OpenStackCollectionErrorCode.ProbeNotAvailable,
        ProductBrandingText.brandText(OPENSTACK_TEST_NOT_PICKED_UP_MESSAGE),
        now,
        OpenStackConnectionTestStatus.Pending,
        OneUptimeDate.addRemoveSeconds(
          now,
          -OPENSTACK_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS,
        ),
      ],
    );

    await manager.query(
      `UPDATE "OpenStackCloudConnectionTest"
       SET "status" = $1, "errorCode" = $2, "errorMessage" = $3, "completedAt" = $4::timestamptz, "credentialSecret" = NULL
       WHERE "status" = $5 AND "deletedAt" IS NULL AND "claimedAt" < $6::timestamptz`,
      [
        OpenStackConnectionTestStatus.Failed,
        OpenStackCollectionErrorCode.TimedOut,
        OPENSTACK_TEST_NOT_REPORTED_MESSAGE,
        now,
        OpenStackConnectionTestStatus.Running,
        OneUptimeDate.addRemoveSeconds(
          now,
          -OPENSTACK_CONNECTION_TEST_RUN_TIMEOUT_IN_SECONDS,
        ),
      ],
    );
  }
}
