import { mockRouter } from "Common/Tests/Server/API/Helpers";
import CommonAPI from "Common/Server/API/CommonAPI";
import NetworkDeviceLabelRuleEngineService from "Common/Server/Services/NetworkDeviceLabelRuleEngineService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import Response from "Common/Server/Utils/Response";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission, { UserPermission } from "Common/Types/Permission";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendJsonObjectResponse: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getUserMiddleware: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/NetworkDeviceService", () => {
  return {
    __esModule: true,
    default: { applySiteAssignmentRuleToExistingDevices: jest.fn() },
  };
});

jest.mock("Common/Server/Services/NetworkDeviceLabelRuleEngineService", () => {
  return {
    __esModule: true,
    default: { applyRuleToExistingNetworkDevices: jest.fn() },
  };
});

/*
 * Importing the API module registers both routes on the mocked router, so
 * each handler can be invoked directly with every service call observable.
 *
 * CommonAPI is deliberately NOT mocked: assertTenantScoped is part of what
 * these endpoints promise, and the permission gate below is only meaningful
 * against the real props helper.
 */
import NetworkRuleRunAPI from "../../FeatureSet/BaseAPI/API/NetworkRuleRun";

new NetworkRuleRunAPI().getRouter();

const PROJECT_ID: ObjectID = ObjectID.generate();
const RULE_ID: ObjectID = ObjectID.generate();

const deviceService: {
  applySiteAssignmentRuleToExistingDevices: jest.Mock;
} = NetworkDeviceService as unknown as {
  applySiteAssignmentRuleToExistingDevices: jest.Mock;
};

const labelRuleEngine: { applyRuleToExistingNetworkDevices: jest.Mock } =
  NetworkDeviceLabelRuleEngineService as unknown as {
    applyRuleToExistingNetworkDevices: jest.Mock;
  };

const responseUtil: { sendJsonObjectResponse: jest.Mock } =
  Response as unknown as { sendJsonObjectResponse: jest.Mock };

const mockResponse: ExpressResponse = {} as ExpressResponse;

// A caller holding exactly the listed permissions inside the project.
function propsWith(data: {
  permissions?: Array<Permission> | undefined;
  blockedPermissions?: Array<Permission> | undefined;
  tenantId?: ObjectID | null | undefined;
  isMasterAdmin?: boolean | undefined;
}): DatabaseCommonInteractionProps {
  const tenantId: ObjectID | undefined =
    data.tenantId === undefined ? PROJECT_ID : data.tenantId || undefined;

  const toUserPermission: (
    permission: Permission,
    isBlockPermission: boolean,
  ) => UserPermission = (
    permission: Permission,
    isBlockPermission: boolean,
  ): UserPermission => {
    return {
      permission: permission,
      labelIds: [],
      isBlockPermission: isBlockPermission,
      _type: "UserPermission",
    } as UserPermission;
  };

  return {
    tenantId: tenantId,
    isMasterAdmin: data.isMasterAdmin || false,
    userId: ObjectID.generate(),
    userTenantAccessPermission: tenantId
      ? {
          [tenantId.toString()]: {
            projectId: tenantId,
            permissions: [
              ...(data.permissions || []).map((permission: Permission) => {
                return toUserPermission(permission, false);
              }),
              ...(data.blockedPermissions || []).map(
                (permission: Permission) => {
                  return toUserPermission(permission, true);
                },
              ),
            ],
            _type: "UserTenantAccessPermission",
          },
        }
      : undefined,
  } as unknown as DatabaseCommonInteractionProps;
}

function mockProps(props: DatabaseCommonInteractionProps): void {
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(props);
}

async function callRoute(data: {
  uri: string;
  ruleId?: string | undefined;
  body?: JSONObject | undefined;
}): Promise<NextFunction> {
  const next: NextFunction = jest.fn() as unknown as NextFunction;

  const req: ExpressRequest = {
    params: {
      ruleId: data.ruleId === undefined ? RULE_ID.toString() : data.ruleId,
    },
    body: data.body || {},
  } as unknown as ExpressRequest;

  await mockRouter
    .match("post", data.uri)
    .handlerFunction(req, mockResponse, next);

  return next;
}

const SITE_RULE_URI: string = "/network-site-assignment-rule/:ruleId/run";
const LABEL_RULE_URI: string = "/network-device-label-rule/:ruleId/run";

function errorFrom(next: NextFunction): Error {
  const calls: Array<Array<unknown>> = (next as unknown as jest.Mock).mock
    .calls as Array<Array<unknown>>;
  expect(calls).toHaveLength(1);
  return calls[0]![0] as Error;
}

/*
 * A role that satisfies both rule kinds. The two models' update ACLs are not
 * identical - a project member may edit an assignment rule but not a label
 * rule - so the shared default is the one that clears both.
 */
const ADMIN_PERMISSIONS: Array<Permission> = [Permission.ProjectAdmin];

describe("Network automation rule run endpoints", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProps(propsWith({ permissions: ADMIN_PERMISSIONS }));
    deviceService.applySiteAssignmentRuleToExistingDevices.mockResolvedValue({
      devicesEvaluated: 3,
      devicesMatched: 2,
      devicesAssigned: 2,
      devicesAlreadyInRuleSite: 0,
      devicesSkippedAlreadyInAnotherSite: 0,
      devicesClaimedByHigherPriorityRule: 0,
      devicesFailed: 0,
      isTruncated: false,
    } as never);
    labelRuleEngine.applyRuleToExistingNetworkDevices.mockResolvedValue({
      devicesEvaluated: 3,
      devicesMatched: 2,
      devicesLabeled: 2,
      labelsAttached: 2,
      labelsFailed: 0,
      isTruncated: false,
    } as never);
  });

  describe("route registration", () => {
    test("both routes are registered behind the user middleware", () => {
      for (const uri of [SITE_RULE_URI, LABEL_RULE_URI]) {
        const route: { middlewares: Array<unknown> } = mockRouter.match(
          "post",
          uri,
        );
        expect(route.middlewares).toHaveLength(1);
      }
    });
  });

  describe("POST /network-site-assignment-rule/:ruleId/run", () => {
    test("runs the rule for the caller's project and returns the counters", async () => {
      const next: NextFunction = await callRoute({ uri: SITE_RULE_URI });

      expect(next).not.toHaveBeenCalled();

      const args: JSONObject = deviceService
        .applySiteAssignmentRuleToExistingDevices.mock
        .calls[0]![0] as JSONObject;

      expect((args["ruleId"] as ObjectID).toString()).toBe(RULE_ID.toString());
      expect((args["projectId"] as ObjectID).toString()).toBe(
        PROJECT_ID.toString(),
      );

      expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
      expect(
        (responseUtil.sendJsonObjectResponse.mock.calls[0]![2] as JSONObject)[
          "devicesAssigned"
        ],
      ).toBe(2);
    });

    // The destructive half is off unless the body says so, in as many words.
    test("does not overwrite existing assignments by default", async () => {
      await callRoute({ uri: SITE_RULE_URI });

      const args: JSONObject = deviceService
        .applySiteAssignmentRuleToExistingDevices.mock
        .calls[0]![0] as JSONObject;

      expect(args["reassignDevicesAlreadyInASite"]).toBe(false);
    });

    test("passes the overwrite flag through when it is set", async () => {
      await callRoute({
        uri: SITE_RULE_URI,
        body: { reassignDevicesAlreadyInASite: true },
      });

      const args: JSONObject = deviceService
        .applySiteAssignmentRuleToExistingDevices.mock
        .calls[0]![0] as JSONObject;

      expect(args["reassignDevicesAlreadyInASite"]).toBe(true);
    });

    /*
     * Only a literal true turns it on. A "true" string or a stray 1 - what a
     * hand-written client or a form encoder sends - must not be enough to
     * move devices somebody placed by hand.
     */
    test.each([["true"], [1], ["yes"], [{}]])(
      "treats a non-boolean overwrite flag (%p) as off",
      async (value: unknown) => {
        await callRoute({
          uri: SITE_RULE_URI,
          body: { reassignDevicesAlreadyInASite: value } as JSONObject,
        });

        const args: JSONObject = deviceService
          .applySiteAssignmentRuleToExistingDevices.mock
          .calls[0]![0] as JSONObject;

        expect(args["reassignDevicesAlreadyInASite"]).toBe(false);
      },
    );

    test("rejects a request with no project scope", async () => {
      mockProps(propsWith({ permissions: ADMIN_PERMISSIONS, tenantId: null }));

      const next: NextFunction = await callRoute({ uri: SITE_RULE_URI });

      expect(errorFrom(next).message).toContain("Project ID is required");
      expect(
        deviceService.applySiteAssignmentRuleToExistingDevices,
      ).not.toHaveBeenCalled();
    });

    test("rejects a malformed rule id", async () => {
      const next: NextFunction = await callRoute({
        uri: SITE_RULE_URI,
        ruleId: "not-a-uuid",
      });

      expect(errorFrom(next).message).toContain("Invalid Rule ID");
      expect(
        deviceService.applySiteAssignmentRuleToExistingDevices,
      ).not.toHaveBeenCalled();
    });

    // A service failure is the caller's answer, not a swallowed 200.
    test("forwards a service failure to the error handler", async () => {
      deviceService.applySiteAssignmentRuleToExistingDevices.mockRejectedValue(
        new Error("Assignment rule not found.") as never,
      );

      const next: NextFunction = await callRoute({ uri: SITE_RULE_URI });

      expect(errorFrom(next).message).toBe("Assignment rule not found.");
      expect(responseUtil.sendJsonObjectResponse).not.toHaveBeenCalled();
    });
  });

  describe("POST /network-device-label-rule/:ruleId/run", () => {
    test("runs the rule for the caller's project and returns the counters", async () => {
      const next: NextFunction = await callRoute({ uri: LABEL_RULE_URI });

      expect(next).not.toHaveBeenCalled();

      const args: JSONObject = labelRuleEngine.applyRuleToExistingNetworkDevices
        .mock.calls[0]![0] as JSONObject;

      expect((args["ruleId"] as ObjectID).toString()).toBe(RULE_ID.toString());
      expect((args["projectId"] as ObjectID).toString()).toBe(
        PROJECT_ID.toString(),
      );

      expect(
        (responseUtil.sendJsonObjectResponse.mock.calls[0]![2] as JSONObject)[
          "labelsAttached"
        ],
      ).toBe(2);
    });

    test("rejects a request with no project scope", async () => {
      mockProps(propsWith({ permissions: ADMIN_PERMISSIONS, tenantId: null }));

      const next: NextFunction = await callRoute({ uri: LABEL_RULE_URI });

      expect(errorFrom(next).message).toContain("Project ID is required");
      expect(
        labelRuleEngine.applyRuleToExistingNetworkDevices,
      ).not.toHaveBeenCalled();
    });

    test("forwards a service failure to the error handler", async () => {
      labelRuleEngine.applyRuleToExistingNetworkDevices.mockRejectedValue(
        new Error("This label rule is disabled.") as never,
      );

      const next: NextFunction = await callRoute({ uri: LABEL_RULE_URI });

      expect(errorFrom(next).message).toBe("This label rule is disabled.");
      expect(responseUtil.sendJsonObjectResponse).not.toHaveBeenCalled();
    });
  });

  /*
   * Running a rule writes to the inventory, so it takes the permission to
   * edit the rule AND the permission to update a network device. Both sets
   * are read off the models' own access control, so these tests are what
   * keeps an ACL edit from silently widening the endpoint.
   */
  describe("permissions", () => {
    test.each([
      [Permission.ProjectOwner],
      [Permission.ProjectAdmin],
      [Permission.ProjectMember],
      [Permission.SettingsAdmin],
      [Permission.SettingsMember],
    ])("allows a caller holding %s", async (permission: Permission) => {
      mockProps(propsWith({ permissions: [permission] }));

      const next: NextFunction = await callRoute({ uri: SITE_RULE_URI });

      expect(next).not.toHaveBeenCalled();
      expect(
        deviceService.applySiteAssignmentRuleToExistingDevices,
      ).toHaveBeenCalledTimes(1);
    });

    /*
     * The two rule models do not share an update ACL: a project member may
     * edit an assignment rule but not a label rule. Reading the required set
     * off each model is what keeps the endpoints in step with that, rather
     * than inventing a permission story of their own.
     */
    test("refuses a project member on the label rule endpoint", async () => {
      mockProps(propsWith({ permissions: [Permission.ProjectMember] }));

      const next: NextFunction = await callRoute({ uri: LABEL_RULE_URI });

      expect(errorFrom(next).message).toContain(
        "You do not have permission to run network device label rules",
      );
      expect(
        labelRuleEngine.applyRuleToExistingNetworkDevices,
      ).not.toHaveBeenCalled();
    });

    test("refuses a read-only caller", async () => {
      mockProps(
        propsWith({
          permissions: [
            Permission.Viewer,
            Permission.ReadNetworkSiteAssignmentRule,
            Permission.ReadNetworkDevice,
          ],
        }),
      );

      const next: NextFunction = await callRoute({ uri: SITE_RULE_URI });

      expect(errorFrom(next).message).toContain(
        "You do not have permission to run site assignment rules",
      );
      expect(
        deviceService.applySiteAssignmentRuleToExistingDevices,
      ).not.toHaveBeenCalled();
    });

    /*
     * The device half of the gate: a caller granted the fine-grained rule
     * permission but not the device one cannot rewrite the inventory
     * through a rule.
     */
    test("refuses a caller who may edit the rule but not devices", async () => {
      mockProps(
        propsWith({
          permissions: [Permission.EditNetworkSiteAssignmentRule],
        }),
      );

      const next: NextFunction = await callRoute({ uri: SITE_RULE_URI });

      expect(errorFrom(next).message).toContain(
        "You do not have permission to update network devices",
      );
      expect(
        deviceService.applySiteAssignmentRuleToExistingDevices,
      ).not.toHaveBeenCalled();
    });

    test("allows the fine-grained pair for site assignment rules", async () => {
      mockProps(
        propsWith({
          permissions: [
            Permission.EditNetworkSiteAssignmentRule,
            Permission.EditNetworkDevice,
          ],
        }),
      );

      const next: NextFunction = await callRoute({ uri: SITE_RULE_URI });

      expect(next).not.toHaveBeenCalled();
    });

    test("allows the fine-grained pair for label rules", async () => {
      mockProps(
        propsWith({
          permissions: [
            Permission.EditNetworkDeviceLabelRule,
            Permission.EditNetworkDevice,
          ],
        }),
      );

      const next: NextFunction = await callRoute({ uri: LABEL_RULE_URI });

      expect(next).not.toHaveBeenCalled();
    });

    // The rule kinds do not share a permission: one does not unlock the other.
    test("refuses a label-rule caller on the site assignment endpoint", async () => {
      mockProps(
        propsWith({
          permissions: [
            Permission.EditNetworkDeviceLabelRule,
            Permission.EditNetworkDevice,
          ],
        }),
      );

      const next: NextFunction = await callRoute({ uri: SITE_RULE_URI });

      expect(errorFrom(next).message).toContain(
        "You do not have permission to run site assignment rules",
      );
    });

    /*
     * A team's explicit BLOCK entry sits in the same permission dictionary as
     * its grants, discriminated only by isBlockPermission. Reading them raw
     * would count a block as a grant.
     */
    test("does not count a blocked permission as a grant", async () => {
      mockProps(
        propsWith({
          permissions: [],
          blockedPermissions: [
            Permission.ProjectAdmin,
            Permission.EditNetworkDevice,
          ],
        }),
      );

      const next: NextFunction = await callRoute({ uri: SITE_RULE_URI });

      expect(errorFrom(next).message).toContain("You do not have permission");
      expect(
        deviceService.applySiteAssignmentRuleToExistingDevices,
      ).not.toHaveBeenCalled();
    });

    test("lets a master admin through", async () => {
      mockProps(propsWith({ permissions: [], isMasterAdmin: true }));

      const next: NextFunction = await callRoute({ uri: SITE_RULE_URI });

      expect(next).not.toHaveBeenCalled();
      expect(
        deviceService.applySiteAssignmentRuleToExistingDevices,
      ).toHaveBeenCalledTimes(1);
    });

    /*
     * Permission is checked before the project scope is used, but after the
     * scope assertion - an unscoped request is told about the missing header
     * rather than about permissions it may well have.
     */
    test("reports a missing project scope ahead of a permission failure", async () => {
      mockProps(propsWith({ permissions: [], tenantId: null }));

      const next: NextFunction = await callRoute({ uri: SITE_RULE_URI });

      expect(errorFrom(next).message).toContain("Project ID is required");
    });
  });
});
