import { mockRouter } from "Common/Tests/Server/API/Helpers";
import CommonAPI from "Common/Server/API/CommonAPI";
import Semaphore from "Common/Server/Infrastructure/Semaphore";
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorTemplateService from "Common/Server/Services/MonitorTemplateService";
import NetworkDeviceAutoImportRuleService from "Common/Server/Services/NetworkDeviceAutoImportRuleService";
import NetworkDeviceDiscoveryScanService from "Common/Server/Services/NetworkDeviceDiscoveryScanService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import Response from "Common/Server/Utils/Response";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorTemplate from "Common/Models/DatabaseModels/MonitorTemplate";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import Permission, { UserPermission } from "Common/Types/Permission";
import UserType from "Common/Types/UserType";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";

/*
 * AN AUTO IMPORT RULE'S RUN NOW, FROM THE ROUTE TO THE WRITES (issue #6323).
 *
 * The route, its permission checks and the import engine are all real; only
 * the database is answered here. What a person's Run Now creates - devices,
 * and monitors from the rule's template - is written on their behalf: root,
 * as before, with their identity and none of their permissions, so the audit
 * log records each as theirs. Who may run the rule is unchanged: a caller
 * the route refuses writes nothing at all, and a dry run writes nothing
 * either.
 */

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
    default: { sendJsonObjectResponse: jest.fn() },
  };
});

jest.mock("Common/Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: { getUserMiddleware: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      trace: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    default: { lock: jest.fn(), release: jest.fn() },
  };
});

jest.mock("Common/Server/Services/NetworkDeviceService", () => {
  return {
    __esModule: true,
    default: {
      applySiteAssignmentRuleToExistingDevices: jest.fn(),
      create: jest.fn(),
      findBy: jest.fn(),
      findOneBy: jest.fn(),
      getDevicesByHostnames: jest.fn(),
      updateOneById: jest.fn(),
      countBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/NetworkDeviceLabelRuleEngineService", () => {
  return {
    __esModule: true,
    default: { applyRuleToExistingNetworkDevices: jest.fn() },
  };
});

jest.mock("Common/Server/Services/NetworkDeviceDiscoveryScanService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      findBy: jest.fn(),
      updateColumnsByIdWithoutHooks: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/NetworkDeviceAutoImportRuleService", () => {
  return {
    __esModule: true,
    default: { findOneBy: jest.fn(), findBy: jest.fn() },
  };
});

jest.mock("Common/Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: { create: jest.fn(), findBy: jest.fn(), findOneBy: jest.fn() },
  };
});

jest.mock("Common/Server/Services/MonitorTemplateService", () => {
  return {
    __esModule: true,
    default: { findOneById: jest.fn(), findBy: jest.fn() },
  };
});

// Importing the module registers its routes on the mocked router.
import NetworkRuleRunAPI from "../../FeatureSet/BaseAPI/API/NetworkRuleRun";

new NetworkRuleRunAPI().getRouter();

const ROUTE: string = "/network-device-auto-import-rule/:ruleId/run";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RULE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const TEMPLATE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const RUNNER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const SCAN_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const KEY_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

/*
 * jest-mock's Mock, which takes the function it stands in for. jest.Mock
 * here is @types/jest's, whose first parameter is what the mock returns,
 * and @jest/globals' jest (28) has no Mock type of its own.
 */
type AnyMock = Mock<(...args: Array<any>) => any>;

function mocked(fn: unknown): AnyMock {
  return fn as AnyMock;
}

const deviceCreate: AnyMock = mocked(NetworkDeviceService.create);
const monitorCreate: AnyMock = mocked(MonitorService.create);
const scanWrite: AnyMock = mocked(
  NetworkDeviceDiscoveryScanService.updateColumnsByIdWithoutHooks,
);
const lock: AnyMock = mocked(Semaphore.lock);
const templateRead: AnyMock = mocked(MonitorTemplateService.findOneById);

// Everything the run asks for, granted across the project.
const RUN_PERMISSIONS: Array<Permission> = [
  Permission.EditNetworkDeviceAutoImportRule,
  Permission.CreateNetworkDevice,
  Permission.CreateProjectMonitor,
];

function grantsOf(
  permissions: Array<Permission>,
  blocked: Array<Permission> = [],
): DatabaseCommonInteractionProps["userTenantAccessPermission"] {
  const row: (
    permission: Permission,
    isBlockPermission: boolean,
  ) => UserPermission = (
    permission: Permission,
    isBlockPermission: boolean,
  ): UserPermission => {
    return {
      _type: "UserPermission",
      permission: permission,
      labelIds: [],
      isBlockPermission: isBlockPermission,
    } as UserPermission;
  };

  return {
    [PROJECT_ID.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT_ID,
      permissions: [
        ...permissions.map((permission: Permission): UserPermission => {
          return row(permission, false);
        }),
        ...blocked.map((permission: Permission): UserPermission => {
          return row(permission, true);
        }),
      ],
    },
  } as unknown as DatabaseCommonInteractionProps["userTenantAccessPermission"];
}

// A person who may run the rule, as the route has them.
function person(
  permissions: Array<Permission> = RUN_PERMISSIONS,
  blocked: Array<Permission> = [],
): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userId: RUNNER_ID,
    userType: UserType.User,
    isMasterAdmin: false,
    userTenantAccessPermission: grantsOf(permissions, blocked),
  };
}

const ON_THEIR_BEHALF: DatabaseCommonInteractionProps = {
  isRoot: true,
  userId: RUNNER_ID,
  userType: UserType.User,
};

function template(): MonitorTemplate {
  const step: MonitorStep = new MonitorStep();
  step.data!.networkDeviceMonitor = {
    networkDeviceId: "99999999-9999-4999-8999-999999999999",
    monitorInterfaces: true,
    collectEndpoints: true,
    oids: [],
  };

  const steps: MonitorSteps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: new ObjectID(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ),
  };

  const item: MonitorTemplate = new MonitorTemplate();
  item.id = TEMPLATE_ID;
  item.projectId = PROJECT_ID;
  item.monitorName = "SNMP health";
  item.monitorType = MonitorType.NetworkDevice;
  item.monitorSteps = steps;
  item.monitoringInterval = "*/5 * * * *";
  return item;
}

// The rule, with or without a monitor template.
function useRule(withTemplate: boolean): void {
  mocked(NetworkDeviceAutoImportRuleService.findOneBy).mockResolvedValue({
    id: RULE_ID,
    _id: RULE_ID.toString(),
    projectId: PROJECT_ID,
    name: "Import the core switches",
    isEnabled: true,
    isExclusion: false,
    ipMatchTarget: "10.0.0.0/24",
    monitorTemplateId: withTemplate ? TEMPLATE_ID : undefined,
  });
  mocked(MonitorTemplateService.findBy).mockResolvedValue(
    withTemplate ? [template()] : [],
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();

  useRule(true);
  templateRead.mockResolvedValue({ id: TEMPLATE_ID });
  mocked(NetworkDeviceAutoImportRuleService.findBy).mockResolvedValue([]);

  // One scan that found two switches, neither in the inventory yet.
  mocked(NetworkDeviceDiscoveryScanService.findBy).mockResolvedValue([
    { id: SCAN_ID },
  ]);
  mocked(NetworkDeviceDiscoveryScanService.findOneBy).mockResolvedValue({
    id: SCAN_ID,
    _id: SCAN_ID.toString(),
    projectId: PROJECT_ID,
    status: "Completed",
    completedAt: OneUptimeDate.getCurrentDate(),
    discoveredDevices: [
      { ipAddress: "10.0.0.5", sysName: "core-switch-01" },
      { ipAddress: "10.0.0.6", sysName: "core-switch-02" },
    ],
    snmpVersion: "V2c",
    snmpCommunityString: "public",
    snmpPort: 161,
  });
  scanWrite.mockResolvedValue(undefined);

  mocked(NetworkDeviceService.getDevicesByHostnames).mockResolvedValue(
    new Map<string, NetworkDevice>(),
  );
  mocked(NetworkDeviceService.findOneBy).mockResolvedValue(null);
  mocked(NetworkDeviceService.findBy).mockResolvedValue([]);
  deviceCreate.mockImplementation(
    async (createBy: { data: NetworkDevice }): Promise<NetworkDevice> => {
      createBy.data.id = createBy.data.id || ObjectID.generate();
      return createBy.data;
    },
  );

  mocked(MonitorService.findBy).mockResolvedValue([]);
  mocked(MonitorService.findOneBy).mockResolvedValue(null);
  monitorCreate.mockImplementation(
    async (createBy: { data: Monitor }): Promise<Monitor> => {
      createBy.data.id = createBy.data.id || ObjectID.generate();
      return createBy.data;
    },
  );

  lock.mockResolvedValue({ id: "sweep-lock" });
  mocked(Semaphore.release).mockResolvedValue(undefined);
});

async function run(
  props: DatabaseCommonInteractionProps,
  body: JSONObject = {},
): Promise<NextFunction> {
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(props);

  const next: NextFunction = jest.fn() as unknown as NextFunction;

  await mockRouter.match("post", ROUTE).handlerFunction(
    {
      params: { ruleId: RULE_ID.toString() },
      body: body,
    } as unknown as ExpressRequest,
    {} as ExpressResponse,
    next,
  );

  return next;
}

function propsOf(fn: AnyMock): Array<unknown> {
  return fn.mock.calls.map((call: Array<any>): unknown => {
    return call[0].props;
  });
}

function expectNothingWritten(): void {
  expect(deviceCreate).not.toHaveBeenCalled();
  expect(monitorCreate).not.toHaveBeenCalled();
  expect(scanWrite).not.toHaveBeenCalled();
  expect(lock).not.toHaveBeenCalled();
}

describe("an auto import rule's Run Now, from the route to the writes", () => {
  test("creates each device on the behalf of the person who ran it", async () => {
    const next: NextFunction = await run(person());

    expect(next).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
    expect(propsOf(deviceCreate)).toEqual([ON_THEIR_BEHALF, ON_THEIR_BEHALF]);
  });

  test("creates each monitor from the rule's template in the project, on their behalf", async () => {
    await run(person());

    expect(propsOf(monitorCreate)).toEqual([
      { ...ON_THEIR_BEHALF, tenantId: PROJECT_ID },
      { ...ON_THEIR_BEHALF, tenantId: PROJECT_ID },
    ]);
  });

  test("carries who they are and nothing they may do", async () => {
    await run(person());

    for (const props of [...propsOf(deviceCreate), ...propsOf(monitorCreate)]) {
      const written: DatabaseCommonInteractionProps =
        props as DatabaseCommonInteractionProps;

      expect(written.userTenantAccessPermission).toBeUndefined();
      expect(written.isMasterAdmin).toBeUndefined();
      expect(written.isRoot).toBe(true);
    }
  });

  test("an API key that may run the rule is credited as the key", async () => {
    await run({
      tenantId: PROJECT_ID,
      userType: UserType.API,
      apiKeyId: KEY_ID,
      apiKeyName: "Terraform",
      userTenantAccessPermission: grantsOf(RUN_PERMISSIONS),
    });

    const asTheKey: DatabaseCommonInteractionProps = {
      isRoot: true,
      userType: UserType.API,
      apiKeyId: KEY_ID,
      apiKeyName: "Terraform",
    };

    expect(propsOf(deviceCreate)).toEqual([asTheKey, asTheKey]);
    expect(propsOf(monitorCreate)).toEqual([
      { ...asTheKey, tenantId: PROJECT_ID },
      { ...asTheKey, tenantId: PROJECT_ID },
    ]);
  });

  test("a dry run by the same person writes nothing", async () => {
    const next: NextFunction = await run(person(), { dryRun: true });

    expect(next).not.toHaveBeenCalled();
    expectNothingWritten();

    const answer: JSONObject = mocked(Response.sendJsonObjectResponse).mock
      .calls[0]![2] as JSONObject;
    expect(answer["isDryRun"]).toBe(true);
    expect(answer["monitorsWouldCreate"]).toBe(2);
  });

  test("a device-only rule still needs no monitor permission, and creates on their behalf", async () => {
    useRule(false);

    const next: NextFunction = await run(
      person([
        Permission.EditNetworkDeviceAutoImportRule,
        Permission.CreateNetworkDevice,
      ]),
    );

    expect(next).not.toHaveBeenCalled();
    expect(propsOf(deviceCreate)).toEqual([ON_THEIR_BEHALF, ON_THEIR_BEHALF]);
    expect(monitorCreate).not.toHaveBeenCalled();
  });

  /*
   * Who may run it is the route's to decide, as before: the person's
   * identity reaches the writes, never a permission they lack.
   */
  describe("a caller the route refuses writes nothing", () => {
    test.each([
      [
        "without permission to create monitors, for a rule with a template",
        (): DatabaseCommonInteractionProps => {
          return person([
            Permission.EditNetworkDeviceAutoImportRule,
            Permission.CreateNetworkDevice,
          ]);
        },
      ],
      [
        "without permission to create network devices",
        (): DatabaseCommonInteractionProps => {
          return person([
            Permission.EditNetworkDeviceAutoImportRule,
            Permission.CreateProjectMonitor,
          ]);
        },
      ],
      [
        "without permission to edit the rule",
        (): DatabaseCommonInteractionProps => {
          return person([
            Permission.CreateNetworkDevice,
            Permission.CreateProjectMonitor,
          ]);
        },
      ],
      [
        "whose team blocks creating monitors",
        (): DatabaseCommonInteractionProps => {
          return person(RUN_PERMISSIONS, [Permission.CreateProjectMonitor]);
        },
      ],
      [
        "an API key without the permissions",
        (): DatabaseCommonInteractionProps => {
          return {
            tenantId: PROJECT_ID,
            userType: UserType.API,
            apiKeyId: KEY_ID,
            userTenantAccessPermission: grantsOf([]),
          };
        },
      ],
      [
        "an anonymous caller",
        (): DatabaseCommonInteractionProps => {
          return { tenantId: PROJECT_ID, userType: UserType.Public };
        },
      ],
      [
        "a request with no project",
        (): DatabaseCommonInteractionProps => {
          return { ...person(), tenantId: undefined };
        },
      ],
    ])(
      "%s",
      async (_name: string, propsFor: () => DatabaseCommonInteractionProps) => {
        const next: NextFunction = await run(propsFor());

        expect((next as unknown as AnyMock).mock.calls).toHaveLength(1);
        expect(
          (next as unknown as AnyMock).mock.calls[0]![0] instanceof Error,
        ).toBe(true);
        expectNothingWritten();
        expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
      },
    );

    test("who cannot read the rule's monitor template", async () => {
      templateRead.mockResolvedValue(null);

      const next: NextFunction = await run(person());

      expect(
        ((next as unknown as AnyMock).mock.calls[0]![0] as Error).message,
      ).toContain("permission to read the Monitor Template");
      // The template is read as the person, not as root.
      expect(templateRead.mock.calls[0]![0].props).toEqual(
        expect.objectContaining({ userId: RUNNER_ID, tenantId: PROJECT_ID }),
      );
      expectNothingWritten();
    });

    test("for a rule outside their project", async () => {
      mocked(NetworkDeviceAutoImportRuleService.findOneBy).mockResolvedValue(
        null,
      );

      const next: NextFunction = await run(person());

      expect(
        ((next as unknown as AnyMock).mock.calls[0]![0] as Error).message,
      ).toBe("Auto-import rule not found.");
      expectNothingWritten();
    });
  });
});
