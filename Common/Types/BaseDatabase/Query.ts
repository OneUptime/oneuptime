import GenericObject from "../GenericObject";
import QueryOperator from "./QueryOperator";

export declare type FindWhereProperty<Property extends GenericObject> = Property | FindWhere<Property> | QueryOperator<Property>;
/**
 * :
 * Used for find operations.
 */
export declare type FindWhere<Entity> = {
  [P in keyof Entity]?: FindWhereProperty<NonNullable<Entity[P]>>
};

declare type Query<TBaseModel extends GenericObject> = FindWhere<TBaseModel>;

export declare type OrQuery<TBaseModel extends GenericObject> = Array<
  Query<TBaseModel>
>;

export default Query;
