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
import DataAlertLineageReader from "../../../../Server/Utils/DataObservability/DataAlertLineage";
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
  DEFAULT_DATA_PIPELINE_LINEAGE_DEPTH,
  DataAlertLineageAnswer,
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
 * THE PIPELINE AND DATA ALERT LINEAGE ROUTES.
 *
 * A pipeline's page asks for its lineage - the tables it reads and writes
 * - by the pipeline's id and the steps each way; a data alert's page asks
 * for the alert's lineage, with the ways to its cause and to the alerts it
 * caused, by the alert's id. Anyone who may read data assets may ask, and
 * their API keys; both are read for the person who asked, so a table's open
 * alerts are counted, and an alert found, only as they may see them. A
 * pipeline or alert of another project, or one they may not see, is not
 * found; a malformed id is refused, and someone who may not read data
 * assets is refused before anything is read.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PIPELINE_ID: string = "22222222-2222-4222-8222-222222222222";
const ALERT_ID: string = "44444444-4444-4444-8444-000000000001";
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

// A POST route's own handler, past the session middleware, from the router the API builds.
function handlerOf(path: string): RouteHandler {
  const router: ExpressRouter = new DataObservabilityAPI().getRouter();
  const layer: RouterLayer | undefined = (
    router as unknown as { stack: Array<RouterLayer> }
  ).stack.find((candidate: RouterLayer): boolean => {
    return (
      candidate.route?.path === path && candidate.route.methods["post"] === true
    );
  });

  expect(layer?.route?.stack).toHaveLength(3);

  return layer!.route!.stack[2]!.handle;
}

const PIPELINE_LINEAGE: DataTableLineage = {
  focusNodeId: `pipeline:${PIPELINE_ID}`,
  depth: 1,
  nodes: [
    {
      id: `pipeline:${PIPELINE_ID}`,
      kind: DataLineageNodeKind.Pipeline,
      side: DataLineageSide.Focus,
      depth: 0,
      name: "orders_etl",
      dataPipelineId: PIPELINE_ID,
    },
  ],
  edges: [],
  hiddenDashboardCount: 0,
  isTruncated: false,
};

const ALERT_ANSWER: DataAlertLineageAnswer = {
  lineage: PIPELINE_LINEAGE,
  hasCause: true,
  isCauseDrawn: false,
  consequenceCount: 2,
  drawnConsequenceCount: 1,
};

interface Asked {
  sent: Mock<(...args: Array<unknown>) => unknown>;
  next: Mock<(...args: Array<unknown>) => unknown>;
  read: ReturnType<typeof jest.spyOn>;
}

async function send(
  handler: RouteHandler,
  props: DatabaseCommonInteractionProps,
  request: { body?: JSONObject; params?: Record<string, string> },
  read: ReturnType<typeof jest.spyOn>,
): Promise<Asked> {
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(props);

  const sent: Mock<(...args: Array<unknown>) => unknown> = jest.fn();
  const next: Mock<(...args: Array<unknown>) => unknown> = jest.fn();

  jest
    .spyOn(Response, "sendJsonObjectResponse")
    .mockImplementation(sent as never);

  await handler(
    {
      body: request.body || {},
      params: request.params || {},
    } as unknown as ExpressRequest,
    {} as ExpressResponse,
    next as unknown as NextFunction,
  );

  return { sent, next, read };
}

async function askPipeline(
  props: DatabaseCommonInteractionProps,
  body: JSONObject,
  answer: DataTableLineage | null = PIPELINE_LINEAGE,
): Promise<Asked> {
  return await send(
    handlerOf(DATA_OBSERVABILITY_API_ROUTES.pipelineLineage),
    props,
    { body },
    jest
      .spyOn(DataTableLineageReader, "readPipeline")
      .mockResolvedValue(answer as never),
  );
}

async function askAlert(
  props: DatabaseCommonInteractionProps,
  alertId: string,
  answer: DataAlertLineageAnswer | null = ALERT_ANSWER,
): Promise<Asked> {
  return await send(
    handlerOf(DATA_OBSERVABILITY_API_ROUTES.alertLineage(":id")),
    props,
    { params: { id: alertId } },
    jest
      .spyOn(DataAlertLineageReader, "read")
      .mockResolvedValue(answer as never),
  );
}

function errorOf(asked: Asked): Error {
  expect(asked.sent).not.toHaveBeenCalled();
  expect(asked.next).toHaveBeenCalledTimes(1);

  return asked.next.mock.calls[0]![0] as Error;
}

const LET_IN: Array<[string, Permission]> = [
  ["Read Data Asset", Permission.ReadDataAsset],
  ["Viewer", Permission.Viewer],
  ["Telemetry Viewer", Permission.TelemetryViewer],
  ["Project Member", Permission.ProjectMember],
  ["Project Owner", Permission.ProjectOwner],
];

beforeEach(() => {
  jest.restoreAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the routes", () => {
  test("live where the Dashboard asks for them", () => {
    expect(DATA_OBSERVABILITY_API_ROUTES.pipelineLineage).toBe(
      "/data-observability/pipelines/lineage",
    );
    expect(DATA_OBSERVABILITY_API_ROUTES.alertLineage(ALERT_ID)).toBe(
      `/data-observability/alerts/${ALERT_ID}/lineage`,
    );
  });
});

describe("POST /data-observability/pipelines/lineage", () => {
  test("answers with the pipeline's lineage, read for the person who asked", async () => {
    const props: DatabaseCommonInteractionProps = withPermission(
      Permission.ProjectMember,
    );
    const asked: Asked = await askPipeline(props, {
      dataPipelineId: PIPELINE_ID,
      depth: 2,
    });

    expect(asked.next).not.toHaveBeenCalled();
    expect(asked.sent).toHaveBeenCalledTimes(1);
    expect(asked.sent.mock.calls[0]![2]).toEqual(PIPELINE_LINEAGE);

    const call: {
      projectId: ObjectID;
      dataPipelineId: ObjectID;
      depth: number;
      now: Date;
      reader: DatabaseCommonInteractionProps | null;
    } = asked.read.mock.calls[0]![0] as never;

    expect(call.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(call.dataPipelineId.toString()).toBe(PIPELINE_ID);
    expect(call.depth).toBe(2);
    expect(call.now).toBeInstanceOf(Date);
    // Its tables' alerts are counted as this person may see them.
    expect(call.reader).toBe(props);
  });

  test.each([
    [undefined, DEFAULT_DATA_PIPELINE_LINEAGE_DEPTH],
    ["3", 3],
    [99, MAX_DATA_LINEAGE_DEPTH],
    [0, 1],
    ["lots", DEFAULT_DATA_PIPELINE_LINEAGE_DEPTH],
  ])("asked for %p steps, walks %p", async (depth: unknown, walked: number) => {
    const asked: Asked = await askPipeline(
      withPermission(Permission.ProjectMember),
      {
        dataPipelineId: PIPELINE_ID,
        ...(depth === undefined ? {} : { depth: depth as number }),
      },
    );

    expect((asked.read.mock.calls[0]![0] as { depth: number }).depth).toBe(
      walked,
    );
  });

  test.each(LET_IN)(
    "lets in someone with %s",
    async (_name: string, permission: Permission) => {
      const asked: Asked = await askPipeline(withPermission(permission), {
        dataPipelineId: PIPELINE_ID,
      });

      expect(asked.next).not.toHaveBeenCalled();
      expect(asked.sent).toHaveBeenCalledTimes(1);
    },
  );

  test("refuses someone who may not read data assets, before anything is read", async () => {
    const asked: Asked = await askPipeline(
      withPermission(Permission.CreateDataAsset),
      { dataPipelineId: PIPELINE_ID },
    );

    expect(errorOf(asked).message).toBe(
      "You do not have permission to do this in Data Observability.",
    );
    expect(asked.read).not.toHaveBeenCalled();
  });

  test("lets in a project API key", async () => {
    const asked: Asked = await askPipeline(
      withPermission(Permission.ProjectMember, {
        userId: undefined,
        userType: UserType.API,
      }),
      { dataPipelineId: PIPELINE_ID },
    );

    expect(asked.next).not.toHaveBeenCalled();
    expect(asked.sent).toHaveBeenCalledTimes(1);
  });

  test.each([
    [{}],
    [{ dataPipelineId: "orders_etl" }],
    [{ dataPipelineId: 42 }],
    [{ dataAssetId: PIPELINE_ID }],
  ])("refuses a pipeline not named by its id: %p", async (body: JSONObject) => {
    const asked: Asked = await askPipeline(
      withPermission(Permission.ProjectMember),
      body,
    );
    const error: Error = errorOf(asked);

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe("Name the pipeline by its ID.");
    expect(asked.read).not.toHaveBeenCalled();
  });

  test("a pipeline that is not the project's is not found", async () => {
    const asked: Asked = await askPipeline(
      withPermission(Permission.ProjectMember),
      { dataPipelineId: PIPELINE_ID },
      null,
    );
    const error: Error = errorOf(asked);

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe("Pipeline not found.");
  });
});

describe("POST /data-observability/alerts/:id/lineage", () => {
  test("answers with the alert's lineage and its ways, read for the person who asked", async () => {
    const props: DatabaseCommonInteractionProps = withPermission(
      Permission.ProjectMember,
    );
    const asked: Asked = await askAlert(props, ALERT_ID);

    expect(asked.next).not.toHaveBeenCalled();
    expect(asked.sent).toHaveBeenCalledTimes(1);
    expect(asked.sent.mock.calls[0]![2]).toEqual(ALERT_ANSWER);

    const call: {
      projectId: ObjectID;
      alertId: ObjectID;
      now: Date;
      reader: DatabaseCommonInteractionProps | null;
    } = asked.read.mock.calls[0]![0] as never;

    expect(call.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(call.alertId.toString()).toBe(ALERT_ID);
    expect(call.now).toBeInstanceOf(Date);
    // Its alerts, its cause and what it caused, as this person may see them.
    expect(call.reader).toBe(props);
  });

  test("an alert about a whole database: told, with no drawing", async () => {
    const answer: DataAlertLineageAnswer = {
      lineage: null,
      hasCause: false,
      isCauseDrawn: false,
      consequenceCount: 4,
      drawnConsequenceCount: 0,
    };
    const asked: Asked = await askAlert(
      withPermission(Permission.ProjectMember),
      ALERT_ID,
      answer,
    );

    expect(asked.sent.mock.calls[0]![2]).toEqual(answer);
  });

  test.each(LET_IN)(
    "lets in someone with %s",
    async (_name: string, permission: Permission) => {
      const asked: Asked = await askAlert(withPermission(permission), ALERT_ID);

      expect(asked.next).not.toHaveBeenCalled();
      expect(asked.sent).toHaveBeenCalledTimes(1);
    },
  );

  test("refuses someone who may not read data assets, before anything is read", async () => {
    const asked: Asked = await askAlert(
      withPermission(Permission.CreateDataAsset),
      ALERT_ID,
    );

    expect(errorOf(asked).message).toBe(
      "You do not have permission to do this in Data Observability.",
    );
    expect(asked.read).not.toHaveBeenCalled();
  });

  test("lets in a project API key", async () => {
    const asked: Asked = await askAlert(
      withPermission(Permission.ProjectMember, {
        userId: undefined,
        userType: UserType.API,
      }),
      ALERT_ID,
    );

    expect(asked.next).not.toHaveBeenCalled();
    expect(asked.sent).toHaveBeenCalledTimes(1);
  });

  test.each([["orders"], [""], ["44444444-4444-4444-8444"]])(
    "refuses an alert not named by its id: %p",
    async (alertId: string) => {
      const asked: Asked = await askAlert(
        withPermission(Permission.ProjectMember),
        alertId,
      );
      const error: Error = errorOf(asked);

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toBe("Not found.");
      expect(asked.read).not.toHaveBeenCalled();
    },
  );

  test("an alert of another project, no data alert, or one they may not see is not found", async () => {
    const asked: Asked = await askAlert(
      withPermission(Permission.ProjectMember),
      ALERT_ID,
      null,
    );
    const error: Error = errorOf(asked);

    expect(error).toBeInstanceOf(BadDataException);
    // The same words whatever the reason: whether a private alert exists is not told.
    expect(error.message).toBe("Alert not found.");
  });
});
