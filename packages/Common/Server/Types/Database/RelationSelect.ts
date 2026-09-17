import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { JSONObject } from "../../../Types/JSON";
import { FindOptionsRelations } from "typeorm";

type RelationSelect<TBaseModel extends BaseModel> =
  | FindOptionsRelations<TBaseModel>
  | JSONObject;

export default RelationSelect;
