import { IsBillingEnabled } from "../../EnvironmentConfig";
import DatabaseService from "../../Services/DatabaseService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import VMwareProbeCollectionStore from "../VMware/VMwareProbeCollectionStore";
import {
  SetAsideCounts,
  getClaimSetAsideParameters,
  getClaimSetAsideStatement,
  readSetAsideCounts,
  setAsideAfterClaim,
} from "../Probe/ClaimSetAside";
import StorageArrayConnection from "../../../Models/DatabaseModels/StorageArrayConnection";
import { SubscriptionStatusUtil } from "../../../Types/Billing/SubscriptionStatus";
import ColumnLength from "../../../Types/Database/ColumnLength";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import StorageArrayCollectionErrorCode, {
  StorageArrayCollectionErrorCodeUtil,
} from "../../../Types/StorageArray/Collection/StorageArrayCollectionErrorCode";
import StorageArrayCollectionStatus from "../../../Types/StorageArray/Collection/StorageArrayCollectionStatus";
import {
  StorageArrayCollectionArraySummary,
  StorageArrayCollectionJob,
  StorageArrayCollectionReport,
  StorageArrayCollectionSummary,
  StorageArrayPresentedCertificate,
} from "../../../Types/StorageArray/Collection/StorageArrayProbeCollection";
import { StorageArrayProbeCollector } from "../../../Types/StorageArray/Collection/StorageArrayProbeCollector";
import StorageArrayProbeCollectors from "../../../Types/StorageArray/Collection/StorageArrayProbeCollectors";
import VMwareCertificateFingerprint from "../../../Utils/VMware/VMwareCertificateFingerprint";
import StorageArrayConnectionSettings from "../../../Utils/StorageArray/StorageArrayConnectionSettings";

/*
 * The database half of storage array probe collection (#11004): which
 * connections a probe collects now, and what it found - VMware's
 * agentless collection store (VMwareProbeCollectionStore), for a
 * StorageArrayConnection.
 *
 * Claiming is one statement (FOR NO KEY UPDATE SKIP LOCKED) that moves each
 * claimed connection's nextCollectionAt an interval on, so two work
 * requests - the same probe's overlapping ticks, or two server replicas -
 * never hand one connection out twice. The connections a probe says it is
 * still collecting are left out, so a collection slower than its interval
 * is skipped, not stacked. The due connections the claim stepped over
 * because nothing may collect them are set aside for a quarter of an hour
 * (Utils/Probe/ClaimSetAside).
 *
 * Only a probe that may collect a connection is ever handed one: the
 * connection names it, and it is the project's own probe - or, on a
 * self-hosted install, one of the instance's own
 * (StorageArrayConnectionSettings.getProbeRefusal).
 */

// What recordCollectionReport made of a report.
export interface StorageArrayCollectionReportOutcome {
  accepted: boolean;
  // Why a report was not accepted, for the probe's log.
  reason?: string | undefined;
  projectId?: ObjectID | undefined;
  storageSystem?: string | undefined;
  /*
   * The report is for the connection's current settings, so its status is
   * the connection's status now. A report for older settings still
   * delivers its data, but leaves the status to the collection of the new
   * ones.
   */
  isCurrent?: boolean | undefined;
}

const MAX_SUMMARY_WARNINGS: number = 50;
const MAX_SUMMARY_ARRAYS: number = 200;
const MAX_REALTIME_OBJECTS: number = 100;
const MAX_TEXT_LENGTH: number = 1000;

export default class StorageArrayProbeCollectionStore {
  public static async claimDueConnections(
    service: DatabaseService<StorageArrayConnection>,
    data: {
      probeId: ObjectID;
      runningStorageArrayConnectionIds: Array<string>;
      limit: number;
    },
  ): Promise<Array<StorageArrayCollectionJob>> {
    if (data.limit <= 0) {
      return [];
    }

    const currentDate: Date = OneUptimeDate.getCurrentDate();

    const runningIds: Array<string> =
      data.runningStorageArrayConnectionIds.filter((id: string): boolean => {
        return ObjectID.isValidUUID(id);
      });

    /*
     * One self-committing statement, as VMware's claimDueVCenters: the due
     * connections are locked FOR NO KEY UPDATE SKIP LOCKED and their next
     * collection moved an interval on in the same statement, so the locks
     * last only as long as it runs. `nextCollectionAt <= now`, oldest
     * first, is a range of the (collectionProbeId, nextCollectionAt)
     * index. The interval is held to 1..60 minutes in SQL; the save hook
     * holds it to the platform's own bounds.
     */
    const claimedRows: unknown = await service.getRepository().manager.query(
      `
      WITH "due" AS (
        SELECT sac."_id", sac."nextCollectionAt" AS "dueAt"
        FROM "StorageArrayConnection" sac
        INNER JOIN "Project" p ON sac."projectId" = p."_id"
        INNER JOIN "Probe" pr ON sac."collectionProbeId" = pr."_id"
        WHERE sac."collectionProbeId" = $1
          AND NOT (sac."_id" = ANY($5::uuid[]))
          AND sac."nextCollectionAt" <= $2
          AND ${StorageArrayProbeCollectionStore.getCollectableSql({
            statusesParameter: "$4",
            isBillingEnabledParameter: "$6",
            storageSystemsParameter: "$7",
          })}
        ORDER BY sac."nextCollectionAt" ASC
        LIMIT $3
        FOR NO KEY UPDATE OF sac SKIP LOCKED
      ),
      "claimed" AS (
        UPDATE "StorageArrayConnection" AS sac
        SET "nextCollectionAt" = $2::timestamptz + (
            CASE
              WHEN sac."collectionIntervalInMinutes" IS NULL
                OR sac."collectionIntervalInMinutes" <= 0
                THEN 5
              ELSE LEAST(GREATEST(sac."collectionIntervalInMinutes", 1), 60)
            END
          ) * INTERVAL '1 minute'
        FROM "due"
        WHERE sac."_id" = "due"."_id"
        RETURNING sac."_id"
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
        StorageArrayProbeCollectors.getStorageSystems(),
      ],
    );

    const claimedIds: Array<string> = Array.isArray(claimedRows)
      ? claimedRows.map((row: { _id: string }): string => {
          return row._id;
        })
      : [];

    await setAsideAfterClaim({
      claim: "claimDueStorageArrayConnections",
      probeId: data.probeId,
      rows: "storage array connections nothing may collect now",
      round: async (): Promise<SetAsideCounts> => {
        return await StorageArrayProbeCollectionStore.setAsideUncollectable(
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

    // Read as OneUptime: the password is decrypted on read.
    const connections: Array<StorageArrayConnection> = await service.findBy({
      query: {
        _id: QueryHelper.any(claimedIds),
      },
      select: {
        _id: true,
        name: true,
        storageSystem: true,
        address: true,
        username: true,
        password: true,
        trustedCertificateFingerprint: true,
        collectionIntervalInMinutes: true,
        collectionSettingsVersion: true,
      },
      limit: claimedIds.length,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const jobs: Array<StorageArrayCollectionJob> = [];

    for (const connection of VMwareProbeCollectionStore.inClaimOrder(
      connections,
      claimedIds,
    )) {
      const collector: StorageArrayProbeCollector | null =
        StorageArrayProbeCollectors.getCollector(connection.storageSystem);

      if (
        !connection._id ||
        !collector ||
        !connection.address ||
        !connection.username ||
        !connection.password
      ) {
        continue;
      }

      const job: StorageArrayCollectionJob = {
        storageArrayConnectionId: connection._id.toString(),
        connectionName: connection.name || "",
        storageSystem: collector.storageSystem,
        address: connection.address,
        username: connection.username,
        password: connection.password,
        collectionIntervalInMinutes:
          StorageArrayConnectionSettings.getSafeInterval(
            connection.collectionIntervalInMinutes,
            collector,
          ),
        settingsVersion: connection.collectionSettingsVersion || 0,
      };

      const fingerprint: string | null = VMwareCertificateFingerprint.normalize(
        connection.trustedCertificateFingerprint,
      );

      if (fingerprint) {
        job.trustedCertificateFingerprint = fingerprint;
      }

      jobs.push(job);
    }

    return jobs;
  }

  /*
   * Sets aside the probe's due connections nothing may collect now
   * (Utils/Probe/ClaimSetAside): without a password, an address or a user
   * name, of a platform no probe collects, on a probe that may not collect
   * it, or of a suspended, blocked or deleted project - each judged by the
   * claim's own rule. Makes due the probe's connections with no
   * nextCollectionAt at all.
   */
  public static async setAsideUncollectable(
    service: DatabaseService<StorageArrayConnection>,
    data: {
      probeId: ObjectID;
      currentDate: Date;
    },
  ): Promise<SetAsideCounts> {
    const rows: unknown = await service.getRepository().manager.query(
      getClaimSetAsideStatement({
        table: "StorageArrayConnection",
        alias: "sac",
        dueColumn: "nextCollectionAt",
        sources: [
          {
            from: `"StorageArrayConnection" sac`,
            where: `sac."collectionProbeId" = $1`,
          },
        ],
        joins: `LEFT JOIN "Project" p ON sac."projectId" = p."_id"
        LEFT JOIN "Probe" pr ON sac."collectionProbeId" = pr."_id"`,
        isProbesRow: `sac."collectionProbeId" = $1`,
        claimable: StorageArrayProbeCollectionStore.getCollectableSql({
          statusesParameter: "$6",
          isBillingEnabledParameter: "$7",
          storageSystemsParameter: "$8",
        }),
      }),
      getClaimSetAsideParameters({
        probeId: data.probeId,
        currentDate: data.currentDate,
        ruleParameters: [
          SubscriptionStatusUtil.getActiveSubscriptionStatuses(),
          IsBillingEnabled,
          StorageArrayProbeCollectors.getStorageSystems(),
        ],
      }),
    );

    return readSetAsideCounts(rows);
  }

  /*
   * Whether a connection may be handed to its probe to collect now, as SQL
   * over the aliases the claim's statements use - `sac` (the connection),
   * `p` (its Project) and `pr` (its collection Probe). One definition, so a
   * connection the claim would hand out is never one the set-aside moves.
   *
   * - Not deleted, with the password, address and user name a collection
   *   needs, of a platform a probe collects.
   * - The tenancy backstop: the project's own probe, or a global probe on
   *   an instance where those are the operator's own (billing off).
   * - The project is served: not deleted, not blocked, and its
   *   subscriptions not inactive.
   */
  public static getCollectableSql(parameters: {
    statusesParameter: string;
    isBillingEnabledParameter: string;
    storageSystemsParameter: string;
  }): string {
    return [
      `sac."deletedAt" IS NULL`,
      `sac."isPasswordSet" = true`,
      `sac."address" IS NOT NULL`,
      `sac."username" IS NOT NULL`,
      `sac."storageSystem" = ANY(${parameters.storageSystemsParameter}::text[])`,
      `((pr."isGlobalProbe" = false AND pr."projectId" = sac."projectId") OR (pr."isGlobalProbe" = true AND ${parameters.isBillingEnabledParameter}::boolean = false))`,
      `pr."deletedAt" IS NULL`,
      `p."deletedAt" IS NULL`,
      `p."isBlocked" = false`,
      `(p."paymentProviderSubscriptionStatus" IS NULL OR p."paymentProviderSubscriptionStatus" = ANY(${parameters.statusesParameter}::text[]))`,
      `(p."paymentProviderMeteredSubscriptionStatus" IS NULL OR p."paymentProviderMeteredSubscriptionStatus" = ANY(${parameters.statusesParameter}::text[]))`,
    ].join("\n          AND ");
  }

  /*
   * Record what a probe found for a connection it collected: the status,
   * and - for a report of the current settings - the error, the
   * certificate it did not trust, and the summary. Only the connection's
   * own probe is heard.
   */
  public static async recordCollectionReport(
    service: DatabaseService<StorageArrayConnection>,
    data: {
      probeId: ObjectID;
      report: StorageArrayCollectionReport;
    },
  ): Promise<StorageArrayCollectionReportOutcome> {
    const report: StorageArrayCollectionReport = data.report;

    if (
      !report.storageArrayConnectionId ||
      typeof report.storageArrayConnectionId !== "string" ||
      !ObjectID.isValidUUID(report.storageArrayConnectionId)
    ) {
      return { accepted: false, reason: "The report names no connection." };
    }

    const connection: StorageArrayConnection | null = await service.findOneById(
      {
        id: new ObjectID(report.storageArrayConnectionId),
        select: {
          _id: true,
          projectId: true,
          storageSystem: true,
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
      },
    );

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
          "This probe does not collect that connection (any more): it was deleted, or moved to another probe.",
      };
    }

    const refusal: string | null =
      StorageArrayConnectionSettings.getProbeRefusal({
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
      report.status === StorageArrayCollectionStatus.Succeeded;

    const values: Record<string, unknown> = {
      lastCollectionAt: now,
    };

    if (isCurrent) {
      values["collectionStatus"] = isSuccess
        ? StorageArrayCollectionStatus.Succeeded
        : StorageArrayCollectionStatus.Failed;

      if (isSuccess) {
        values["collectionErrorCode"] = null;
        values["collectionError"] = null;
        values["presentedCertificate"] = null;
        values["lastSuccessfulCollectionAt"] = now;

        const summary: StorageArrayCollectionSummary | null =
          StorageArrayProbeCollectionStore.sanitizeSummary(report.summary);

        if (summary) {
          values["collectionSummary"] = summary;
        }
      } else {
        const errorCode: StorageArrayCollectionErrorCode =
          StorageArrayCollectionErrorCodeUtil.isValid(report.errorCode)
            ? report.errorCode
            : StorageArrayCollectionErrorCode.Internal;

        values["collectionErrorCode"] = errorCode;
        values["collectionError"] =
          VMwareProbeCollectionStore.boundText(
            report.errorMessage,
            ColumnLength.LongText,
          ) || null;
        values["presentedCertificate"] =
          StorageArrayCollectionErrorCodeUtil.isCertificateProblem(errorCode)
            ? StorageArrayProbeCollectionStore.sanitizePresentedCertificate(
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
        `Could not record the collection of storage array connection ${report.storageArrayConnectionId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }

    return {
      accepted: true,
      projectId: connection.projectId,
      storageSystem: connection.storageSystem || undefined,
      isCurrent: isCurrent,
    };
  }

  public static sanitizePresentedCertificate(
    value: unknown,
  ): StorageArrayPresentedCertificate | null {
    return VMwareProbeCollectionStore.sanitizePresentedCertificate(value);
  }

  // A summary as the probe reported it: whole counts, bounded strings.
  public static sanitizeSummary(
    value: unknown,
  ): StorageArrayCollectionSummary | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const raw: Record<string, unknown> = value as Record<string, unknown>;

    const summary: StorageArrayCollectionSummary = {
      arrays: (Array.isArray(raw["arrays"]) ? raw["arrays"] : [])
        .map(
          (entry: unknown): StorageArrayCollectionArraySummary | null => {
            return StorageArrayProbeCollectionStore.sanitizeArraySummary(entry);
          },
        )
        .filter(
          (
            entry: StorageArrayCollectionArraySummary | null,
          ): entry is StorageArrayCollectionArraySummary => {
            return entry !== null;
          },
        )
        .slice(0, MAX_SUMMARY_ARRAYS),
      warnings: StorageArrayProbeCollectionStore.sanitizeWords(
        raw["warnings"],
      ),
    };

    for (const key of [
      "serverProductName",
      "serverVersion",
      "apiVersion",
    ] as const) {
      const text: string | null = VMwareProbeCollectionStore.boundText(
        raw[key],
        ColumnLength.ShortText * 2,
      );
      if (text) {
        summary[key] = text;
      }
    }

    for (const key of ["resourceCount", "datapointCount"] as const) {
      if (raw[key] !== undefined) {
        summary[key] = StorageArrayProbeCollectionStore.wholeCount(raw[key]);
      }
    }

    return summary;
  }

  public static sanitizeArraySummary(
    value: unknown,
  ): StorageArrayCollectionArraySummary | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const raw: Record<string, unknown> = value as Record<string, unknown>;
    const id: string | null = VMwareProbeCollectionStore.boundText(
      raw["id"],
      ColumnLength.ShortText,
    );
    if (!id) {
      return null;
    }

    const counts: Record<string, number> = {};
    const rawCounts: unknown = raw["counts"];
    if (rawCounts && typeof rawCounts === "object" && !Array.isArray(rawCounts)) {
      for (const [kind, count] of Object.entries(
        rawCounts as Record<string, unknown>,
      )) {
        // A kind is letters and digits starting with a letter (#11000).
        if (/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(kind)) {
          counts[kind] = StorageArrayProbeCollectionStore.wholeCount(count);
        }
      }
    }

    const summary: StorageArrayCollectionArraySummary = {
      id: id,
      isLocal: raw["isLocal"] === true,
      isCollected: raw["isCollected"] === true,
      counts: counts,
      warnings: StorageArrayProbeCollectionStore.sanitizeWords(raw["warnings"]),
    };

    for (const key of ["model", "osVersion"] as const) {
      const text: string | null = VMwareProbeCollectionStore.boundText(
        raw[key],
        ColumnLength.ShortText,
      );
      if (text) {
        summary[key] = text;
      }
    }

    for (const key of [
      "isPerformanceCollected",
      "isRealtimeCollected",
    ] as const) {
      const flag: unknown = raw[key];
      if (flag === true || flag === false || flag === null) {
        summary[key] = flag;
      }
    }

    if (Array.isArray(raw["realtimeObjects"])) {
      summary.realtimeObjects = raw["realtimeObjects"]
        .map((name: unknown): string | null => {
          return VMwareProbeCollectionStore.boundText(
            name,
            ColumnLength.ShortText,
          );
        })
        .filter((name: string | null): name is string => {
          return name !== null;
        })
        .slice(0, MAX_REALTIME_OBJECTS);
    }

    return summary;
  }

  private static sanitizeWords(value: unknown): Array<string> {
    return (Array.isArray(value) ? value : [])
      .map((warning: unknown): string | null => {
        return VMwareProbeCollectionStore.boundText(warning, MAX_TEXT_LENGTH);
      })
      .filter((warning: string | null): warning is string => {
        return warning !== null;
      })
      .slice(0, MAX_SUMMARY_WARNINGS);
  }

  private static wholeCount(value: unknown): number {
    const number: number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
  }

  public static getCollector(
    storageSystem: string | null | undefined,
  ): StorageArrayProbeCollector | null {
    return StorageArrayProbeCollectors.getCollector(storageSystem);
  }
}
