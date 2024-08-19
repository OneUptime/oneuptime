import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BaseQuery, { OrQuery as BaseQueryOrQuery } from "../../../Types/BaseDatabase/Query";

export declare type OrQuery<TBaseModel extends BaseModel> = BaseQueryOrQuery<TBaseModel>;

declare type Query<TBaseModel extends BaseModel> = BaseQuery<TBaseModel>;

export default Query;
