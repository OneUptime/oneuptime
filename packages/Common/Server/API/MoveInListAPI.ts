import DatabaseService from "../Services/DatabaseService";
import BaseAPI from "./BaseAPI";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { MoveInListResult } from "../../Types/Database/MoveInList";
import ObjectID from "../../Types/ObjectID";

// A service whose rows can be moved to another row's place in their list.
export interface MoveInListService {
  moveInList(data: {
    id: ObjectID;
    placeOfId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<MoveInListResult>;
}

/*
 * The API of one of the five lists numbered by an `order` column whose
 * services keep them by hand (issue #9573: a status page's groups and
 * resources, an on-call policy's escalation rules, a schedule's layers and
 * the people in a layer): its table's routes, and
 *
 *   POST /<the table's path>/:id/move   { "placeOfId": "<id>" }
 *
 * which moves the row to the place of the row named (BaseAPI.moveItem, the
 * service's own moveInList). Every drag-ordered list (@ListOrderColumn) has
 * the same route through BaseAPI itself (issue #9609).
 */
export default class MoveInListAPI<
  TBaseModel extends BaseModel,
  TBaseService extends DatabaseService<BaseModel> & MoveInListService,
> extends BaseAPI<TBaseModel, TBaseService> {
  public constructor(type: { new (): TBaseModel }, service: TBaseService) {
    super(type, service);

    // A drag-ordered list has it already.
    if (!new this.entityType().getListOrder()) {
      this.addMoveInListRoute();
    }
  }
}
