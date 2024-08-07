import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import Search from "Common/Types/BaseDatabase/Search";
import CompareBase from "Common/Types/Database/CompareBase";
import GenericObject from "Common/Types/GenericObject";
import { JSONObject, JSONValue } from "Common/Types/JSON";

type Query<
  TBaseModel extends
    | BaseModel
    | AnalyticsBaseModel
    | JSONObject
    | GenericObject,
> = {
  [P in keyof TBaseModel]?:
    | JSONValue
    | Search
    | InBetween
    | NotNull
    | CompareBase;
};

export default Query;
