import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import RecordOwnership, {
  RecordOwnershipResult,
} from "../../Types/RecordAccess/RecordOwnership";
import UserMiddleware from "../Middleware/UserAuthorization";
import DatabaseService from "../Services/DatabaseService";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import RecordOwnershipReader from "../Utils/RecordAccess/RecordOwnershipReader";
import Response from "../Utils/Response";
import CommonAPI from "./CommonAPI";

/*
 * POST /<record>/record-ownership { "ids": [...] }: who owns each of the
 * records a page shows, as the server's Owned scope reads it, and the
 * tables and operations those owners decide (Types/RecordAccess
 * /RecordOwnership, #11436). A record's page asks it once for its record,
 * a list once for the rows on screen, and the locks on them are worked out
 * by the shared rule (Types/LabelAccess/LabelAccess.weighRecord).
 *
 * Registered by BaseAPI on the CRUD path of every kind with owner tables of
 * its own, behind the session guards: a request with no session is answered
 * 401, so an idle tab refreshes it rather than showing an error. It changes
 * nothing, so it is answered while the record's product is switched off
 * too, as a read is. The project is the request's tenant; a record the
 * caller may not read is left out of the answer, as a list leaves it out.
 */
export default class RecordOwnershipRoute {
  public static register(data: {
    router: ExpressRouter;
    // The kind's CRUD path, "/monitor".
    apiPath: string;
    service: DatabaseService<BaseModel>;
  }): void {
    data.router.post(
      `${data.apiPath}${RecordOwnership.routePath}`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await RecordOwnershipRoute.handle(req, res, data.service);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  public static async handle(
    req: ExpressRequest,
    res: ExpressResponse,
    service: DatabaseService<BaseModel>,
  ): Promise<void> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    CommonAPI.assertTenantScoped(props);

    const ids: Array<string> | null = RecordOwnership.readRequestIds(req.body);

    if (!ids) {
      throw new BadDataException(
        'Name the records to ask about by their IDs: { "ids": ["<record ID>"] }.',
      );
    }

    const result: RecordOwnershipResult = await RecordOwnershipReader.read({
      service: service,
      ids: ids,
      props: props,
    });

    Response.setNoCacheHeaders(res);

    return Response.sendJsonObjectResponse(
      req,
      res,
      RecordOwnership.toJSON(result),
    );
  }
}
