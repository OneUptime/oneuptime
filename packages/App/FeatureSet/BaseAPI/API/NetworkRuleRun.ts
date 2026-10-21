import BadDataException from "Common/Types/Exception/BadDataException";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import CommonAPI from "Common/Server/API/CommonAPI";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import DatabaseRequestType from "Common/Server/Types/BaseDatabase/DatabaseRequestType";
import RuleRunPermission from "Common/Server/Utils/Rules/RuleRun/RuleRunPermission";
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
import { DatabaseBaseModelType } from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";

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
 * Auto-import rules have a narrower version of the same gap, in time
 * instead of space: the worker only processes NEW scan results. Writing
 * a rule now re-arms the project's results from the last 24 hours so
 * the sweep applies it to them (issue #3487), which leaves this Run Now
 * for what that deliberately will not touch — results older than that
 * horizon, and a re-run over the whole project on demand. Its dryRun
 * flag remains the answer to "what would this rule import" BEFORE
 * enabling it against live scans.
 *
 * All of these mutate network devices, so all demand the permission to
 * update the rule AND a matching NetworkDevice permission — update for
 * the rules that edit devices, CREATE for auto-import, which makes new
 * ones. A run reaches every device of the project, so each permission
 * must reach the whole project, as every rule's Run now asks
 * (RuleRunPermission). The required sets are read off the models' own
 * @TableAccessControl rather than restated here, so an ACL edit on
 * either model cannot drift from what these endpoints enforce.
 * ------------------------------------------------------------------
 */

/*
 * Every check below is the one a rule's Run now asks everywhere
 * (RuleRunPermission.assertMayChangeEveryRecord): a run reaches every
 * network device of the project - it walks them all, or imports from every
 * scan - so the caller must be allowed to do what it does to every one of
 * them. That is a grant that reaches the whole project (a permission limited
 * to some labels, or to owned devices, reaches only those), no block on the
 * model's list - refused with the message that names it - and, for the
 * models whose records carry labels (network devices, monitors), no block on
 * some labels either: the run would change the devices carrying them too.
 * The model's own list is asked, so an operational resource accepts its
 * *AllOperationalResources wildcard. A master admin may, as the write path
 * lets them.
 */
function assertCanRunRule(data: {
  props: DatabaseCommonInteractionProps;
  ruleModelType: DatabaseBaseModelType;
  ruleLabel: string;
  /*
   * What running this rule does to the inventory: site/label rules EDIT
   * devices, auto-import rules CREATE them — and a role allowed to author
   * rules but lacking the matching device permission must not get it by
   * proxy through a rule run.
   */
  deviceWriteKind?: "update" | "create";
}): void {
  RuleRunPermission.assertMayChangeEveryRecord({
    props: data.props,
    modelType: data.ruleModelType,
    requestType: DatabaseRequestType.Update,
    message: `You do not have permission to run ${data.ruleLabel}.`,
  });

  /*
   * Running a rule writes to devices. Without this a role allowed to author
   * rules but not to touch the inventory could edit (or grow) it wholesale
   * through a rule, which is exactly the permission it does not have.
   */
  if (data.deviceWriteKind === "create") {
    RuleRunPermission.assertMayChangeEveryRecord({
      props: data.props,
      modelType: NetworkDevice,
      requestType: DatabaseRequestType.Create,
      message: `You do not have permission to create network devices anywhere in this project, which running ${data.ruleLabel} does.`,
      missingPermission: Permission.CreateNetworkDevice,
    });

    return;
  }

  RuleRunPermission.assertMayChangeEveryRecord({
    props: data.props,
    modelType: NetworkDevice,
    requestType: DatabaseRequestType.Update,
    message: `You do not have permission to edit every network device in this project, which running ${data.ruleLabel} does.`,
    missingPermission: Permission.EditNetworkDevice,
  });
}

/*
 * A rule with a Monitor Template performs a second kind of create: after the
 * inventory record is available it creates an active Network Device monitor.
 * The worker runs that operation as root, but a human pressing Run Now must
 * not gain Monitor-create access through a rule when their role explicitly
 * lacks it - and the run creates monitors for devices across the whole
 * project, so a permission limited to some labels is not enough either.
 * Kept separate from assertCanRunRule because device-only import rules
 * retain their existing permission contract.
 */
function assertCanCreateMonitor(props: DatabaseCommonInteractionProps): void {
  RuleRunPermission.assertMayChangeEveryRecord({
    props: props,
    modelType: Monitor,
    requestType: DatabaseRequestType.Create,
    message:
      "You do not have permission to create monitors anywhere in this project, which running this auto-import rule does.",
    missingPermission: Permission.CreateProjectMonitor,
  });
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
            ruleModelType: NetworkSiteAssignmentRule,
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
            ruleModelType: NetworkDeviceAutoImportRule,
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
            ruleModelType: NetworkDeviceLabelRule,
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
