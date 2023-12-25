import NotImplementedException from 'Common/Types/Exception/NotImplementedException';
import ObjectID from 'Common/Types/ObjectID';
import BillingService from '../../../Services/BillingService';
import MeteredPlan from 'Common/Types/Billing/MeteredPlan';
import { ProductType } from 'Model/Models/UsageBilling';

export default class ServerMeteredPlan {
    public getProductType(): ProductType {
        throw new NotImplementedException();
    }

    public async getCostByProjectId(
        projectId: ObjectID,
        quantity: number
    ): Promise<number> {
        const meteredPlan: MeteredPlan = await this.getMeteredPlan(projectId);
        return this.getCostByMeteredPlan(meteredPlan, quantity);
    }

    public getCostByMeteredPlan(
        meteredPlan: MeteredPlan,
        quantity: number
    ): number {
        return meteredPlan.getPricePerUnit() * quantity;
    }

    public async getMeteredPlan(_projectId: ObjectID): Promise<MeteredPlan> {
        throw new NotImplementedException();
    }

    public async reportQuantityToBillingProvider(
        _projectId: ObjectID,
        _options: {
            meteredPlanSubscriptionId?: string | undefined;
        }
    ): Promise<void> {
        throw new NotImplementedException();
    }

    public getPriceId(): string {
        return BillingService.getMeteredPlanPriceId(this.getProductType());
    }
}
