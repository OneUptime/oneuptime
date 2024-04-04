import NotImplementedException from 'Common/Types/Exception/NotImplementedException';
import ObjectID from 'Common/Types/ObjectID';
import BillingService from '../../../Services/BillingService';
import MeteredPlan from 'Common/Types/Billing/MeteredPlan';
import { ProductType } from 'Model/Models/TelemetryUsageBilling';

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

    public async getMeteredPlan(projectId: ObjectID): Promise<MeteredPlan> {
        return await BillingService.getMeteredPlan({
            projectId: projectId,
            productType: this.getProductType(),
        });
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
