import RelationSelect from "./RelationSelect";
import Select from "./Select";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { JSONObject } from "../../../Types/JSON";
import Typeof from "../../../Types/Typeof";
import CaptureSpan from "../../Utils/Telemetry/CaptureSpan";

export default class SelectUtil {
  @CaptureSpan()
  public static sanitizeSelect<TBaseModel extends BaseModel>(
    modelType: DatabaseBaseModelType,
    select: Select<TBaseModel>,
  ): {
    select: Select<TBaseModel>;
    relationSelect: RelationSelect<TBaseModel>;
  } {
    const model: BaseModel = new modelType();
    const relationSelect: RelationSelect<TBaseModel> = {};

    for (const key in select) {
      if (model.isEntityColumn(key)) {
        if (typeof (select as JSONObject)[key] === Typeof.Object) {
          (relationSelect as any)[key] = true;
          (select as any)[key] = {
            ...(select as any)[key],
            _id: true,
          };
        } else {
          // if you want to relationSelect the whole object, you only do the id because of security.
          (select as any)[key] = {
            ...(select as any)[key],
            _id: true,
          } as any;
          (relationSelect as any)[key] = true;
        }
      }
    }

    return { select, relationSelect };
  }
}
