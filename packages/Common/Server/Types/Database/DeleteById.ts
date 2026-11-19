import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import User from "../../../Models/DatabaseModels/User";

export default interface DeleteById {
  id: ObjectID;
  deletedByUser?: User;
  // See DeleteOneBy.deletionReason - passed straight through to the hooks.
  deletionReason?: string | undefined;
  // See DeleteOneBy.miscDataProps - passed straight through to the hooks.
  miscDataProps?: JSONObject | undefined;
  props: DatabaseCommonInteractionProps;
}
