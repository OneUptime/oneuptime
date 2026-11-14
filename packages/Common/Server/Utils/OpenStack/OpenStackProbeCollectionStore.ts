import { IsBillingEnabled } from "../../EnvironmentConfig";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import { SubscriptionStatusUtil } from "../../../Types/Billing/SubscriptionStatus";
import ColumnLength from "../../../Types/Database/ColumnLength";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import OpenStackCollectionErrorCode, {
  OpenStackCollectionErrorUtil,
} from "../../../Types/OpenStack/OpenStackCollectionError";
import {
  OpenStackInstanceMetricsOptions,
  normalizeOpenStackInstanceMetricsOptions,
} from "../../../Types/OpenStack/OpenStackInstanceMetrics";
import OpenStackCollectionMethod from "../../../Types/OpenStack/OpenStackCollectionMethod";
import OpenStackCollectionStatus from "../../../Types/OpenStack/OpenStackCollectionStatus";
import {
  DEFAULT_OPENSTACK_ENDPOINT_INTERFACE,
  OpenStackAccessRead,
  OpenStackCollectionJob,
  OpenStackCollectionOptions,
  OpenStackCollectionReport,
  OpenStackCollectionSummary,
  OpenStackConnectionTestSummary,
  OpenStackCredential,
  OpenStackPresentedCertificate,
  OpenStackServiceSummary,
} from "../../../Types/OpenStack/OpenStackProbeCollection";
import VMwareCertificateFingerprint from "../../../Utils/VMware/VMwareCertificateFingerprint";
import OpenStackCollectionSettings, {
  DEFAULT_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES,
  MAX_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES,
  MIN_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES,
} from "../../../Utils/OpenStack/OpenStackCollectionSettings";
import {
  SetAsideCounts,
  getClaimSetAsideParameters,
  getClaimSetAsideStatement,
  getMakeDueNowParameters,
  getMakeDueNowStatement,
  readSetAsideCounts,
  setAsideAfterClaim,
} from "../Probe/ClaimSetAside";

/*
 * The database half of probe collection: which clouds a probe collects now, and what
 * it found. It is VMware's store (VMwareProbeCollectionStore) for what a cloud is.
 *
 * Claiming is one statement (FOR NO KEY UPDATE SKIP LOCKED) that moves each claimed
 * cloud's nextCollectionAt an interval on, so two work requests - the same probe's
 * overlapping ticks, or two server replicas - never hand one cloud out twice, and no
 * claim holds a cloud longer than that statement runs. The clouds a probe says it is
 * still collecting are left out, so a collection slower than its interval is skipped,
 * not stacked. After each claim, the due clouds it stepped over because nothing may collect
 * them are set aside for a quarter of an hour (Utils/Probe/ClaimSetAside), so no claim steps
 * over them again and again; a write that makes one collectable makes it due at once
 * (OpenStackCloudConnection.afterWrite, and OpenStackCloudService for one unarchived).
 *
 * Only a probe that may collect a cloud is ever handed one: the cloud names it, and it
 * is the project's own probe - or, on a self-hosted install, one of the instance's own
 * (OpenStackCollectionSettings.getProbeRefusal). The save hooks hold every write to
 * this, and the claim holds rows written before them to it as well, so a stale row can
 * be made uncollectable but never hand its credential to the wrong probe.
 *
 * Written against OpenStackCollectionCloudService, which DatabaseService<OpenStackCloud>
 * meets, because nothing here needs more of the database than that.
 */

// What the store reads of a cloud: OpenStackCloud's collection columns.
export interface OpenStackCollectionCloudRecord {
  _id?: string | undefined;
  id?: ObjectID | null | undefined;
  projectId?: ObjectID | undefined;
  name?: string | undefined;
  collectionMethod?: OpenStackCollectionMethod | undefined;
  collectionProbeId?: ObjectID | undefined;
  collectionProbe?:
    | { isGlobalProbe?: boolean | undefined; projectId?: ObjectID | undefined }
    | undefined;
  collectionSettingsVersion?: number | undefined;
  collectionIntervalInMinutes?: number | undefined;
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
  collectionOptions?: OpenStackCollectionOptions | undefined;
  instanceMetricsOptions?: unknown;
}

export interface OpenStackSqlManager {
  query: (sql: string, parameters: Array<unknown>) => Promise<unknown>;
}

// What the store needs of the service that owns the table.
export interface OpenStackCollectionCloudService {
  /*
   * Its connection, for the claim's one self-committing statement. There is
   * no transaction to open here: a claim's row locks must never outlive its
   * statement (OneUptime issue #7194).
   */
  getRepository: () => { manager: OpenStackSqlManager };
  findBy: (options: {
    query: Record<string, unknown>;
    select: Record<string, unknown>;
    limit: number;
    skip: number;
    props: { isRoot: boolean };
  }) => Promise<Array<OpenStackCollectionCloudRecord>>;
  findOneById: (options: {
    id: ObjectID;
    select: Record<string, unknown>;
    props: { isRoot: boolean };
  }) => Promise<OpenStackCollectionCloudRecord | null>;
  updateColumnsByIdWithoutHooks: (options: {
    id: ObjectID;
    data: Record<string, unknown>;
  }) => Promise<unknown>;
}

// What recordCollectionReport made of a report.
export interface OpenStackCollectionReportOutcome {
  accepted: boolean;
  // Why a report was not accepted, for the probe's log.
  reason?: string | undefined;
  projectId?: ObjectID | undefined;
  cloudName?: string | undefined;
  /*
   * The report is for the cloud's current settings, so its status is the cloud's status
   * now. A report for older settings still delivers its data, but leaves the status to
   * the collection of the new ones.
   */
  isCurrent?: boolean | undefined;
}

const MAX_SUMMARY_WARNINGS: number = 20;
const MAX_SUMMARY_SERVICES: number = 512;
const MAX_SUMMARY_READS: number = 2048;
const MAX_TEXT_LENGTH: number = 1000;

export default class OpenStackProbeCollectionStore {
  public static async claimDueClouds(
    service: OpenStackCollectionCloudService,
    data: {
      probeId: ObjectID;
      runningOpenStackCloudIds: Array<string>;
      limit: number;
    },
  ): Promise<Array<OpenStackCollectionJob>> {
    if (data.limit <= 0) {
      return [];
    }

    const currentDate: Date = OneUptimeDate.getCurrentDate();

    const runningIds: Array<string> = data.runningOpenStackCloudIds.filter(
      (id: string): boolean => {
        return ObjectID.isValidUUID(id);
      },
    );

    /*
     * One self-committing statement (OneUptime issue #7194), as VMware's
     * claim explains (VMwareProbeCollectionStore.claimDueVCenters): the due
     * clouds are locked FOR NO KEY UPDATE SKIP LOCKED and moved an interval
     * on by the same statement, so the locks last only as long as it runs,
     * and the foreign-key check of a row that names a cloud never waits for
     * them. `nextCollectionAt <= now`, oldest first, is a range of the
     * (collectionProbeId, nextCollectionAt) index in its own order, which
     * stops at the limit; `IS NULL OR` and `NULLS FIRST` made it read and
     * sort every due cloud of the probe. A cloud with no nextCollectionAt
     * is made due by the set-aside below. The clouds the probe is still
     * collecting are left out, but not set aside: they may be collected.
     * The interval is held to getSafeInterval's bounds in SQL (the last
     * three parameters; the column is a NOT NULL integer, so it is the same
     * rule). The ids come back in claim order, the longest overdue first.
     */
    const claimedRows: unknown = await service.getRepository().manager.query(
      `
      WITH "due" AS (
        SELECT c."_id", c."nextCollectionAt" AS "dueAt"
        FROM "OpenStackCloud" c
        INNER JOIN "Project" p ON c."projectId" = p."_id"
        INNER JOIN "Probe" pr ON c."collectionProbeId" = pr."_id"
        WHERE c."collectionProbeId" = $1
          AND NOT (c."_id" = ANY($6::uuid[]))
          AND c."nextCollectionAt" <= $2
          AND ${OpenStackProbeCollectionStore.getCollectableSql({
            collectionMethodParameter: "$5",
            statusesParameter: "$4",
            isBillingEnabledParameter: "$7",
          })}
        ORDER BY c."nextCollectionAt" ASC
        LIMIT $3
        FOR NO KEY UPDATE OF c SKIP LOCKED
      ),
      "claimed" AS (
        -- ::timestamptz - see NetworkDeviceService.claimDevicesForPolling
        -- for why a ::timestamp cast skews the schedule.
        UPDATE "OpenStackCloud" AS c
        SET "nextCollectionAt" = $2::timestamptz + (
            CASE
              WHEN c."collectionIntervalInMinutes" IS NULL
                OR c."collectionIntervalInMinutes" <= 0
                THEN $8::int
              ELSE LEAST(GREATEST(c."collectionIntervalInMinutes", $9::int), $10::int)
            END
          ) * INTERVAL '1 minute'
        FROM "due"
        WHERE c."_id" = "due"."_id"
        RETURNING c."_id"
      )
      SELECT "due"."_id"
      FROM "due"
      INNER JOIN "claimed" ON "claimed"."_id" = "due"."_id"
      ORDER BY "due"."dueAt" ASC
    `,
      [
        data.probeId.toString(),
        currentDate,
        data.limit,
        SubscriptionStatusUtil.getActiveSubscriptionStatuses(),
        OpenStackCollectionMethod.Probe,
        runningIds,
        IsBillingEnabled,
        DEFAULT_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES,
        MIN_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES,
        MAX_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES,
      ],
    );

    const claimedIds: Array<string> = Array.isArray(claimedRows)
      ? claimedRows.map((row: { _id: string }): string => {
          return row._id;
        })
      : [];

    /*
     * The due clouds the claim stepped over - nothing may collect them
     * now - are set aside, so the next claim does not step over them again
     * (Utils/Probe/ClaimSetAside).
     */
    await setAsideAfterClaim({
      claim: "claimDueClouds",
      probeId: data.probeId,
      rows: "OpenStack clouds nothing may collect now",
      round: async (): Promise<SetAsideCounts> => {
        return await OpenStackProbeCollectionStore.setAsideUncollectable(
          service,
          {
            probeId: data.probeId,
            currentDate: currentDate,
          },
        );
      },
    });

    if (claimedIds.length === 0) {
      return [];
    }

    // Read as OneUptime: the secret is decrypted on read.
    const clouds: Array<OpenStackCollectionCloudRecord> = await service.findBy({
      query: {
        _id: QueryHelper.any(claimedIds),
      },
      select: {
        _id: true,
        name: true,
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
        collectionIntervalInMinutes: true,
        collectionSettingsVersion: true,
        collectionOptions: true,
        instanceMetricsOptions: true,
      },
      limit: claimedIds.length,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const jobs: Array<OpenStackCollectionJob> = [];

    // In the order they were claimed: the longest overdue first.
    for (const cloud of OpenStackProbeCollectionStore.inClaimOrder(
      clouds,
      claimedIds,
    )) {
      const credential: OpenStackCredential | null =
        OpenStackProbeCollectionStore.readCredential(cloud);

      if (!cloud._id || !cloud.authUrl || !credential) {
        continue;
      }

      jobs.push({
        openStackCloudId: cloud._id.toString(),
        cloudName: cloud.name || "",
        authUrl: cloud.authUrl,
        credential: credential,
        regions: Array.isArray(cloud.collectionRegions)
          ? cloud.collectionRegions
          : [],
        endpointInterface: OpenStackCollectionSettings.isEndpointInterface(
          cloud.endpointInterface,
        )
          ? cloud.endpointInterface
          : DEFAULT_OPENSTACK_ENDPOINT_INTERFACE,
        trustedCertificateFingerprints:
          OpenStackProbeCollectionStore.readFingerprints(
            cloud.trustedCertificateFingerprints,
          ),
        collectionIntervalInMinutes:
          OpenStackProbeCollectionStore.getSafeInterval(
            cloud.collectionIntervalInMinutes,
          ),
        settingsVersion: cloud.collectionSettingsVersion || 0,
        options: OpenStackProbeCollectionStore.getJobOptions(cloud),
      });
    }

    return jobs;
  }

  /*
   * Sets aside the probe's due clouds that nothing may collect now (Utils/Probe/ClaimSetAside):
   * collected by the OpenStack agent - switching to it clears nextCollectionAt and keeps the
   * probe - archived, without a credential or Keystone's address, on a probe that may not collect
   * it, or of a suspended, blocked, sample or deleted project. Each is judged again by the claim's
   * own rule (getCollectableSql, IS NOT TRUE), so a cloud the claim would hand out is never moved.
   * Makes due the probe's clouds with no nextCollectionAt at all.
   *
   * Returns how many it set aside, and how many it made due.
   */
  public static async setAsideUncollectable(
    service: OpenStackCollectionCloudService,
    data: {
      probeId: ObjectID;
      currentDate: Date;
    },
  ): Promise<SetAsideCounts> {
    const rows: unknown = await service.getRepository().manager.query(
      getClaimSetAsideStatement({
        table: "OpenStackCloud",
        alias: "c",
        dueColumn: "nextCollectionAt",
        sources: [
          {
            from: `"OpenStackCloud" c`,
            where: `c."collectionProbeId" = $1`,
          },
        ],
        joins: `LEFT JOIN "Project" p ON c."projectId" = p."_id"
        LEFT JOIN "Probe" pr ON c."collectionProbeId" = pr."_id"`,
        isProbesRow: `c."collectionProbeId" = $1`,
        claimable: OpenStackProbeCollectionStore.getCollectableSql({
          collectionMethodParameter: "$6",
          statusesParameter: "$7",
          isBillingEnabledParameter: "$8",
        }),
      }),
      getClaimSetAsideParameters({
        probeId: data.probeId,
        currentDate: data.currentDate,
        ruleParameters: [
          OpenStackCollectionMethod.Probe,
          SubscriptionStatusUtil.getActiveSubscriptionStatuses(),
          IsBillingEnabled,
        ],
      }),
    );

    return readSetAsideCounts(rows);
  }

  /*
   * Makes probe-collected clouds due now, unless they are due already (Utils/Probe/ClaimSetAside,
   * getMakeDueNowStatement): for a write that makes a cloud the claim set aside collectable again
   * that is not a collection settings write - those make the cloud due themselves
   * (OpenStackCloudConnection.afterWrite) - such as unarchiving it. A cloud the agent sends is
   * left as it is.
   */
  public static async makeDueNow(
    service: Pick<OpenStackCollectionCloudService, "getRepository">,
    openStackCloudIds: Array<ObjectID>,
  ): Promise<void> {
    const parameters: Array<unknown> | null = getMakeDueNowParameters({
      ids: openStackCloudIds,
      currentDate: OneUptimeDate.getCurrentDate(),
    });

    if (!parameters) {
      return;
    }

    await service.getRepository().manager.query(
      getMakeDueNowStatement({
        table: "OpenStackCloud",
        dueColumns: ["nextCollectionAt"],
        idColumn: "_id",
        where: `"collectionMethod" = '${OpenStackCollectionMethod.Probe}'`,
      }),
      parameters,
    );
  }

  /*
   * Whether a cloud may be handed to its probe to collect now, as SQL over the aliases the claim's
   * statements use - `c` (the OpenStackCloud), `p` (its Project) and `pr` (its collection Probe) -
   * with the Probe collection method, the served subscription statuses and whether billing is on
   * bound as the parameters named. The claim keeps the clouds it is true for and the set-aside
   * moves the ones it is not true for: one definition, so a cloud the claim would hand out is never
   * one the set-aside moves. Read through LEFT JOINs, a missing project or probe is NULL here,
   * never true.
   *
   * - Collected by a probe, not deleted or archived, with the credential and Keystone's address a
   *   collection needs.
   * - The tenancy backstop: the project's own probe, or a global probe on an instance where those
   *   are the operator's own (billing off).
   * - The project is served (ProjectService.getActiveProjectStatusQuery): not deleted, not blocked
   *   by a master admin - it is not collected until it is unblocked - not a sample, and its
   *   subscriptions not inactive.
   */
  public static getCollectableSql(parameters: {
    collectionMethodParameter: string;
    statusesParameter: string;
    isBillingEnabledParameter: string;
  }): string {
    return [
      `c."collectionMethod" = ${parameters.collectionMethodParameter}`,
      `c."deletedAt" IS NULL`,
      `c."isArchived" = false`,
      `c."isCredentialSet" = true`,
      `c."authUrl" IS NOT NULL`,
      `((pr."isGlobalProbe" = false AND pr."projectId" = c."projectId") OR (pr."isGlobalProbe" = true AND ${parameters.isBillingEnabledParameter}::boolean = false))`,
      `pr."deletedAt" IS NULL`,
      `p."deletedAt" IS NULL`,
      `p."isBlocked" = false`,
      `p."isSampleProject" = false`,
      `(p."paymentProviderSubscriptionStatus" IS NULL OR p."paymentProviderSubscriptionStatus" = ANY(${parameters.statusesParameter}::text[]))`,
      `(p."paymentProviderMeteredSubscriptionStatus" IS NULL OR p."paymentProviderMeteredSubscriptionStatus" = ANY(${parameters.statusesParameter}::text[]))`,
    ].join("\n          AND ");
  }

  /*
   * What a job is handed: what was saved for the probe, and which instances this cloud chose to
   * keep series for, which is saved apart because ingest reads it too.
   */
  public static getJobOptions(
    cloud: Pick<
      OpenStackCollectionCloudRecord,
      "collectionOptions" | "instanceMetricsOptions"
    >,
  ): OpenStackCollectionOptions | undefined {
    const instanceMetrics: OpenStackInstanceMetricsOptions | undefined =
      normalizeOpenStackInstanceMetricsOptions(
        cloud.instanceMetricsOptions,
      ).options;

    if (!instanceMetrics) {
      return cloud.collectionOptions || undefined;
    }

    return {
      ...(cloud.collectionOptions || {}),
      instanceSeriesMode: instanceMetrics.mode,
      keptProjectIds: instanceMetrics.projectIds,
    };
  }

  /*
   * The credential a row holds, or null when the row holds none it can use. The secret
   * is one column for either kind, because only one kind is ever saved.
   */
  public static readCredential(record: {
    credentialKind?: string | undefined;
    applicationCredentialId?: string | undefined;
    keystoneUsername?: string | undefined;
    userDomainName?: string | undefined;
    projectName?: string | undefined;
    projectDomainName?: string | undefined;
    credentialSecret?: string | undefined;
  }): OpenStackCredential | null {
    if (!record.credentialSecret) {
      return null;
    }

    if (
      record.credentialKind === "applicationCredential" &&
      record.applicationCredentialId
    ) {
      return {
        kind: "applicationCredential",
        id: record.applicationCredentialId,
        secret: record.credentialSecret,
      };
    }

    if (
      record.credentialKind === "password" &&
      record.keystoneUsername &&
      record.projectName
    ) {
      return {
        kind: "password",
        username: record.keystoneUsername,
        password: record.credentialSecret,
        userDomainName: record.userDomainName || "Default",
        projectName: record.projectName,
        projectDomainName: record.projectDomainName || "Default",
      };
    }

    return null;
  }

  public static readFingerprints(value: unknown): Array<string> {
    if (!Array.isArray(value)) {
      return [];
    }

    const fingerprints: Array<string> = [];

    for (const item of value) {
      const fingerprint: string | null = VMwareCertificateFingerprint.normalize(
        typeof item === "string" ? item : "",
      );

      if (fingerprint && !fingerprints.includes(fingerprint)) {
        fingerprints.push(fingerprint);
      }
    }

    return fingerprints;
  }

  /*
   * Record what a probe found for a cloud it collected: the status, and - for a report
   * of the current settings - the error, the certificate it did not trust, and the
   * summary. Only the cloud's own probe is heard, and only while a probe collects it.
   */
  public static async recordCollectionReport(
    service: OpenStackCollectionCloudService,
    data: {
      probeId: ObjectID;
      report: OpenStackCollectionReport;
    },
  ): Promise<OpenStackCollectionReportOutcome> {
    const report: OpenStackCollectionReport = data.report;

    if (
      !report.openStackCloudId ||
      !ObjectID.isValidUUID(report.openStackCloudId)
    ) {
      return { accepted: false, reason: "The report names no cloud." };
    }

    const cloud: OpenStackCollectionCloudRecord | null =
      await service.findOneById({
        id: new ObjectID(report.openStackCloudId),
        select: {
          _id: true,
          projectId: true,
          name: true,
          collectionMethod: true,
          collectionProbeId: true,
          collectionSettingsVersion: true,
          collectionProbe: {
            _id: true,
            isGlobalProbe: true,
            projectId: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

    if (
      !cloud ||
      !cloud.projectId ||
      cloud.collectionMethod !== OpenStackCollectionMethod.Probe ||
      !cloud.collectionProbeId ||
      cloud.collectionProbeId.toString().toLowerCase() !==
        data.probeId.toString().toLowerCase()
    ) {
      return {
        accepted: false,
        reason:
          "This probe does not collect that cloud (any more): it was deleted, switched to the OpenStack agent, or moved to another probe.",
      };
    }

    const refusal: string | null = OpenStackCollectionSettings.getProbeRefusal({
      probe: {
        isGlobalProbe: cloud.collectionProbe?.isGlobalProbe,
        projectId: cloud.collectionProbe?.projectId?.toString() || null,
      },
      projectId: cloud.projectId.toString(),
      isBillingEnabled: IsBillingEnabled,
    });

    if (refusal) {
      return { accepted: false, reason: refusal };
    }

    const isCurrent: boolean =
      Number(report.settingsVersion) ===
      Number(cloud.collectionSettingsVersion || 0);

    const now: Date = OneUptimeDate.getCurrentDate();

    const values: Record<string, unknown> = {
      lastCollectionAt: now,
    };

    if (isCurrent) {
      const status: OpenStackCollectionStatus =
        report.status === OpenStackCollectionStatus.Succeeded
          ? OpenStackCollectionStatus.Succeeded
          : report.status === OpenStackCollectionStatus.PartiallySucceeded
            ? OpenStackCollectionStatus.PartiallySucceeded
            : OpenStackCollectionStatus.Failed;

      values["collectionStatus"] = status;

      if (status !== OpenStackCollectionStatus.Failed) {
        values["lastSuccessfulCollectionAt"] = now;
      }

      const summary: OpenStackCollectionSummary | null =
        OpenStackProbeCollectionStore.sanitizeSummary(report.summary);

      if (summary) {
        values["collectionSummary"] = summary;
      }

      if (status === OpenStackCollectionStatus.Succeeded) {
        values["collectionErrorCode"] = null;
        values["collectionError"] = null;
        values["presentedCertificate"] = null;
      } else {
        const errorCode: OpenStackCollectionErrorCode =
          OpenStackCollectionErrorUtil.isValid(report.errorCode)
            ? report.errorCode
            : OpenStackCollectionErrorCode.Internal;

        values["collectionErrorCode"] = errorCode;
        values["collectionError"] = OpenStackProbeCollectionStore.getErrorText({
          errorCode: errorCode,
          errorMessage: report.errorMessage,
        });
        values["presentedCertificate"] =
          OpenStackCollectionErrorUtil.isCertificateTrustProblem(errorCode)
            ? OpenStackProbeCollectionStore.sanitizePresentedCertificate(
                report.presentedCertificate,
              )
            : null;
      }
    }

    try {
      await service.updateColumnsByIdWithoutHooks({
        id: cloud.id || new ObjectID(report.openStackCloudId),
        data: values,
      });
    } catch (error) {
      logger.error(
        `Could not record the collection of cloud ${report.openStackCloudId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }

    return {
      accepted: true,
      projectId: cloud.projectId,
      cloudName: cloud.name || undefined,
      isCurrent: isCurrent,
    };
  }

  public static getSafeInterval(value: number | null | undefined): number {
    const interval: number = Number(value);

    if (!Number.isFinite(interval) || interval <= 0) {
      return DEFAULT_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES;
    }

    return Math.min(
      Math.max(
        Math.round(interval),
        MIN_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES,
      ),
      MAX_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES,
    );
  }

  /*
   * Rows read back by id, in the order their ids were claimed (a read by id comes back
   * in whatever order Postgres finds them). Rows whose id was not claimed are left out.
   */
  public static inClaimOrder<T extends { _id?: string | undefined }>(
    rows: Array<T>,
    claimedIds: Array<string>,
  ): Array<T> {
    const byId: Map<string, T> = new Map();

    for (const row of rows) {
      if (row._id) {
        byId.set(row._id.toString().toLowerCase(), row);
      }
    }

    const ordered: Array<T> = [];

    for (const id of claimedIds) {
      const row: T | undefined = byId.get(id.toLowerCase());

      if (row) {
        ordered.push(row);
      }
    }

    return ordered;
  }

  /*
   * The sentence stored for a failure: the probe's own, bounded - or, when it sent none
   * (or only blanks), the code's title.
   */
  public static getErrorText(data: {
    errorCode: OpenStackCollectionErrorCode;
    errorMessage: unknown;
  }): string | null {
    return (
      OpenStackProbeCollectionStore.boundText(
        data.errorMessage,
        ColumnLength.LongText,
      ) ||
      OpenStackProbeCollectionStore.boundText(
        OpenStackCollectionErrorUtil.getAdvice(data.errorCode).title,
        ColumnLength.LongText,
      )
    );
  }

  public static boundText(value: unknown, maxLength: number): string | null {
    if (typeof value !== "string") {
      return null;
    }

    const trimmed: string = value.trim();

    if (!trimmed) {
      return null;
    }

    return trimmed.length > maxLength
      ? `${trimmed.substring(0, maxLength - 1)}…`
      : trimmed;
  }

  /*
   * A presented certificate as the probe reported it, held to the shape the dashboard
   * reads: a fingerprint in the canonical spelling, and bounded strings. Null when the
   * fingerprint is not one.
   */
  public static sanitizePresentedCertificate(
    value: unknown,
  ): OpenStackPresentedCertificate | null {
    if (!value || typeof value !== "object") {
      return null;
    }

    const raw: Record<string, unknown> = value as Record<string, unknown>;

    const fingerprint: string | null = VMwareCertificateFingerprint.normalize(
      typeof raw["fingerprint256"] === "string"
        ? (raw["fingerprint256"] as string)
        : null,
    );

    if (!fingerprint) {
      return null;
    }

    const certificate: OpenStackPresentedCertificate = {
      fingerprint256: fingerprint,
      subject:
        OpenStackProbeCollectionStore.boundText(
          raw["subject"],
          MAX_TEXT_LENGTH,
        ) || "",
      issuer:
        OpenStackProbeCollectionStore.boundText(
          raw["issuer"],
          MAX_TEXT_LENGTH,
        ) || "",
      isSelfSigned: raw["isSelfSigned"] === true,
    };

    for (const key of [
      "validFrom",
      "validTo",
      "subjectAltName",
      "verificationError",
      "host",
    ] as const) {
      const text: string | null = OpenStackProbeCollectionStore.boundText(
        raw[key],
        MAX_TEXT_LENGTH,
      );

      if (text) {
        certificate[key] = text;
      }
    }

    const port: number = Number(raw["port"]);

    if (Number.isInteger(port) && port > 0 && port <= 65535) {
      certificate.port = port;
    }

    return certificate;
  }

  private static wholeCount(value: unknown): number {
    const number: number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
  }

  private static boundList(value: unknown, max: number): Array<string> {
    return (Array.isArray(value) ? value : [])
      .map((item: unknown): string | null => {
        return OpenStackProbeCollectionStore.boundText(item, MAX_TEXT_LENGTH);
      })
      .filter((item: string | null): item is string => {
        return item !== null;
      })
      .slice(0, max);
  }

  // A summary as the probe reported it: whole counts, bounded strings and lists.
  public static sanitizeSummary(
    value: unknown,
  ): OpenStackCollectionSummary | null {
    if (!value || typeof value !== "object") {
      return null;
    }

    const raw: Record<string, unknown> = value as Record<string, unknown>;

    const count: (key: string) => number = (key: string): number => {
      return OpenStackProbeCollectionStore.wholeCount(raw[key]);
    };

    const summary: OpenStackCollectionSummary = {
      credentialKind:
        raw["credentialKind"] === "password"
          ? "password"
          : "applicationCredential",
      regionNames: OpenStackProbeCollectionStore.boundList(
        raw["regionNames"],
        MAX_SUMMARY_SERVICES,
      ),
      services: (Array.isArray(raw["services"]) ? raw["services"] : [])
        .slice(0, MAX_SUMMARY_SERVICES)
        .map((item: unknown): OpenStackServiceSummary | null => {
          return OpenStackProbeCollectionStore.sanitizeServiceSummary(item);
        })
        .filter(
          (
            item: OpenStackServiceSummary | null,
          ): item is OpenStackServiceSummary => {
            return item !== null;
          },
        ),
      hypervisorCount: count("hypervisorCount"),
      instanceCount: count("instanceCount"),
      networkCount: count("networkCount"),
      volumeCount: count("volumeCount"),
      projectCount: count("projectCount"),
      warnings: OpenStackProbeCollectionStore.boundList(
        raw["warnings"],
        MAX_SUMMARY_WARNINGS,
      ),
    };

    const projectName: string | null = OpenStackProbeCollectionStore.boundText(
      raw["projectName"],
      ColumnLength.ShortText * 2,
    );

    if (projectName) {
      summary.projectName = projectName;
    }

    if (Array.isArray(raw["roleNames"])) {
      summary.roleNames = OpenStackProbeCollectionStore.boundList(
        raw["roleNames"],
        MAX_SUMMARY_WARNINGS,
      );
    }

    for (const key of [
      "resourceCount",
      "datapointCount",
      "requestCount",
    ] as const) {
      if (raw[key] !== undefined) {
        summary[key] = count(key);
      }
    }

    if (raw["isSummaryMode"] === true) {
      summary.isSummaryMode = true;
      summary.refreshCycleInMinutes = count("refreshCycleInMinutes");

      const firstCycleEndsAt: number =
        typeof raw["firstCycleEndsAt"] === "string"
          ? Date.parse(raw["firstCycleEndsAt"])
          : NaN;

      if (Number.isFinite(firstCycleEndsAt)) {
        summary.firstCycleEndsAt = new Date(firstCycleEndsAt).toISOString();
      }
    }

    for (const key of ["computeMicroversions", "instanceReadModes"] as const) {
      const map: Record<string, string> | null =
        OpenStackProbeCollectionStore.boundMap(raw[key]);

      if (map) {
        (summary as unknown as Record<string, unknown>)[key] = map;
      }
    }

    return summary;
  }

  private static boundMap(value: unknown): Record<string, string> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const map: Record<string, string> = {};

    for (const key of Object.keys(value).slice(0, MAX_SUMMARY_SERVICES)) {
      const text: string | null = OpenStackProbeCollectionStore.boundText(
        (value as Record<string, unknown>)[key],
        MAX_TEXT_LENGTH,
      );

      if (text) {
        map[key.substring(0, MAX_TEXT_LENGTH)] = text;
      }
    }

    return map;
  }

  private static sanitizeServiceSummary(
    value: unknown,
  ): OpenStackServiceSummary | null {
    if (!value || typeof value !== "object") {
      return null;
    }

    const raw: Record<string, unknown> = value as Record<string, unknown>;

    const service: string | null = OpenStackProbeCollectionStore.boundText(
      raw["service"],
      ColumnLength.ShortText,
    );
    const outcome: string | null = OpenStackProbeCollectionStore.boundText(
      raw["outcome"],
      ColumnLength.ShortText,
    );

    if (!service || !outcome) {
      return null;
    }

    const summary: OpenStackServiceSummary = {
      service: service as OpenStackServiceSummary["service"],
      regionName:
        OpenStackProbeCollectionStore.boundText(
          raw["regionName"],
          MAX_TEXT_LENGTH,
        ) || "",
      outcome: outcome as OpenStackServiceSummary["outcome"],
      durationInMs: OpenStackProbeCollectionStore.wholeCount(
        raw["durationInMs"],
      ),
      requestCount: OpenStackProbeCollectionStore.wholeCount(
        raw["requestCount"],
      ),
    };

    if (raw["pausedForInMs"] !== undefined) {
      summary.pausedForInMs = OpenStackProbeCollectionStore.wholeCount(
        raw["pausedForInMs"],
      );
      summary.slowestAnswerInMs = OpenStackProbeCollectionStore.wholeCount(
        raw["slowestAnswerInMs"],
      );
    }

    if (OpenStackCollectionErrorUtil.isValid(raw["errorCode"])) {
      summary.errorCode = raw["errorCode"];
    }

    const message: string | null = OpenStackProbeCollectionStore.boundText(
      raw["errorMessage"],
      MAX_TEXT_LENGTH,
    );

    if (message) {
      summary.errorMessage = message;
    }

    const backingOffUntil: string | null =
      OpenStackProbeCollectionStore.boundText(
        raw["backingOffUntil"],
        ColumnLength.ShortText,
      );

    if (backingOffUntil) {
      summary.backingOffUntil = backingOffUntil;
    }

    return summary;
  }

  // A connection test's summary as the probe reported it, held to the same bounds.
  public static sanitizeTestSummary(
    value: unknown,
  ): OpenStackConnectionTestSummary | null {
    if (!value || typeof value !== "object") {
      return null;
    }

    const raw: Record<string, unknown> = value as Record<string, unknown>;

    const reads: Array<OpenStackAccessRead> = [];

    for (const item of (Array.isArray(raw["reads"]) ? raw["reads"] : []).slice(
      0,
      MAX_SUMMARY_READS,
    )) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const read: Record<string, unknown> = item as Record<string, unknown>;

      reads.push({
        regionName:
          OpenStackProbeCollectionStore.boundText(
            read["regionName"],
            MAX_TEXT_LENGTH,
          ) || "",
        service: (OpenStackProbeCollectionStore.boundText(
          read["service"],
          ColumnLength.ShortText,
        ) || "") as OpenStackAccessRead["service"],
        read:
          OpenStackProbeCollectionStore.boundText(
            read["read"],
            MAX_TEXT_LENGTH,
          ) || "",
        access: (OpenStackProbeCollectionStore.boundText(
          read["access"],
          ColumnLength.ShortText,
        ) || "Failing") as OpenStackAccessRead["access"],
        reason:
          OpenStackProbeCollectionStore.boundText(
            read["reason"],
            MAX_TEXT_LENGTH,
          ) || undefined,
        goesWithout:
          OpenStackProbeCollectionStore.boundText(
            read["goesWithout"],
            MAX_TEXT_LENGTH,
          ) || undefined,
        fix:
          OpenStackProbeCollectionStore.boundText(
            read["fix"],
            MAX_TEXT_LENGTH,
          ) || undefined,
      });
    }

    const servicesByRegion: Record<string, Array<string>> = {};

    if (
      raw["servicesByRegion"] &&
      typeof raw["servicesByRegion"] === "object"
    ) {
      const byRegion: Record<string, unknown> = raw[
        "servicesByRegion"
      ] as Record<string, unknown>;

      for (const region of Object.keys(byRegion).slice(
        0,
        MAX_SUMMARY_SERVICES,
      )) {
        servicesByRegion[region.substring(0, MAX_TEXT_LENGTH)] =
          OpenStackProbeCollectionStore.boundList(
            byRegion[region],
            MAX_SUMMARY_WARNINGS,
          );
      }
    }

    return {
      credentialKind:
        raw["credentialKind"] === "password"
          ? "password"
          : "applicationCredential",
      projectName:
        OpenStackProbeCollectionStore.boundText(
          raw["projectName"],
          ColumnLength.ShortText * 2,
        ) || undefined,
      roleNames: OpenStackProbeCollectionStore.boundList(
        raw["roleNames"],
        MAX_SUMMARY_WARNINGS,
      ),
      hasAccessRules: raw["hasAccessRules"] === true,
      isUnrestricted: raw["isUnrestricted"] === true,
      canProbablyWrite: raw["canProbablyWrite"] === true,
      regionsInCatalog: OpenStackProbeCollectionStore.boundList(
        raw["regionsInCatalog"],
        MAX_SUMMARY_SERVICES,
      ),
      servicesByRegion:
        servicesByRegion as OpenStackConnectionTestSummary["servicesByRegion"],
      accessLevel: (OpenStackProbeCollectionStore.boundText(
        raw["accessLevel"],
        ColumnLength.ShortText,
      ) || "Other") as OpenStackConnectionTestSummary["accessLevel"],
      reads: reads,
      warnings: OpenStackProbeCollectionStore.boundList(
        raw["warnings"],
        MAX_SUMMARY_WARNINGS,
      ),
    };
  }
}
