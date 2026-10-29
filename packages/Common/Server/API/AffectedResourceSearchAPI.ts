import UserMiddleware from "../Middleware/UserAuthorization";
import AffectedResourceSearch from "../Utils/AffectedResources/AffectedResourceSearch";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import CommonAPI from "./CommonAPI";
import {
  AFFECTED_RESOURCE_SEARCH_ROUTE,
  AffectedResourceSearchRequest,
  AffectedResourceSearchResult,
  readAffectedResourceSearchRequest,
  toAffectedResourceSearchResultJSON,
} from "../../Types/AffectedResources/AffectedResourceSearch";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../Types/ObjectID";

/*
 * POST /affected-resources/search
 *
 * The Affected Resources picker's one request (issue #5341): what the
 * person typed, found across every kind of resource it asks for - hosts,
 * network devices, clusters, databases, cloud resources, services,
 * monitors - each kind with how many match and the first of them by name.
 *
 * For an authenticated member of the project or a project API key. Every
 * kind is read with the caller's own props (AffectedResourceSearch), so a
 * kind they may not read is named as unreadable and never listed, and
 * labels and owned scope narrow the rest. Nothing is written, and the
 * answer is never cached: a resource added a moment later can change it.
 */
export default class AffectedResourceSearchAPI {
  public router: ExpressRouter;

  public constructor() {
    this.router = Express.getRouter();

    this.router.post(
      AFFECTED_RESOURCE_SEARCH_ROUTE,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectPrincipal(props);

          const request: AffectedResourceSearchRequest =
            readAffectedResourceSearchRequest(req.body);

          const result: AffectedResourceSearchResult =
            await AffectedResourceSearch.search({
              projectId: projectId,
              props: props,
              request: request,
            });

          Response.setNoCacheHeaders(res);

          return Response.sendJsonObjectResponse(
            req,
            res,
            toAffectedResourceSearchResultJSON(result),
          );
        } catch (err) {
          next(err);
        }
      },
    );
  }

  public getRouter(): ExpressRouter {
    return this.router;
  }
}
