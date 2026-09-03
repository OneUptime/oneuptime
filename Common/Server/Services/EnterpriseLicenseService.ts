import DatabaseService from "./DatabaseService";
import EnterpriseLicense from "../../Models/DatabaseModels/EnterpriseLicense";
import MarketingEventUtil from "../Utils/Marketing/MarketingEventUtil";
import { MarketingEventType } from "../../Types/Marketing/MarketingEvent";
import { OnCreate } from "../Types/Database/Hooks";
import OneUptimeDate from "../../Types/Date";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ObjectID from "../../Types/ObjectID";
import Semaphore, { SemaphoreMutex } from "../Infrastructure/Semaphore";
import logger from "../Utils/Logger";

export const ENTERPRISE_LICENSE_USAGE_AGGREGATION_LOCK_NAMESPACE: string =
  "EnterpriseLicenseService.usageAggregation";

export const ENTERPRISE_LICENSE_USAGE_AGGREGATION_LOCK_OPTIONS: Readonly<{
  namespace: string;
  lockTimeout: number;
  acquireTimeout: number;
}> = Object.freeze({
  namespace: ENTERPRISE_LICENSE_USAGE_AGGREGATION_LOCK_NAMESPACE,
  lockTimeout: 60_000,
  acquireTimeout: 10_000,
});

export class Service extends DatabaseService<EnterpriseLicense> {
  public constructor() {
    super(EnterpriseLicense);
  }

  /**
   * Serialize usage aggregation for one enterprise license across every API
   * and worker process. Callers must put the complete read-compute-write
   * operation inside `fn`; locking only the write would leave the stale-read
   * race intact.
   */
  public async runWithUsageAggregationLock<TResult>(data: {
    licenseId: ObjectID;
    fn: () => Promise<TResult>;
  }): Promise<TResult> {
    /*
     * Acquisition is deliberately outside the callback try/finally. If Redis
     * is unavailable or contention exceeds the bounded acquire timeout, the
     * operation fails closed and there is no unowned mutex to release.
     */
    const mutex: SemaphoreMutex = await Semaphore.lock({
      key: data.licenseId.toString(),
      ...ENTERPRISE_LICENSE_USAGE_AGGREGATION_LOCK_OPTIONS,
    });

    try {
      return await data.fn();
    } finally {
      try {
        await Semaphore.release(mutex);
      } catch (error) {
        /*
         * redis-semaphore refreshes held locks and lets them expire after the
         * lock timeout if explicit release fails. Logging is best effort: a
         * release error must not replace either the callback's value or its
         * more useful error.
         */
        logger.error(
          `Failed to release enterprise license usage aggregation lock for ${data.licenseId.toString()}; it will expire automatically: ${error}`,
        );
      }
    }
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<EnterpriseLicense>,
    createdItem: EnterpriseLicense,
  ): Promise<EnterpriseLicense> {
    /*
     * The outbound enterprise_license_issued conversion.
     *
     * This is where sales-led revenue enters the funnel. Everything else
     * OneUptime emits is self-serve and knows its own value from the plan
     * table; an enterprise contract is negotiated, so annualContractValue is
     * the only place the number exists at all.
     *
     * Emitted even with no email and no ACV. A licence issued without either
     * is still a licence issued, and a receiver that sees the event can chase
     * the missing detail — one that never sees it cannot. The two nulls are
     * reported honestly rather than defaulted to zero, which would quietly
     * drag reported contract value down.
     */
    MarketingEventUtil.emitInBackground(() => {
      return MarketingEventUtil.buildEvent({
        eventType: MarketingEventType.EnterpriseLicenseIssued,
        eventId: `${MarketingEventType.EnterpriseLicenseIssued}:${createdItem.id?.toString()}`,
        occurredAt: createdItem.createdAt || new Date(),
        email: createdItem.email?.toString(),
        /*
         * No attribution source. A licence row is typed in by a human and
         * carries no session, so its campaign is whatever the earlier
         * conversion sharing its email carried — the join the receiver makes
         * on emailHash, not something OneUptime can restate here.
         */
        data: {
          enterpriseLicenseId: createdItem.id?.toString() || "",
          companyName: createdItem.companyName || "",
          annualContractValueInUSD:
            createdItem.annualContractValue === undefined ||
            createdItem.annualContractValue === null
              ? null
              : createdItem.annualContractValue,
          currency: "USD",
          isEvaluationLicense: Boolean(createdItem.isEvaluationLicense),
          userLimit:
            createdItem.userLimit === undefined ||
            createdItem.userLimit === null
              ? null
              : createdItem.userLimit,
          /*
           * Read through OneUptimeDate rather than calling toISOString on the
           * column directly. TypeORM's save() returns the entity it was handed,
           * so this is whatever the caller supplied — a Date from the coercion
           * in BaseModel.fromJSON, but a raw string from any caller that skips
           * it. This hook runs AFTER the INSERT has committed, so a TypeError
           * here does not undo the licence: it only turns a licence that exists
           * into a "Server Error" the admin retries, creating another one.
           */
          expiresAt: OneUptimeDate.toIsoStringOrNull(createdItem.expiresAt),
        },
      });
    });

    return createdItem;
  }
}

export default new Service();
