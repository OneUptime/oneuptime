import { IsBillingEnabled } from "../../EnvironmentConfig";
import DatabaseService from "../../Services/DatabaseService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import { SubscriptionStatusUtil } from "../../../Types/Billing/SubscriptionStatus";
import ColumnLength from "../../../Types/Database/ColumnLength";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import VMwareCollectionErrorCode, {
  VMwareCollectionErrorUtil,
} from "../../../Types/VMware/VMwareCollectionError";
import VMwareCollectionMethod from "../../../Types/VMware/VMwareCollectionMethod";
import VMwareCollectionStatus from "../../../Types/VMware/VMwareCollectionStatus";
import {
  VMwareCollectionJob,
  VMwareCollectionReport,
  VMwareCollectionSummary,
  VMwarePresentedCertificate,
} from "../../../Types/VMware/VMwareProbeCollection";
import VMwareCertificateFingerprint from "../../../Utils/VMware/VMwareCertificateFingerprint";
import VMwareCollectionSettings, {
  DEFAULT_VMWARE_COLLECTION_INTERVAL_IN_MINUTES,
  MAX_VMWARE_COLLECTION_INTERVAL_IN_MINUTES,
  MIN_VMWARE_COLLECTION_INTERVAL_IN_MINUTES,
} from "../../../Utils/VMware/VMwareCollectionSettings";
import { EntityManager } from "typeorm";

/*
 * The database half of probe collection: which vCenters a probe collects
 * now, and what it found.
 *
 * Claiming is atomic (FOR UPDATE SKIP LOCKED) and moves each claimed
 * vCenter's nextCollectionAt an interval on, so two work requests - the same
 * probe's overlapping ticks, or two server replicas - never hand one vCenter
 * out twice. The vCenters a probe says it is still collecting are left out,
 * so a collection slower than its interval is skipped, not stacked.
 *
 * Only a probe that may collect a vCenter is ever handed one: the vCenter
 * names it, and it is the project's own probe - or, on a self-hosted
 * install, one of the instance's own (VMwareCollectionSettings.
 * getProbeRefusal). The save hooks hold every write to this; the claim
 * holds rows written before them to it as well, so a stale row can be made
 * uncollectable but never hand its password to the wrong probe.
 */

// What recordCollectionReport made of a report.
export interface VMwareCollectionReportOutcome {
  accepted: boolean;
  // Why a report was not accepted, for the probe's log.
  reason?: string | undefined;
  projectId?: ObjectID | undefined;
  vcenterName?: string | undefined;
  /*
   * The report is for the vCenter's current settings, so its status is the
   * vCenter's status now. A report for older settings still delivers its
   * data, but leaves the status to the collection of the new ones.
   */
  isCurrent?: boolean | undefined;
}

const MAX_SUMMARY_WARNINGS: number = 20;
const MAX_TEXT_LENGTH: number = 1000;

export default class VMwareProbeCollectionStore {
  public static async claimDueVCenters(
    service: DatabaseService<VMwareVCenter>,
    data: {
      probeId: ObjectID;
      runningVMwareVCenterIds: Array<string>;
      limit: number;
    },
  ): Promise<Array<VMwareCollectionJob>> {
    if (data.limit <= 0) {
      return [];
    }

    const currentDate: Date = OneUptimeDate.getCurrentDate();

    const runningIds: Array<string> = data.runningVMwareVCenterIds.filter(
      (id: string): boolean => {
        return ObjectID.isValidUUID(id);
      },
    );

    const claimedIds: Array<string> = await service.executeTransaction(
      async (transactionalEntityManager: EntityManager) => {
        const selectQuery: string = `
        SELECT vc."_id", vc."collectionIntervalInMinutes"
        FROM "VMwareVCenter" vc
        INNER JOIN "Project" p ON vc."projectId" = p."_id"
        INNER JOIN "Probe" pr ON vc."collectionProbeId" = pr."_id"
        WHERE vc."collectionProbeId" = $1
          AND vc."collectionMethod" = $5
          AND vc."deletedAt" IS NULL
          AND vc."isVCenterPasswordSet" = true
          AND vc."vcenterUrl" IS NOT NULL
          AND vc."vcenterUsername" IS NOT NULL
          AND (vc."nextCollectionAt" IS NULL OR vc."nextCollectionAt" <= $2)
          AND NOT (vc."_id" = ANY($6::uuid[]))
          -- The tenancy backstop: the project's own probe, or a global
          -- probe on an instance where those are the operator's own.
          AND (
            (pr."isGlobalProbe" = false AND pr."projectId" = vc."projectId")
            OR (pr."isGlobalProbe" = true AND $7::boolean = false)
          )
          AND pr."deletedAt" IS NULL
          AND p."deletedAt" IS NULL
          AND (p."paymentProviderSubscriptionStatus" IS NULL
               OR p."paymentProviderSubscriptionStatus" = ANY($4::text[]))
          AND (p."paymentProviderMeteredSubscriptionStatus" IS NULL
               OR p."paymentProviderMeteredSubscriptionStatus" = ANY($4::text[]))
        ORDER BY vc."nextCollectionAt" ASC NULLS FIRST
        LIMIT $3
        FOR UPDATE OF vc SKIP LOCKED
      `;

        const selectedRows: Array<{
          _id: string;
          collectionIntervalInMinutes: number | null;
        }> = await transactionalEntityManager.query(selectQuery, [
          data.probeId.toString(),
          currentDate,
          data.limit,
          SubscriptionStatusUtil.getActiveSubscriptionStatuses(),
          VMwareCollectionMethod.Probe,
          runningIds,
          IsBillingEnabled,
        ]);

        if (selectedRows.length === 0) {
          return [];
        }

        const caseFragments: Array<string> = [];
        const parameters: Array<string | Date> = [];
        let parameterIndex: number = 1;

        for (const row of selectedRows) {
          const nextCollectionAt: Date = OneUptimeDate.addRemoveMinutes(
            currentDate,
            VMwareProbeCollectionStore.getSafeInterval(
              row.collectionIntervalInMinutes,
            ),
          );

          /*
           * ::timestamptz - see NetworkDeviceService.claimDevicesForPolling
           * for why a ::timestamp cast skews the schedule.
           */
          caseFragments.push(
            `WHEN $${parameterIndex} THEN $${parameterIndex + 1}::timestamptz`,
          );
          parameters.push(row._id, nextCollectionAt);
          parameterIndex += 2;
        }

        const ids: Array<string> = selectedRows.map(
          (row: { _id: string }): string => {
            return row._id;
          },
        );

        const idPlaceholders: Array<string> = ids.map(
          (_id: string, index: number): string => {
            return `$${parameterIndex + index}`;
          },
        );
        parameters.push(...ids);

        await transactionalEntityManager.query(
          `UPDATE "VMwareVCenter" SET "nextCollectionAt" = CASE "_id" ${caseFragments.join(
            " ",
          )} END WHERE "_id" IN (${idPlaceholders.join(", ")})`,
          parameters,
        );

        return ids;
      },
    );

    if (claimedIds.length === 0) {
      return [];
    }

    // Read as OneUptime: the password is decrypted on read.
    const vcenters: Array<VMwareVCenter> = await service.findBy({
      query: {
        _id: QueryHelper.any(claimedIds),
      },
      select: {
        _id: true,
        name: true,
        vcenterUrl: true,
        vcenterUsername: true,
        vcenterPassword: true,
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

    const jobs: Array<VMwareCollectionJob> = [];

    for (const vcenter of vcenters) {
      if (
        !vcenter._id ||
        !vcenter.vcenterUrl ||
        !vcenter.vcenterUsername ||
        !vcenter.vcenterPassword
      ) {
        continue;
      }

      const job: VMwareCollectionJob = {
        vmwareVCenterId: vcenter._id.toString(),
        vcenterName: vcenter.name || "",
        vcenterUrl: vcenter.vcenterUrl,
        username: vcenter.vcenterUsername,
        password: vcenter.vcenterPassword,
        collectionIntervalInMinutes: VMwareProbeCollectionStore.getSafeInterval(
          vcenter.collectionIntervalInMinutes,
        ),
        settingsVersion: vcenter.collectionSettingsVersion || 0,
      };

      const fingerprint: string | null = VMwareCertificateFingerprint.normalize(
        vcenter.trustedCertificateFingerprint,
      );

      if (fingerprint) {
        job.trustedCertificateFingerprint = fingerprint;
      }

      jobs.push(job);
    }

    return jobs;
  }

  /*
   * Record what a probe found for a vCenter it collected: the status, and -
   * for a report of the current settings - the error, the certificate it
   * did not trust, and the summary. Only the vCenter's own probe is heard,
   * and only while the vCenter is collected by a probe.
   */
  public static async recordCollectionReport(
    service: DatabaseService<VMwareVCenter>,
    data: {
      probeId: ObjectID;
      report: VMwareCollectionReport;
    },
  ): Promise<VMwareCollectionReportOutcome> {
    const report: VMwareCollectionReport = data.report;

    if (!report.vmwareVCenterId || !ObjectID.isValidUUID(report.vmwareVCenterId)) {
      return { accepted: false, reason: "The report names no vCenter." };
    }

    const vcenter: VMwareVCenter | null = await service.findOneById({
      id: new ObjectID(report.vmwareVCenterId),
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
      !vcenter ||
      !vcenter.projectId ||
      vcenter.collectionMethod !== VMwareCollectionMethod.Probe ||
      !vcenter.collectionProbeId ||
      vcenter.collectionProbeId.toString().toLowerCase() !==
        data.probeId.toString().toLowerCase()
    ) {
      return {
        accepted: false,
        reason:
          "This probe does not collect that vCenter (any more): it was deleted, switched to the VMware agent, or moved to another probe.",
      };
    }

    const refusal: string | null = VMwareCollectionSettings.getProbeRefusal({
      probe: {
        isGlobalProbe: vcenter.collectionProbe?.isGlobalProbe,
        projectId: vcenter.collectionProbe?.projectId?.toString() || null,
      },
      projectId: vcenter.projectId.toString(),
      isBillingEnabled: IsBillingEnabled,
    });

    if (refusal) {
      return { accepted: false, reason: refusal };
    }

    const isCurrent: boolean =
      Number(report.settingsVersion) ===
      Number(vcenter.collectionSettingsVersion || 0);

    const now: Date = OneUptimeDate.getCurrentDate();
    const isSuccess: boolean = report.status === VMwareCollectionStatus.Succeeded;

    const values: Record<string, unknown> = {
      lastCollectionAt: now,
    };

    if (isCurrent) {
      values["collectionStatus"] = isSuccess
        ? VMwareCollectionStatus.Succeeded
        : VMwareCollectionStatus.Failed;

      if (isSuccess) {
        values["collectionErrorCode"] = null;
        values["collectionError"] = null;
        values["presentedCertificate"] = null;
        values["lastSuccessfulCollectionAt"] = now;

        const summary: VMwareCollectionSummary | null =
          VMwareProbeCollectionStore.sanitizeSummary(report.summary);

        if (summary) {
          values["collectionSummary"] = summary;
        }
      } else {
        const errorCode: VMwareCollectionErrorCode =
          VMwareCollectionErrorUtil.isValid(report.errorCode)
            ? report.errorCode
            : VMwareCollectionErrorCode.Internal;

        values["collectionErrorCode"] = errorCode;
        values["collectionError"] = VMwareProbeCollectionStore.boundText(
          report.errorMessage ||
            VMwareCollectionErrorUtil.getAdvice(errorCode).title,
          ColumnLength.LongText,
        );
        values["presentedCertificate"] =
          VMwareCollectionErrorUtil.isCertificateTrustProblem(errorCode)
            ? VMwareProbeCollectionStore.sanitizePresentedCertificate(
                report.presentedCertificate,
              )
            : null;
      }
    }

    try {
      await service.updateColumnsByIdWithoutHooks({
        id: vcenter.id!,
        data: values as never,
      });
    } catch (error) {
      logger.error(
        `Could not record the collection of vCenter ${report.vmwareVCenterId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }

    return {
      accepted: true,
      projectId: vcenter.projectId,
      vcenterName: vcenter.name || undefined,
      isCurrent: isCurrent,
    };
  }

  public static getSafeInterval(value: number | null | undefined): number {
    const interval: number = Number(value);

    if (!Number.isFinite(interval) || interval <= 0) {
      return DEFAULT_VMWARE_COLLECTION_INTERVAL_IN_MINUTES;
    }

    return Math.min(
      Math.max(Math.round(interval), MIN_VMWARE_COLLECTION_INTERVAL_IN_MINUTES),
      MAX_VMWARE_COLLECTION_INTERVAL_IN_MINUTES,
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
   * A presented certificate as the probe reported it, held to the shape the
   * dashboard reads: a fingerprint in the canonical spelling, and bounded
   * strings. Null when the fingerprint is not one.
   */
  public static sanitizePresentedCertificate(
    value: unknown,
  ): VMwarePresentedCertificate | null {
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

    const certificate: VMwarePresentedCertificate = {
      fingerprint256: fingerprint,
      subject:
        VMwareProbeCollectionStore.boundText(raw["subject"], MAX_TEXT_LENGTH) ||
        "",
      issuer:
        VMwareProbeCollectionStore.boundText(raw["issuer"], MAX_TEXT_LENGTH) ||
        "",
      isSelfSigned: raw["isSelfSigned"] === true,
    };

    for (const key of [
      "validFrom",
      "validTo",
      "subjectAltName",
      "verificationError",
    ] as const) {
      const text: string | null = VMwareProbeCollectionStore.boundText(
        raw[key],
        MAX_TEXT_LENGTH,
      );

      if (text) {
        certificate[key] = text;
      }
    }

    return certificate;
  }

  // A summary as the probe reported it: whole counts, bounded strings.
  public static sanitizeSummary(value: unknown): VMwareCollectionSummary | null {
    if (!value || typeof value !== "object") {
      return null;
    }

    const raw: Record<string, unknown> = value as Record<string, unknown>;

    const count: (key: string) => number = (key: string): number => {
      const number: number = Number(raw[key]);
      return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
    };

    const summary: VMwareCollectionSummary = {
      datacenterCount: count("datacenterCount"),
      clusterCount: count("clusterCount"),
      hostCount: count("hostCount"),
      vmCount: count("vmCount"),
      poweredOnVmCount: count("poweredOnVmCount"),
      templateCount: count("templateCount"),
      datastoreCount: count("datastoreCount"),
      resourcePoolCount: count("resourcePoolCount"),
      warnings: (Array.isArray(raw["warnings"]) ? raw["warnings"] : [])
        .map((warning: unknown): string | null => {
          return VMwareProbeCollectionStore.boundText(warning, MAX_TEXT_LENGTH);
        })
        .filter((warning: string | null): warning is string => {
          return warning !== null;
        })
        .slice(0, MAX_SUMMARY_WARNINGS),
    };

    for (const key of [
      "productName",
      "fullName",
      "version",
      "build",
      "apiType",
      "apiVersion",
      "instanceUuid",
    ] as const) {
      const text: string | null = VMwareProbeCollectionStore.boundText(
        raw[key],
        ColumnLength.ShortText * 2,
      );

      if (text) {
        summary[key] = text;
      }
    }

    if (raw["resourceCount"] !== undefined) {
      summary.resourceCount = count("resourceCount");
    }

    if (raw["datapointCount"] !== undefined) {
      summary.datapointCount = count("datapointCount");
    }

    return summary;
  }
}
