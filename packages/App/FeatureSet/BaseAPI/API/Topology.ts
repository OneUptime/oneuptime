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
import TopologyConcurrencyLimiter, {
  TOPOLOGY_BUSY_RETRY_AFTER_SECONDS,
  TopologyRequestAbandonedError,
} from "Common/Server/Utils/Topology/TopologyConcurrencyLimiter";
import TopologyQueries from "Common/Server/Utils/Topology/TopologyQueries";
import TopologyRequest, {
  TopologyCollectionRequest,
  TopologyCollectionSearchRequest,
  TopologyEntityAllTimeConnectionsRequest,
  TopologyEntityAllTimeRequest,
  TopologyEntityConnectionsRequest,
  TopologyEntityRequest,
  TopologyMapRequest,
} from "Common/Server/Utils/Topology/TopologyRequest";
import TopologyResponseCache, {
  topologyResponseCacheKey,
} from "Common/Server/Utils/Topology/TopologyResponseCache";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "Common/Types/Exception/BadDataException";
import TooManyRequestsException from "Common/Types/Exception/TooManyRequestsException";
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
 *
 * Every database read runs under the process's TopologyConcurrencyLimiter —
 * after the caller is authorized and the body parsed, and for the maps inside
 * the cache's build, so a cache hit or a request sharing a running build
 * takes no slot. When the limiter is full the answer is a 429 with
 * Retry-After.
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

/*
 * Fires when the client goes away before its response is written (the drawer
 * aborts the previous entity's request on every click), so the limiter can
 * give the queue place to someone still waiting.
 */
function abandonedWhenClientLeaves(res: ExpressResponse): AbortSignal {
  const controller: AbortController = new AbortController();
  if (typeof res.on === "function") {
    res.on("close", (): void => {
      if (!res.writableFinished) {
        controller.abort();
      }
    });
  }
  return controller.signal;
}

/*
 * One read, run when the limiter has a slot for the project. A per-request
 * read passes `signal` so an abandoned request never starts; a map build is
 * shared by everyone asking for the same map, so it is never abandoned.
 */
async function limited<T>(
  projectId: ObjectID,
  read: () => Promise<T>,
  signal?: AbortSignal | undefined,
): Promise<T> {
  return await TopologyConcurrencyLimiter.run<T>(
    projectId.toString(),
    read,
    signal,
  );
}

/* Hands an error to the error handler; a busy limiter adds Retry-After. */
function passOn(err: unknown, res: ExpressResponse, next: NextFunction): void {
  if (err instanceof TopologyRequestAbandonedError) {
    // The client is gone; there is nobody to answer.
    return;
  }
  if (err instanceof TooManyRequestsException) {
    res.setHeader("Retry-After", String(TOPOLOGY_BUSY_RETRY_AFTER_SECONDS));
  }
  return next(err);
}

export default class TopologyAPI {
  public getRouter(): ExpressRouter {
    const router: ExpressRouter = Express.getRouter();

    /*
     * The two maps. Their payloads are cached as serialized JSON per
     * (route, project, minute-floored range start) for a minute, and
     * concurrent cold loads share one build. The cache is consulted only
     * after the caller is authorized. An explicit refresh (`fresh`) skips the
     * cached copy, still sharing a build already running, and replaces it.
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
          const request: TopologyMapRequest = TopologyRequest.parseMapRequest(
            req.body,
          );

          const json: string = await TopologyResponseCache.getOrBuild(
            topologyResponseCacheKey({
              route: TopologyApiPath.ServiceMap,
              projectId: projectId.toString(),
              rangeStart: request.rangeStart,
            }),
            async (): Promise<string> => {
              return JSON.stringify(
                await limited(projectId, () => {
                  return TopologyQueries.getServiceMap({
                    rangeStart: request.rangeStart,
                    projectId,
                  });
                }),
              );
            },
            { fresh: request.fresh },
          );

          return Response.sendJsonStringResponse(req, res, json);
        } catch (err) {
          return passOn(err, res, next);
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
          const request: TopologyMapRequest = TopologyRequest.parseMapRequest(
            req.body,
          );

          const json: string = await TopologyResponseCache.getOrBuild(
            topologyResponseCacheKey({
              route: TopologyApiPath.Infrastructure,
              projectId: projectId.toString(),
              rangeStart: request.rangeStart,
            }),
            async (): Promise<string> => {
              return JSON.stringify(
                await limited(projectId, () => {
                  return TopologyQueries.getInfrastructure({
                    rangeStart: request.rangeStart,
                    projectId,
                  });
                }),
              );
            },
            { fresh: request.fresh },
          );

          return Response.sendJsonStringResponse(req, res, json);
        } catch (err) {
          return passOn(err, res, next);
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
        const abandoned: AbortSignal = abandonedWhenClientLeaves(res);
        try {
          const projectId: ObjectID = await authorizeTopologyRead(req, "items");
          const request: TopologyCollectionRequest =
            TopologyRequest.parseCollectionRequest(req.body);

          return Response.sendJsonStringResponse(
            req,
            res,
            JSON.stringify(
              await limited(
                projectId,
                () => {
                  return TopologyQueries.getCollectionPage({
                    ...request,
                    projectId,
                  });
                },
                abandoned,
              ),
            ),
          );
        } catch (err) {
          return passOn(err, res, next);
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
        const abandoned: AbortSignal = abandonedWhenClientLeaves(res);
        try {
          const projectId: ObjectID = await authorizeTopologyRead(req, "items");
          const request: TopologyCollectionSearchRequest =
            TopologyRequest.parseCollectionSearchRequest(req.body);

          return Response.sendJsonStringResponse(
            req,
            res,
            JSON.stringify(
              await limited(
                projectId,
                () => {
                  return TopologyQueries.getCollectionSearch({
                    ...request,
                    projectId,
                  });
                },
                abandoned,
              ),
            ),
          );
        } catch (err) {
          return passOn(err, res, next);
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
        const abandoned: AbortSignal = abandonedWhenClientLeaves(res);
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
              await limited(
                projectId,
                () => {
                  return TopologyQueries.getEntity({ ...request, projectId });
                },
                abandoned,
              ),
            ),
          );
        } catch (err) {
          return passOn(err, res, next);
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
        const abandoned: AbortSignal = abandonedWhenClientLeaves(res);
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
              await limited(
                projectId,
                () => {
                  return TopologyQueries.getEntityConnections({
                    ...request,
                    projectId,
                  });
                },
                abandoned,
              ),
            ),
          );
        } catch (err) {
          return passOn(err, res, next);
        }
      },
    );

    /*
     * The inventory item page's Connections: the drawer's sections over
     * everything the inventory holds, with no range.
     */
    router.post(
      TopologyApiPath.EntityAllTime,
      UserMiddleware.getUserMiddleware,
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        const abandoned: AbortSignal = abandonedWhenClientLeaves(res);
        try {
          const projectId: ObjectID = await authorizeTopologyRead(
            req,
            "itemsAndRelationships",
          );
          const request: TopologyEntityAllTimeRequest =
            TopologyRequest.parseEntityAllTimeRequest(req.body);

          return Response.sendJsonStringResponse(
            req,
            res,
            JSON.stringify(
              await limited(
                projectId,
                () => {
                  return TopologyQueries.getEntityAllTime({
                    ...request,
                    projectId,
                  });
                },
                abandoned,
              ),
            ),
          );
        } catch (err) {
          return passOn(err, res, next);
        }
      },
    );

    // Its "Show more": the next page of one all-time section.
    router.post(
      TopologyApiPath.EntityAllTimeConnections,
      UserMiddleware.getUserMiddleware,
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        const abandoned: AbortSignal = abandonedWhenClientLeaves(res);
        try {
          const projectId: ObjectID = await authorizeTopologyRead(
            req,
            "itemsAndRelationships",
          );
          const request: TopologyEntityAllTimeConnectionsRequest =
            TopologyRequest.parseEntityAllTimeConnectionsRequest(req.body);

          return Response.sendJsonStringResponse(
            req,
            res,
            JSON.stringify(
              await limited(
                projectId,
                () => {
                  return TopologyQueries.getEntityAllTimeConnections({
                    ...request,
                    projectId,
                  });
                },
                abandoned,
              ),
            ),
          );
        } catch (err) {
          return passOn(err, res, next);
        }
      },
    );

    return router;
  }
}
