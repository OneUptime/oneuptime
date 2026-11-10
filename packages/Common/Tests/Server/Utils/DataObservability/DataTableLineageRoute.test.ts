import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import CommonAPI from "../../../../Server/API/CommonAPI";
import DataObservabilityAPI from "../../../../Server/API/DataObservabilityAPI";
import DataTableLineageReader from "../../../../Server/Utils/DataObservability/DataTableLineage";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../../../../Server/Utils/Express";
import Response from "../../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { DATA_OBSERVABILITY_API_ROUTES } from "../../../../Types/DataObservability/DataObservabilityApiTypes";
import {
  DEFAULT_DATA_LINEAGE_DEPTH,
  DataLineageNodeKind,
  DataLineageSide,
  DataTableLineage,
  MAX_DATA_LINEAGE_DEPTH,
} from "../../../../Types/DataObservability/DataTableLineage";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";

/*
 * THE TABLE-LINEAGE ROUTE: WHAT A TABLE'S LINEAGE TAB ASKS.
 *
 * Anyone who may read data assets - and their API keys, so a build in CI
 * can ask what a change reaches - names a table by its id and the steps
 * each way; the answer is that table's lineage, its open alerts counted as
 * the person who asked may see them. A table of another project is not
 * found, a malformed id is refused, and someone who may not read data
 * assets is refused before anything is read.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const TABLE_ID: string = "22222222-2222-4222-8222-222222222222";
const USER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-000000000001");

type RouteHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

type RouterLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: RouteHandler }>;
  };
};

function withPermission(
  permission: Permission,
  fields: Partial<DatabaseCommonInteractionProps> = {},
): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userType: UserType.User,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: [
          {
            _type: "UserPermission",
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
          },
        ],
      },
    },
    ...fields,
  };
}

// The route's own handler, past the session middleware, from the router the API builds.
function lineageHandler(): RouteHandler {
  const router: ExpressRouter = new DataObservabilityAPI().getRouter();
  const layer: RouterLayer | undefined = (
    router as unknown as { stack: Array<RouterLayer> }
  ).stack.find((candidate: RouterLayer): boolean => {
    return (
      candidate.route?.path === DATA_OBSERVABILITY_API_ROUTES.tableLineage &&
      candidate.route.methods["post"] === true
    );
  });

  expect(layer?.route?.stack).toHaveLength(3);

  return layer!.route!.stack[2]!.handle;
}

const LINEAGE: DataTableLineage = {
  focusNodeId: `table:${TABLE_ID}`,
  depth: 3,
  nodes: [
    {
      id: `table:${TABLE_ID}`,
      kind: DataLineageNodeKind.Table,
      side: DataLineageSide.Focus,
      depth: 0,
      name: "public.orders",
      dataAssetId: TABLE_ID,
    },
  ],
  edges: [],
  hiddenDashboardCount: 0,
  isTruncated: false,
};

interface Asked {
  sent: Mock<(...args: Array<unknown>) => unknown>;
  next: Mock<(...args: Array<unknown>) => unknown>;
  read: ReturnType<typeof jest.spyOn>;
}

async function ask(
  props: DatabaseCommonInteractionProps,
  body: JSONObject,
  answer: DataTableLineage | null = LINEAGE,
): Promise<Asked> {
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(props);

  const read: ReturnType<typeof jest.spyOn> = jest
    .spyOn(DataTableLineageReader, "read")
    .mockResolvedValue(answer as never);
  const sent: Mock<(...args: Array<unknown>) => unknown> = jest.fn();
  const next: Mock<(...args: Array<unknown>) => unknown> = jest.fn();

  jest
    .spyOn(Response, "sendJsonObjectResponse")
    .mockImplementation(sent as never);

  await lineageHandler()(
    { body } as unknown as ExpressRequest,
    {} as ExpressResponse,
    next as unknown as NextFunction,
  );

  return { sent, next, read };
}

function errorOf(asked: Asked): Error {
  expect(asked.sent).not.toHaveBeenCalled();
  expect(asked.next).toHaveBeenCalledTimes(1);

  return asked.next.mock.calls[0]![0] as Error;
}

beforeEach(() => {
  jest.restoreAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /data-observability/tables/lineage", () => {
  test("answers with the table's lineage, read for the person who asked", async () => {
    const props: DatabaseCommonInteractionProps = withPermission(
      Permission.ProjectMember,
    );
    const asked: Asked = await ask(props, { dataAssetId: TABLE_ID, depth: 2 });

    expect(asked.next).not.toHaveBeenCalled();
    expect(asked.sent).toHaveBeenCalledTimes(1);
    expect(asked.sent.mock.calls[0]![2]).toEqual(LINEAGE);

    const call: {
      projectId: ObjectID;
      dataAssetId: ObjectID;
      depth: number;
      now: Date;
      reader: DatabaseCommonInteractionProps | null;
    } = asked.read.mock.calls[0]![0] as never;

    expect(call.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(call.dataAssetId.toString()).toBe(TABLE_ID);
    expect(call.depth).toBe(2);
    expect(call.now).toBeInstanceOf(Date);
    // Its alerts are counted as this person may see them.
    expect(call.reader).toBe(props);
  });

  test.each([
    [undefined, DEFAULT_DATA_LINEAGE_DEPTH],
    ["5", 5],
    [99, MAX_DATA_LINEAGE_DEPTH],
    [0, 1],
    ["lots", DEFAULT_DATA_LINEAGE_DEPTH],
  ])(
    "asked for %p steps, walks %p",
    async (depth: unknown, walked: number) => {
      const asked: Asked = await ask(withPermission(Permission.ProjectMember), {
        dataAssetId: TABLE_ID,
        ...(depth === undefined ? {} : { depth: depth as number }),
      });

      expect((asked.read.mock.calls[0]![0] as { depth: number }).depth).toBe(
        walked,
      );
    },
  );

  test.each([
    ["Read Data Asset", Permission.ReadDataAsset],
    ["Viewer", Permission.Viewer],
    ["Telemetry Viewer", Permission.TelemetryViewer],
    ["Project Owner", Permission.ProjectOwner],
  ])(
    "lets in someone with %s",
    async (_name: string, permission: Permission) => {
      const asked: Asked = await ask(withPermission(permission), {
        dataAssetId: TABLE_ID,
      });

      expect(asked.next).not.toHaveBeenCalled();
      expect(asked.sent).toHaveBeenCalledTimes(1);
    },
  );

  test("refuses someone who may not read data assets, before anything is read", async () => {
    const asked: Asked = await ask(withPermission(Permission.CreateDataAsset), {
      dataAssetId: TABLE_ID,
    });

    expect(errorOf(asked).message).toBe(
      "You do not have permission to do this in Data Observability.",
    );
    expect(asked.read).not.toHaveBeenCalled();
  });

  test("lets in a project API key, so a build in CI can ask", async () => {
    const asked: Asked = await ask(
      withPermission(Permission.ProjectMember, {
        userId: undefined,
        userType: UserType.API,
      }),
      { dataAssetId: TABLE_ID },
    );

    expect(asked.next).not.toHaveBeenCalled();
    expect(asked.sent).toHaveBeenCalledTimes(1);
  });

  test.each([[{}], [{ dataAssetId: "orders" }], [{ dataAssetId: 42 }]])(
    "refuses a table not named by its id: %p",
    async (body: JSONObject) => {
      const asked: Asked = await ask(
        withPermission(Permission.ProjectMember),
        body,
      );
      const error: Error = errorOf(asked);

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toBe("Name the table by its ID.");
      expect(asked.read).not.toHaveBeenCalled();
    },
  );

  test("a table that is not the project's is not found", async () => {
    const asked: Asked = await ask(
      withPermission(Permission.ProjectMember),
      { dataAssetId: TABLE_ID },
      null,
    );
    const error: Error = errorOf(asked);

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe("Table not found.");
  });
});
