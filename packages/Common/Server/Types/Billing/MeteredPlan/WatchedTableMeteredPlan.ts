import Project from "../../../../Models/DatabaseModels/Project";
import ProductType from "../../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../../Types/ObjectID";
import BillingService from "../../../Services/BillingService";
import PayAsYouGoBillingService, {
  LiveUsageAuthorization,
} from "../../../Services/PayAsYouGoBillingService";
import ProjectService from "../../../Services/ProjectService";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";
import ServerMeteredPlan from "./ServerMeteredPlan";

/*
 * THE TABLES DATA OBSERVABILITY WATCHES, COUNTED FOR THE BILL.
 *
 * Every table that has not been dropped, counted and written on the project
 * whatever else is decided, so what a price would cost can be read before there
 * is one. Nothing is charged until this plan has a price (hasPriceId): with
 * none, no subscription item is made and nothing reaches the payment provider.
 */
export default class WatchedTableMeteredPlan extends ServerMeteredPlan {
  @CaptureSpan()
  public override getProductType(): ProductType {
    return ProductType.WatchedTables;
  }

  @CaptureSpan()
  public static async countWatchedTables(projectId: ObjectID): Promise<number> {
    // Read when it is needed: the project's services load this plan, and this service theirs.
    const { default: DataAssetService } = await import(
      "../../../Services/DataAssetService"
    );
    const count: { toNumber: () => number } = await DataAssetService.countBy({
      query: { projectId, isDropped: false },
      props: { isRoot: true },
    });

    return count.toNumber();
  }

  @CaptureSpan()
  public override async reportQuantityToBillingProvider(
    projectId: ObjectID,
    options?: {
      meteredPlanSubscriptionId?: string | undefined;
    },
  ): Promise<void> {
    const count: number =
      await WatchedTableMeteredPlan.countWatchedTables(projectId);

    await ProjectService.updateColumnsByIdWithoutHooks({
      id: projectId,
      data: { currentWatchedTablesCount: count } as never,
    });

    if (!this.hasPriceId()) {
      return;
    }

    const liveAuthorization: LiveUsageAuthorization | null =
      await PayAsYouGoBillingService.authorizeUsageNow(projectId);

    if (!liveAuthorization) {
      return;
    }

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
    const subscriptionId: string | undefined =
      options?.meteredPlanSubscriptionId ||
      project?.paymentProviderMeteredSubscriptionId;

    if (subscriptionId && project?.paymentProviderPlanId) {
      await BillingService.addOrUpdateMeteredPricingOnSubscription(
        subscriptionId,
        this,
        count,
        { liveAuthorization },
      );
    }
  }
}
