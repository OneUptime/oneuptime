import { IsBillingEnabled } from "../../EnvironmentConfig";
import DatabaseService from "../../Services/DatabaseService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import VMwareProbeCollectionStore from "../VMware/VMwareProbeCollectionStore";
import XcpNgConnection from "../../../Models/DatabaseModels/XcpNgConnection";
import { SubscriptionStatusUtil } from "../../../Types/Billing/SubscriptionStatus";
import ColumnLength from "../../../Types/Database/ColumnLength";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import XcpNgCollectionErrorCode, {
  XcpNgCollectionErrorUtil,
} from "../../../Types/XcpNg/XcpNgCollectionError";
import XcpNgCollectionStatus from "../../../Types/XcpNg/XcpNgCollectionStatus";
import XcpNgConnectionType, {
  XcpNgConnectionTypeUtil,
} from "../../../Types/XcpNg/XcpNgConnectionType";
import {
  XcpNgApiTokenSummary,
  XcpNgCollectionJob,
  XcpNgCollectionReport,
  XcpNgCollectionSummary,
  XcpNgMessageWatermark,
  XcpNgPoolSummary,
  XcpNgPresentedCertificate,
  XcpNgXapiAccountSummary,
  XcpNgXapiPoolHost,
} from "../../../Types/XcpNg/XcpNgProbeCollection";
import { XcpNgXapiAccountKindUtil } from "../../../Types/XcpNg/XcpNgXapiAccount";
import { XcpNgTelemetryUtil } from "../../../Types/XcpNg/XcpNgTelemetry";
import VMwareCertificateFingerprint from "../../../Utils/VMware/VMwareCertificateFingerprint";
import XcpNgCollectionSettings, {
  DEFAULT_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES,
  MAX_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES,
  MIN_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES,
} from "../../../Utils/XcpNg/XcpNgCollectionSettings";
import {
  SetAsideCounts,
  getClaimSetAsideParameters,
  getClaimSetAsideStatement,
  readSetAsideCounts,
  setAsideAfterClaim,
} from "../Probe/ClaimSetAside";

/*
 * The database half of reading XCP-ng connections from a probe: which
 * connections a probe reads now, and what it found - a vCenter's
 * (VMwareProbeCollectionStore), statement for statement.
 *
 * Claiming is one statement (FOR NO KEY UPDATE SKIP LOCKED) that moves each
 * claimed connection's nextCollectionAt an interval on, so two work
 * requests - the same probe's overlapping ticks, or two server replicas -
 * never hand one connection out twice. The connections a probe says it is
 * still reading are left out, so a read slower than its interval is
 * skipped, not stacked. The due connections nothing may read now are set
 * aside for a quarter of an hour (Utils/Probe/ClaimSetAside).
 *
 * Only a probe that may read a connection is ever handed one: the
 * connection names it, and it is the project's own probe - or, on a
 * self-hosted install, one of the instance's own. The save hooks hold every
 * write to this; the claim holds rows written before them to it as well.
 */

// What recordCollectionReport made of a report.
export interface XcpNgCollectionReportOutcome {
  accepted: boolean;
  // Why a report was not accepted, for the probe's log.
  reason?: string | undefined;
  projectId?: ObjectID | undefined;
  connectionName?: string | undefined;
  connectionType?: XcpNgConnectionType | undefined;
  /*
   * The report is for the connection's current settings, so its status is
   * the connection's status now. A report for older settings still delivers
   * its data, but leaves the status to the read of the new ones.
   */
  isCurrent?: boolean | undefined;
}

const MAX_SUMMARY_WARNINGS: number = 20;
const MAX_SUMMARY_POOLS: number = 500;
const MAX_POOL_HOSTS: number = 128;
const MAX_TEXT_LENGTH: number = 1000;
const MAX_WATERMARK_UUIDS: number = 500;
// A pool master the probe reported is kept only as the https:// URL it read.
const HTTPS_URL: RegExp = /^https:\/\//i;

function boundText(value: unknown, maxLength: number): string | null {
  return VMwareProbeCollectionStore.boundText(value, maxLength);
}

function count(value: unknown): number {
  const number: number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

export default class XcpNgProbeCollectionStore {
  public static async claimDueConnections(
    service: DatabaseService<XcpNgConnection>,
    data: {
      probeId: ObjectID;
      runningXcpNgConnectionIds: Array<string>;
      limit: number;
    },
  ): Promise<Array<XcpNgCollectionJob>> {
    if (data.limit <= 0) {
      return [];
    }

    const currentDate: Date = OneUptimeDate.getCurrentDate();

    const runningIds: Array<string> = data.runningXcpNgConnectionIds.filter(
      (id: string): boolean => {
        return ObjectID.isValidUUID(id);
      },
    );

    /*
     * One self-committing statement, the vCenters' own (see
     * VMwareProbeCollectionStore.claimDueVCenters for why): the due
     * connections are locked FOR NO KEY UPDATE SKIP LOCKED and moved an
     * interval on by the same statement, the longest overdue first, along
     * the (collectionProbeId, nextCollectionAt) index.
     */
    const claimedRows: unknown = await service.getRepository().manager.query(
      `
      WITH "due" AS (
        SELECT c."_id", c."nextCollectionAt" AS "dueAt"
        FROM "XcpNgConnection" c
        INNER JOIN "Project" p ON c."projectId" = p."_id"
        INNER JOIN "Probe" pr ON c."collectionProbeId" = pr."_id"
        WHERE c."collectionProbeId" = $1
          AND NOT (c."_id" = ANY($5::uuid[]))
          AND c."nextCollectionAt" <= $2
          AND ${XcpNgProbeCollectionStore.getCollectableSql({
            statusesParameter: "$4",
            isBillingEnabledParameter: "$6",
          })}
        ORDER BY c."nextCollectionAt" ASC
        LIMIT $3
        FOR NO KEY UPDATE OF c SKIP LOCKED
      ),
      "claimed" AS (
        UPDATE "XcpNgConnection" AS c
        SET "nextCollectionAt" = $2::timestamptz + (
            CASE
              WHEN c."collectionIntervalInMinutes" IS NULL
                OR c."collectionIntervalInMinutes" <= 0
                THEN $7::int
              ELSE LEAST(GREATEST(c."collectionIntervalInMinutes", $8::int), $9::int)
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
        runningIds,
        IsBillingEnabled,
        DEFAULT_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES,
        MIN_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES,
        MAX_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES,
      ],
    );

    const claimedIds: Array<string> = Array.isArray(claimedRows)
      ? claimedRows.map((row: { _id: string }): string => {
          return row._id;
        })
      : [];

    await setAsideAfterClaim({
      claim: "claimDueXcpNgConnections",
      probeId: data.probeId,
      rows: "XCP-ng connections nothing may read now",
      round: async (): Promise<SetAsideCounts> => {
        return await XcpNgProbeCollectionStore.setAsideUncollectable(service, {
          probeId: data.probeId,
          currentDate: currentDate,
        });
      },
    });

    if (claimedIds.length === 0) {
      return [];
    }

    // Read as OneUptime: the secrets are decrypted on read.
    const connections: Array<XcpNgConnection> = await service.findBy({
      query: {
        _id: QueryHelper.any(claimedIds),
      },
      select: {
        _id: true,
        name: true,
        connectionType: true,
        address: true,
        trustedCertificateFingerprint: true,
        collectionIntervalInMinutes: true,
        collectionSettingsVersion: true,
        openMetricsSecret: true,
        apiToken: true,
        username: true,
        password: true,
        xapiPoolId: true,
        xapiMasterAddress: true,
        xapiPoolHosts: true,
        messageWatermark: true,
      },
      limit: claimedIds.length,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const jobs: Array<XcpNgCollectionJob> = [];

    for (const connection of VMwareProbeCollectionStore.inClaimOrder(
      connections,
      claimedIds,
    )) {
      const job: XcpNgCollectionJob | null =
        XcpNgProbeCollectionStore.toJob(connection);

      if (job) {
        jobs.push(job);
      }
    }

    return jobs;
  }

  // A claimed connection as the job its probe is handed, or null when unusable.
  public static toJob(connection: XcpNgConnection): XcpNgCollectionJob | null {
    if (
      !connection._id ||
      !connection.address ||
      !XcpNgConnectionTypeUtil.isValid(connection.connectionType)
    ) {
      return null;
    }

    const job: XcpNgCollectionJob = {
      xcpNgConnectionId: connection._id.toString(),
      connectionName: connection.name || "",
      connectionType: connection.connectionType,
      address: connection.address,
      collectionIntervalInMinutes: XcpNgProbeCollectionStore.getSafeInterval(
        connection.collectionIntervalInMinutes,
      ),
      settingsVersion: connection.collectionSettingsVersion || 0,
    };

    const fingerprint: string | null = VMwareCertificateFingerprint.normalize(
      connection.trustedCertificateFingerprint,
    );

    if (fingerprint) {
      job.trustedCertificateFingerprint = fingerprint;
    }

    if (connection.connectionType === XcpNgConnectionType.XenOrchestra) {
      if (!connection.openMetricsSecret) {
        return null;
      }

      job.openMetricsSecret = connection.openMetricsSecret;

      if (connection.apiToken) {
        job.apiToken = connection.apiToken;
      }

      return job;
    }

    if (!connection.username || !connection.password) {
      return null;
    }

    job.username = connection.username;
    job.password = connection.password;

    if (connection.xapiPoolId) {
      job.xapiPoolId = connection.xapiPoolId;
    }

    if (connection.xapiMasterAddress) {
      job.xapiMasterAddress = connection.xapiMasterAddress;
    }

    const hosts: Array<XcpNgXapiPoolHost> =
      XcpNgProbeCollectionStore.sanitizePoolHosts(connection.xapiPoolHosts);

    if (hosts.length > 0) {
      job.xapiPoolHosts = hosts;
    }

    const watermark: XcpNgMessageWatermark | null =
      XcpNgProbeCollectionStore.sanitizeWatermark(connection.messageWatermark);

    if (watermark) {
      job.messageWatermark = watermark;
    }

    return job;
  }

  /*
   * Sets aside the probe's due connections nothing may read now
   * (Utils/Probe/ClaimSetAside), judged again by the claim's own rule.
   */
  public static async setAsideUncollectable(
    service: DatabaseService<XcpNgConnection>,
    data: {
      probeId: ObjectID;
      currentDate: Date;
    },
  ): Promise<SetAsideCounts> {
    const rows: unknown = await service.getRepository().manager.query(
      getClaimSetAsideStatement({
        table: "XcpNgConnection",
        alias: "c",
        dueColumn: "nextCollectionAt",
        sources: [
          {
            from: `"XcpNgConnection" c`,
            where: `c."collectionProbeId" = $1`,
          },
        ],
        joins: `LEFT JOIN "Project" p ON c."projectId" = p."_id"
        LEFT JOIN "Probe" pr ON c."collectionProbeId" = pr."_id"`,
        isProbesRow: `c."collectionProbeId" = $1`,
        claimable: XcpNgProbeCollectionStore.getCollectableSql({
          statusesParameter: "$6",
          isBillingEnabledParameter: "$7",
        }),
      }),
      getClaimSetAsideParameters({
        probeId: data.probeId,
        currentDate: data.currentDate,
        ruleParameters: [
          SubscriptionStatusUtil.getActiveSubscriptionStatuses(),
          IsBillingEnabled,
        ],
      }),
    );

    return readSetAsideCounts(rows);
  }

  /*
   * Whether a connection may be handed to its probe to read now, as SQL
   * over the aliases the claim's statements use - `c` (the
   * XcpNgConnection), `p` (its Project) and `pr` (its collection Probe):
   *
   * - not deleted, with an address and the secrets its kind needs: a Xen
   *   Orchestra's OpenMetrics secret, or an XAPI user name and password;
   * - the tenancy backstop: the project's own probe, or a global probe on an
   *   instance where those are the operator's own (billing off);
   * - the project is served: not deleted, not blocked, its subscriptions
   *   not inactive.
   */
  public static getCollectableSql(parameters: {
    statusesParameter: string;
    isBillingEnabledParameter: string;
  }): string {
    return [
      `c."deletedAt" IS NULL`,
      `c."address" IS NOT NULL`,
      `((c."connectionType" = '${XcpNgConnectionType.XenOrchestra}' AND c."isOpenMetricsSecretSet" = true) OR (c."connectionType" = '${XcpNgConnectionType.Xapi}' AND c."isPasswordSet" = true AND c."username" IS NOT NULL))`,
      `((pr."isGlobalProbe" = false AND pr."projectId" = c."projectId") OR (pr."isGlobalProbe" = true AND ${parameters.isBillingEnabledParameter}::boolean = false))`,
      `pr."deletedAt" IS NULL`,
      `p."deletedAt" IS NULL`,
      `p."isBlocked" = false`,
      `(p."paymentProviderSubscriptionStatus" IS NULL OR p."paymentProviderSubscriptionStatus" = ANY(${parameters.statusesParameter}::text[]))`,
      `(p."paymentProviderMeteredSubscriptionStatus" IS NULL OR p."paymentProviderMeteredSubscriptionStatus" = ANY(${parameters.statusesParameter}::text[]))`,
    ].join("\n          AND ");
  }

  /*
   * Record what a probe found for a connection it read: the status, and -
   * for a report of the current settings - the error, the certificate it
   * did not trust, the summary, and what it learned for the next read (the
   * token's expiry; for XAPI the pool, its master, its hosts and where
   * reading its messages stands). Only the connection's own probe is heard.
   */
  public static async recordCollectionReport(
    service: DatabaseService<XcpNgConnection>,
    data: {
      probeId: ObjectID;
      report: XcpNgCollectionReport;
    },
  ): Promise<XcpNgCollectionReportOutcome> {
    const report: XcpNgCollectionReport = data.report;

    if (
      !report.xcpNgConnectionId ||
      !ObjectID.isValidUUID(report.xcpNgConnectionId)
    ) {
      return {
        accepted: false,
        reason: "The report names no XCP-ng connection.",
      };
    }

    const connection: XcpNgConnection | null = await service.findOneById({
      id: new ObjectID(report.xcpNgConnectionId),
      select: {
        _id: true,
        projectId: true,
        name: true,
        connectionType: true,
        collectionProbeId: true,
        collectionSettingsVersion: true,
        apiTokenExpiresAt: true,
        isApiTokenSet: true,
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
      !connection ||
      !connection.projectId ||
      !connection.collectionProbeId ||
      connection.collectionProbeId.toString().toLowerCase() !==
        data.probeId.toString().toLowerCase()
    ) {
      return {
        accepted: false,
        reason:
          "This probe does not read that XCP-ng connection (any more): it was removed, or moved to another probe.",
      };
    }

    const refusal: string | null = XcpNgCollectionSettings.getProbeRefusal({
      probe: {
        isGlobalProbe: connection.collectionProbe?.isGlobalProbe,
        projectId: connection.collectionProbe?.projectId?.toString() || null,
      },
      projectId: connection.projectId.toString(),
      isBillingEnabled: IsBillingEnabled,
    });

    if (refusal) {
      return { accepted: false, reason: refusal };
    }

    const isCurrent: boolean =
      Number(report.settingsVersion) ===
      Number(connection.collectionSettingsVersion || 0);

    const now: Date = OneUptimeDate.getCurrentDate();
    const isSuccess: boolean =
      report.status === XcpNgCollectionStatus.Succeeded;

    const values: Record<string, unknown> = {
      lastCollectionAt: now,
    };

    if (isCurrent) {
      values["collectionStatus"] = isSuccess
        ? XcpNgCollectionStatus.Succeeded
        : XcpNgCollectionStatus.Failed;

      if (isSuccess) {
        values["collectionErrorCode"] = null;
        values["collectionError"] = null;
        values["presentedCertificate"] = null;
        values["lastSuccessfulCollectionAt"] = now;

        const summary: XcpNgCollectionSummary | null =
          XcpNgProbeCollectionStore.sanitizeSummary(report.summary, {
            storedApiTokenExpiresAt: connection.apiTokenExpiresAt,
            now: now,
          });

        if (summary) {
          values["collectionSummary"] = summary;
          XcpNgProbeCollectionStore.recordLearned({
            values: values,
            summary: summary,
            report: report,
            connection: connection,
          });
        }
      } else {
        const errorCode: XcpNgCollectionErrorCode =
          XcpNgCollectionErrorUtil.isValid(report.errorCode)
            ? report.errorCode
            : XcpNgCollectionErrorCode.Internal;

        values["collectionErrorCode"] = errorCode;
        values["collectionError"] = XcpNgProbeCollectionStore.getErrorText({
          errorCode: errorCode,
          errorMessage: report.errorMessage,
        });

        values["presentedCertificate"] =
          XcpNgCollectionErrorUtil.isCertificateTrustProblem(errorCode)
            ? XcpNgProbeCollectionStore.sanitizePresentedCertificate(
                report.presentedCertificate,
              )
            : null;
      }
    }

    try {
      await service.updateColumnsByIdWithoutHooks({
        id: connection.id!,
        data: values as never,
      });
    } catch (error) {
      logger.error(
        `Could not record the read of XCP-ng connection ${report.xcpNgConnectionId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }

    return {
      accepted: true,
      projectId: connection.projectId,
      connectionName: connection.name || undefined,
      connectionType: connection.connectionType,
      isCurrent: isCurrent,
    };
  }

  /*
   * What a successful read taught the next one, kept on the connection: the
   * API token's expiry; for XAPI the account, the pool, the master reached,
   * the pool's hosts with their certificates, and the message watermark.
   */
  private static recordLearned(data: {
    values: Record<string, unknown>;
    summary: XcpNgCollectionSummary;
    report: XcpNgCollectionReport;
    connection: XcpNgConnection;
  }): void {
    const { values, summary, report, connection } = data;

    if (connection.isApiTokenSet && summary.apiToken?.expiresAt) {
      const expiresAt: Date = new Date(summary.apiToken.expiresAt);

      if (!Number.isNaN(expiresAt.getTime())) {
        values["apiTokenExpiresAt"] = expiresAt;

        /*
         * A token renewed in Xen Orchestra (same client, a later expiry)
         * may be warned about again.
         */
        const stored: number = connection.apiTokenExpiresAt
          ? new Date(connection.apiTokenExpiresAt).getTime()
          : Number.NaN;

        if (Number.isFinite(stored) && expiresAt.getTime() > stored) {
          values["apiTokenExpiryWarnedAt"] = null;
        }
      }
    }

    if (connection.connectionType !== XcpNgConnectionType.Xapi) {
      return;
    }

    if (summary.account) {
      values["xapiAccountKind"] = summary.account.kind;
    }

    const poolId: string = XcpNgTelemetryUtil.normalizePoolIdentifier(
      report.xapiPoolId,
    );

    if (poolId) {
      values["xapiPoolId"] = poolId;
    }

    const master: string | null = boundText(
      report.xapiMasterAddress,
      ColumnLength.LongText,
    );

    if (master && HTTPS_URL.test(master)) {
      values["xapiMasterAddress"] = master;
    }

    const hosts: Array<XcpNgXapiPoolHost> =
      XcpNgProbeCollectionStore.sanitizePoolHosts(report.xapiPoolHosts);

    if (hosts.length > 0) {
      values["xapiPoolHosts"] = hosts;
    }

    const watermark: XcpNgMessageWatermark | null =
      XcpNgProbeCollectionStore.sanitizeWatermark(report.messageWatermark);

    if (watermark) {
      values["messageWatermark"] = watermark;
    }
  }

  /*
   * The sentence stored for a failure: the probe's own, bounded - or, when
   * it sent none (or only blanks), the code's title.
   */
  public static getErrorText(data: {
    errorCode: XcpNgCollectionErrorCode;
    errorMessage: unknown;
  }): string | null {
    return (
      boundText(data.errorMessage, ColumnLength.LongText) ||
      boundText(
        XcpNgCollectionErrorUtil.getAdvice(data.errorCode).title,
        ColumnLength.LongText,
      )
    );
  }

  public static getSafeInterval(value: number | null | undefined): number {
    const interval: number = Number(value);

    if (!Number.isFinite(interval) || interval <= 0) {
      return DEFAULT_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES;
    }

    return Math.min(
      Math.max(Math.round(interval), MIN_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES),
      MAX_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES,
    );
  }

  /*
   * A presented certificate as the probe reported it, held to the shape the
   * dashboard reads: the vCenter's rule, the same shape.
   */
  public static sanitizePresentedCertificate(
    value: unknown,
  ): XcpNgPresentedCertificate | null {
    return VMwareProbeCollectionStore.sanitizePresentedCertificate(value);
  }

  // The pool's hosts as a probe reported them: bounded, each fingerprint canonical.
  public static sanitizePoolHosts(value: unknown): Array<XcpNgXapiPoolHost> {
    if (!Array.isArray(value)) {
      return [];
    }

    const hosts: Array<XcpNgXapiPoolHost> = [];

    for (const entry of value.slice(0, MAX_POOL_HOSTS)) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const raw: Record<string, unknown> = entry as Record<string, unknown>;
      const uuid: string = XcpNgTelemetryUtil.normalizePoolIdentifier(
        typeof raw["uuid"] === "string" ? (raw["uuid"] as string) : "",
      );
      const address: string | null = boundText(raw["address"], 255);

      if (!uuid || !address) {
        continue;
      }

      hosts.push({
        uuid: uuid,
        name: boundText(raw["name"], ColumnLength.ShortText) || "",
        address: address,
        certificateFingerprint:
          VMwareCertificateFingerprint.normalize(
            typeof raw["certificateFingerprint"] === "string"
              ? (raw["certificateFingerprint"] as string)
              : null,
          ) || "",
        isMaster: raw["isMaster"] === true,
      });
    }

    return hosts;
  }

  public static sanitizeWatermark(
    value: unknown,
  ): XcpNgMessageWatermark | null {
    if (!value || typeof value !== "object") {
      return null;
    }

    const raw: Record<string, unknown> = value as Record<string, unknown>;
    const readUntil: Date = new Date(
      typeof raw["readUntil"] === "string" ? (raw["readUntil"] as string) : "",
    );

    if (Number.isNaN(readUntil.getTime())) {
      return null;
    }

    return {
      readUntil: readUntil.toISOString(),
      uuidsAtReadUntil: (Array.isArray(raw["uuidsAtReadUntil"])
        ? (raw["uuidsAtReadUntil"] as Array<unknown>)
        : []
      )
        .filter((uuid: unknown): uuid is string => {
          return (
            typeof uuid === "string" && uuid.length > 0 && uuid.length <= 64
          );
        })
        .slice(0, MAX_WATERMARK_UUIDS),
    };
  }

  /*
   * A summary as the probe reported it: whole counts, bounded strings, and
   * a token the stored expiry says has expired named as expired.
   */
  public static sanitizeSummary(
    value: unknown,
    context?: {
      storedApiTokenExpiresAt?: Date | null | undefined;
      now: Date;
    },
  ): XcpNgCollectionSummary | null {
    if (!value || typeof value !== "object") {
      return null;
    }

    const raw: Record<string, unknown> = value as Record<string, unknown>;
    const connectionType: XcpNgConnectionType = XcpNgConnectionTypeUtil.isValid(
      raw["connectionType"],
    )
      ? raw["connectionType"]
      : XcpNgConnectionType.XenOrchestra;

    const summary: XcpNgCollectionSummary = {
      connectionType: connectionType,
      pools: (Array.isArray(raw["pools"])
        ? (raw["pools"] as Array<unknown>)
        : []
      )
        .slice(0, MAX_SUMMARY_POOLS)
        .map((entry: unknown): XcpNgPoolSummary | null => {
          if (!entry || typeof entry !== "object") {
            return null;
          }

          const pool: Record<string, unknown> = entry as Record<
            string,
            unknown
          >;
          const poolId: string = XcpNgTelemetryUtil.normalizePoolIdentifier(
            typeof pool["poolId"] === "string"
              ? (pool["poolId"] as string)
              : "",
          );

          if (!poolId) {
            return null;
          }

          const summarized: XcpNgPoolSummary = {
            poolId: poolId,
            hostCount: count(pool["hostCount"]),
            runningHostCount: count(pool["runningHostCount"]),
            vmCount: count(pool["vmCount"]),
            runningVmCount: count(pool["runningVmCount"]),
            storageRepositoryCount: count(pool["storageRepositoryCount"]),
          };

          const poolName: string | null = boundText(
            pool["poolName"],
            ColumnLength.ShortText,
          );

          if (poolName) {
            summarized.poolName = poolName;
          }

          return summarized;
        })
        .filter((pool: XcpNgPoolSummary | null): pool is XcpNgPoolSummary => {
          return pool !== null;
        }),
      warnings: (Array.isArray(raw["warnings"]) ? raw["warnings"] : [])
        .map((warning: unknown): string | null => {
          return boundText(warning, MAX_TEXT_LENGTH);
        })
        .filter((warning: string | null): warning is string => {
          return warning !== null;
        })
        .slice(0, MAX_SUMMARY_WARNINGS),
    };

    const token: XcpNgApiTokenSummary | null =
      XcpNgProbeCollectionStore.sanitizeApiToken(raw["apiToken"], context);

    if (token) {
      summary.apiToken = token;
    }

    for (const key of [
      "masterAddress",
      "masterHostName",
      "productName",
      "productVersion",
      "xapiVersion",
    ] as const) {
      const text: string | null = boundText(
        raw[key],
        ColumnLength.ShortText * 2,
      );

      if (text) {
        summary[key] = text;
      }
    }

    const account: XcpNgXapiAccountSummary | null =
      XcpNgProbeCollectionStore.sanitizeAccount(raw["account"]);

    if (account) {
      summary.account = account;
    }

    if (raw["resourceCount"] !== undefined) {
      summary.resourceCount = count(raw["resourceCount"]);
    }

    if (raw["datapointCount"] !== undefined) {
      summary.datapointCount = count(raw["datapointCount"]);
    }

    return summary;
  }

  public static sanitizeApiToken(
    value: unknown,
    context?: {
      storedApiTokenExpiresAt?: Date | null | undefined;
      now: Date;
    },
  ): XcpNgApiTokenSummary | null {
    if (!value || typeof value !== "object") {
      return null;
    }

    const raw: Record<string, unknown> = value as Record<string, unknown>;
    const token: XcpNgApiTokenSummary = {};

    const expiresAt: Date = new Date(
      typeof raw["expiresAt"] === "string" ? (raw["expiresAt"] as string) : "",
    );

    if (!Number.isNaN(expiresAt.getTime())) {
      token.expiresAt = expiresAt.toISOString();
    }

    const userName: string | null = boundText(
      raw["userName"],
      ColumnLength.ShortText * 2,
    );

    if (userName) {
      token.userName = userName;
    }

    for (const key of [
      "isReadOnly",
      "canReadAlarms",
      "canReadMessages",
      "canReadBackupLogs",
    ] as const) {
      if (typeof raw[key] === "boolean") {
        token[key] = raw[key] as boolean;
      }
    }

    if (XcpNgCollectionErrorUtil.isValid(raw["errorCode"])) {
      token.errorCode = raw["errorCode"];

      const message: string | null = boundText(
        raw["errorMessage"],
        MAX_TEXT_LENGTH,
      );

      if (message) {
        token.errorMessage = message;
      }

      /*
       * Xen Orchestra forgets an expired token, so a wrong token and an
       * expired one are refused alike: the expiry OneUptime last read says
       * which it is.
       */
      if (
        token.errorCode === XcpNgCollectionErrorCode.TokenRejected &&
        context &&
        XcpNgCollectionSettings.isApiTokenExpired({
          expiresAt: context.storedApiTokenExpiresAt,
          now: context.now,
        })
      ) {
        token.errorCode = XcpNgCollectionErrorCode.TokenExpired;
        token.errorMessage =
          "The API token expired. Create a new one for the read-only user in Xen Orchestra and save it here. Metrics keep coming; alarms and backups need the token.";
      }
    }

    return token;
  }

  public static sanitizeAccount(
    value: unknown,
  ): XcpNgXapiAccountSummary | null {
    if (!value || typeof value !== "object") {
      return null;
    }

    const raw: Record<string, unknown> = value as Record<string, unknown>;

    if (!XcpNgXapiAccountKindUtil.isValid(raw["kind"])) {
      return null;
    }

    return {
      kind: raw["kind"],
      name: boundText(raw["name"], ColumnLength.ShortText * 2) || "",
      roles: (Array.isArray(raw["roles"]) ? raw["roles"] : [])
        .map((role: unknown): string | null => {
          return boundText(role, ColumnLength.ShortText);
        })
        .filter((role: string | null): role is string => {
          return role !== null;
        })
        .slice(0, 20),
    };
  }
}
