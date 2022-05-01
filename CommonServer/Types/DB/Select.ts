import BaseModel from "Common/Models/BaseModel";
import { FindOptionsSelect } from "typeorm";

type Select<TBaseModel extends BaseModel> = FindOptionsSelect<TBaseModel>;
export default Select;
