import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import RecordAccess, {
  RecordAccessKind,
  RecordAccessResult,
} from "../../Types/RecordAccess/RecordAccess";
import UserMiddleware from "../Middleware/UserAuthorization";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import RecordAccessBuilder from "../Utils/RecordAccess/RecordAccessBuilder";
import Response from "../Utils/Response";
import CommonAPI from "./CommonAPI";

/*
 * GET /<record>/record-access/:recordId: what the reader may do on one
 * incident, alert, episode or maintenance event and on its parts - each
 * operation allowed, or refused with why - worked out by the checks a write
 * runs (Types/RecordAccess/RecordAccess, Server/Utils/RecordAccess
 * /RecordAccessBuilder). The record's page asks it once as it opens, and
 * every lock on the page reads it (#10272).
 *
 * A GET: it changes nothing, so it is answered while the record's product
 * is switched off too, as a read is. Registered by each record's API on its
 * own router, behind the session guards: a request with no session is
 * answered 401, so an idle tab refreshes it rather than showing an error.
 * The project is the request's tenant; a project API key is admitted like a
 * member, its permissions deciding. A record the caller may not read is
 * answered as missing, as its own GET answers it.
 */
export default class RecordAccessRoute {
  public static register(data: {
    router: ExpressRouter;
    // The record API's own path, "/incident".
    apiPath: string;
    kind: RecordAccessKind;
  }): void {
    data.router.get(
      `${data.apiPath}${RecordAccess.routePath}/:recordId`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await RecordAccessRoute.handle(req, res, data.kind);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  public static async handle(
    req: ExpressRequest,
    res: ExpressResponse,
    kind: RecordAccessKind,
  ): Promise<void> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    CommonAPI.assertTenantScoped(props);

    const recordId: ObjectID = RecordAccessRoute.parseRecordId(
      req.params["recordId"],
    );

    const result: RecordAccessResult = await RecordAccessBuilder.build({
      kind: kind,
      recordId: recordId,
      props: props,
    });

    Response.setNoCacheHeaders(res);

    return Response.sendJsonObjectResponse(
      req,
      res,
      RecordAccess.toJSON(result),
    );
  }

  public static parseRecordId(value: unknown): ObjectID {
    const text: string = typeof value === "string" ? value.trim() : "";

    if (!text || !ObjectID.isValidUUID(text)) {
      throw new BadDataException(
        "The record to ask about is not named by an ID. Ask again with the ID of the record.",
      );
    }

    return new ObjectID(text);
  }
}
