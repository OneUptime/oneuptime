import GenericObject from "../GenericObject";
import { JSONObject, JSONValue } from "../JSON";

export type QueryPropertyOptions = JSONValue | JSONObject;

export declare type QueryOptions<Entity> = {
  [P in keyof Entity]?: QueryPropertyOptions;
};

type Query<TBaseModel extends GenericObject> = QueryOptions<TBaseModel>;

export default Query;
