import UserMiddleware from "../Middleware/UserAuthorization";
import DatabaseService from "../Services/DatabaseService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import MoveInListUtil, {
  MOVE_IN_LIST_ROUTE,
  MoveInListRequest,
  MoveInListResult,
} from "../../Types/Database/MoveInList";
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
 * The API of a list numbered by an `order` column (issue #9573): its
 * table's routes, and
 *
 *   POST /<the table's path>/:id/move   { "placeOfId": "<id>" }
 *
 * which moves the row to the place of the row named, the rows between them
 * stepping one place towards where it was (Types/Database/MoveInList,
 * Server/Utils/Database/ContiguousOrder). A write of `order` through the
 * table's own routes places the row alone - what Terraform needs, numbering
 * a whole list one write per row - so a move, what someone dragging a row
 * means, is its own request.
 *
 * The project is the request's tenant; a project API key is asked like a
 * member, its permissions deciding: the move is refused to whoever may not
 * change the row's order. A request with no session is answered 401, so an
 * idle tab refreshes it.
 */
export default class MoveInListAPI<
  TBaseModel extends BaseModel,
  TBaseService extends DatabaseService<BaseModel> & MoveInListService,
> extends BaseAPI<TBaseModel, TBaseService> {
  public constructor(type: { new (): TBaseModel }, service: TBaseService) {
    super(type, service);

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}${MOVE_IN_LIST_ROUTE}`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.moveItem(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  public async moveItem(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    await this.assertProductIsOn();

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    CommonAPI.assertTenantScoped(props);

    const idParam: string = String(req.params["id"] || "");
    ObjectID.validateUUID(idParam);

    const request: MoveInListRequest = MoveInListUtil.parseRequest(req.body);

    const result: MoveInListResult = await this.service.moveInList({
      id: new ObjectID(idParam),
      placeOfId: request.placeOfId,
      props: props,
    });

    Response.setNoCacheHeaders(res);

    return Response.sendJsonObjectResponse(
      req,
      res,
      MoveInListUtil.resultToJSON(result),
    );
  }
}
