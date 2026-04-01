import DataMigrationBase from "./DataMigrationBase";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import Sleep from "Common/Types/Sleep";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import BillingService, {
  SubscriptionItem,
} from "Common/Server/Services/BillingService";
import ProjectService from "Common/Server/Services/ProjectService";
import AllMeteredPlans from "Common/Server/Types/Billing/MeteredPlan/AllMeteredPlans";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import Project from "Common/Models/DatabaseModels/Project";

export default class MigrateToMeteredSubscription extends DataMigrationBase {
  public constructor() {
    super("MigrateToMeteredSubscription");
  }

  public override async migrate(): Promise<void> {
    if (!IsBillingEnabled) {
      return;
    }

    const projects: Array<Project> = await ProjectService.findBy({
      query: {
        paymentProviderMeteredSubscriptionId: QueryHelper.isNull(),
      },
      select: {
        _id: true,
        paymentProviderSubscriptionId: true,
        paymentProviderCustomerId: true,
        trialEndsAt: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const project of projects) {
      if (!project.paymentProviderSubscriptionId) {
        continue;
      }

      if (!project.paymentProviderCustomerId) {
        continue;
      }

      // remove subscription item.
      const subscriptionItems: Array<SubscriptionItem> =
        await BillingService.getSubscriptionItems(
          project.paymentProviderSubscriptionId,
        );

      for (const subscriptionItem of subscriptionItems) {
        if (
          subscriptionItem.plan.id === "price_1N6Cg9ANuQdJ93r7veN7YgsH" ||
          subscriptionItem.plan.id === "price_1N6B9EANuQdJ93r7fj3bhcWP"
        ) {
          await BillingService.removeSubscriptionItem(
            project.paymentProviderSubscriptionId,
            subscriptionItem.id,
            true,
          );
        }
      }

      // add metered subscription item and update metered quantity.
      const meteredPlan: {
        meteredSubscriptionId: string;
      } = await BillingService.subscribeToMeteredPlan({
        projectId: project.id!,
        customerId: project.paymentProviderCustomerId!,
        serverMeteredPlans: AllMeteredPlans,
        trialDate: project.trialEndsAt || null,
      });

      // update project with metered subscription id.
      await ProjectService.updateOneById({
        id: project.id!,
        data: {
          paymentProviderMeteredSubscriptionId:
            meteredPlan.meteredSubscriptionId,
        },
        props: {
          isRoot: true,
        },
      });

      await Sleep.sleep(500);
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
