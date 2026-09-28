import ProxmoxResource from "../../Models/DatabaseModels/ProxmoxResource";
import ProxmoxCluster from "../../Models/DatabaseModels/ProxmoxCluster";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import ProxmoxResourceService, {
  ProxmoxInventorySummary,
  Service as ProxmoxResourceServiceType,
} from "../Services/ProxmoxResourceService";
import ProxmoxClusterService from "../Services/ProxmoxClusterService";
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
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import { JSONObject } from "../../Types/JSON";
import ModelPermission from "../Types/Database/Permissions/Index";
import Query from "../Types/Database/Query";

// A node's pve externalId is "node/<name>" on the agent and the native push.
const NODE_EXTERNAL_ID_PREFIX: string = "node/";

/*
 * One answer for "no such cluster in this project" and "a cluster you
 * may not edit", so the refusal is not a way to probe for ids.
 */
const EDITABLE_CLUSTER_NOT_FOUND_MESSAGE: string =
  "Proxmox Cluster not found, or you do not have permission to edit it. Removing a node needs permission to edit its cluster.";

const NODE_STILL_REPORTING_MESSAGE: string =
  "Only a node that has stopped reporting can be removed. A node that is still reporting would come back on its next report.";

/*
 * ------------------------------------------------------------------
 * ProxmoxResourceAPI
 *
 * Augments the auto-generated CRUD router with two custom endpoints:
 *
 *   POST /proxmox-resource/inventory-summary/:clusterId
 *     Sidebar badge counts for the Proxmox layout/overview pages in
 *     one round-trip. Needs read access to the cluster.
 *
 *   POST /proxmox-resource/remove-node/:clusterId   { nodeName }
 *     Removes a node that has stopped reporting, for a node taken out
 *     of the Proxmox cluster, which OneUptime cannot tell apart from a
 *     dead one on the Proxmox VE native push. Its live siblings stop
 *     reporting it as down and its Node Offline alert resolves. A node
 *     that is still up is refused: it would come back on its next
 *     report. Needs permission to EDIT the cluster, since users have
 *     no write access to the inventory table itself.
 *
 * The standard CRUD endpoints (list / get) are still registered by
 * BaseAPI; the UI uses them via ModelAPI for list/detail reads.
 * Write endpoints reject (@TableAccessControl create/update/delete
 * = []); ingest writes go through ProxmoxResourceService as root.
 * ------------------------------------------------------------------
 */
export default class ProxmoxResourceAPI extends BaseAPI<
  ProxmoxResource,
  ProxmoxResourceServiceType
> {
  public constructor() {
    super(ProxmoxResource, ProxmoxResourceService);

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

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/remove-node/:clusterId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.removeNode(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  private readClusterIdParam(req: ExpressRequest): ObjectID {
    const clusterIdParam: string | undefined = req.params["clusterId"];
    if (!clusterIdParam) {
      throw new BadDataException("Cluster ID is required");
    }

    try {
      return new ObjectID(clusterIdParam);
    } catch {
      throw new BadDataException("Invalid Cluster ID");
    }
  }

  /*
   * Cluster + auth resolution for the cluster-scoped sub-route.
   * Returns the (projectId, proxmoxClusterId) tuple after enforcing
   * the standard ACL chain. Throws NotFound when the cluster is
   * missing or the caller lacks read access (indistinguishable on
   * purpose).
   */
  private async resolveClusterForRequest(req: ExpressRequest): Promise<{
    projectId: ObjectID;
    proxmoxClusterId: ObjectID;
  }> {
    const proxmoxClusterId: ObjectID = this.readClusterIdParam(req);

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const cluster: ProxmoxCluster | null =
      await ProxmoxClusterService.findOneById({
        id: proxmoxClusterId,
        select: {
          _id: true,
          projectId: true,
        },
        props,
      });

    if (!cluster || !cluster.projectId) {
      throw new NotFoundException("Proxmox Cluster not found");
    }

    return {
      projectId: cluster.projectId,
      proxmoxClusterId,
    };
  }

  private async getInventorySummary(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { projectId, proxmoxClusterId } =
      await this.resolveClusterForRequest(req);

    const summary: ProxmoxInventorySummary =
      await this.service.getInventorySummary({
        projectId,
        proxmoxClusterId,
      });

    const responseBody: JSONObject = {
      countsByKind: summary.countsByKind as unknown as JSONObject,
      // Convenience fields so the UI doesn't have to repeat COALESCE:
      nodeCount: summary.countsByKind["Node"] || 0,
      guestCount: summary.countsByKind["Guest"] || 0,
      storageCount: summary.countsByKind["Storage"] || 0,
      nodeOnlineCount: summary.nodeOnlineCount,
      guestRunningCount: summary.guestRunningCount,
    };

    return Response.sendJsonObjectResponse(req, res, responseBody);
  }

  /*
   * The cluster a caller removes a node from, read only if the caller
   * may EDIT it, decided the way the cluster's own update endpoint
   * decides it:
   *
   *   1. the update permission check scopes the lookup the way an update
   *      of that row would be scoped (project, label- and Owned-scoped
   *      grants), and the row is then read as root;
   *   2. the per-row check the update endpoint runs before writing
   *      (updateOneById) enforces the team block list, which the query
   *      check does not.
   *
   * The project is the caller's own (props.tenantId), the only project
   * the caller was checked in. A missing cluster, a cluster in another
   * project and a cluster the caller may not edit all get the same
   * NotFound.
   */
  private async resolveEditableClusterForRequest(
    req: ExpressRequest,
    proxmoxClusterId: ObjectID,
  ): Promise<{
    projectId: ObjectID;
    proxmoxClusterId: ObjectID;
  }> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const projectId: ObjectID | undefined = props.tenantId;
    if (!projectId) {
      throw new NotFoundException(EDITABLE_CLUSTER_NOT_FOUND_MESSAGE);
    }

    let cluster: ProxmoxCluster | null = null;
    try {
      const editableQuery: Query<ProxmoxCluster> =
        await ModelPermission.checkUpdateQueryPermissions(
          ProxmoxCluster,
          {
            _id: proxmoxClusterId.toString(),
            projectId: projectId,
          },
          {},
          props,
        );

      cluster = await ProxmoxClusterService.findOneBy({
        query: editableQuery,
        select: {
          _id: true,
          projectId: true,
          labels: {
            _id: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

      if (cluster) {
        const editableCluster: ProxmoxCluster = cluster;
        await ModelPermission.checkUpdatePermissionByModel({
          modelType: ProxmoxCluster,
          fetchModelWithAccessControlIds:
            async (): Promise<ProxmoxCluster | null> => {
              return editableCluster;
            },
          props,
        });
      }
    } catch (err) {
      if (err instanceof NotAuthorizedException) {
        throw new NotFoundException(EDITABLE_CLUSTER_NOT_FOUND_MESSAGE);
      }
      throw err;
    }

    if (!cluster || !cluster.projectId) {
      throw new NotFoundException(EDITABLE_CLUSTER_NOT_FOUND_MESSAGE);
    }

    return {
      projectId: cluster.projectId,
      proxmoxClusterId,
    };
  }

  /*
   * The node name from the body: a non-empty string, trimmed, and a
   * single name. The externalId is "node/<name>", so a "/" would point
   * at something other than a node.
   */
  private readNodeName(req: ExpressRequest): string {
    const body: JSONObject =
      req.body && typeof req.body === "object" ? (req.body as JSONObject) : {};
    const rawNodeName: unknown = body["nodeName"];

    if (typeof rawNodeName !== "string" || !rawNodeName.trim()) {
      throw new BadDataException("Node name is required");
    }

    const nodeName: string = rawNodeName.trim();

    if (nodeName.includes("/")) {
      throw new BadDataException("Node name must not contain a slash");
    }

    return nodeName;
  }

  private async removeNode(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const requestedClusterId: ObjectID = this.readClusterIdParam(req);

    // ObjectID accepts any string; this id goes into a Postgres uuid column.
    if (!ObjectID.isValidUUID(requestedClusterId.toString())) {
      throw new BadDataException("Invalid Cluster ID");
    }

    const nodeName: string = this.readNodeName(req);

    const { projectId, proxmoxClusterId } =
      await this.resolveEditableClusterForRequest(req, requestedClusterId);

    const removed: boolean = await this.service.removeOfflineNode({
      projectId,
      proxmoxClusterId,
      externalId: `${NODE_EXTERNAL_ID_PREFIX}${nodeName}`,
    });

    /*
     * False for a node that is still up and for one that is not in the
     * inventory at all; both get the same answer.
     */
    if (!removed) {
      throw new BadDataException(NODE_STILL_REPORTING_MESSAGE);
    }

    return Response.sendJsonObjectResponse(req, res, { removed: true });
  }
}
