import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHO MAY CHOOSE THE WEB ACLS THE BLOCKLIST IS ENFORCED IN (#10344), through
 * the routes the Blocklist page calls:
 *
 *   POST   /security-block-cloud-waf                 pick a web ACL (the CRUD create)
 *   POST   /security-block-cloud-waf/get-list        read them
 *   PUT    /security-block-cloud-waf/:id             where it reads the client's address
 *   DELETE /security-block-cloud-waf/:id             never: Remove takes OneUptime's rule out first
 *   POST   /security-block-cloud-waf/candidates      the web ACLs that may be picked
 *   POST   /security-block-cloud-waf/:id/check       set up and read now
 *   POST   /security-block-cloud-waf/:id/remove      take OneUptime out, then remove it
 *
 * A Project Owner, a Project Admin and a Security Admin pick, change and
 * remove one - it writes the customer's cloud - and whoever reads the
 * blocklist reads them. A web ACL is named by its inventory row, the
 * project's own; OneUptime writes its ARN, name, Region and connection from
 * the inventory, so a caller never names another account's.
 *
 * Nothing is stubbed between the route and the tables but the tables, held
 * in memory: the caller's real permission rows go through the real
 * permission layer. What lies past them - the reconcile a change queues,
 * the set-up and removal against AWS - stands in for itself.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
      sendEntityArrayResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
    },
  };
});

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

import SecurityBlockCloudWafAPI, {
  CLOUD_WAF_REFUSED_MESSAGE,
  SECURITY_BLOCK_CLOUD_WAF_CANDIDATES_ROUTE,
} from "../../../Server/API/SecurityBlockCloudWafAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import CloudConnectionService from "../../../Server/Services/CloudConnectionService";
import CloudResourceService from "../../../Server/Services/CloudResourceService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import SecurityBlockCloudWafService, {
  SECURITY_BLOCK_CLOUD_WAF_MESSAGES,
} from "../../../Server/Services/SecurityBlockCloudWafService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import ColumnWriteRefusedException from "../../../Server/Types/Database/Permissions/ColumnWriteRefusedException";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import Response from "../../../Server/Utils/Response";
import SecurityBlockCloudWafs from "../../../Server/Utils/SecurityBlocklist/SecurityBlockCloudWafs";
import SecurityBlocklistJobs from "../../../Server/Utils/SecurityBlocklist/SecurityBlocklistJobs";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SecurityBlockCloudWaf from "../../../Models/DatabaseModels/SecurityBlockCloudWaf";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  SecurityBlockClientAddress,
  SecurityBlockCloudWafLeftKind,
  SecurityBlockCloudWafStatus,
} from "../../../Types/SecurityBlocklist/SecurityBlockCloudWaf";
import { SecurityBlockCloudWafKind } from "../../../Types/SecurityBlocklist/SecurityBlockCloudWafKind";
import { customDomainCaller } from "./CustomDomainCallers";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { everyServerProductIsOn } from "../TestingUtils/ServerProductsOn";

type MockedFn = ReturnType<typeof jest.fn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "5c1e7a40-5c2d-4e8f-9a61-7d0c2b4e6f01",
);
const OTHER_PROJECT_ID: string = "5c1e7a40-5c2d-4e8f-9a61-7d0c2b4e6f99";
const CONNECTION_ID: string = "5c1e7a40-5c2d-4e8f-9a61-7d0c2b4e6c01";
const OFF_CONNECTION_ID: string = "5c1e7a40-5c2d-4e8f-9a61-7d0c2b4e6c02";
const WEB_ACL_ID: string = "5c1e7a40-5c2d-4e8f-9a61-7d0c2b4e6a01";
const METRICS_ONLY_ID: string = "5c1e7a40-5c2d-4e8f-9a61-7d0c2b4e6a02";
const OFF_WEB_ACL_ID: string = "5c1e7a40-5c2d-4e8f-9a61-7d0c2b4e6a03";
const OTHER_PROJECT_WEB_ACL_ID: string = "5c1e7a40-5c2d-4e8f-9a61-7d0c2b4e6a04";
const PICKED_ID: string = "5c1e7a40-5c2d-4e8f-9a61-7d0c2b4e6b01";
const AWS_WEB_ACL_ID: string = "a1b2c3d4-5678-90ab-cdef-111111111111";

const WRITERS: Array<[string, Permission]> = [
  ["Project Owner", Permission.ProjectOwner],
  ["Project Admin", Permission.ProjectAdmin],
  ["Security Admin", Permission.SecurityAdmin],
];

const NOT_WRITERS: Array<[string, Permission]> = [
  ["Security Member", Permission.SecurityMember],
  ["Security Viewer", Permission.SecurityViewer],
  ["Project Member", Permission.ProjectMember],
];

let props: DatabaseCommonInteractionProps;
let wafs: InMemoryTable;
let reconcile: MockedFn;

const sendJsonObjectResponseMock: MockedFn =
  Response.sendJsonObjectResponse as unknown as MockedFn;

function caller(permission: Permission): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: [permission], projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

function webAclRow(data: {
  id: string;
  name: string;
  projectId?: string | undefined;
  connectionId?: string | undefined;
  properties?: JSONObject | undefined;
}): StoredRow {
  return {
    _id: data.id,
    projectId: data.projectId || PROJECT_ID.toString(),
    name: data.name,
    cloudProvider: CloudProvider.AWS,
    cloudResourceType: "AWS::WAFv2::WebACL",
    cloudRegion: "eu-west-1",
    cloudAccountId: "123456789012",
    cloudConnectionId: data.connectionId || CONNECTION_ID,
    cloudProperties: data.properties || {
      Name: data.name,
      Id: AWS_WEB_ACL_ID,
      Scope: "REGIONAL",
    },
    isArchived: false,
    version: 1,
  };
}

async function call(data: {
  method: "post" | "put" | "delete";
  uri: string;
  params?: Record<string, string> | undefined;
  body?: JSONObject | undefined;
}): Promise<{ refusal: Exception | null }> {
  const req: ExpressRequest = {
    params: data.params || {},
    query: {},
    headers: {},
    body: data.body || {},
  } as unknown as ExpressRequest;
  const res: ExpressResponse = {
    setHeader: jest.fn(),
  } as unknown as ExpressResponse;
  const next: MockedFn = jest.fn();

  await mockRouter
    .match(data.method, data.uri)
    .handlerFunction(req, res, next as unknown as NextFunction);

  return {
    refusal: (next.mock.calls[0]?.[0] as Exception | undefined) || null,
  };
}

function answered(): JSONObject {
  const calls: Array<Array<unknown>> = sendJsonObjectResponseMock.mock.calls;
  return calls[calls.length - 1]![2] as JSONObject;
}

async function pick(
  cloudResourceId: string,
  extra: JSONObject = {},
): Promise<{ refusal: Exception | null }> {
  return await call({
    method: "post",
    uri: "/security-block-cloud-waf",
    body: {
      data: {
        projectId: PROJECT_ID.toString(),
        cloudResourceId,
        ...extra,
      },
    },
  });
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new SecurityBlockCloudWafAPI();
});

beforeEach(() => {
  jest.clearAllMocks();

  everyServerProductIsOn();

  wafs = useInMemoryTable(
    SecurityBlockCloudWafService as unknown as DatabaseService<BaseModel>,
    [],
  );
  useInMemoryTable(
    CloudResourceService as unknown as DatabaseService<BaseModel>,
    [
      webAclRow({ id: WEB_ACL_ID, name: "prod-alb" }),
      // Found by its metrics alone: no Id, no Scope, no ARN.
      webAclRow({
        id: METRICS_ONLY_ID,
        name: "metrics-only",
        properties: {},
      }),
      webAclRow({
        id: OFF_WEB_ACL_ID,
        name: "staging-alb",
        connectionId: OFF_CONNECTION_ID,
      }),
      webAclRow({
        id: OTHER_PROJECT_WEB_ACL_ID,
        name: "theirs",
        projectId: OTHER_PROJECT_ID,
      }),
    ],
  );
  useInMemoryTable(
    CloudConnectionService as unknown as DatabaseService<BaseModel>,
    [
      {
        _id: CONNECTION_ID,
        projectId: PROJECT_ID.toString(),
        name: "Production",
        provider: CloudProvider.AWS,
        config: { authMethod: "aws-role", wafBlocklist: "rule" },
        version: 1,
      },
      {
        _id: OFF_CONNECTION_ID,
        projectId: PROJECT_ID.toString(),
        name: "Staging",
        provider: CloudProvider.AWS,
        config: { authMethod: "aws-role" },
        version: 1,
      },
    ],
  );

  // A reference is checked against its own table: the inventory's and the connections', in memory.
  jest
    .spyOn(ProjectScopedReferenceValidator, "getLookupService")
    .mockImplementation(((modelType: { new (): BaseModel }) => {
      const tableName: string = new modelType().tableName || "";

      if (tableName === "CloudResource") {
        return CloudResourceService;
      }

      if (tableName === "CloudConnection") {
        return CloudConnectionService;
      }

      throw new Error(`No table in memory for ${tableName}`);
    }) as never);

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return props;
    });
  reconcile = jest
    .spyOn(SecurityBlocklistJobs, "queueReconcile")
    .mockResolvedValue(undefined) as unknown as MockedFn;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("picking a web ACL", () => {
  test.each(WRITERS)(
    "a %s picks one from the inventory, and OneUptime names it from there",
    async (_who: string, permission: Permission) => {
      props = caller(permission);

      const { refusal } = await pick(WEB_ACL_ID, {
        clientAddress: SecurityBlockClientAddress.XForwardedFor,
      });

      expect(refusal).toBeNull();
      expect(wafs.rows).toHaveLength(1);

      const row: StoredRow = wafs.rows[0]!;

      expect(row["wafId"]).toBe(
        `arn:aws:wafv2:eu-west-1:123456789012:regional/webacl/prod-alb/${AWS_WEB_ACL_ID}`,
      );
      expect(row["name"]).toBe("prod-alb");
      expect(row["region"]).toBe("eu-west-1");
      expect(String(row["cloudConnectionId"]).toLowerCase()).toBe(
        CONNECTION_ID,
      );
      expect(row["cloudProvider"]).toBe(CloudProvider.AWS);
      expect(row["status"]).toBe(SecurityBlockCloudWafStatus.Checking);
      expect(row["clientAddress"]).toBe(
        SecurityBlockClientAddress.XForwardedFor,
      );
      expect(reconcile).toHaveBeenCalledTimes(1);
    },
  );

  test("reads the request's source address unless told otherwise", async () => {
    props = caller(Permission.SecurityAdmin);

    await pick(WEB_ACL_ID);

    expect(wafs.rows[0]!["clientAddress"]).toBe(
      SecurityBlockClientAddress.SourceIp,
    );
  });

  test.each(NOT_WRITERS)(
    "a %s may not",
    async (_who: string, permission: Permission) => {
      props = caller(permission);

      const { refusal } = await pick(WEB_ACL_ID);

      expect(refusal).toBeInstanceOf(NotAuthorizedException);
      expect(refusal?.message).toBe(
        "You do not have permissions to create Cloud WAF. You need one of these permissions: Project Owner, Project Admin, Security Admin",
      );
      expect(wafs.rows).toHaveLength(0);
    },
  );

  test("a web ACL whose connection may not block addresses in AWS WAF is refused, saying where to turn it on", async () => {
    props = caller(Permission.ProjectAdmin);

    const { refusal } = await pick(OFF_WEB_ACL_ID);

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal?.message).toBe(
      SECURITY_BLOCK_CLOUD_WAF_MESSAGES.turnOnBlocking({
        connection: "Staging",
      }),
    );
    expect(wafs.rows).toHaveLength(0);
  });

  test("a web ACL OneUptime has not listed - found by its metrics alone - is refused, saying what to do", async () => {
    props = caller(Permission.ProjectAdmin);

    const { refusal } = await pick(METRICS_ONLY_ID);

    expect(refusal?.message).toBe(
      SECURITY_BLOCK_CLOUD_WAF_MESSAGES.notListed({ name: "metrics-only" }),
    );
  });

  test("another project's web ACL is refused as one that is not there", async () => {
    props = caller(Permission.ProjectAdmin);

    const { refusal } = await pick(OTHER_PROJECT_WEB_ACL_ID);

    expect(refusal).not.toBeNull();
    expect(refusal?.message).not.toContain("theirs");
    expect(wafs.rows).toHaveLength(0);
  });

  test("a web ACL already picked is refused", async () => {
    props = caller(Permission.ProjectAdmin);

    await pick(WEB_ACL_ID);
    const { refusal } = await pick(WEB_ACL_ID);

    expect(refusal?.message).toBe(
      SECURITY_BLOCK_CLOUD_WAF_MESSAGES.alreadyEnforcing({ name: "prod-alb" }),
    );
    expect(wafs.rows).toHaveLength(1);
  });

  test("a caller never names the web ACL's ARN, its connection or where it stands: what it sends is left out, and OneUptime writes them from the inventory", async () => {
    props = caller(Permission.ProjectOwner);

    const { refusal } = await pick(WEB_ACL_ID, {
      wafId: "arn:aws:wafv2:eu-west-1:999999999999:regional/webacl/theirs/x",
      cloudConnectionId: OFF_CONNECTION_ID,
      name: "theirs",
      region: "us-west-2",
      status: SecurityBlockCloudWafStatus.Enforcing,
      statusMessage: "Enforcing everywhere.",
    });

    expect(refusal).toBeNull();
    expect(wafs.rows).toHaveLength(1);

    const row: StoredRow = wafs.rows[0]!;

    expect(row["wafId"]).toBe(
      `arn:aws:wafv2:eu-west-1:123456789012:regional/webacl/prod-alb/${AWS_WEB_ACL_ID}`,
    );
    expect(String(row["cloudConnectionId"]).toLowerCase()).toBe(CONNECTION_ID);
    expect(row["name"]).toBe("prod-alb");
    expect(row["region"]).toBe("eu-west-1");
    expect(row["status"]).toBe(SecurityBlockCloudWafStatus.Checking);
    expect(row["statusMessage"] ?? null).toBeNull();
  });
});

describe("changing and removing one", () => {
  beforeEach(() => {
    wafs.rows.push({
      _id: PICKED_ID,
      projectId: PROJECT_ID.toString(),
      cloudConnectionId: CONNECTION_ID,
      cloudResourceId: WEB_ACL_ID,
      cloudProvider: CloudProvider.AWS,
      wafId: `arn:aws:wafv2:eu-west-1:123456789012:regional/webacl/prod-alb/${AWS_WEB_ACL_ID}`,
      name: "prod-alb",
      region: "eu-west-1",
      clientAddress: SecurityBlockClientAddress.SourceIp,
      status: SecurityBlockCloudWafStatus.Enforcing,
      version: 1,
    });
  });

  test.each(WRITERS)(
    "a %s changes where it reads the client's address, and the rule is written again",
    async (_who: string, permission: Permission) => {
      props = caller(permission);

      const { refusal } = await call({
        method: "put",
        uri: "/security-block-cloud-waf/:id",
        params: { id: PICKED_ID },
        body: {
          data: { clientAddress: SecurityBlockClientAddress.CfConnectingIp },
        },
      });

      expect(refusal).toBeNull();
      expect(wafs.get(PICKED_ID)!["clientAddress"]).toBe(
        SecurityBlockClientAddress.CfConnectingIp,
      );
      expect(reconcile).toHaveBeenCalled();
    },
  );

  test.each([
    ["cloudResourceId", OFF_WEB_ACL_ID],
    ["wafId", "arn:aws:wafv2:eu-west-1:999999999999:regional/webacl/theirs/x"],
    ["status", SecurityBlockCloudWafStatus.Failed],
  ])(
    "its %s never changes by hand: pick another web ACL instead",
    async (column: string, value: string) => {
      props = caller(Permission.ProjectOwner);

      const before: StoredRow = { ...wafs.get(PICKED_ID)! };
      const { refusal } = await call({
        method: "put",
        uri: "/security-block-cloud-waf/:id",
        params: { id: PICKED_ID },
        body: { data: { [column]: value } },
      });

      expect(refusal).toBeInstanceOf(ColumnWriteRefusedException);
      expect((refusal as ColumnWriteRefusedException).columnName).toBe(column);
      expect(wafs.get(PICKED_ID)).toEqual(before);
    },
  );

  test("a plain delete is refused, saying to remove it with Remove", async () => {
    props = caller(Permission.ProjectOwner);

    const { refusal } = await call({
      method: "delete",
      uri: "/security-block-cloud-waf/:id",
      params: { id: PICKED_ID },
    });

    expect(refusal?.message).toBe(
      SECURITY_BLOCK_CLOUD_WAF_MESSAGES.removeWithRemove,
    );
    expect(wafs.get(PICKED_ID)).toBeDefined();
  });

  test.each(WRITERS)(
    "a %s removes it with Remove, or from OneUptime only",
    async (_who: string, permission: Permission) => {
      props = caller(permission);

      const remove: MockedFn = jest
        .spyOn(SecurityBlockCloudWafs, "remove")
        .mockResolvedValue({
          leftInCloud: [
            {
              kind: SecurityBlockCloudWafLeftKind.IpSet,
              name: "oneuptime-x-block-ipv4",
            },
          ],
        }) as unknown as MockedFn;

      const { refusal } = await call({
        method: "post",
        uri: "/security-block-cloud-waf/:cloudWafId/remove",
        params: { cloudWafId: PICKED_ID },
        body: { keepInCloud: true },
      });

      expect(refusal).toBeNull();
      expect(remove).toHaveBeenCalledTimes(1);

      const asked: {
        projectId: ObjectID;
        cloudWafId: ObjectID;
        keepInCloud: boolean;
      } = remove.mock.calls[0]![0] as never;

      expect(asked.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(asked.cloudWafId.toString()).toBe(PICKED_ID);
      expect(asked.keepInCloud).toBe(true);
      expect(answered()).toEqual({
        removed: true,
        leftInCloud: [{ kind: "ipSet", name: "oneuptime-x-block-ipv4" }],
      });
    },
  );

  test("Remove takes OneUptime out first unless told to keep it", async () => {
    props = caller(Permission.SecurityAdmin);

    const remove: MockedFn = jest
      .spyOn(SecurityBlockCloudWafs, "remove")
      .mockResolvedValue({ leftInCloud: [] }) as unknown as MockedFn;

    await call({
      method: "post",
      uri: "/security-block-cloud-waf/:cloudWafId/remove",
      params: { cloudWafId: PICKED_ID },
      body: { keepInCloud: "yes" },
    });

    expect(
      (remove.mock.calls[0]![0] as { keepInCloud: boolean }).keepInCloud,
    ).toBe(false);
  });

  test.each(WRITERS)(
    "a %s checks it again",
    async (_who: string, permission: Permission) => {
      props = caller(permission);

      const checked: SecurityBlockCloudWaf = new SecurityBlockCloudWaf();
      checked._id = PICKED_ID;
      checked.status = SecurityBlockCloudWafStatus.WaitingForRule;
      checked.statusMessage = "prod-alb has no rule that blocks the sets yet.";
      checked.checkedAt = new Date("2026-11-21T10:00:00.000Z");

      const check: MockedFn = jest
        .spyOn(SecurityBlockCloudWafs, "check")
        .mockResolvedValue(checked) as unknown as MockedFn;

      const { refusal } = await call({
        method: "post",
        uri: "/security-block-cloud-waf/:cloudWafId/check",
        params: { cloudWafId: PICKED_ID },
      });

      expect(refusal).toBeNull();
      expect(check).toHaveBeenCalledTimes(1);
      expect(answered()).toEqual({
        cloudWaf: {
          _id: PICKED_ID,
          status: SecurityBlockCloudWafStatus.WaitingForRule,
          statusMessage: "prod-alb has no rule that blocks the sets yet.",
          statusReason: null,
          ruleDetails: null,
          checkedAt: "2026-11-21T10:00:00.000Z",
        },
      });
    },
  );

  test.each(NOT_WRITERS)(
    "a %s may neither check nor remove one",
    async (_who: string, permission: Permission) => {
      props = caller(permission);

      const check: MockedFn = jest.spyOn(
        SecurityBlockCloudWafs,
        "check",
      ) as unknown as MockedFn;
      const remove: MockedFn = jest.spyOn(
        SecurityBlockCloudWafs,
        "remove",
      ) as unknown as MockedFn;

      for (const route of ["check", "remove"]) {
        const { refusal } = await call({
          method: "post",
          uri: `/security-block-cloud-waf/:cloudWafId/${route}`,
          params: { cloudWafId: PICKED_ID },
        });

        expect(refusal).toBeInstanceOf(NotAuthorizedException);
        expect(refusal?.message).toBe(CLOUD_WAF_REFUSED_MESSAGE);
      }

      expect(check).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
    },
  );

  test("an ID that is not one is refused before anything is read", async () => {
    props = caller(Permission.ProjectOwner);

    const { refusal } = await call({
      method: "post",
      uri: "/security-block-cloud-waf/:cloudWafId/check",
      params: { cloudWafId: "not-an-id" },
    });

    expect(refusal?.message).toBe("A valid WAF ID is required.");
  });
});

describe("the web ACLs that may be picked", () => {
  test("lists the project's web ACLs, each with its connection, whether it may block, whether it is listed and whether it is picked", async () => {
    props = caller(Permission.SecurityAdmin);
    wafs.rows.push({
      _id: PICKED_ID,
      projectId: PROJECT_ID.toString(),
      cloudConnectionId: CONNECTION_ID,
      cloudProvider: CloudProvider.AWS,
      wafId: `arn:aws:wafv2:eu-west-1:123456789012:regional/webacl/prod-alb/${AWS_WEB_ACL_ID}`,
      name: "prod-alb",
      version: 1,
    });

    const { refusal } = await call({
      method: "post",
      uri: SECURITY_BLOCK_CLOUD_WAF_CANDIDATES_ROUTE,
    });

    expect(refusal).toBeNull();

    const answer: JSONObject = answered();
    const byName: Map<string, JSONObject> = new Map(
      (answer["candidates"] as Array<JSONObject>).map(
        (candidate: JSONObject): [string, JSONObject] => {
          return [candidate["name"] as string, candidate];
        },
      ),
    );

    // Never another project's.
    expect([...byName.keys()].sort()).toEqual([
      "metrics-only",
      "prod-alb",
      "staging-alb",
    ]);
    expect(byName.get("prod-alb")).toEqual({
      cloudResourceId: WEB_ACL_ID,
      cloudProvider: CloudProvider.AWS,
      kind: SecurityBlockCloudWafKind.AwsWebAcl,
      name: "prod-alb",
      region: "eu-west-1",
      accountId: "123456789012",
      isCloudFront: false,
      cloudArmorPolicyType: null,
      // Where it can read the client's address, the address that connected first.
      clientAddresses: [
        SecurityBlockClientAddress.SourceIp,
        SecurityBlockClientAddress.XForwardedFor,
        SecurityBlockClientAddress.CfConnectingIp,
        SecurityBlockClientAddress.TrueClientIp,
      ],
      connectionId: CONNECTION_ID,
      connectionName: "Production",
      isBlockingOn: true,
      isListed: true,
      refusal: "",
      refusalReason: null,
      isPicked: true,
    });
    expect(byName.get("metrics-only")!["isListed"]).toBe(false);
    expect(byName.get("staging-alb")!["isBlockingOn"]).toBe(false);
    expect(byName.get("staging-alb")!["isPicked"]).toBe(false);
    expect(answer["connections"]).toEqual([
      {
        _id: CONNECTION_ID,
        name: "Production",
        provider: CloudProvider.AWS,
        isBlockingOn: true,
      },
      {
        _id: OFF_CONNECTION_ID,
        name: "Staging",
        provider: CloudProvider.AWS,
        isBlockingOn: false,
      },
    ]);
  });

  test.each(NOT_WRITERS)(
    "a %s is not shown them",
    async (_who: string, permission: Permission) => {
      props = caller(permission);

      const { refusal } = await call({
        method: "post",
        uri: SECURITY_BLOCK_CLOUD_WAF_CANDIDATES_ROUTE,
      });

      expect(refusal?.message).toBe(CLOUD_WAF_REFUSED_MESSAGE);
    },
  );
});
