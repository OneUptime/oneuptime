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
import TablePermission from "Common/Server/Types/Database/Permissions/TablePermission";
import DatabaseRequestType from "Common/Server/Types/BaseDatabase/DatabaseRequestType";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceAutoImportRule from "Common/Models/DatabaseModels/NetworkDeviceAutoImportRule";
import NetworkDeviceLabelRule from "Common/Models/DatabaseModels/NetworkDeviceLabelRule";
import NetworkSiteAssignmentRule from "Common/Models/DatabaseModels/NetworkSiteAssignmentRule";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorTemplate from "Common/Models/DatabaseModels/MonitorTemplate";
import MonitorTemplateService from "Common/Server/Services/MonitorTemplateService";
import NetworkDeviceAutoImportRuleEngineService from "Common/Server/Services/NetworkDeviceAutoImportRuleEngineService";
import NetworkDeviceAutoImportRuleService from "Common/Server/Services/NetworkDeviceAutoImportRuleService";
import NetworkDeviceLabelRuleEngineService from "Common/Server/Services/NetworkDeviceLabelRuleEngineService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import {
  AutoImportRuleRunResult,
  LabelRuleRunResult,
  SiteAssignmentRuleRunResult,
} from "Common/Types/NetworkAutomation/RuleRunResult";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";

/*
 * ------------------------------------------------------------------
 * NetworkRuleRunAPI
 *
 * "Run now" for the Network Automation rule kinds:
 *
 *   POST /network-site-assignment-rule/:ruleId/run
 *   POST /network-device-label-rule/:ruleId/run
 *   POST /network-device-auto-import-rule/:ruleId/run   (supports dryRun)
 *
 * Site and label rules only ever fire on device create (and, for site
 * assignment, on an identity change or the next poll of a device with
 * no site). A rule written after an estate was imported therefore never
 * reaches any of it, and short of deleting and rediscovering every
 * device there was no way to close that gap — OneUptime/oneuptime#3191.
 * These endpoints apply one rule to the devices that already exist.
 * Auto-import rules have the same gap in time instead of space: the
 * worker only processes NEW scan results, so their Run Now applies one
 * rule to the completed scans already sitting in the project — and its
 * dryRun flag is the answer to "what would this rule import" BEFORE
 * enabling it against live scans.
 *
 * All of these mutate network devices, so all demand the permission to
 * update the rule AND a matching NetworkDevice permission — update for
 * the rules that edit devices, CREATE for auto-import, which makes new
 * ones. The required sets are read off the models' own
 * @TableAccessControl rather than restated here, so an ACL edit on
 * either model cannot drift from what these endpoints enforce.
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
  /*
   * What running this rule does to the inventory: site/label rules EDIT
   * devices, auto-import rules CREATE them — and a role allowed to author
   * rules but lacking the matching device permission must not get it by
   * proxy through a rule run.
   */
  deviceWriteKind?: "update" | "create";
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
   * rules but not to touch the inventory could edit (or grow) it wholesale
   * through a rule, which is exactly the permission it does not have.
   */
  if (data.deviceWriteKind === "create") {
    if (!holdsAnyOf(new NetworkDevice().getCreatePermissions() || [])) {
      throw new NotAuthorizedException(
        `You do not have permission to create network devices, which running ${data.ruleLabel} does. Missing permission: ${PermissionHelper.getTitle(
          Permission.CreateNetworkDevice,
        )}.`,
      );
    }

    /*
     * The Allow check above is only half the ACL: every real BaseAPI create
     * also refuses a caller whose team BLOCK list carries the create
     * permission (CreatePermission.checkCreateBlockPermissions). Reuse that
     * exact enforcement so a block-listed user cannot create devices by
     * proxy through a rule run. (The isMasterAdmin early-return above
     * mirrors the BaseAPI path's own bypass.)
     */
    TablePermission.checkTableLevelBlockPermissions(
      NetworkDevice,
      data.props,
      DatabaseRequestType.Create,
    );

    return;
  }

  if (!holdsAnyOf(getUpdatePermissions(new NetworkDevice()))) {
    throw new NotAuthorizedException(
      `You do not have permission to update network devices, which running ${data.ruleLabel} does. Missing permission: ${PermissionHelper.getTitle(
        Permission.EditNetworkDevice,
      )}.`,
    );
  }
}

/*
 * A rule with a Monitor Template performs a second kind of create: after the
 * inventory record is available it creates an active Network Device monitor.
 * The worker runs that operation as root, but a human pressing Run Now must
 * not gain Monitor-create access through a rule when their role explicitly
 * lacks it. Kept separate from assertCanRunRule because device-only import
 * rules retain their existing permission contract.
 */
function assertCanCreateMonitor(props: DatabaseCommonInteractionProps): void {
  if (props.isMasterAdmin) {
    return;
  }

  const held: Array<Permission> = callerPermissions(props);
  const createPermissions: Array<Permission> =
    new Monitor().getCreatePermissions() || [];

  if (
    !held.some((permission: Permission): boolean => {
      return createPermissions.includes(permission);
    })
  ) {
    throw new NotAuthorizedException(
      `You do not have permission to create monitors, which running this auto-import rule does. Missing permission: ${PermissionHelper.getTitle(
        Permission.CreateProjectMonitor,
      )}.`,
    );
  }

  /*
   * Match BaseAPI's create path in both directions: a broad ProjectAdmin
   * grant does not override a team's explicit block on Monitor creation.
   */
  TablePermission.checkTableLevelBlockPermissions(
    Monitor,
    props,
    DatabaseRequestType.Create,
  );
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
 * A body flag with a tri-state contract: absent means false, a literal
 * boolean means itself, and anything else is a 400. Silent coercion is
 * wrong in BOTH directions the flags here are used in — a "true" string
 * for reassignDevicesAlreadyInASite must not move hand-placed devices, and
 * a "true" string for dryRun must not silently run the REAL import the
 * caller asked to simulate. Rejecting malformed values is the only reading
 * that fails safe for every flag.
 */
function readBooleanFlag(body: JSONObject, key: string): boolean {
  const value: unknown = body[key];

  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value !== "boolean") {
    throw new BadDataException(`${key} must be a boolean (true or false).`);
  }

  return value;
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
      "/network-device-auto-import-rule/:ruleId/run",
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
            ruleModel: new NetworkDeviceAutoImportRule(),
            ruleLabel: "auto-import rules",
            deviceWriteKind: "create",
          });

          const ruleId: ObjectID = readRuleId(req);

          /*
           * Resolve the rule inside the caller's project before deciding
           * whether Monitor-create permission is needed. Requiring it for
           * every auto-import rule would break the existing device-only
           * operation; trusting an id without the project predicate would let
           * one tenant use another tenant's rule to influence authorization.
           */
          const rule: NetworkDeviceAutoImportRule | null =
            await NetworkDeviceAutoImportRuleService.findOneBy({
              query: {
                _id: ruleId,
                projectId: projectId,
              },
              select: {
                _id: true,
                monitorTemplateId: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (!rule) {
            throw new BadDataException("Auto-import rule not found.");
          }

          if (rule.monitorTemplateId) {
            assertCanCreateMonitor(props);

            /*
             * Run Now is a fresh human-triggered use of the template, not an
             * unattended continuation of the rule's persisted capability.
             * Re-authorize the template under the current caller's tenant,
             * ownership and label scope before the root engine can clone it.
             */
            const readableTemplate: MonitorTemplate | null =
              await MonitorTemplateService.findOneById({
                id: rule.monitorTemplateId,
                select: { _id: true },
                props,
              });

            if (!readableTemplate) {
              throw new NotAuthorizedException(
                "You do not have permission to read the Monitor Template selected by this auto-import rule.",
              );
            }
          }

          const body: JSONObject = (req.body || {}) as JSONObject;

          const result: AutoImportRuleRunResult =
            await NetworkDeviceAutoImportRuleEngineService.applyRuleToCompletedScans(
              {
                ruleId: ruleId,
                projectId: projectId,
                isDryRun: readBooleanFlag(body, "dryRun"),
                expectedMonitorTemplateId: rule.monitorTemplateId || null,
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
