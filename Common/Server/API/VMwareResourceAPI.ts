import VMwareResource from "../../Models/DatabaseModels/VMwareResource";
import VMwareVCenter from "../../Models/DatabaseModels/VMwareVCenter";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import VMwareResourceService, {
  VMwareInventorySummary,
  Service as VMwareResourceServiceType,
} from "../Services/VMwareResourceService";
import VMwareVCenterService from "../Services/VMwareVCenterService";
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
 * VMwareResourceAPI
 *
 * Augments the auto-generated CRUD router with a single custom
 * endpoint the VMware layout/overview pages use to fetch sidebar
 * badge counts (hosts, virtual machines, datastores, clusters,
 * resource pools) in one round-trip:
 *
 *   POST /vmware-resource/inventory-summary/:vcenterId
 *
 * The standard CRUD endpoints (list / get) are still registered by
 * BaseAPI; the UI uses them via ModelAPI for list/detail reads.
 * Write endpoints reject (@TableAccessControl create/update/delete
 * = []); ingest writes go through VMwareResourceService as root.
 * ------------------------------------------------------------------
 */
export default class VMwareResourceAPI extends BaseAPI<
  VMwareResource,
  VMwareResourceServiceType
> {
  public constructor() {
    super(VMwareResource, VMwareResourceService);

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/inventory-summary/:vcenterId`,
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
   * vCenter + auth resolution for the vCenter-scoped sub-route.
   * Returns the (projectId, vmwareVCenterId) tuple after enforcing
   * the standard ACL chain (the VMwareVCenter model's read
   * permissions, Permission.ReadVMwareVCenter et al.). Throws
   * NotFound when the vCenter is missing or the caller lacks read
   * access (indistinguishable on purpose, so an unauthorised caller
   * cannot probe which vCenter ids exist).
   */
  private async resolveVCenterForRequest(req: ExpressRequest): Promise<{
    projectId: ObjectID;
    vmwareVCenterId: ObjectID;
  }> {
    const vcenterIdParam: string | undefined = req.params["vcenterId"];
    if (!vcenterIdParam) {
      throw new BadDataException("vCenter ID is required");
    }

    let vmwareVCenterId: ObjectID;
    try {
      vmwareVCenterId = new ObjectID(vcenterIdParam);
    } catch {
      throw new BadDataException("Invalid vCenter ID");
    }

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const vcenter: VMwareVCenter | null =
      await VMwareVCenterService.findOneById({
        id: vmwareVCenterId,
        select: {
          _id: true,
          projectId: true,
        },
        props,
      });

    if (!vcenter || !vcenter.projectId) {
      throw new NotFoundException("vCenter not found");
    }

    return {
      projectId: vcenter.projectId,
      vmwareVCenterId,
    };
  }

  private async getInventorySummary(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { projectId, vmwareVCenterId } =
      await this.resolveVCenterForRequest(req);

    const summary: VMwareInventorySummary =
      await this.service.getInventorySummary({
        projectId,
        vmwareVCenterId,
      });

    const responseBody: JSONObject = {
      countsByKind: summary.countsByKind as unknown as JSONObject,
      /*
       * Convenience fields so the UI doesn't have to repeat COALESCE.
       * The kind strings are the PascalCase values ingest writes to
       * VMwareResource.kind (VMwareResourceKind).
       */
      datacenterCount: summary.datacenterCount,
      clusterCount: summary.clusterCount,
      hostCount: summary.hostCount,
      // Non-template VM rows — matches VMwareVCenter.vmCount.
      virtualMachineCount: summary.virtualMachineCount,
      poweredOnVirtualMachineCount: summary.poweredOnVirtualMachineCount,
      virtualMachineTemplateCount: summary.virtualMachineTemplateCount,
      datastoreCount: summary.datastoreCount,
      resourcePoolCount: summary.resourcePoolCount,
    };

    return Response.sendJsonObjectResponse(req, res, responseBody);
  }
}
