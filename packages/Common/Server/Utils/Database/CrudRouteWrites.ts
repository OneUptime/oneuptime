import DatabaseService from "../../Services/DatabaseService";
import DatabaseRequestType from "../../Types/BaseDatabase/DatabaseRequestType";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { coerceBooleanColumnsInJSON } from "../../../Types/Database/BooleanColumnValue";
import { coerceDateColumnsInJSON } from "../../../Types/Database/DateColumnValue";
import { coerceNumericColumnsInJSON } from "../../../Types/Database/NumericColumnValue";
import PartialEntity from "../../../Types/Database/PartialEntity";
import { coerceTextColumnsInJSON } from "../../../Types/Database/TextColumnValue";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";

/*
 * A RECORD WRITTEN AS THE API'S CRUD ROUTE WRITES IT (#10378).
 *
 * Most of Data Security's buttons are a plain write of a record through
 * the API: Confirm and Not Sensitive update a finding, Accept Risk, Not an
 * Issue, Reopen and Assign update an issue, and a store's owners are
 * created and deleted. Ask AI's actions make the same writes, and must make
 * them exactly as the button does - the same columns coerced the same way,
 * the same service, the same hooks, the caller's own props, and a write
 * that matched nothing refused as the route refuses it. So the route
 * (BaseAPI) and the actions both read the body here, and both write
 * through these: a change to how the route reads a write changes the
 * actions with it.
 *
 * Never root: each write is made with the props it is handed, so what the
 * person may not change, nothing here changes.
 */

/*
 * An update's columns as the route reads its body's `data`: deserialized,
 * then each number, date, switch and name column coerced to what its
 * column holds - "10" a number, "2027-01-01" a date, "true" a boolean - so a
 * hook reads the value the database will store; and never the row's id or
 * its timestamps, which no caller writes.
 */
export function readCrudUpdateData<TBaseModel extends BaseModel>(
  data: JSONObject,
  entityModel: TBaseModel,
): PartialEntity<TBaseModel> {
  const item: PartialEntity<TBaseModel> = coerceTextColumnsInJSON(
    coerceBooleanColumnsInJSON(
      coerceDateColumnsInJSON(
        coerceNumericColumnsInJSON(
          JSONFunctions.deserialize(data),
          entityModel,
        ),
        entityModel,
      ),
      entityModel,
    ),
    entityModel,
  ) as PartialEntity<TBaseModel>;

  delete (item as Record<string, unknown>)["_id"];
  delete (item as Record<string, unknown>)["createdAt"];
  delete (item as Record<string, unknown>)["updatedAt"];

  return item;
}

/*
 * A create's record as the route reads its body's `data`: the model built
 * from it, with no id of its own - a create never names the row it makes
 * (BaseAPI.createItem says why the id is cleared and not deleted).
 */
export function readCrudCreateItem<TBaseModel extends BaseModel>(
  data: JSONObject,
  entityType: { new (): TBaseModel },
): TBaseModel {
  const item: TBaseModel = BaseModel.fromJSON<TBaseModel>(
    data,
    entityType,
  ) as TBaseModel;

  (item as unknown as Record<string, unknown>)["_id"] = undefined;

  return item;
}

export default class CrudRouteWrites {
  /*
   * PUT /<record>/:id, as the button sends it: { data } updated by id with
   * the caller's props, and one that matched no row refused - missing to
   * whom may not read it, refused to whom may read and not change it.
   */
  public static async update<TBaseModel extends BaseModel>(data: {
    service: DatabaseService<TBaseModel>;
    entityType: { new (): TBaseModel };
    id: ObjectID;
    data: JSONObject;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const item: PartialEntity<TBaseModel> = readCrudUpdateData(
      data.data,
      new data.entityType(),
    );

    const numberOfDocsAffected: number = await data.service.updateOneById({
      id: data.id,
      data: item,
      miscDataProps: {},
      props: data.props,
    });

    if (numberOfDocsAffected === 0) {
      throw await data.service.getUnwrittenByIdError({
        id: data.id,
        props: data.props,
        type: DatabaseRequestType.Update,
      });
    }
  }

  // POST /<record>, as the button sends it: { data } created with the caller's props.
  public static async create<TBaseModel extends BaseModel>(data: {
    service: DatabaseService<TBaseModel>;
    entityType: { new (): TBaseModel };
    data: JSONObject;
    props: DatabaseCommonInteractionProps;
  }): Promise<TBaseModel> {
    return await data.service.create({
      data: readCrudCreateItem(data.data, data.entityType),
      miscDataProps: {},
      props: data.props,
    });
  }

  /*
   * DELETE /<record>/:id, as the button sends it: deleted by id with the
   * caller's props, and one that removed nothing refused as an update is.
   */
  public static async delete<TBaseModel extends BaseModel>(data: {
    service: DatabaseService<TBaseModel>;
    id: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const numberOfDocsDeleted: number = await data.service.deleteOneById({
      id: data.id,
      props: data.props,
    });

    if (numberOfDocsDeleted === 0) {
      throw await data.service.getUnwrittenByIdError({
        id: data.id,
        props: data.props,
        type: DatabaseRequestType.Delete,
      });
    }
  }
}
