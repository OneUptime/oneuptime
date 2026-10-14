import BillingService from "../../../Services/BillingService";
import ProjectService from "../../../Services/ProjectService";
import ActiveMonitorLimit from "../../../Utils/Billing/ActiveMonitorLimit";
import ServerMeteredPlan from "./ServerMeteredPlan";
import ProductType from "../../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../../Types/ObjectID";
import Project from "../../../../Models/DatabaseModels/Project";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";
import PayAsYouGoBillingService, {
  LiveUsageAuthorization,
} from "../../../Services/PayAsYouGoBillingService";

export default class ActiveMonitoringMeteredPlan extends ServerMeteredPlan {
  @CaptureSpan()
  public override getProductType(): ProductType {
    return ProductType.ActiveMonitoring;
  }

  @CaptureSpan()
  public override async reportQuantityToBillingProvider(
    projectId: ObjectID,
    options?: {
      meteredPlanSubscriptionId?: string | undefined;
    },
  ): Promise<void> {
    /*
     * Every monitor but a Manual one, counted and written on the project
     * (Project.currentActiveMonitorsCount) under the active monitor limit's
     * lock, so the count the project shows is what the Monitor table holds
     * - the same count the plan's limit is held to. See
     * ActiveMonitorLimit.refreshCount.
     */
    const count: number = await ActiveMonitorLimit.refreshCount(projectId);

    /*
     * This runs on every monitor create and delete, so each live check here
     * is a payment-provider read on a request path. Check once, and hand the
     * answer to the usage write instead of letting it read the same payment
     * setup again a moment later.
     */
    const liveAuthorization: LiveUsageAuthorization | null =
      await PayAsYouGoBillingService.authorizeUsageNow(projectId);

    if (!liveAuthorization) {
      return;
    }

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
        count,
        { liveAuthorization: liveAuthorization },
      );
    }
  }
}
