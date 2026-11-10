import NetworkDevice from "../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceNamingRule from "../../Models/DatabaseModels/NetworkDeviceNamingRule";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../Types/JSON";
import {
  DeviceNamingApplyResult,
  DeviceNamingPlan,
  DeviceNamingPreview,
  DeviceNamingPreviewItem,
  DeviceNamingRename,
  MAX_DEVICES_PER_NAMING_PLAN,
  MAX_RENAMES_PER_NAMING_APPLY,
} from "../../Types/NetworkDevice/DeviceNaming";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import UserMiddleware from "../Middleware/UserAuthorization";
import NetworkDeviceNamingRuleEngineService from "../Services/NetworkDeviceNamingRuleEngineService";
import DatabaseRequestType from "../Types/BaseDatabase/DatabaseRequestType";
import TablePermission from "../Types/Database/Permissions/TablePermission";
import CallerPlan from "../Utils/Billing/CallerPlan";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import DiscoveryImportRunner from "../Utils/NetworkDiscovery/DiscoveryImportRunner";
import RuleRunPermission from "../Utils/Rules/RuleRun/RuleRunPermission";
import Response from "../Utils/Response";
import { assertCanSeeImports } from "./NetworkDeviceDiscoveryImportAPI";
import CommonAPI from "./CommonAPI";

/*
 * NAMING RULES, OVER HTTP (OneUptime issue #6619).
 *
 *   POST /network-device-naming/preview-scan
 *        { scanId, ipAddresses }     what the import of these hosts of a
 *                                    scan names each one
 *   POST /network-device-naming/preview-discovered-devices
 *        { endpointIds }             the same, for devices the Discovered
 *                                    Devices list adds
 *   POST /network-device-naming/plan
 *        { deviceIds? }              the devices that do not follow the
 *                                    rules - all of them, or the ones
 *                                    asked about - and what each would be
 *                                    called
 *   POST /network-device-naming/apply
 *        { renames: [{ deviceId, fromName, toName }] }
 *                                    renames the devices a person confirmed
 *
 * A bare router (NetworkDeviceDiscoveryImportAPI is its neighbour): a plan
 * reads every device of the project and every rule as root, so these
 * handlers are the gate.
 *
 *  - The previews ask what the import they preview asks: the right to read
 *    the scan, or the Discovered Devices list, read as the person. Which
 *    rule named a host is said only to someone who may read the rules.
 *  - The plan and the apply rename devices across the project - the plan is
 *    the apply's preview - so they ask what every network rule's Run now
 *    asks (RuleRunPermission): the right to edit the naming rules, and to
 *    edit every network device of the project by a grant that reaches all
 *    of them. The renames are then written as root, on the person's behalf.
 */
const router: ExpressRouter = Express.getRouter();

async function getPersonProps(req: ExpressRequest): Promise<{
  props: DatabaseCommonInteractionProps;
  projectId: ObjectID;
}> {
  const props: DatabaseCommonInteractionProps = await CallerPlan.withPlan(
    await CommonAPI.getDatabaseCommonInteractionProps(req),
  );

  const projectId: ObjectID = CommonAPI.assertAuthenticatedProjectMember(props);

  return { props: props, projectId: projectId };
}

function readBody(req: ExpressRequest): JSONObject {
  return req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? (req.body as JSONObject)
    : {};
}

// Whether the person may read the project's naming rules.
export function canReadNamingRules(
  props: DatabaseCommonInteractionProps,
): boolean {
  try {
    TablePermission.checkTableLevelPermissions(
      NetworkDeviceNamingRule,
      props,
      DatabaseRequestType.Read,
    );
    return true;
  } catch (error) {
    if (
      error instanceof NotAuthorizedException ||
      error instanceof PaymentRequiredException
    ) {
      return false;
    }

    throw error;
  }
}

/*
 * A preview as the person may see it: the names an import gives are theirs
 * to know, since they are the names their import will create; which rule
 * gave each is the rules' business.
 */
export function previewForPerson(
  preview: DeviceNamingPreview,
  mayReadRules: boolean,
): DeviceNamingPreview {
  if (mayReadRules) {
    return preview;
  }

  return {
    hasRules: preview.hasRules,
    items: preview.items.map(
      (item: DeviceNamingPreviewItem): DeviceNamingPreviewItem => {
        const copy: DeviceNamingPreviewItem = { ...item };
        delete copy.ruleId;
        delete copy.ruleName;
        return copy;
      },
    ),
  };
}

// Refused unless the person may apply the naming rules across the project.
export function assertCanApplyNamingRules(
  props: DatabaseCommonInteractionProps,
): void {
  RuleRunPermission.assertMayChangeEveryRecord({
    props: props,
    modelType: NetworkDeviceNamingRule,
    requestType: DatabaseRequestType.Update,
    message: "You do not have permission to apply the naming rules.",
    missingPermission: Permission.EditNetworkDeviceNamingRule,
  });

  RuleRunPermission.assertMayChangeEveryRecord({
    props: props,
    modelType: NetworkDevice,
    requestType: DatabaseRequestType.Update,
    message:
      "You do not have permission to rename every network device in this project, which applying the naming rules does.",
    missingPermission: Permission.EditNetworkDevice,
  });
}

/*
 * The devices a plan is asked about: none (every device of the project), or
 * a list of ids.
 */
export function readPlanDeviceIds(value: unknown): Array<string> | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new BadDataException("Pick the devices to check from the list.");
  }

  if (value.length > MAX_DEVICES_PER_NAMING_PLAN) {
    throw new BadDataException(
      `Check at most ${MAX_DEVICES_PER_NAMING_PLAN} devices at once.`,
    );
  }

  const ids: Array<string> = [];

  for (const id of value) {
    if (typeof id !== "string" || !ObjectID.isValidUUID(id.trim())) {
      throw new BadDataException("Pick the devices to check from the list.");
    }

    ids.push(id.trim());
  }

  return ids;
}

// The renames an apply carries, checked.
export function readRenames(value: unknown): Array<DeviceNamingRename> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BadDataException("Pick at least one device to rename.");
  }

  if (value.length > MAX_RENAMES_PER_NAMING_APPLY) {
    throw new BadDataException(
      `Rename at most ${MAX_RENAMES_PER_NAMING_APPLY} devices at once.`,
    );
  }

  const renames: Array<DeviceNamingRename> = [];
  const seen: Set<string> = new Set<string>();

  for (const item of value) {
    const record: Record<string, unknown> =
      item && typeof item === "object" && !Array.isArray(item)
        ? (item as Record<string, unknown>)
        : {};
    const deviceId: string =
      typeof record["deviceId"] === "string" ? record["deviceId"].trim() : "";
    const fromName: unknown = record["fromName"];
    const toName: unknown = record["toName"];

    if (
      !ObjectID.isValidUUID(deviceId) ||
      typeof fromName !== "string" ||
      typeof toName !== "string" ||
      !toName.trim()
    ) {
      throw new BadDataException(
        "Each rename needs the device, the name it has and the name it gets.",
      );
    }

    if (seen.has(deviceId)) {
      continue;
    }

    seen.add(deviceId);
    renames.push({ deviceId: deviceId, fromName: fromName, toName: toName });
  }

  return renames;
}

router.post(
  "/network-device-naming/preview-scan",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { props, projectId } = await getPersonProps(req);
      const body: JSONObject = readBody(req);

      assertCanSeeImports(props);

      const preview: DeviceNamingPreview =
        await DiscoveryImportRunner.previewScanNames({
          projectId: projectId,
          props: props,
          scanId: body["scanId"],
          ipAddresses: body["ipAddresses"],
        });

      return Response.sendJsonObjectResponse(
        req,
        res,
        previewForPerson(
          preview,
          canReadNamingRules(props),
        ) as unknown as JSONObject,
      );
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/network-device-naming/preview-discovered-devices",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { props, projectId } = await getPersonProps(req);
      const body: JSONObject = readBody(req);

      const preview: DeviceNamingPreview =
        await DiscoveryImportRunner.previewDiscoveredDeviceNames({
          projectId: projectId,
          props: props,
          endpointIds: body["endpointIds"],
        });

      return Response.sendJsonObjectResponse(
        req,
        res,
        previewForPerson(
          preview,
          canReadNamingRules(props),
        ) as unknown as JSONObject,
      );
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/network-device-naming/plan",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { props, projectId } = await getPersonProps(req);
      const body: JSONObject = readBody(req);

      assertCanApplyNamingRules(props);

      const plan: DeviceNamingPlan =
        await NetworkDeviceNamingRuleEngineService.planExistingDevices({
          projectId: projectId,
          deviceIds: readPlanDeviceIds(body["deviceIds"]),
        });

      return Response.sendJsonObjectResponse(
        req,
        res,
        plan as unknown as JSONObject,
      );
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/network-device-naming/apply",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { props, projectId } = await getPersonProps(req);
      const body: JSONObject = readBody(req);

      assertCanApplyNamingRules(props);

      const result: DeviceNamingApplyResult =
        await NetworkDeviceNamingRuleEngineService.applyRenames({
          projectId: projectId,
          renames: readRenames(body["renames"]),
          props: props,
        });

      return Response.sendJsonObjectResponse(
        req,
        res,
        result as unknown as JSONObject,
      );
    } catch (err) {
      next(err);
    }
  },
);

export default router;
