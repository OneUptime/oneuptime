import BadDataException from "Common/Types/Exception/BadDataException";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission, {
  PermissionHelper,
  UserPermission,
} from "Common/Types/Permission";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "Common/Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import CommonAPI from "Common/Server/API/CommonAPI";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceLabelRule from "Common/Models/DatabaseModels/NetworkDeviceLabelRule";
import NetworkSiteAssignmentRule from "Common/Models/DatabaseModels/NetworkSiteAssignmentRule";
import NetworkDeviceLabelRuleEngineService from "Common/Server/Services/NetworkDeviceLabelRuleEngineService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import {
  LabelRuleRunResult,
  SiteAssignmentRuleRunResult,
} from "Common/Types/NetworkAutomation/RuleRunResult";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";

/*
 * ------------------------------------------------------------------
 * NetworkRuleRunAPI
 *
 * "Run now" for the two Network Automation rule kinds:
 *
 *   POST /network-site-assignment-rule/:ruleId/run
 *   POST /network-device-label-rule/:ruleId/run
 *
 * Both rule kinds only ever fire on device create (and, for site
 * assignment, on an identity change or the next poll of a device with
 * no site). A rule written after an estate was imported therefore never
 * reaches any of it, and short of deleting and rediscovering every
 * device there was no way to close that gap — OneUptime/oneuptime#3191.
 * These two endpoints apply one rule to the devices that already exist.
 *
 * Both mutate network devices, so both demand the permission to update
 * the rule AND the permission to update a network device. The required
 * sets are read off the models' own @TableAccessControl rather than
 * restated here, so an ACL edit on either model cannot drift from what
 * these endpoints enforce.
 * ------------------------------------------------------------------
 */

/*
 * The permissions a caller must hold to run a rule of this kind: the rule
 * model's update ACL, intersected with nothing — both it and NetworkDevice's
 * update ACL have to be satisfied, checked separately below.
 */
function getUpdatePermissions(model: DatabaseBaseModel): Array<Permission> {
  return model.getUpdatePermissions() || [];
}

function callerPermissions(
  props: DatabaseCommonInteractionProps,
): Array<Permission> {
  /*
   * Read through getUserPermissions(Allow) rather than off
   * userTenantAccessPermission directly: those entries hold grants AND
   * denials together, discriminated only by isBlockPermission, so mapping
   * them raw would count a team's explicit block as a grant.
   */
  return DatabaseCommonInteractionPropsUtil.getUserPermissions(
    props,
    PermissionType.Allow,
  ).map((userPermission: UserPermission) => {
    return userPermission.permission;
  });
}

function assertCanRunRule(data: {
  props: DatabaseCommonInteractionProps;
  ruleModel: DatabaseBaseModel;
  ruleLabel: string;
}): void {
  if (data.props.isMasterAdmin) {
    return;
  }

  const held: Array<Permission> = callerPermissions(data.props);

  const holdsAnyOf: (required: Array<Permission>) => boolean = (
    required: Array<Permission>,
  ): boolean => {
    return held.some((permission: Permission) => {
      return required.includes(permission);
    });
  };

  if (!holdsAnyOf(getUpdatePermissions(data.ruleModel))) {
    throw new NotAuthorizedException(
      `You do not have permission to run ${data.ruleLabel}.`,
    );
  }

  /*
   * Running a rule writes to devices. Without this a role allowed to author
   * rules but not to touch the inventory could edit it wholesale through a
   * rule, which is exactly the permission it does not have.
   */
  if (!holdsAnyOf(getUpdatePermissions(new NetworkDevice()))) {
    throw new NotAuthorizedException(
      `You do not have permission to update network devices, which running ${data.ruleLabel} does. Missing permission: ${PermissionHelper.getTitle(
        Permission.EditNetworkDevice,
      )}.`,
    );
  }
}

/*
 * ":ruleId" as an ObjectID, or a message the caller can act on. The format
 * check is explicit: ObjectID's constructor takes any string, so an id that
 * is not a UUID would otherwise reach the query layer and come back as a
 * Postgres syntax error instead of a bad request.
 */
function readRuleId(req: ExpressRequest): ObjectID {
  const ruleIdParam: string | undefined = req.params["ruleId"];

  if (!ruleIdParam) {
    throw new BadDataException("Rule ID is required.");
  }

  if (!ObjectID.isValidUUID(ruleIdParam)) {
    throw new BadDataException("Invalid Rule ID.");
  }

  return new ObjectID(ruleIdParam);
}

/*
 * A body flag, read strictly: only a literal `true` turns on the destructive
 * half of a site assignment run, so a "true" string or a stray 1 cannot move
 * devices somebody placed by hand.
 */
function readBooleanFlag(body: JSONObject, key: string): boolean {
  return body[key] === true;
}

export default class NetworkRuleRunAPI {
  public getRouter(): ExpressRouter {
    const router: ExpressRouter = Express.getRouter();

    router.post(
      "/network-site-assignment-rule/:ruleId/run",
      UserMiddleware.getUserMiddleware,
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const projectId: ObjectID = CommonAPI.assertTenantScoped(props);

          assertCanRunRule({
            props: props,
            ruleModel: new NetworkSiteAssignmentRule(),
            ruleLabel: "site assignment rules",
          });

          const body: JSONObject = (req.body || {}) as JSONObject;

          const result: SiteAssignmentRuleRunResult =
            await NetworkDeviceService.applySiteAssignmentRuleToExistingDevices(
              {
                ruleId: readRuleId(req),
                projectId: projectId,
                reassignDevicesAlreadyInASite: readBooleanFlag(
                  body,
                  "reassignDevicesAlreadyInASite",
                ),
              },
            );

          return Response.sendJsonObjectResponse(
            req,
            res,
            result as unknown as JSONObject,
          );
        } catch (err) {
          return next(err);
        }
      },
    );

    router.post(
      "/network-device-label-rule/:ruleId/run",
      UserMiddleware.getUserMiddleware,
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const projectId: ObjectID = CommonAPI.assertTenantScoped(props);

          assertCanRunRule({
            props: props,
            ruleModel: new NetworkDeviceLabelRule(),
            ruleLabel: "network device label rules",
          });

          const result: LabelRuleRunResult =
            await NetworkDeviceLabelRuleEngineService.applyRuleToExistingNetworkDevices(
              {
                ruleId: readRuleId(req),
                projectId: projectId,
              },
            );

          return Response.sendJsonObjectResponse(
            req,
            res,
            result as unknown as JSONObject,
          );
        } catch (err) {
          return next(err);
        }
      },
    );

    return router;
  }
}
