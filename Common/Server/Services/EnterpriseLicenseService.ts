import DatabaseService from "./DatabaseService";
import EnterpriseLicense from "../../Models/DatabaseModels/EnterpriseLicense";
import MarketingEventUtil from "../Utils/Marketing/MarketingEventUtil";
import { MarketingEventType } from "../../Types/Marketing/MarketingEvent";
import { OnCreate } from "../Types/Database/Hooks";
import OneUptimeDate from "../../Types/Date";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<EnterpriseLicense> {
  public constructor() {
    super(EnterpriseLicense);
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
