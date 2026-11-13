import DataStore from "../../../../Models/DatabaseModels/DataStore";
import Project from "../../../../Models/DatabaseModels/Project";
import { getWatchedTablesCostInCents } from "../../../../Types/Billing/PayAsYouGoPricing";
import DataAssetKind from "../../../../Types/DataObservability/DataAssetKind";
import ProductType from "../../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../../Types/ObjectID";
import BillingService from "../../../Services/BillingService";
import PayAsYouGoBillingService, {
  LiveUsageAuthorization,
} from "../../../Services/PayAsYouGoBillingService";
import ProjectService from "../../../Services/ProjectService";
import { WatchedTablePricingConfig } from "../../../EnvironmentConfig";
import QueryHelper from "../../Database/QueryHelper";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";
import type { SubscriptionItem } from "../BillingProvider";
import ServerMeteredPlan from "./ServerMeteredPlan";

/*
 * THE TABLES DATA OBSERVABILITY WATCHES, ON THE BILL.
 *
 * Every table of a database being watched, whatever else is decided, so what a
 * price would cost can be read before there is one. A view is free, and so are
 * the tables of a database someone stopped watching.
 *
 * What is reported is the month's cost in cents, not the count, so the rates the
 * install sets (WatchedTablePricingConfig) are the only copy of what a table
 * costs. The Stripe price it names (WatchedTableStripePriceId) is therefore
 * metered, one cent a unit, and keeps the last usage of the period, so a project
 * that drops tables pays for what it has now. With no price named nothing reaches
 * the payment provider.
 */
export default class WatchedTableMeteredPlan extends ServerMeteredPlan {
  @CaptureSpan()
  public override getProductType(): ProductType {
    return ProductType.WatchedTables;
  }

  @CaptureSpan()
  public static async countWatchedTables(projectId: ObjectID): Promise<number> {
    // Read when they are needed: the project's services load this plan, and these theirs.
    const { default: DataStoreService } = await import(
      "../../../Services/DataStoreService"
    );
    const { default: DataAssetService } = await import(
      "../../../Services/DataAssetService"
    );
    const watchedStores: Array<DataStore> = await DataStoreService.findAllBy({
      query: { projectId, isArchived: false, isTableHealthEnabled: true },
      select: { _id: true },
      props: { isRoot: true },
    });

    if (watchedStores.length === 0) {
      return 0;
    }

    const count: { toNumber: () => number } = await DataAssetService.countBy({
      query: {
        projectId,
        isDropped: false,
        assetKind: QueryHelper.notEquals(DataAssetKind.View),
        dataStoreId: QueryHelper.any(
          watchedStores.map((store: DataStore): string => {
            return store.id!.toString();
          }),
        ),
      },
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
    /*
     * A sample project (issue #6808) is never billed: nothing of it is
     * counted, written or reported to the payment provider.
     */
    if (await ProjectService.isSampleProject(projectId)) {
      return;
    }

    const count: number =
      await WatchedTableMeteredPlan.countWatchedTables(projectId);

    await ProjectService.updateColumnsByIdWithoutHooks({
      id: projectId,
      data: { currentWatchedTablesCount: count } as never,
    });

    if (!this.hasPriceId()) {
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

    if (!subscriptionId || !project?.paymentProviderPlanId) {
      return;
    }

    const costInCents: number = getWatchedTablesCostInCents(
      count,
      WatchedTablePricingConfig,
    );

    /*
     * Nothing owed needs no way to pay, and no line on the invoice. Only a report
     * from earlier this month has to be replaced, or it would still be billed.
     */
    if (costInCents === 0) {
      const items: Array<SubscriptionItem> =
        await BillingService.getSubscriptionItems(subscriptionId);
      const isOnSubscription: boolean = items.some(
        (item: SubscriptionItem): boolean => {
          return item.price?.id === this.getPriceId();
        },
      );

      if (isOnSubscription) {
        await BillingService.addOrUpdateMeteredPricingOnSubscription(
          subscriptionId,
          this,
          0,
        );
      }

      return;
    }

    const liveAuthorization: LiveUsageAuthorization | null =
      await PayAsYouGoBillingService.authorizeUsageNow(projectId);

    if (!liveAuthorization) {
      return;
    }

    await BillingService.addOrUpdateMeteredPricingOnSubscription(
      subscriptionId,
      this,
      costInCents,
      { liveAuthorization },
    );
  }
}
