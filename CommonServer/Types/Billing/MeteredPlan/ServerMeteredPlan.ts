import MeteredPlan from "Common/Types/Billing/MeteredPlan";
import NotImplementedException from "Common/Types/Exception/NotImplementedException";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";



export default class ServerMeteredPlan {
    public static meteredPlanId: MeteredPlan;

    public static async updateCurrentQuantity(_projectId: ObjectID): Promise<PositiveNumber> {
        throw new NotImplementedException();
    }
}