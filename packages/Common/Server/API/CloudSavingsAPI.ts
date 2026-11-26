import CloudSavingsAction from "../../Models/DatabaseModels/CloudSavingsAction";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { CLOUD_SAVINGS_API_ROUTES } from "../../Types/Cloud/CloudSavingsApiTypes";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import ProductKey from "../../Types/Product/ProductKey";
import UserMiddleware from "../Middleware/UserAuthorization";
import CloudSavingsActionService, {
  Service as CloudSavingsActionServiceType,
} from "../Services/CloudSavingsActionService";
import CloudOffHoursScheduler from "../Utils/CloudSavings/CloudOffHoursScheduler";
import CloudSavingsActions from "../Utils/CloudSavings/CloudSavingsActions";
import CloudSavingsCodeFix from "../Utils/CloudSavings/CloudSavingsCodeFix";
import { CLOUD_SAVINGS_REQUEST_PERMISSIONS } from "../Utils/CloudSavings/CloudSavingsOwners";
import CloudSavingsSummaryReader from "../Utils/CloudSavings/CloudSavingsSummaryReader";
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
 * ACTING ON SAVINGS FROM ONEUPTIME (#11010): the routes behind the
 * Savings page's Apply, its approval cards and its strip, and an off-hours
 * schedule's preview - beside the read API of the changes themselves
 * (CloudSavingsAction, written only by these routes and the workers).
 *
 *   POST /cloud-savings/offer               what Apply would do
 *   POST /cloud-savings/apply               ask for it (made at once by an approver)
 *   POST /cloud-savings/action/:id/approve  an owner's approval
 *   POST /cloud-savings/action/:id/dismiss  a no, with a reason
 *   POST /cloud-savings/action/:id/undo     take it back
 *   POST /cloud-savings/fix-in-code         a pull request instead
 *   POST /cloud-savings/summary             saved this month, and what waits
 *   POST /cloud-savings/schedule/:id/preview  what a schedule picks now
 *
 * A route lets in whoever may read the project's savings, or ask for one;
 * who may approve, dismiss or undo a change - an owner of its resource -
 * is the util's to decide (CloudSavingsActions), from the change itself.
 * Every route that changes something is refused while the server has
 * Cloud switched off, and the pull request while Code is.
 */

// Who reads the project's savings: who reads its cloud resources.
const READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
  Permission.ReadCloudResource,
];

const REQUEST_PERMISSIONS: Array<Permission> = [
  ...CLOUD_SAVINGS_REQUEST_PERMISSIONS,
];

// An id from a body or a path, or why not.
export function readCloudSavingsId(value: unknown, what: string): ObjectID {
  if (typeof value !== "string" || !ObjectID.isValidUUID(value)) {
    throw new BadDataException(`Name the ${what} as its id.`);
  }

  return new ObjectID(value);
}

export default class CloudSavingsAPI extends BaseAPI<
  CloudSavingsAction,
  CloudSavingsActionServiceType
> {
  public constructor() {
    super(CloudSavingsAction, CloudSavingsActionService);

    this.post(
      CLOUD_SAVINGS_API_ROUTES.offer,
      READ_PERMISSIONS,
      async (
        projectId: ObjectID,
        req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ): Promise<JSONObject> => {
        const body: JSONObject = (req.body || {}) as JSONObject;

        return (await CloudSavingsActions.offer({
          props,
          projectId,
          cloudCostRecommendationId: readCloudSavingsId(
            body["cloudCostRecommendationId"],
            "saving",
          ),
        })) as unknown as JSONObject;
      },
    );

    this.post(
      CLOUD_SAVINGS_API_ROUTES.apply,
      REQUEST_PERMISSIONS,
      async (
        projectId: ObjectID,
        req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ): Promise<JSONObject> => {
        const body: JSONObject = (req.body || {}) as JSONObject;

        return (await CloudSavingsActions.apply({
          props,
          projectId,
          cloudCostRecommendationId: readCloudSavingsId(
            body["cloudCostRecommendationId"],
            "saving",
          ),
          finalSnapshot: body["finalSnapshot"],
        })) as unknown as JSONObject;
      },
    );

    this.post(
      CLOUD_SAVINGS_API_ROUTES.approve(":id"),
      READ_PERMISSIONS,
      async (
        projectId: ObjectID,
        req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ): Promise<JSONObject> => {
        return (await CloudSavingsActions.approve({
          props,
          projectId,
          actionId: readCloudSavingsId(req.params["id"], "change"),
        })) as unknown as JSONObject;
      },
      { changes: true },
    );

    this.post(
      CLOUD_SAVINGS_API_ROUTES.dismiss(":id"),
      READ_PERMISSIONS,
      async (
        projectId: ObjectID,
        req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ): Promise<JSONObject> => {
        const body: JSONObject = (req.body || {}) as JSONObject;

        return (await CloudSavingsActions.dismiss({
          props,
          projectId,
          actionId: readCloudSavingsId(req.params["id"], "change"),
          reason: body["reason"],
        })) as unknown as JSONObject;
      },
      { changes: true },
    );

    this.post(
      CLOUD_SAVINGS_API_ROUTES.undo(":id"),
      READ_PERMISSIONS,
      async (
        projectId: ObjectID,
        req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ): Promise<JSONObject> => {
        return (await CloudSavingsActions.undo({
          props,
          projectId,
          actionId: readCloudSavingsId(req.params["id"], "change"),
        })) as unknown as JSONObject;
      },
      { changes: true },
    );

    this.post(
      CLOUD_SAVINGS_API_ROUTES.fixInCode,
      REQUEST_PERMISSIONS,
      async (
        projectId: ObjectID,
        req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ): Promise<JSONObject> => {
        const body: JSONObject = (req.body || {}) as JSONObject;

        return (await CloudSavingsCodeFix.start({
          props,
          projectId,
          cloudCostRecommendationId: readCloudSavingsId(
            body["cloudCostRecommendationId"],
            "saving",
          ),
          codeRepositoryId: body["codeRepositoryId"],
        })) as unknown as JSONObject;
      },
      { startsCodeWork: true },
    );

    this.post(
      CLOUD_SAVINGS_API_ROUTES.summary,
      READ_PERMISSIONS,
      async (
        projectId: ObjectID,
        _req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ): Promise<JSONObject> => {
        return (await CloudSavingsSummaryReader.read({
          props,
          projectId,
          now: OneUptimeDate.getCurrentDate(),
        })) as unknown as JSONObject;
      },
    );

    this.post(
      CLOUD_SAVINGS_API_ROUTES.schedulePreview(":id"),
      READ_PERMISSIONS,
      async (projectId: ObjectID, req: ExpressRequest): Promise<JSONObject> => {
        return (await CloudOffHoursScheduler.preview({
          projectId,
          scheduleId: readCloudSavingsId(req.params["id"], "schedule"),
          now: OneUptimeDate.getCurrentDate(),
        })) as unknown as JSONObject;
      },
    );
  }

  private post(
    route: string,
    permissions: Array<Permission>,
    handler: (
      projectId: ObjectID,
      req: ExpressRequest,
      props: DatabaseCommonInteractionProps,
    ) => Promise<JSONObject>,
    options: {
      // Changes a customer's cloud, whatever its route lets in.
      changes?: boolean | undefined;
      // Starts a task in Code: asks OneUptime AI for a code change.
      startsCodeWork?: boolean | undefined;
    } = {},
  ): void {
    this.router.post(
      route,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      // A change - every route but the reads - is refused while Cloud is off.
      ...(permissions === READ_PERMISSIONS && !options.changes
        ? []
        : [ServerProductRoutes.refuseWhileOff(ProductKey.Cloud)]),
      ...(options.startsCodeWork
        ? [ServerProductRoutes.refuseWhileOff(ProductKey.Code)]
        : []),
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);
          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(props);

          CommonAPI.assertPermittedInProject({
            databaseProps: props,
            allowedPermissions: permissions,
            errorMessage:
              "You do not have permission to act on this project's cloud savings.",
          });

          const answer: JSONObject = await handler(projectId, req, props);

          return Response.sendJsonObjectResponse(req, res, answer);
        } catch (error) {
          next(error);
        }
      },
    );
  }
}
