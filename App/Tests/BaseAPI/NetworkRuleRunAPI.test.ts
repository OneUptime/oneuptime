import { mockRouter } from "Common/Tests/Server/API/Helpers";
import CommonAPI from "Common/Server/API/CommonAPI";
import NetworkDeviceAutoImportRuleEngineService from "Common/Server/Services/NetworkDeviceAutoImportRuleEngineService";
import NetworkDeviceAutoImportRuleService from "Common/Server/Services/NetworkDeviceAutoImportRuleService";
import NetworkDeviceLabelRuleEngineService from "Common/Server/Services/NetworkDeviceLabelRuleEngineService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import MonitorTemplateService from "Common/Server/Services/MonitorTemplateService";
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

jest.mock("Common/Server/Services/NetworkDeviceAutoImportRuleService", () => {
  return {
    __esModule: true,
    default: { findOneBy: jest.fn() },
  };
});

jest.mock("Common/Server/Services/MonitorTemplateService", () => {
  return {
    __esModule: true,
    default: { findOneById: jest.fn() },
  };
});

jest.mock(
  "Common/Server/Services/NetworkDeviceAutoImportRuleEngineService",
  () => {
    return {
      __esModule: true,
      default: { applyRuleToCompletedScans: jest.fn() },
    };
  },
);

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

const autoImportRuleService: { findOneBy: jest.Mock } =
  NetworkDeviceAutoImportRuleService as unknown as { findOneBy: jest.Mock };

const monitorTemplateService: { findOneById: jest.Mock } =
  MonitorTemplateService as unknown as { findOneById: jest.Mock };

const autoImportRuleEngine: { applyRuleToCompletedScans: jest.Mock } =
  NetworkDeviceAutoImportRuleEngineService as unknown as {
    applyRuleToCompletedScans: jest.Mock;
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
const AUTO_IMPORT_RULE_URI: string =
  "/network-device-auto-import-rule/:ruleId/run";

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
    autoImportRuleService.findOneBy.mockResolvedValue({
      id: RULE_ID,
      monitorTemplateId: undefined,
    });
    monitorTemplateService.findOneById.mockResolvedValue({
      id: ObjectID.generate(),
    });
    autoImportRuleEngine.applyRuleToCompletedScans.mockResolvedValue({
      hostsEvaluated: 3,
      hostsMatched: 2,
      hostsExcluded: 0,
      hostsSkippedAlreadyRegistered: 0,
      devicesCreated: 2,
      devicesFailed: 0,
      monitorsWouldCreate: 0,
      monitorsCreated: 0,
      monitorsSkippedAlreadyExisting: 0,
      monitorsSkippedUnsupportedHost: 0,
      monitorsFailed: 0,
      isTruncated: false,
      hasMoreScans: false,
      isDryRun: false,
      matchedIpAddressSample: ["10.0.0.1", "10.0.0.2"],
    });
  });

  describe("route registration", () => {
    test("all routes are registered behind the user middleware", () => {
      for (const uri of [SITE_RULE_URI, LABEL_RULE_URI, AUTO_IMPORT_RULE_URI]) {
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
     * Only a literal boolean is accepted. A "true" string or a stray 1 - what
     * a hand-written client or a form encoder sends - is a 400, and the rule
     * does not run at all.
     *
     * Rejecting rather than coercing is what fails safe in BOTH directions
     * these flags are used in: read as false, a "true" string would silently
     * skip the reassignment the caller asked for; read as true, it would move
     * devices somebody placed by hand. The endpoint refuses to guess which
     * (App/FeatureSet/BaseAPI/API/NetworkRuleRun.ts readBooleanFlag).
     */
    test.each([["true"], [1], ["yes"], [{}]])(
      "refuses a non-boolean overwrite flag (%p) rather than guessing",
      async (value: unknown) => {
        const next: NextFunction = await callRoute({
          uri: SITE_RULE_URI,
          body: { reassignDevicesAlreadyInASite: value } as JSONObject,
        });

        expect(errorFrom(next).message).toContain(
          "reassignDevicesAlreadyInASite must be a boolean",
        );

        // Nothing was moved: the run never started.
        expect(
          deviceService.applySiteAssignmentRuleToExistingDevices,
        ).not.toHaveBeenCalled();
      },
    );

    /*
     * The absent case is the one that IS allowed to mean false - a caller that
     * says nothing about reassignment is asking for the safe half.
     */
    test.each([[undefined], [null]])(
      "treats an omitted overwrite flag (%p) as off",
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

  describe("POST /network-device-auto-import-rule/:ruleId/run", () => {
    test("resolves the selected rule in the caller's project and returns every counter", async () => {
      autoImportRuleEngine.applyRuleToCompletedScans.mockResolvedValue({
        hostsEvaluated: 4,
        hostsMatched: 3,
        hostsExcluded: 1,
        hostsSkippedAlreadyRegistered: 1,
        devicesCreated: 2,
        devicesFailed: 0,
        monitorsWouldCreate: 0,
        monitorsCreated: 1,
        monitorsSkippedAlreadyExisting: 1,
        monitorsSkippedUnsupportedHost: 0,
        monitorsFailed: 0,
        isTruncated: false,
        hasMoreScans: false,
        isDryRun: false,
        matchedIpAddressSample: ["10.0.0.1"],
      });

      const next: NextFunction = await callRoute({
        uri: AUTO_IMPORT_RULE_URI,
      });

      expect(next).not.toHaveBeenCalled();
      expect(autoImportRuleService.findOneBy).toHaveBeenCalledTimes(1);

      const lookup: JSONObject = autoImportRuleService.findOneBy.mock
        .calls[0]![0] as JSONObject;
      const lookupQuery: JSONObject = lookup["query"] as JSONObject;
      expect((lookupQuery["_id"] as ObjectID).toString()).toBe(
        RULE_ID.toString(),
      );
      expect((lookupQuery["projectId"] as ObjectID).toString()).toBe(
        PROJECT_ID.toString(),
      );
      expect(lookup["select"]).toEqual({
        _id: true,
        monitorTemplateId: true,
      });

      const run: JSONObject = autoImportRuleEngine.applyRuleToCompletedScans
        .mock.calls[0]![0] as JSONObject;
      expect((run["ruleId"] as ObjectID).toString()).toBe(RULE_ID.toString());
      expect((run["projectId"] as ObjectID).toString()).toBe(
        PROJECT_ID.toString(),
      );
      expect(run["isDryRun"]).toBe(false);
      expect(run["expectedMonitorTemplateId"]).toBeNull();

      expect(
        (responseUtil.sendJsonObjectResponse.mock.calls[0]![2] as JSONObject)[
          "monitorsCreated"
        ],
      ).toBe(1);
    });

    test("passes a literal dryRun through after applying the existing create-permission policy", async () => {
      await callRoute({
        uri: AUTO_IMPORT_RULE_URI,
        body: { dryRun: true },
      });

      const run: JSONObject = autoImportRuleEngine.applyRuleToCompletedScans
        .mock.calls[0]![0] as JSONObject;
      expect(run["isDryRun"]).toBe(true);
    });

    test.each([["true"], [1], ["yes"], [{}]])(
      "refuses malformed dryRun (%p) rather than accidentally writing",
      async (value: unknown) => {
        const next: NextFunction = await callRoute({
          uri: AUTO_IMPORT_RULE_URI,
          body: { dryRun: value } as JSONObject,
        });

        expect(errorFrom(next).message).toContain("dryRun must be a boolean");
        expect(
          autoImportRuleEngine.applyRuleToCompletedScans,
        ).not.toHaveBeenCalled();
      },
    );

    test("rejects a rule that does not resolve inside the project", async () => {
      autoImportRuleService.findOneBy.mockResolvedValue(null);

      const next: NextFunction = await callRoute({
        uri: AUTO_IMPORT_RULE_URI,
      });

      expect(errorFrom(next).message).toBe("Auto-import rule not found.");
      expect(
        autoImportRuleEngine.applyRuleToCompletedScans,
      ).not.toHaveBeenCalled();
    });

    test("retains the device-only permission contract when no template is selected", async () => {
      mockProps(
        propsWith({
          permissions: [
            Permission.EditNetworkDeviceAutoImportRule,
            Permission.CreateNetworkDevice,
          ],
        }),
      );

      const next: NextFunction = await callRoute({
        uri: AUTO_IMPORT_RULE_URI,
      });

      expect(next).not.toHaveBeenCalled();
      expect(
        autoImportRuleEngine.applyRuleToCompletedScans,
      ).toHaveBeenCalledTimes(1);
    });

    test("requires Monitor create permission when the rule selects a template", async () => {
      autoImportRuleService.findOneBy.mockResolvedValue({
        id: RULE_ID,
        monitorTemplateId: ObjectID.generate(),
      });
      mockProps(
        propsWith({
          permissions: [
            Permission.EditNetworkDeviceAutoImportRule,
            Permission.CreateNetworkDevice,
          ],
        }),
      );

      const next: NextFunction = await callRoute({
        uri: AUTO_IMPORT_RULE_URI,
      });

      expect(errorFrom(next).message).toContain(
        "permission to create monitors",
      );
      expect(
        autoImportRuleEngine.applyRuleToCompletedScans,
      ).not.toHaveBeenCalled();
    });

    test("passes the authorized Monitor Template snapshot to the engine", async () => {
      const monitorTemplateId: ObjectID = ObjectID.generate();
      autoImportRuleService.findOneBy.mockResolvedValue({
        id: RULE_ID,
        monitorTemplateId: monitorTemplateId,
      });
      mockProps(
        propsWith({
          permissions: [
            Permission.EditNetworkDeviceAutoImportRule,
            Permission.CreateNetworkDevice,
            Permission.CreateProjectMonitor,
          ],
        }),
      );

      const next: NextFunction = await callRoute({
        uri: AUTO_IMPORT_RULE_URI,
      });

      expect(next).not.toHaveBeenCalled();
      expect(
        autoImportRuleEngine.applyRuleToCompletedScans,
      ).toHaveBeenCalledTimes(1);

      const run: JSONObject = autoImportRuleEngine.applyRuleToCompletedScans
        .mock.calls[0]![0] as JSONObject;
      expect((run["expectedMonitorTemplateId"] as ObjectID).toString()).toBe(
        monitorTemplateId.toString(),
      );
      expect(monitorTemplateService.findOneById).toHaveBeenCalledWith(
        expect.objectContaining({
          id: monitorTemplateId,
          props: expect.objectContaining({ tenantId: PROJECT_ID }),
        }),
      );
    });

    test("refuses Run Now when the selected Monitor Template is outside the caller's read scope", async () => {
      const monitorTemplateId: ObjectID = ObjectID.generate();
      autoImportRuleService.findOneBy.mockResolvedValue({
        id: RULE_ID,
        monitorTemplateId,
      });
      monitorTemplateService.findOneById.mockResolvedValue(null);
      mockProps(
        propsWith({
          permissions: [
            Permission.EditNetworkDeviceAutoImportRule,
            Permission.CreateNetworkDevice,
            Permission.CreateProjectMonitor,
          ],
        }),
      );

      const next: NextFunction = await callRoute({
        uri: AUTO_IMPORT_RULE_URI,
      });

      expect(errorFrom(next).message).toContain(
        "permission to read the Monitor Template",
      );
      expect(monitorTemplateService.findOneById).toHaveBeenCalledWith(
        expect.objectContaining({
          id: monitorTemplateId,
          props: expect.objectContaining({ tenantId: PROJECT_ID }),
        }),
      );
      expect(
        autoImportRuleEngine.applyRuleToCompletedScans,
      ).not.toHaveBeenCalled();
    });

    test("honours an explicit block on Monitor creation", async () => {
      autoImportRuleService.findOneBy.mockResolvedValue({
        id: RULE_ID,
        monitorTemplateId: ObjectID.generate(),
      });
      mockProps(
        propsWith({
          permissions: [
            Permission.EditNetworkDeviceAutoImportRule,
            Permission.CreateNetworkDevice,
            Permission.CreateProjectMonitor,
          ],
          blockedPermissions: [Permission.CreateProjectMonitor],
        }),
      );

      const next: NextFunction = await callRoute({
        uri: AUTO_IMPORT_RULE_URI,
      });

      expect(errorFrom(next).message).toContain("block list");
      expect(
        autoImportRuleEngine.applyRuleToCompletedScans,
      ).not.toHaveBeenCalled();
    });

    test("keeps Monitor create permission checks on a dry run", async () => {
      autoImportRuleService.findOneBy.mockResolvedValue({
        id: RULE_ID,
        monitorTemplateId: ObjectID.generate(),
      });
      mockProps(
        propsWith({
          permissions: [
            Permission.EditNetworkDeviceAutoImportRule,
            Permission.CreateNetworkDevice,
          ],
        }),
      );

      const next: NextFunction = await callRoute({
        uri: AUTO_IMPORT_RULE_URI,
        body: { dryRun: true },
      });

      expect(errorFrom(next).message).toContain(
        "permission to create monitors",
      );
      expect(
        autoImportRuleEngine.applyRuleToCompletedScans,
      ).not.toHaveBeenCalled();
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
