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
 * WHO MAY READ, BLOCK, LIFT AND EXTEND, THROUGH THE ROUTES THE BLOCKLIST
 * PAGE AND THE API CALL (#10338):
 *
 *   POST   /security-block               block an address (the CRUD create)
 *   POST   /security-block/get-list      read the blocklist
 *   PUT    /security-block/:id           lift it, or move its end
 *   DELETE /security-block/:id           never: a block is lifted, not deleted
 *   POST   /security-block/check         what a block of a value would meet
 *   POST   /security-block/destinations  where the blocklist is enforced
 *
 * Project Owner, Project Admin, Security Admin and Security Member block and
 * lift; Security Viewer reads; a block kept until someone lifts it takes a
 * Security Admin, a Project Admin or a Project Owner; a member with no
 * Security role reads nothing of it.
 *
 * Nothing is stubbed between the route and the blocks table but the table
 * itself, held in memory: the caller's real permission rows go through the
 * real permission layer. What lies past the write - the case's timeline,
 * the reconcile it queues, what protects an address - stands in for itself.
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

import CommonAPI from "../../../Server/API/CommonAPI";
import SecurityBlockAPI, {
  CHECK_REFUSED_MESSAGE,
  DESTINATIONS_REFUSED_MESSAGE,
  SECURITY_BLOCK_CHECK_ROUTE,
  SECURITY_BLOCK_DESTINATIONS_ROUTE,
} from "../../../Server/API/SecurityBlockAPI";
import SecurityBlockCloudWafService from "../../../Server/Services/SecurityBlockCloudWafService";
import SecurityBlockService from "../../../Server/Services/SecurityBlockService";
import SecurityCaseFeedService from "../../../Server/Services/SecurityCaseFeedService";
import SecurityEventConnectionService from "../../../Server/Services/SecurityEventConnectionService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import SecurityBlocklistJobs from "../../../Server/Utils/SecurityBlocklist/SecurityBlocklistJobs";
import SecurityBlockDestinations from "../../../Server/Utils/SecurityBlocklist/SecurityBlockDestinations";
import SecurityProtectedAddresses from "../../../Server/Utils/SecurityBlocklist/SecurityProtectedAddresses";
import TestSecurityBlockDestination from "../../../Server/Utils/SecurityBlocklist/TestSecurityBlockDestination";
import CrowdStrikeBlockDestination from "../../../Server/Utils/SecurityBlocklist/Destinations/CrowdStrikeBlockDestination";
import MicrosoftDefenderBlockDestination from "../../../Server/Utils/SecurityBlocklist/Destinations/MicrosoftDefenderBlockDestination";
import CrowdStrikeFalconResponseClient from "../../../Server/Utils/SecurityEvent/Response/CrowdStrikeFalconResponseClient";
import MicrosoftDefenderEndpointClient from "../../../Server/Utils/SecurityEvent/Response/MicrosoftDefenderEndpointClient";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Exception from "../../../Types/Exception/Exception";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  SecurityBlockAction,
  SecurityBlockIndicatorType,
  SecurityBlockSource,
  SecurityBlockState,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import { SecurityBlockDestinationProvider } from "../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import { SecurityProtectedAddressSource } from "../../../Types/SecurityBlocklist/SecurityProtectedAddress";
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
const BLOCK_ID: string = "5c1e7a40-5c2d-4e8f-9a61-7d0c2b4e6f02";

const HOUR_IN_MS: number = 60 * 60 * 1000;

const BLOCKERS: Array<[string, Permission]> = [
  ["Project Owner", Permission.ProjectOwner],
  ["Project Admin", Permission.ProjectAdmin],
  ["Security Admin", Permission.SecurityAdmin],
  ["Security Member", Permission.SecurityMember],
];

const READERS: Array<[string, Permission]> = [
  ...BLOCKERS,
  ["Security Viewer", Permission.SecurityViewer],
];

// Those who may keep a block until someone lifts it.
const ADMINS: Array<[string, Permission]> = [
  ["Project Owner", Permission.ProjectOwner],
  ["Project Admin", Permission.ProjectAdmin],
  ["Security Admin", Permission.SecurityAdmin],
];

let props: DatabaseCommonInteractionProps;
let table: InMemoryTable;
let reconcile: MockedFn;

const sendJsonObjectResponseMock: MockedFn =
  Response.sendJsonObjectResponse as unknown as MockedFn;
const sendEntityArrayResponseMock: MockedFn =
  Response.sendEntityArrayResponse as unknown as MockedFn;

function caller(permission: Permission): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: [permission], projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

function activeBlock(): StoredRow {
  return {
    _id: BLOCK_ID,
    projectId: PROJECT_ID.toString(),
    value: "35.205.11.131",
    indicatorType: SecurityBlockIndicatorType.IpAddress,
    action: SecurityBlockAction.Block,
    state: SecurityBlockState.Active,
    expiresAt: new Date(Date.now() + 24 * HOUR_IN_MS),
    source: SecurityBlockSource.Person,
    createdAt: new Date(Date.now() - HOUR_IN_MS),
    version: 1,
  };
}

// The route's answer: what it sent, or what it handed to next.
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

beforeAll(() => {
  mockRouter.routes.length = 0;
  new SecurityBlockAPI();
});

beforeEach(() => {
  jest.clearAllMocks();

  everyServerProductIsOn();

  table = useInMemoryTable(
    SecurityBlockService as unknown as DatabaseService<BaseModel>,
    [activeBlock()],
  );

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return props;
    });

  jest
    .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
    .mockResolvedValue(undefined as never);
  reconcile = jest
    .spyOn(SecurityBlocklistJobs, "queueReconcile")
    .mockResolvedValue(undefined) as unknown as MockedFn;
  jest
    .spyOn(SecurityProtectedAddresses, "findProtection")
    .mockResolvedValue({ protection: null, unreadSources: [] });
  // The project has picked no cloud WAF (#10344): its production source lists none.
  jest
    .spyOn(SecurityBlockCloudWafService, "findForProject")
    .mockResolvedValue([]);
  // No Microsoft Defender or CrowdStrike Falcon connection blocks (#10346): the default destinations find none.
  jest.spyOn(SecurityEventConnectionService, "findBy").mockResolvedValue([]);
});

afterEach(() => {
  SecurityBlockDestinations.resetSourcesForTests();
  jest.restoreAllMocks();
});

describe("blocking an address", () => {
  test.each(BLOCKERS)(
    "a %s blocks one",
    async (_who: string, permission: Permission) => {
      props = caller(permission);

      const { refusal } = await call({
        method: "post",
        uri: "/security-block",
        body: {
          data: { projectId: PROJECT_ID.toString(), value: "198.51.100.7" },
        },
      });

      expect(refusal).toBeNull();
      expect(
        table.rows.map((row: StoredRow): unknown => {
          return row["value"];
        }),
      ).toEqual(["35.205.11.131", "198.51.100.7"]);
      expect(reconcile).toHaveBeenCalledTimes(1);
    },
  );

  test.each([
    ["Security Viewer", Permission.SecurityViewer],
    ["Project Member", Permission.ProjectMember],
    ["Project Viewer", Permission.Viewer],
  ])("a %s may not", async (_who: string, permission: Permission) => {
    props = caller(permission);

    const { refusal } = await call({
      method: "post",
      uri: "/security-block",
      body: {
        data: { projectId: PROJECT_ID.toString(), value: "198.51.100.7" },
      },
    });

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect(refusal?.message).toBe(
      "You do not have permissions to create Block. You need one of these permissions: Project Owner, Project Admin, Security Admin, Security Member, Create Security Block",
    );
    expect(table.rows).toHaveLength(1);
    expect(reconcile).not.toHaveBeenCalled();
  });

  test.each(ADMINS)(
    "a %s may keep a block until someone lifts it",
    async (_who: string, permission: Permission) => {
      props = caller(permission);

      const { refusal } = await call({
        method: "post",
        uri: "/security-block",
        body: {
          data: {
            projectId: PROJECT_ID.toString(),
            value: "198.51.100.7",
            expiresAt: null,
          },
        },
      });

      expect(refusal).toBeNull();
      expect(table.rows[1]!["expiresAt"]).toBeNull();
    },
  );

  test("a Security Member may not keep one until someone lifts it", async () => {
    props = caller(Permission.SecurityMember);

    const { refusal } = await call({
      method: "post",
      uri: "/security-block",
      body: {
        data: {
          projectId: PROJECT_ID.toString(),
          value: "198.51.100.7",
          expiresAt: null,
        },
      },
    });

    expect(refusal?.message).toContain("Only a Security Admin");
    expect(table.rows).toHaveLength(1);
  });

  test("a protected address is refused with what protects it", async () => {
    props = caller(Permission.ProjectOwner);
    jest.spyOn(SecurityProtectedAddresses, "findProtection").mockResolvedValue({
      protection: {
        source: SecurityProtectedAddressSource.OneUptimeCloud,
        protectedValue: "198.51.100.0/24",
        name: "OneUptime Cloud",
      },
      unreadSources: [],
    });

    const { refusal } = await call({
      method: "post",
      uri: "/security-block",
      body: {
        data: { projectId: PROJECT_ID.toString(), value: "198.51.100.7" },
      },
    });

    expect(refusal?.message).toBe(
      "198.51.100.7 is inside 198.51.100.0/24. 198.51.100.0/24 is one of OneUptime Cloud's probe addresses.",
    );
    expect(table.rows).toHaveLength(1);
  });
});

describe("reading the blocklist", () => {
  test.each(READERS)(
    "a %s reads it",
    async (_who: string, permission: Permission) => {
      props = caller(permission);

      const { refusal } = await call({
        method: "post",
        uri: "/security-block/get-list",
        body: {
          query: {},
          select: { value: true },
        },
      });

      expect(refusal).toBeNull();
      expect(sendEntityArrayResponseMock).toHaveBeenCalledTimes(1);
    },
  );

  test.each([
    ["Project Member", Permission.ProjectMember],
    ["Project Viewer", Permission.Viewer],
  ])("a %s does not", async (_who: string, permission: Permission) => {
    props = caller(permission);

    const { refusal } = await call({
      method: "post",
      uri: "/security-block/get-list",
      body: { query: {}, select: { value: true } },
    });

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect(refusal?.message).toBe(
      "You do not have permissions to read Block. You need one of these permissions: Project Owner, Project Admin, Security Admin, Security Member, Security Viewer, Read Security Block",
    );
    expect(sendEntityArrayResponseMock).not.toHaveBeenCalled();
  });
});

describe("lifting and extending a block", () => {
  test.each(BLOCKERS)(
    "a %s lifts one",
    async (_who: string, permission: Permission) => {
      props = caller(permission);

      const { refusal } = await call({
        method: "put",
        uri: "/security-block/:id",
        params: { id: BLOCK_ID },
        body: {
          data: { state: SecurityBlockState.Lifted, liftReason: "Ours" },
        },
      });

      expect(refusal).toBeNull();
      expect(table.get(BLOCK_ID)!["state"]).toBe(SecurityBlockState.Lifted);
      expect(String(table.get(BLOCK_ID)!["liftedByUserId"])).toBe(
        props.userId!.toString(),
      );
    },
  );

  test.each(BLOCKERS)(
    "a %s extends one",
    async (_who: string, permission: Permission) => {
      props = caller(permission);
      const until: Date = new Date(Date.now() + 7 * 24 * HOUR_IN_MS);

      const { refusal } = await call({
        method: "put",
        uri: "/security-block/:id",
        params: { id: BLOCK_ID },
        body: { data: { expiresAt: until.toISOString() } },
      });

      expect(refusal).toBeNull();
      expect(
        new Date(table.get(BLOCK_ID)!["expiresAt"] as Date).getTime(),
      ).toBe(until.getTime());
    },
  );

  test("a Security Viewer may not lift one", async () => {
    props = caller(Permission.SecurityViewer);

    const { refusal } = await call({
      method: "put",
      uri: "/security-block/:id",
      params: { id: BLOCK_ID },
      body: { data: { state: SecurityBlockState.Lifted } },
    });

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect(refusal?.message).toBe(
      "You do not have permissions to update Block. You need one of these permissions: Project Owner, Project Admin, Security Admin, Security Member, Edit Security Block",
    );
    expect(table.get(BLOCK_ID)!["state"]).toBe(SecurityBlockState.Active);
  });

  test.each(ADMINS)(
    "a %s makes one permanent",
    async (_who: string, permission: Permission) => {
      props = caller(permission);

      const { refusal } = await call({
        method: "put",
        uri: "/security-block/:id",
        params: { id: BLOCK_ID },
        body: { data: { expiresAt: null } },
      });

      expect(refusal).toBeNull();
      expect(table.get(BLOCK_ID)!["expiresAt"]).toBeNull();
    },
  );

  test("a Security Member may not make one permanent", async () => {
    props = caller(Permission.SecurityMember);

    const { refusal } = await call({
      method: "put",
      uri: "/security-block/:id",
      params: { id: BLOCK_ID },
      body: { data: { expiresAt: null } },
    });

    expect(refusal?.message).toContain("Only a Security Admin");
    expect(table.get(BLOCK_ID)!["expiresAt"]).not.toBeNull();
  });

  test.each(READERS)(
    "a %s may not delete one",
    async (_who: string, permission: Permission) => {
      props = caller(permission);

      const { refusal } = await call({
        method: "delete",
        uri: "/security-block/:id",
        params: { id: BLOCK_ID },
      });

      // Nobody holds the permission to delete a block: it is lifted.
      expect(refusal).toBeInstanceOf(NotAuthorizedException);
      expect(refusal?.message).toBe("delete on Block is not allowed.");
      expect(table.get(BLOCK_ID)).toBeTruthy();
      expect(table.deletes).toEqual([]);
    },
  );
});

describe("POST /security-block/check", () => {
  test.each(BLOCKERS)(
    "a %s asks what a block would meet: the value as kept, and whether it holds their own address",
    async (_who: string, permission: Permission) => {
      props = caller(permission);

      const { refusal } = await call({
        method: "post",
        uri: SECURITY_BLOCK_CHECK_ROUTE,
        body: { value: "35.205.11.131/24" },
      });

      expect(refusal).toBeNull();
      expect(answered()).toEqual(
        expect.objectContaining({
          value: "35.205.11.0/24",
          indicatorType: SecurityBlockIndicatorType.IpRange,
          problem: null,
          isWiderThanLargestRange: false,
          // The active 35.205.11.131 sits inside it, but a range is not covered by an address.
          coveredBy: null,
          protection: null,
          cannotTell: false,
        }),
      );
    },
  );

  test("a value an active block covers names that block", async () => {
    props = caller(Permission.SecurityMember);

    await call({
      method: "post",
      uri: SECURITY_BLOCK_CHECK_ROUTE,
      body: { value: "35.205.11.131" },
    });

    expect(answered()["coveredBy"]).toEqual(
      expect.objectContaining({ _id: BLOCK_ID, value: "35.205.11.131" }),
    );
  });

  test("a Security Viewer may not ask, as what it answers is what a block would be told", async () => {
    props = caller(Permission.SecurityViewer);

    const { refusal } = await call({
      method: "post",
      uri: SECURITY_BLOCK_CHECK_ROUTE,
      body: { value: "35.205.11.131" },
    });

    expect(refusal?.message).toBe(CHECK_REFUSED_MESSAGE);
  });
});

describe("POST /security-block/destinations", () => {
  test.each(READERS)(
    "a %s reads where the blocklist is enforced: nowhere, until a destination is connected",
    async (_who: string, permission: Permission) => {
      props = caller(permission);

      const { refusal } = await call({
        method: "post",
        uri: SECURITY_BLOCK_DESTINATIONS_ROUTE,
      });

      expect(refusal).toBeNull();
      expect(answered()).toEqual({ destinations: [], cannotTell: false });
    },
  );

  test("names each destination, and says when a kind of destination could not be listed", async () => {
    props = caller(Permission.SecurityViewer);
    SecurityBlockDestinations.setSourcesForTests([
      {
        provider: SecurityBlockDestinationProvider.Test,
        findForProject: async () => {
          return [new TestSecurityBlockDestination({ name: "Edge" })];
        },
      },
      {
        provider: SecurityBlockDestinationProvider.Test,
        findForProject: async () => {
          throw new Error("down");
        },
      },
    ]);

    await call({ method: "post", uri: SECURITY_BLOCK_DESTINATIONS_ROUTE });

    expect(answered()).toEqual({
      destinations: [
        {
          key: "Test:destination",
          name: "Edge",
          provider: SecurityBlockDestinationProvider.Test,
          // What it holds, and where (#10346): the test destination holds every kind, at the edge.
          blocks: [
            SecurityBlockIndicatorType.IpAddress,
            SecurityBlockIndicatorType.IpRange,
            SecurityBlockIndicatorType.Domain,
            SecurityBlockIndicatorType.Url,
            SecurityBlockIndicatorType.FileSha256,
            SecurityBlockIndicatorType.FileSha1,
            SecurityBlockIndicatorType.FileMd5,
          ],
          enforcesOnEveryMachine: false,
          quarantinesFiles: false,
        },
      ],
      cannotTell: true,
    });
  });

  test("Microsoft Defender and CrowdStrike Falcon block on every machine: what each holds, and which quarantines a file (#10346)", async () => {
    props = caller(Permission.SecurityViewer);
    const connectionId: ObjectID = new ObjectID(
      "6f0a2c3e-4b5d-4e6f-8a7b-9c0d1e2f3a4b",
    );
    SecurityBlockDestinations.setSourcesForTests([
      {
        provider: SecurityBlockDestinationProvider.MicrosoftDefender,
        findForProject: async () => {
          return [
            new MicrosoftDefenderBlockDestination({
              connectionId,
              name: "Microsoft Defender",
              // Listing destinations never calls the product.
              client: {} as MicrosoftDefenderEndpointClient,
            }),
          ];
        },
      },
      {
        provider: SecurityBlockDestinationProvider.CrowdStrike,
        findForProject: async () => {
          return [
            new CrowdStrikeBlockDestination({
              connectionId,
              name: "CrowdStrike Falcon",
              client: {} as CrowdStrikeFalconResponseClient,
            }),
          ];
        },
      },
    ]);

    await call({ method: "post", uri: SECURITY_BLOCK_DESTINATIONS_ROUTE });

    expect(answered()).toEqual({
      destinations: [
        {
          key: `MicrosoftDefender:${connectionId.toString()}`,
          name: "Microsoft Defender",
          provider: SecurityBlockDestinationProvider.MicrosoftDefender,
          // One address at a time, never a range; every kind of file hash.
          blocks: [
            SecurityBlockIndicatorType.IpAddress,
            SecurityBlockIndicatorType.Domain,
            SecurityBlockIndicatorType.Url,
            SecurityBlockIndicatorType.FileSha256,
            SecurityBlockIndicatorType.FileSha1,
            SecurityBlockIndicatorType.FileMd5,
          ],
          enforcesOnEveryMachine: true,
          quarantinesFiles: true,
        },
        {
          key: `CrowdStrike:${connectionId.toString()}`,
          name: "CrowdStrike Falcon",
          provider: SecurityBlockDestinationProvider.CrowdStrike,
          // Falcon prevents files by SHA-256 or MD5 only.
          blocks: [
            SecurityBlockIndicatorType.FileSha256,
            SecurityBlockIndicatorType.FileMd5,
          ],
          enforcesOnEveryMachine: true,
          quarantinesFiles: false,
        },
      ],
      cannotTell: false,
    });
  });

  test("a member with no Security role reads nothing of it", async () => {
    props = caller(Permission.ProjectMember);

    const { refusal } = await call({
      method: "post",
      uri: SECURITY_BLOCK_DESTINATIONS_ROUTE,
    });

    expect(refusal?.message).toBe(DESTINATIONS_REFUSED_MESSAGE);
  });
});
