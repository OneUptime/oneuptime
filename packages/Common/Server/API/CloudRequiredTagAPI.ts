import CloudRequiredTag from "../../Models/DatabaseModels/CloudRequiredTag";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  CLOUD_TAG_COVERAGE_ROUTE,
  CloudTagCoverageJSON,
} from "../../Types/Cloud/CloudTagCoverage";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import UserMiddleware from "../Middleware/UserAuthorization";
import CloudRequiredTagService, {
  Service as CloudRequiredTagServiceType,
} from "../Services/CloudRequiredTagService";
import CloudTagCoverageReader from "../Utils/CloudConnection/CloudTagCoverageReader";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";

/*
 * ------------------------------------------------------------------
 * CloudRequiredTagAPI (#11012)
 *
 * The CRUD routes of required tags, and the one read Cloud > Tags and an
 * account's Tags make:
 *
 *   POST /cloud-required-tag/coverage  { cloudAccountId? }
 *     How much of the accounts' spend and resources carry their required
 *     tags, the trend of both, and the resources that lack one, the
 *     costliest first (CloudTagCoverageReader). Read as the caller: only
 *     the accounts they may read are counted, and only the resources they
 *     may read are named.
 * ------------------------------------------------------------------
 */
export default class CloudRequiredTagAPI extends BaseAPI<
  CloudRequiredTag,
  CloudRequiredTagServiceType
> {
  public constructor() {
    super(CloudRequiredTag, CloudRequiredTagService);

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/${CLOUD_TAG_COVERAGE_ROUTE}`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getCoverage(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  private async getCoverage(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    if (!props.tenantId) {
      throw new BadDataException("Project ID is required");
    }

    const body: JSONObject = (req.body || {}) as JSONObject;
    const accountParam: unknown = body["cloudAccountId"];
    let cloudAccountId: ObjectID | null = null;

    if (typeof accountParam === "string" && accountParam.trim()) {
      ObjectID.validateUUID(accountParam.trim());
      cloudAccountId = new ObjectID(accountParam.trim());
    }

    const coverage: CloudTagCoverageJSON = await CloudTagCoverageReader.read({
      projectId: props.tenantId,
      cloudAccountId,
      props,
      now: OneUptimeDate.getCurrentDate(),
    });

    return Response.sendJsonObjectResponse(
      req,
      res,
      coverage as unknown as JSONObject,
    );
  }
}
