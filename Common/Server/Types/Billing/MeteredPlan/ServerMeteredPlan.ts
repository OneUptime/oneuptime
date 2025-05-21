import BillingService from "../../../Services/BillingService";
import MeteredPlan from "../../../../Types/Billing/MeteredPlan";
import NotImplementedException from "../../../../Types/Exception/NotImplementedException";
import ProductType from "../../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../../Types/ObjectID";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export default class ServerMeteredPlan {
  public getProductType(): ProductType {
    throw new NotImplementedException();
  }

  public getCostByMeteredPlan(
    meteredPlan: MeteredPlan,
    quantity: number,
  ): number {
    return meteredPlan.getPricePerUnit() * quantity;
  }

  @CaptureSpan()
  public async reportQuantityToBillingProvider(
    _projectId: ObjectID,
    _options: {
      meteredPlanSubscriptionId?: string | undefined;
    },
  ): Promise<void> {
    throw new NotImplementedException();
  }

  public getPriceId(): string {
    return BillingService.getMeteredPlanPriceId(this.getProductType());
  }
}
