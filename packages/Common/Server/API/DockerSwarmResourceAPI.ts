import DockerSwarmResource from "../../Models/DatabaseModels/DockerSwarmResource";
import DockerSwarmCluster from "../../Models/DatabaseModels/DockerSwarmCluster";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import DockerSwarmResourceService, {
  DockerSwarmInventorySummary,
  Service as DockerSwarmResourceServiceType,
} from "../Services/DockerSwarmResourceService";
import DockerSwarmClusterService from "../Services/DockerSwarmClusterService";
import UserMiddleware from "../Middleware/UserAuthorization";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotFoundException from "../../Types/Exception/NotFoundException";
import { JSONObject } from "../../Types/JSON";

/*
 * ------------------------------------------------------------------
 * DockerSwarmResourceAPI
 *
 * Augments the auto-generated CRUD router with a single custom
 * endpoint the DockerSwarm layout/overview pages use to fetch sidebar
 * badge counts in one round-trip:
 *
 *   POST /docker-swarm-resource/inventory-summary/:clusterId
 *
 * The standard CRUD endpoints (list / get) are still registered by
 * BaseAPI; the UI uses them via ModelAPI for list/detail reads.
 * Write endpoints reject (@TableAccessControl create/update/delete
 * = []); ingest writes go through DockerSwarmResourceService as root.
 * ------------------------------------------------------------------
 */
export default class DockerSwarmResourceAPI extends BaseAPI<
  DockerSwarmResource,
  DockerSwarmResourceServiceType
> {
  public constructor() {
    super(DockerSwarmResource, DockerSwarmResourceService);

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/inventory-summary/:clusterId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getInventorySummary(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  /*
   * Cluster + auth resolution for the cluster-scoped sub-route.
   * Returns the (projectId, dockerSwarmClusterId) tuple after enforcing
   * the standard ACL chain. Throws NotFound when the cluster is
   * missing or the caller lacks read access (indistinguishable on
   * purpose).
   */
  private async resolveClusterForRequest(req: ExpressRequest): Promise<{
    projectId: ObjectID;
    dockerSwarmClusterId: ObjectID;
  }> {
    const clusterIdParam: string | undefined = req.params["clusterId"];
    if (!clusterIdParam) {
      throw new BadDataException("Cluster ID is required");
    }

    let dockerSwarmClusterId: ObjectID;
    try {
      dockerSwarmClusterId = new ObjectID(clusterIdParam);
    } catch {
      throw new BadDataException("Invalid Cluster ID");
    }

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const cluster: DockerSwarmCluster | null =
      await DockerSwarmClusterService.findOneById({
        id: dockerSwarmClusterId,
        select: {
          _id: true,
          projectId: true,
        },
        props,
      });

    if (!cluster || !cluster.projectId) {
      throw new NotFoundException("DockerSwarm Cluster not found");
    }

    return {
      projectId: cluster.projectId,
      dockerSwarmClusterId,
    };
  }

  private async getInventorySummary(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { projectId, dockerSwarmClusterId } =
      await this.resolveClusterForRequest(req);

    const summary: DockerSwarmInventorySummary =
      await this.service.getInventorySummary({
        projectId,
        dockerSwarmClusterId,
      });

    const responseBody: JSONObject = {
      countsByKind: summary.countsByKind as unknown as JSONObject,
      // Convenience fields so the UI doesn't have to repeat COALESCE:
      nodeCount: summary.countsByKind["Node"] || 0,
      serviceCount: summary.countsByKind["Service"] || 0,
      taskCount: summary.countsByKind["Task"] || 0,
      stackCount: summary.countsByKind["Stack"] || 0,
      networkCount: summary.countsByKind["Network"] || 0,
      secretCount: summary.countsByKind["Secret"] || 0,
      configCount: summary.countsByKind["Config"] || 0,
      volumeCount: summary.countsByKind["Volume"] || 0,
      nodeReadyCount: summary.nodeReadyCount,
      taskRunningCount: summary.taskRunningCount,
    };

    return Response.sendJsonObjectResponse(req, res, responseBody);
  }
}
