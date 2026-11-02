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
