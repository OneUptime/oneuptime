import MeteredPlan from "Common/Types/Billing/MeteredPlan";
import NotImplementedException from "Common/Types/Exception/NotImplementedException";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";



export default class ServerMeteredPlan {
    public static meteredPlan: MeteredPlan | undefined = undefined;

    public static async updateCurrentQuantity(_projectId: ObjectID): Promise<PositiveNumber> {
        throw new NotImplementedException();
    }
}