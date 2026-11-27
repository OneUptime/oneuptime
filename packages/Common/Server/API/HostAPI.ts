import Host from "../../Models/DatabaseModels/Host";
import BadDataException from "../../Types/Exception/BadDataException";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../Types/JSON";
import HostService, {
  HostsThatMayNeedAttention,
  Service as HostServiceType,
} from "../Services/HostService";
import UserMiddleware from "../Middleware/UserAuthorization";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";
import ObjectID from "../../Types/ObjectID";
import QueryDeepPartialEntity from "../../Types/Database/PartialEntity";
import DatabaseRequestType from "../Types/BaseDatabase/DatabaseRequestType";
import ServerSetColumns from "../Utils/Database/ServerSetColumns";
import { TRY_COLLECTOR_CONFIG_AGAIN_ROUTE } from "../../Types/HostCollector/HostCollectorRoutes";
import {
  CloudHostMachineJSON,
  CloudVmHostJSON,
  HOST_CLOUD_MACHINE_ROUTE,
  HOST_OF_CLOUD_RESOURCE_ROUTE,
} from "../../Types/Cloud/CloudHostLink";
import CloudHostLinks, {
  CloudLinkedHost,
  CloudLinkedVm,
} from "../Utils/CloudConnection/CloudHostLinks";
import ServerProductRoutes from "../Utils/ServerProducts/ServerProductRoutes";
import ProductKey from "../../Types/Product/ProductKey";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";

/*
 * ------------------------------------------------------------------
 * HostAPI
 *
 * The CRUD router every host model has, and one read the Hosts list
 * makes:
 *
 *   POST /host/needs-attention
 *     The project's hosts that may need attention - not reporting, a
 *     filesystem or memory nearly full, swap in use, load above their
 *     cores, failed systemd units, a collector config that did not start
 *     - for the list's Needs attention card
 *     (HostService.findHostsThatMayNeedAttention). The Dashboard says
 *     which of them do, and why, by HostHealth's rules.
 *
 * It reads as the caller: their project (the tenant header), their
 * permission to read hosts and their label access, as a list of hosts
 * would. Like the list it reads no more than a few hundred hosts per
 * condition, and says when there were more.
 *
 *   POST /host/:id/cloud-machine
 *   POST /host/of-cloud-resource/:cloudResourceId
 *     The cloud VM a host is, and the host a cloud VM is (#11013): their
 *     provider, account, Region and instance ID all agree, and nothing
 *     else claims them (CloudHostLinks). Read as the caller, so neither
 *     page names a record its reader may not read.
 *
 *   POST /host/:id/try-collector-config-again
 *     Try again on a host's collector card: sends the host the config that
 *     failed on it again, by clearing the failed config's hash
 *     (Host.collectorFailedConfigHash). Only OneUptime writes that column,
 *     so an update through the API cannot clear it (#10053); this clears it
 *     as OneUptime's value (ServerSetColumns), asking the caller's
 *     permission to change the host as an edit of it would.
 * ------------------------------------------------------------------
 */
export default class HostAPI extends BaseAPI<Host, HostServiceType> {
  public constructor() {
    super(Host, HostService);

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/needs-attention`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getNeedsAttention(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * Which cloud VM a host is, and which host a cloud VM is (#11013): a
     * read each, as the caller, for the two pages that link to each other
     * (CloudHostLinks).
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/:id/${HOST_CLOUD_MACHINE_ROUTE}`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getCloudMachine(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/${HOST_OF_CLOUD_RESOURCE_ROUTE}/:cloudResourceId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getHostOfCloudResource(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * A change of a host: refused while Hosts is switched off on the
     * server, with who can switch it on, before anything is read
     * (ServerProductRoutes, ProductCustomRoutesGuard).
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/:id/${TRY_COLLECTOR_CONFIG_AGAIN_ROUTE}`,
      UserMiddleware.getUserMiddleware,
      ServerProductRoutes.refuseWhileOff(ProductKey.Hosts),
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.tryCollectorConfigAgain(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  private async tryCollectorConfigAgain(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    await this.assertProductIsOn();

    const idParam: string = req.params["id"] as string;
    ObjectID.validateUUID(idParam);
    const id: ObjectID = new ObjectID(idParam);

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const data: Record<string, unknown> = {};
    ServerSetColumns.set(data, { collectorFailedConfigHash: null });

    const updated: number = await this.service.updateOneById({
      id: id,
      data: data as QueryDeepPartialEntity<Host>,
      props: props,
    });

    // A host the caller may not read is answered as missing; one they may not change, refused.
    if (updated === 0) {
      throw await this.service.getUnwrittenByIdError({
        id: id,
        props: props,
        type: DatabaseRequestType.Update,
      });
    }

    return Response.sendEmptySuccessResponse(req, res);
  }

  // The cloud VM a host is, or null: as the caller may read both.
  private async getCloudMachine(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    if (!props.tenantId) {
      throw new BadDataException("Project ID is required");
    }

    const idParam: string = req.params["id"] as string;
    ObjectID.validateUUID(idParam);

    const machine: CloudLinkedVm | null = await CloudHostLinks.vmOfHost({
      projectId: props.tenantId,
      hostId: new ObjectID(idParam),
      props,
    });
    const json: CloudHostMachineJSON | null = machine
      ? {
          cloudResourceId: machine.id.toString(),
          name: machine.name,
          provider: machine.provider,
          type: machine.type,
          accountId: machine.accountId,
          region: machine.region,
          instanceId: machine.instanceId,
        }
      : null;

    return Response.sendJsonObjectResponse(req, res, {
      machine: json as unknown as JSONObject,
    });
  }

  // The host a cloud VM is, or null: as the caller may read both.
  private async getHostOfCloudResource(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    if (!props.tenantId) {
      throw new BadDataException("Project ID is required");
    }

    const idParam: string = req.params["cloudResourceId"] as string;
    ObjectID.validateUUID(idParam);

    const host: CloudLinkedHost | null = await CloudHostLinks.hostOfVm({
      projectId: props.tenantId,
      cloudResourceId: new ObjectID(idParam),
      props,
    });
    const json: CloudVmHostJSON | null = host
      ? {
          hostId: host.id.toString(),
          name: host.name,
          hostIdentifier: host.hostIdentifier,
        }
      : null;

    return Response.sendJsonObjectResponse(req, res, {
      host: json as unknown as JSONObject,
    });
  }

  private async getNeedsAttention(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    if (!props.tenantId) {
      throw new BadDataException("Project ID is required");
    }

    const found: HostsThatMayNeedAttention =
      await this.service.findHostsThatMayNeedAttention({
        projectId: props.tenantId,
        props: props,
      });

    const body: JSONObject = {
      hosts: Host.toJSONArray(found.hosts, Host),
      isTruncated: found.isTruncated,
    };

    return Response.sendJsonObjectResponse(req, res, body);
  }
}
