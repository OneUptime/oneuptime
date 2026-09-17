import Query from "../Query";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import UserModel from "../../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export default class UserPermissions {
  @CaptureSpan()
  public static async addUserScopeToQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    props: DatabaseCommonInteractionProps,
  ): Promise<Query<TBaseModel>> {
    const model: BaseModel = new modelType();

    if (model instanceof UserModel) {
      if (props.userId) {
        (query as any)["_id"] = props.userId;
      } else if (!props.isRoot && !props.isMasterAdmin) {
        throw new NotAuthorizedException(
          `You do not have permissions to query on - ${model.singularName}.`,
        );
      }
    }

    return query;
  }
}
