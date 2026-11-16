import BillingService from "../../../Services/BillingService";
import ProjectService from "../../../Services/ProjectService";
import TelemetryUsageBillingService from "../../../Services/TelemetryUsageBillingService";
import ServerMeteredPlan from "./ServerMeteredPlan";
import OneUptimeDate from "../../../../Types/Date";
import ProductType from "../../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../../Types/ObjectID";
import Project from "../../../../Models/DatabaseModels/Project";
import TelemetryUsageBilling from "../../../../Models/DatabaseModels/TelemetryUsageBilling";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";
import PayAsYouGoBillingService, {
  LiveUsageAuthorization,
} from "../../../Services/PayAsYouGoBillingService";

export default class TelemetryMeteredPlan extends ServerMeteredPlan {
  private _productType!: ProductType;
  public get productType(): ProductType {
    return this._productType;
  }
  public set productType(v: ProductType) {
    this._productType = v;
  }

  private _unitCostInUSD: number = 0;
  public get unitCostInUSD(): number {
    return this._unitCostInUSD;
  }
  public set unitCostInUSD(v: number) {
    this._unitCostInUSD = v;
  }

  /*
   * The fewest days a GB is billed for, however soon it is deleted. Zero
   * bills exactly the days it is kept.
   */
  private _minimumBillableRetentionInDays: number = 0;
  public get minimumBillableRetentionInDays(): number {
    return this._minimumBillableRetentionInDays;
  }
  public set minimumBillableRetentionInDays(v: number) {
    this._minimumBillableRetentionInDays = v;
  }

  public constructor(data: {
    productType: ProductType;
    unitCostInUSD: number;
    minimumBillableRetentionInDays?: number | undefined;
  }) {
    super();
    this.productType = data.productType;
    this.unitCostInUSD = data.unitCostInUSD;
    this.minimumBillableRetentionInDays =
      data.minimumBillableRetentionInDays || 0;
  }

  /*
   * The days a GB kept this long is billed for. Usage History still shows
   * the days it is kept: only the cost is floored.
   */
  public getBillableRetentionInDays(retentionInDays: number): number {
    return Math.max(retentionInDays, this.minimumBillableRetentionInDays);
  }

  public getTotalCostInUSD(data: {
    dataIngestedInGB: number;
    retentionInDays: number;
  }): number {
    return (
      data.dataIngestedInGB *
      this.getBillableRetentionInDays(data.retentionInDays) *
      this.unitCostInUSD
    );
  }

  @CaptureSpan()
  public override getProductType(): ProductType {
    return this.productType;
  }

  @CaptureSpan()
  public override async reportQuantityToBillingProvider(
    projectId: ObjectID,
    options?: {
      meteredPlanSubscriptionId?: string | undefined;
    },
  ): Promise<void> {
    /*
     * One live read of the payment setup for the whole report. Staging and the
     * usage write each used to repeat it seconds later, for every product type
     * of every project in the billing pass; they are handed this one instead,
     * and still check live when it is not for this project or has aged out.
     */
    const liveAuthorization: LiveUsageAuthorization | null =
      await PayAsYouGoBillingService.authorizeUsageNow(projectId);

    if (!liveAuthorization) {
      await TelemetryUsageBillingService.waiveUnreportedUsageBilling({
        projectId: projectId,
        productType: this.productType,
      });
      return;
    }

    const billingStartsAt: Date | undefined =
      await PayAsYouGoBillingService.getTelemetryBillingStartDate(projectId);
    if (billingStartsAt) {
      await TelemetryUsageBillingService.waiveUnreportedUsageBilling({
        projectId: projectId,
        productType: this.productType,
        before: billingStartsAt,
      });
    }

    /*
     * Every day of the catch-up window that was never staged, not only
     * yesterday. A day that fails to stage must not keep the days that did
     * from being billed, so its error waits until they are reported.
     */
    let stagingError: unknown = null;

    try {
      await TelemetryUsageBillingService.stageUnstagedTelemetryUsageForProject({
        projectId: projectId,
        productType: this.productType,
        liveAuthorization: liveAuthorization,
        billingStartsAt: billingStartsAt,
      });
    } catch (error) {
      stagingError = error;
    }

    await this.reportUnreportedUsage(projectId, liveAuthorization, options);

    if (stagingError) {
      throw stagingError;
    }
  }

  private async reportUnreportedUsage(
    projectId: ObjectID,
    liveAuthorization: LiveUsageAuthorization,
    options?: {
      meteredPlanSubscriptionId?: string | undefined;
    },
  ): Promise<void> {
    const usageBillings: Array<TelemetryUsageBilling> =
      await TelemetryUsageBillingService.getUnreportedUsageBilling({
        projectId: projectId,
        productType: this.productType,
      });

    if (usageBillings.length === 0) {
      return;
    }

    // calculate all the total usage count and report it to billing provider.

    let totalCostInUSD: number = 0;

    for (const usageBilling of usageBillings) {
      if (
        usageBilling?.totalCostInUSD?.value &&
        usageBilling?.totalCostInUSD.value > 0
      ) {
        totalCostInUSD += usageBilling.totalCostInUSD.value;
      }
    }

    if (totalCostInUSD < 1) {
      return; // too low to report.
    }

    // convert USD to cents.

    let totalCostInCents: number = totalCostInUSD * 100;

    // convert this to integer.

    totalCostInCents = Math.ceil(totalCostInCents);

    // update this count in project as well.
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: {
        paymentProviderMeteredSubscriptionId: true,
        paymentProviderPlanId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (
      project &&
      (options?.meteredPlanSubscriptionId ||
        project.paymentProviderMeteredSubscriptionId) &&
      project.paymentProviderPlanId
    ) {
      await BillingService.addOrUpdateMeteredPricingOnSubscription(
        (options?.meteredPlanSubscriptionId as string) ||
          (project.paymentProviderMeteredSubscriptionId as string),
        this,
        totalCostInCents,
        { liveAuthorization: liveAuthorization },
      );

      for (const usageBilling of usageBillings) {
        if (usageBilling.id) {
          // now mark it as reported.

          await TelemetryUsageBillingService.updateOneById({
            id: usageBilling.id,
            data: {
              isReportedToBillingProvider: true,
              reportedToBillingProviderAt: OneUptimeDate.getCurrentDate(),
            },
            props: {
              isRoot: true,
            },
          });
        }
      }
    }
  }
}
