import CloudCostGroup from "../../Models/DatabaseModels/CloudCostGroup";
import CloudCostView from "../../Models/DatabaseModels/CloudCostView";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  CloudCostAllocationInterval,
  CloudCostAllocationResult,
} from "../../Types/Cloud/CloudCostAllocation";
import {
  CloudCostBasis,
  isCloudCostBasis,
} from "../../Types/Cloud/CloudCostBasis";
import BadDataException from "../../Types/Exception/BadDataException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import ProductKey from "../../Types/Product/ProductKey";
import UserMiddleware from "../Middleware/UserAuthorization";
import CloudCostViewService, {
  Service as CloudCostViewServiceType,
} from "../Services/CloudCostViewService";
import CloudCostAllocation from "../Utils/CloudCost/CloudCostAllocation";
import CloudCostViewSync from "../Utils/CloudCost/CloudCostViewSync";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import ServerProductRoutes from "../Utils/ServerProducts/ServerProductRoutes";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";

/*
 * Cost views: the CRUD routes, and
 *
 *   POST /cloud-cost-view/:viewId/allocation
 *     { startDate, endDate, interval?, currency?, basis?, cloudAccountIds?,
 *       cloudCostGroupId?, compareWithPrevious? }
 *     What the view allocates in a window of whole UTC days, both ends
 *     included: each group's spend (its own, its line items, what it took
 *     of the shared groups and what it gave away), bucket by bucket, the
 *     unallocated spend and what it is made of, and the window before
 *     (CloudCostAllocation), on a cost basis - billed, amortized or net,
 *     the project's when none is sent (#11007). Read as the caller may read the view, its
 *     groups and the costs - a project API key included, so finance can
 *     pull the month's chargeback from a script, the CLI or an AI agent.
 *
 *   POST /cloud-cost-view/:viewId/make-groups
 *     For a view made per tag value or owner team: makes the groups it is
 *     missing now, rather than at the hourly job (CloudCostViewSync). It
 *     writes them as the server, so it is refused while the server has
 *     switched Cloud off (ServerProductRoutes), before anything is read;
 *     the allocation only reads, and is left alone.
 */

// An allocation's request body, read: refused with what to fix.
export function readAllocationBody(body: unknown): {
  startDate: Date;
  endDate: Date;
  interval?: CloudCostAllocationInterval | undefined;
  currency?: string | undefined;
  basis?: CloudCostBasis | undefined;
  cloudAccountIds?: Array<ObjectID> | undefined;
  groupId?: ObjectID | undefined;
  compareWithPrevious?: boolean | undefined;
} {
  const data: JSONObject =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as JSONObject)
      : {};

  const readDate: (key: string) => Date = (key: string): Date => {
    const value: unknown = data[key];
    const date: Date =
      typeof value === "string" || typeof value === "number"
        ? new Date(value)
        : value && typeof value === "object" && "value" in value
          ? new Date(String((value as JSONObject)["value"]))
          : new Date(Number.NaN);

    if (!Number.isFinite(date.getTime())) {
      throw new BadDataException(`Send ${key} as a date, such as 2026-11-01.`);
    }

    return date;
  };

  const interval: unknown = data["interval"];

  if (
    interval !== undefined &&
    interval !== null &&
    !(Object.values(CloudCostAllocationInterval) as Array<unknown>).includes(
      interval,
    )
  ) {
    throw new BadDataException("Send interval as day or month.");
  }

  const basis: unknown = data["basis"];

  if (
    basis !== undefined &&
    basis !== null &&
    basis !== "" &&
    !isCloudCostBasis(basis)
  ) {
    throw new BadDataException("Send basis as billed, amortized or net.");
  }

  const readId: (value: unknown, name: string) => ObjectID = (
    value: unknown,
    name: string,
  ): ObjectID => {
    const text: string =
      value && typeof value === "object" && "_id" in value
        ? String((value as JSONObject)["_id"])
        : String(value || "");

    if (!ObjectID.isValidUUID(text)) {
      throw new BadDataException(`Send ${name} as an ID.`);
    }

    return new ObjectID(text);
  };

  const accounts: unknown = data["cloudAccountIds"];

  if (accounts !== undefined && accounts !== null && !Array.isArray(accounts)) {
    throw new BadDataException("Send cloudAccountIds as a list of IDs.");
  }

  const groupId: unknown = data["cloudCostGroupId"] ?? data["groupId"];

  return {
    startDate: readDate("startDate"),
    endDate: readDate("endDate"),
    interval: (interval as CloudCostAllocationInterval | null) || undefined,
    currency:
      typeof data["currency"] === "string" && data["currency"].trim()
        ? data["currency"].trim()
        : undefined,
    basis: isCloudCostBasis(basis) ? basis : undefined,
    cloudAccountIds: Array.isArray(accounts)
      ? accounts.map((id: unknown): ObjectID => {
          return readId(id, "each of cloudAccountIds");
        })
      : undefined,
    groupId:
      groupId === undefined || groupId === null || groupId === ""
        ? undefined
        : readId(groupId, "cloudCostGroupId"),
    compareWithPrevious:
      typeof data["compareWithPrevious"] === "boolean"
        ? data["compareWithPrevious"]
        : undefined,
  };
}

export default class CloudCostViewAPI extends BaseAPI<
  CloudCostView,
  CloudCostViewServiceType
> {
  public constructor() {
    super(CloudCostView, CloudCostViewService);

    const path: string = new this.entityType().getCrudApiPath()!.toString();

    this.router.post(
      `${path}/:viewId/allocation`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.readAllocation(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${path}/:viewId/make-groups`,
      UserMiddleware.getUserMiddleware,
      ServerProductRoutes.refuseWhileOff(ProductKey.Cloud),
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.makeGroups(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  private readViewId(req: ExpressRequest): ObjectID {
    const id: string = String(req.params["viewId"] || "");

    if (!ObjectID.isValidUUID(id)) {
      throw new BadDataException("The cost view's ID is not valid.");
    }

    return new ObjectID(id);
  }

  private async readAllocation(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);
    const projectId: ObjectID = props.isMasterAdmin
      ? CommonAPI.assertTenantScoped(props)
      : CommonAPI.assertAuthenticatedProjectPrincipal(props);
    const body: ReturnType<typeof readAllocationBody> = readAllocationBody(
      req.body,
    );

    const allocation: CloudCostAllocationResult =
      await CloudCostAllocation.read({
        projectId,
        viewId: this.readViewId(req),
        startDate: body.startDate,
        endDate: body.endDate,
        interval: body.interval,
        currency: body.currency,
        basis: body.basis,
        cloudAccountIds: body.cloudAccountIds,
        groupId: body.groupId,
        compareWithPrevious: body.compareWithPrevious,
        props,
      });

    return Response.sendJsonObjectResponse(
      req,
      res,
      allocation as unknown as JSONObject,
    );
  }

  private async makeGroups(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);
    const projectId: ObjectID = props.isMasterAdmin
      ? CommonAPI.assertTenantScoped(props)
      : CommonAPI.assertAuthenticatedProjectPrincipal(props);

    // Making groups writes them: only for whoever may create groups.
    CommonAPI.assertCanCreateTable({
      modelType: CloudCostGroup,
      props,
      errorMessage:
        "You need a role that may create cloud resources to make a view's groups.",
    });

    const viewId: ObjectID = this.readViewId(req);
    const view: CloudCostView | null = await CloudCostViewService.findOneBy({
      query: { _id: viewId, projectId },
      select: { _id: true },
      props,
    });

    if (!view?.id) {
      throw new NotFoundException(
        "This cost view was not found. It may have been deleted, or you may not have access to it.",
      );
    }

    const made: number = await CloudCostViewSync.makeGroupsForView(view.id);

    return Response.sendJsonObjectResponse(req, res, { made });
  }
}
