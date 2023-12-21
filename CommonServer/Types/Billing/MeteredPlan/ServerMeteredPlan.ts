import MeteredPlan from 'Common/Types/Billing/MeteredPlan';
import BadDataException from 'Common/Types/Exception/BadDataException';
import NotImplementedException from 'Common/Types/Exception/NotImplementedException';
import ObjectID from 'Common/Types/ObjectID';

export default class ServerMeteredPlan {
    public static meteredPlan: MeteredPlan | undefined = undefined;

    public static getMeteredPlan(): MeteredPlan {
        if (!this.meteredPlan) {
            throw new BadDataException('Metered plan not found');
        }

        return this.meteredPlan;
    }

    public static async reportQuantityToBillingProvider(
        _projectId: ObjectID,
        _options: {
            meteredPlanSubscriptionId?: string | undefined;
        }
    ): Promise<void> {
        throw new NotImplementedException();
    }
}
