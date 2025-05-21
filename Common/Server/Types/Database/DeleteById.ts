import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import User from "../../../Models/DatabaseModels/User";

export default interface DeleteById {
  id: ObjectID;
  deletedByUser?: User;
  props: DatabaseCommonInteractionProps;
}
