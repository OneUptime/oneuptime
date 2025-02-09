import BillingService from "../../../Services/BillingService";
import MeteredPlan from "Common/Types/Billing/MeteredPlan";
import NotImplementedException from "Common/Types/Exception/NotImplementedException";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";

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
