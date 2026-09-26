import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import InventoryItemRelationship from "Common/Models/DatabaseModels/InventoryItemRelationship";
import CommonAPI from "Common/Server/API/CommonAPI";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import ModelPermission from "Common/Server/Types/Database/Permissions/Index";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import TopologyQueries from "Common/Server/Utils/Topology/TopologyQueries";
import TopologyRequest, {
  TopologyCollectionRequest,
  TopologyCollectionSearchRequest,
  TopologyEntityConnectionsRequest,
  TopologyEntityRequest,
  TopologyRangeRequest,
} from "Common/Server/Utils/Topology/TopologyRequest";
import TopologyResponseCache, {
  topologyResponseCacheKey,
} from "Common/Server/Utils/Topology/TopologyResponseCache";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import { TopologyApiPath } from "Common/Types/Topology/TopologyApi";

/*
 * The Topology maps' API: Postgres reduces the inventory graph and each view
 * gets exactly the rows it draws, computed over the whole inventory (see
 * Common/Types/Topology/TopologyApi.ts for the contract and
 * Common/Server/Utils/Topology for the SQL).
 *
 * Every route is gated the way the generic list API gates InventoryItem and
 * InventoryItemRelationship — table permissions, team block rules, the
 * unpaid-subscription 402 and master admin all come from
 * ModelPermission.checkReadQueryPermission. Neither model has an
 * access-control, owner or user column, so the only predicate that check
 * would add is the tenant scope, and the SQL binds exactly that tenant
 * (props.tenantId) itself; the returned query is therefore not needed.
 * Anything project-shaped in a request body is ignored.
 *
 * An anonymous caller gets 401 before anything else happens, so a browser
 * whose session expired refreshes it and replays the request.
 */

type TopologyReads = "items" | "itemsAndRelationships";

async function authorizeTopologyRead(
  req: ExpressRequest,
  reads: TopologyReads,
): Promise<ObjectID> {
  const props: DatabaseCommonInteractionProps =
    await CommonAPI.getDatabaseCommonInteractionProps(req);

  const projectId: ObjectID = CommonAPI.assertTenantScoped(props);

  if (props.isMultiTenantRequest) {
    throw new BadDataException("Topology is read one project at a time.");
  }

  await ModelPermission.checkReadQueryPermission<InventoryItem>(
    InventoryItem,
    { projectId: projectId },
    null,
    props,
  );

  if (reads === "itemsAndRelationships") {
    await ModelPermission.checkReadQueryPermission<InventoryItemRelationship>(
      InventoryItemRelationship,
      { projectId: projectId },
      null,
      props,
    );
  }

  return projectId;
}

export default class TopologyAPI {
  public getRouter(): ExpressRouter {
    const router: ExpressRouter = Express.getRouter();

    /*
     * The two maps. Their payloads are cached as serialized JSON per
     * (route, project, minute-floored range start) for a minute, and
     * concurrent cold loads share one build. The cache is consulted only
     * after the caller is authorized.
     */
    router.post(
      TopologyApiPath.ServiceMap,
      UserMiddleware.getUserMiddleware,
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const projectId: ObjectID = await authorizeTopologyRead(
            req,
            "itemsAndRelationships",
          );
          const request: TopologyRangeRequest =
            TopologyRequest.parseRangeRequest(req.body);

          const json: string = await TopologyResponseCache.getOrBuild(
            topologyResponseCacheKey({
              route: TopologyApiPath.ServiceMap,
              projectId: projectId.toString(),
              rangeStart: request.rangeStart,
            }),
            async (): Promise<string> => {
              return JSON.stringify(
                await TopologyQueries.getServiceMap({
                  ...request,
                  projectId,
                }),
              );
            },
          );

          return Response.sendJsonStringResponse(req, res, json);
        } catch (err) {
          return next(err);
        }
      },
    );

    router.post(
      TopologyApiPath.Infrastructure,
      UserMiddleware.getUserMiddleware,
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const projectId: ObjectID = await authorizeTopologyRead(
            req,
            "itemsAndRelationships",
          );
          const request: TopologyRangeRequest =
            TopologyRequest.parseRangeRequest(req.body);

          const json: string = await TopologyResponseCache.getOrBuild(
            topologyResponseCacheKey({
              route: TopologyApiPath.Infrastructure,
              projectId: projectId.toString(),
              rangeStart: request.rangeStart,
            }),
            async (): Promise<string> => {
              return JSON.stringify(
                await TopologyQueries.getInfrastructure({
                  ...request,
                  projectId,
                }),
              );
            },
          );

          return Response.sendJsonStringResponse(req, res, json);
        } catch (err) {
          return next(err);
        }
      },
    );

    // One page of a collection (a flat type too large to ship row by row).
    router.post(
      TopologyApiPath.InfrastructureCollection,
      UserMiddleware.getUserMiddleware,
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const projectId: ObjectID = await authorizeTopologyRead(req, "items");
          const request: TopologyCollectionRequest =
            TopologyRequest.parseCollectionRequest(req.body);

          return Response.sendJsonStringResponse(
            req,
            res,
            JSON.stringify(
              await TopologyQueries.getCollectionPage({
                ...request,
                projectId,
              }),
            ),
          );
        } catch (err) {
          return next(err);
        }
      },
    );

    // How many items of each collection match an Infrastructure search.
    router.post(
      TopologyApiPath.InfrastructureCollectionSearch,
      UserMiddleware.getUserMiddleware,
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const projectId: ObjectID = await authorizeTopologyRead(req, "items");
          const request: TopologyCollectionSearchRequest =
            TopologyRequest.parseCollectionSearchRequest(req.body);

          return Response.sendJsonStringResponse(
            req,
            res,
            JSON.stringify(
              await TopologyQueries.getCollectionSearch({
                ...request,
                projectId,
              }),
            ),
          );
        } catch (err) {
          return next(err);
        }
      },
    );

    // The detail drawer: the entity and its connections, by section.
    router.post(
      TopologyApiPath.Entity,
      UserMiddleware.getUserMiddleware,
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const projectId: ObjectID = await authorizeTopologyRead(
            req,
            "itemsAndRelationships",
          );
          const request: TopologyEntityRequest =
            TopologyRequest.parseEntityRequest(req.body);

          return Response.sendJsonStringResponse(
            req,
            res,
            JSON.stringify(
              await TopologyQueries.getEntity({ ...request, projectId }),
            ),
          );
        } catch (err) {
          return next(err);
        }
      },
    );

    // The drawer's "Show more": the next page of one section.
    router.post(
      TopologyApiPath.EntityConnections,
      UserMiddleware.getUserMiddleware,
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const projectId: ObjectID = await authorizeTopologyRead(
            req,
            "itemsAndRelationships",
          );
          const request: TopologyEntityConnectionsRequest =
            TopologyRequest.parseEntityConnectionsRequest(req.body);

          return Response.sendJsonStringResponse(
            req,
            res,
            JSON.stringify(
              await TopologyQueries.getEntityConnections({
                ...request,
                projectId,
              }),
            ),
          );
        } catch (err) {
          return next(err);
        }
      },
    );

    return router;
  }
}
