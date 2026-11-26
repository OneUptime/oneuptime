import CloudCostGroup from "../../Models/DatabaseModels/CloudCostGroup";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  CloudCostAllocationGroupResult,
  CloudCostAllocationResult,
} from "../../Types/Cloud/CloudCostAllocation";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import UserMiddleware from "../Middleware/UserAuthorization";
import CloudCostGroupService, {
  Service as CloudCostGroupServiceType,
} from "../Services/CloudCostGroupService";
import CloudCostAllocation from "../Utils/CloudCost/CloudCostAllocation";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";
import { readAllocationBody } from "./CloudCostViewAPI";

/*
 * Cost groups: the CRUD routes, and
 *
 *   POST /cloud-cost-group/:groupId/spend
 *     { startDate, endDate, interval?, currency?, compareWithPrevious? }
 *     One group's spend in a window: what its rules matched, its line
 *     items, its share of the shared groups, bucket by bucket, against the
 *     window before, and the services, resources and accounts it is charged
 *     for most (CloudCostAllocation.readGroup). A group's own page reads
 *     it, and so can a script, the CLI or an AI agent, as the caller may
 *     read the group and the costs.
 */
export default class CloudCostGroupAPI extends BaseAPI<
  CloudCostGroup,
  CloudCostGroupServiceType
> {
  public constructor() {
    super(CloudCostGroup, CloudCostGroupService);

    const path: string = new this.entityType().getCrudApiPath()!.toString();

    this.router.post(
      `${path}/:groupId/spend`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.readSpend(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  private async readSpend(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);
    const projectId: ObjectID = props.isMasterAdmin
      ? CommonAPI.assertTenantScoped(props)
      : CommonAPI.assertAuthenticatedProjectPrincipal(props);
    const groupId: string = String(req.params["groupId"] || "");

    if (!ObjectID.isValidUUID(groupId)) {
      throw new BadDataException("The cost group's ID is not valid.");
    }

    const body: ReturnType<typeof readAllocationBody> = readAllocationBody(
      req.body,
    );
    const read: {
      allocation: CloudCostAllocationResult;
      group: CloudCostAllocationGroupResult;
    } = await CloudCostAllocation.readGroup({
      projectId,
      groupId: new ObjectID(groupId),
      startDate: body.startDate,
      endDate: body.endDate,
      interval: body.interval,
      currency: body.currency,
      compareWithPrevious: body.compareWithPrevious,
      props,
    });

    /*
     * The group's own figures, with the window's and the currency's: what
     * the page draws. Not the view's other groups: a team member opening
     * their group's page sees only its spend.
     */
    return Response.sendJsonObjectResponse(req, res, {
      viewId: read.allocation.viewId,
      viewName: read.allocation.viewName,
      currency: read.allocation.currency,
      interval: read.allocation.interval,
      start: read.allocation.start,
      lastDay: read.allocation.lastDay,
      previousStart: read.allocation.previousStart || null,
      previousLastDay: read.allocation.previousLastDay || null,
      buckets: read.allocation.buckets,
      readAt: read.allocation.readAt,
      group: read.group,
    } as unknown as JSONObject);
  }
}
