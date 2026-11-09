import { mockRouter } from "Common/Tests/Server/API/Helpers";
import ProbeService from "Common/Server/Services/ProbeService";
import MonitorProbeService from "Common/Server/Services/MonitorProbeService";
import CommonAPI from "Common/Server/API/CommonAPI";
import Response from "Common/Server/Utils/Response";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorProbe, {
  MonitorStepProbeResponse,
} from "Common/Models/DatabaseModels/MonitorProbe";
import Probe from "Common/Models/DatabaseModels/Probe";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
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

jest.mock("Common/Server/API/CommonAPI", () => {
  return {
    __esModule: true,
    default: {
      getDatabaseCommonInteractionProps: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ProbeService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/MonitorProbeService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

/*
 * THE LATENCY GRID READS EACH PAIR'S LATEST CHECK AS ONEUPTIME DOES (#6341).
 *
 * A probe's latest check (MonitorProbe.lastMonitoringLog) holds the whole
 * response, and a person's read of it is redacted first
 * (MonitorProbeService.onFindSuccess) - per row, with a read of each
 * row's monitor. The grid needs three numbers of it: the latency, the
 * state and the time. So it reads which pairs the person may see with the
 * person's own permissions, then the latest checks of exactly those pairs
 * as OneUptime reads them, and only the three numbers leave the endpoint.
 */

import NetworkLatencyMatrixAPI from "../../FeatureSet/BaseAPI/API/NetworkLatencyMatrix";

new NetworkLatencyMatrixAPI().getRouter();

const PROJECT_ID: ObjectID = ObjectID.generate();
const PROBE_ID: ObjectID = ObjectID.generate();
const MONITOR_ID: ObjectID = ObjectID.generate();
const STEP_ID: string = ObjectID.generate().toString();

const PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: ObjectID.generate(),
};

const commonAPI: { getDatabaseCommonInteractionProps: jest.Mock } =
  CommonAPI as unknown as { getDatabaseCommonInteractionProps: jest.Mock };
const probeService: { findBy: jest.Mock } = ProbeService as unknown as {
  findBy: jest.Mock;
};
const monitorProbeService: { findBy: jest.Mock } =
  MonitorProbeService as unknown as { findBy: jest.Mock };
const responseUtil: { sendJsonObjectResponse: jest.Mock } =
  Response as unknown as { sendJsonObjectResponse: jest.Mock };

function pair(id: ObjectID): MonitorProbe {
  const monitor: Monitor = new Monitor();
  monitor.id = MONITOR_ID;
  monitor.name = "Checkout API";

  const row: MonitorProbe = new MonitorProbe();
  row.id = id;
  row.monitorId = MONITOR_ID;
  row.probeId = PROBE_ID;
  row.monitor = monitor;
  return row;
}

// A latest check as the column holds it: the response, body and all.
function lastCheckOf(id: ObjectID): MonitorProbe {
  const row: MonitorProbe = new MonitorProbe();
  row.id = id;
  row.lastMonitoringLog = {
    [STEP_ID]: {
      isOnline: true,
      responseTimeInMs: 182,
      monitoredAt: new Date(Date.now() - 30_000).toISOString(),
      responseBody: '{"owner":"jane@acme.example","password":"hunter2"}',
      responseHeaders: { authorization: "Bearer live-token" },
    },
  } as unknown as MonitorStepProbeResponse;
  return row;
}

async function requestGrid(): Promise<NextFunction> {
  const next: NextFunction = jest.fn() as unknown as NextFunction;

  await mockRouter
    .match("post", "/network-device/latency-matrix")
    .handlerFunction(
      { body: {} } as unknown as ExpressRequest,
      {} as ExpressResponse,
      next,
    );

  return next;
}

function readOf(index: number): JSONObject {
  return monitorProbeService.findBy.mock.calls[index]![0] as JSONObject;
}

/*
 * The ids a QueryHelper.any condition matches: its parameter's name is
 * made up each time, so the condition is read by its values.
 */
function idsIn(condition: unknown): Array<string> {
  expect(Object.keys(QueryHelper.any([ObjectID.generate()]))).toEqual(
    Object.keys(condition as JSONObject),
  );

  const parameters: Record<string, unknown> =
    (condition as { _objectLiteralParameters?: Record<string, unknown> })
      ._objectLiteralParameters || {};

  return Object.values(parameters).reduce(
    (ids: Array<string>, value: unknown): Array<string> => {
      return ids.concat(value as Array<string>);
    },
    [],
  );
}

describe("the latency grid's reads of each pair's latest check", () => {
  const pairId: ObjectID = ObjectID.generate();

  beforeEach(() => {
    commonAPI.getDatabaseCommonInteractionProps.mockReset();
    probeService.findBy.mockReset();
    monitorProbeService.findBy.mockReset();
    responseUtil.sendJsonObjectResponse.mockReset();

    commonAPI.getDatabaseCommonInteractionProps.mockResolvedValue(PROPS);

    const probe: Probe = new Probe();
    probe.id = PROBE_ID;
    probe.name = "Frankfurt";
    probeService.findBy.mockResolvedValue([probe]);

    monitorProbeService.findBy.mockImplementation(
      (options: unknown): Promise<Array<MonitorProbe>> => {
        const props: DatabaseCommonInteractionProps = (options as JSONObject)[
          "props"
        ] as DatabaseCommonInteractionProps;

        return Promise.resolve(
          props.isRoot ? [lastCheckOf(pairId)] : [pair(pairId)],
        );
      },
    );
  });

  test("which pairs the person may see is read with their own permissions, without the checks", async () => {
    const next: NextFunction = await requestGrid();

    expect(next).not.toHaveBeenCalled();

    const scoped: JSONObject = readOf(0);

    expect(scoped["props"]).toBe(PROPS);
    expect(scoped["query"]).toEqual({ projectId: PROJECT_ID });
    expect(Object.keys(scoped["select"] as JSONObject)).not.toContain(
      "lastMonitoringLog",
    );
  });

  test("the latest checks of exactly those pairs are read as OneUptime reads them", async () => {
    await requestGrid();

    expect(monitorProbeService.findBy).toHaveBeenCalledTimes(2);

    const checks: JSONObject = readOf(1);

    expect(checks["props"]).toEqual({ isRoot: true });

    const query: JSONObject = checks["query"] as JSONObject;

    expect(Object.keys(query).sort()).toEqual(["_id", "projectId"]);
    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(idsIn(query["_id"])).toEqual([pairId.toString()]);
    expect(checks["select"]).toEqual({ _id: true, lastMonitoringLog: true });
    expect(checks["limit"]).toBe(1);
  });

  test("only the latency, the state and the time of a check leave the endpoint", async () => {
    await requestGrid();

    expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledTimes(1);

    const grid: JSONObject = responseUtil.sendJsonObjectResponse.mock
      .calls[0]![2] as JSONObject;
    const cell: JSONObject = (
      (grid["cells"] as JSONObject)[MONITOR_ID.toString()] as JSONObject
    )[PROBE_ID.toString()] as JSONObject;

    expect(cell["hasData"]).toBe(true);
    expect(cell["latencyInMs"]).toBe(182);
    expect(cell["isOnline"]).toBe(true);
    expect(cell["ageInSeconds"]).toBeGreaterThanOrEqual(29);

    const text: string = JSON.stringify(grid);

    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("jane@acme.example");
    expect(text).not.toContain("live-token");
  });

  test("a person who may see no pair costs no read of the checks", async () => {
    monitorProbeService.findBy.mockResolvedValue([]);

    await requestGrid();

    expect(monitorProbeService.findBy).toHaveBeenCalledTimes(1);
    expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
  });
});
