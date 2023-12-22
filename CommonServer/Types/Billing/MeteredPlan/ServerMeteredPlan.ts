import NotImplementedException from 'Common/Types/Exception/NotImplementedException';
import ObjectID from 'Common/Types/ObjectID';
import BillingService, { MeteredPlanName } from '../../../Services/BillingService';
import MeteredPlan from 'Common/Types/Billing/MeteredPlan';

export default class ServerMeteredPlan {
   
    public getMeteredPlanName(): MeteredPlanName {
        throw new NotImplementedException();
    }

    public getMeteredPlan(_projectId: ObjectID): MeteredPlan {
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
        return BillingService.getMeteredPlanPriceId(this.getMeteredPlanName());
    }
}
