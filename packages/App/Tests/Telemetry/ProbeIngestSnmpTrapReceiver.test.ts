import { mockRouter } from "Common/Tests/Server/API/Helpers";
import ProbeService from "Common/Server/Services/ProbeService";
import SnmpTrapReceiverUsers from "Common/Server/Utils/Monitor/SnmpTrapReceiverUsers";
import Probe from "Common/Models/DatabaseModels/Probe";
import Response from "Common/Server/Utils/Response";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import SnmpAuthProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpSecurityLevel from "Common/Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import {
  SnmpTrapReceiverReport,
  SnmpTrapReceiverUser,
  SnmpTrapRefusalReason,
} from "Common/Types/Probe/SnmpTrapReceiver";
import ProbeAuthorization from "../../FeatureSet/Telemetry/Middleware/ProbeAuthorization";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

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
      sendErrorResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
    },
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
    },
  };
});

jest.mock("Common/Server/Services/ProbeService", () => {
  return {
    __esModule: true,
    default: {
      recordSnmpTrapReceiverReport: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Monitor/SnmpTrapReceiverUsers", () => {
  return {
    __esModule: true,
    default: {
      getUsersForProbe: jest.fn(),
    },
  };
});

jest.mock("../../FeatureSet/Telemetry/Middleware/ProbeAuthorization", () => {
  return {
    __esModule: true,
    default: {
      isAuthorizedServiceMiddleware: jest.fn(),
    },
  };
});

/*
 * POST /probe/snmp-trap/receiver (#11005): a probe reports its trap
 * receiver every thirty seconds and is handed the SNMPv3 users of its own
 * devices. Only the AUTHENTICATED probe counts - one named in the body never
 * does - so a probe hears no other probe's users and writes no other
 * probe's report.
 */

import { INVALID_REPORT_MESSAGE } from "../../FeatureSet/Telemetry/API/ProbeIngest/SnmpTrapReceiver";

const recordReport: Mock =
  ProbeService.recordSnmpTrapReceiverReport as unknown as Mock;
const getUsers: Mock =
  SnmpTrapReceiverUsers.getUsersForProbe as unknown as Mock;
const responseUtil: {
  sendErrorResponse: Mock;
  sendJsonObjectResponse: Mock;
} = Response as unknown as {
  sendErrorResponse: Mock;
  sendJsonObjectResponse: Mock;
};

const URI: string = "/probe/snmp-trap/receiver";
const PROBE_ID: ObjectID = new ObjectID("11050000-0000-4000-8000-00000000aaaa");
const OTHER_PROBE_ID: ObjectID = new ObjectID(
  "11050000-0000-4000-8000-00000000bbbb",
);

const REPORT: SnmpTrapReceiverReport = {
  isEnabled: true,
  port: 162,
  engineId: "8000B98380A1B2C3D4E5F60718293A4B",
  userCount: 1,
  refusals: [
    {
      sourceAddress: "10.20.0.5",
      reason: SnmpTrapRefusalReason.UnknownUser,
      userName: "san-monitor",
      count: 12,
      firstSeenAt: "2026-11-24T10:00:00.000Z",
      lastSeenAt: "2026-11-24T11:00:00.000Z",
    },
  ],
};

const USERS: Array<SnmpTrapReceiverUser> = [
  {
    userName: "san-monitor",
    securityLevel: SnmpSecurityLevel.AuthNoPriv,
    authProtocol: SnmpAuthProtocol.SHA,
    authKey: "auth-passphrase",
    addresses: ["10.20.0.5"],
  },
];

type RouteStep = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

function request(data: {
  probeId?: ObjectID | null | undefined;
  body?: unknown;
}): ExpressRequest {
  const req: JSONObject = {
    body: (data.body === undefined ? {} : data.body) as JSONObject,
  };

  if (data.probeId !== null) {
    req["probe"] = new Probe(data.probeId || PROBE_ID);
  }

  return req as unknown as ExpressRequest;
}

async function call(req: ExpressRequest): Promise<{ next: Mock }> {
  const next: Mock = jest.fn();
  const route: { middlewares: Array<RouteStep>; handlerFunction: RouteStep } =
    mockRouter.match("post", URI);

  await route.handlerFunction(
    req,
    {} as ExpressResponse,
    next as unknown as NextFunction,
  );

  return { next };
}

function sentBody(): JSONObject {
  expect(responseUtil.sendErrorResponse).not.toHaveBeenCalled();
  expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
  return responseUtil.sendJsonObjectResponse.mock.calls[0]![2] as JSONObject;
}

beforeEach(() => {
  recordReport.mockResolvedValue(true as never);
  getUsers.mockResolvedValue(USERS as never);
});

afterEach(() => {
  jest.clearAllMocks();
});

test("is held to the probe's own key", () => {
  const route: { middlewares: Array<RouteStep> } = mockRouter.match(
    "post",
    URI,
  );

  expect(route.middlewares).toContain(
    ProbeAuthorization.isAuthorizedServiceMiddleware,
  );
});

describe("a report", () => {
  test("is kept for the authenticated probe, which is handed its devices' users", async () => {
    await call(request({ body: { snmpTrapReceiver: REPORT } }));

    expect(recordReport).toHaveBeenCalledWith({
      probeId: PROBE_ID,
      report: REPORT,
    });
    expect(getUsers).toHaveBeenCalledWith(PROBE_ID);
    expect(sentBody()).toEqual({ users: USERS, isReportKept: true });
  });

  test("a probe ID in the body is never the probe: the authenticated one is", async () => {
    await call(
      request({
        body: { probeId: OTHER_PROBE_ID.toString(), snmpTrapReceiver: REPORT },
      }),
    );

    expect(recordReport.mock.calls[0]![0]).toMatchObject({ probeId: PROBE_ID });
    expect(getUsers).toHaveBeenCalledWith(PROBE_ID);
  });

  test("is kept only as what it can be", async () => {
    await call(
      request({
        body: {
          snmpTrapReceiver: {
            ...REPORT,
            engineId: "not hex",
            injected: "<script>",
            refusals: [...REPORT.refusals, { reason: "made-up" }],
          },
        },
      }),
    );

    const kept: SnmpTrapReceiverReport = (
      recordReport.mock.calls[0]![0] as { report: SnmpTrapReceiverReport }
    ).report;

    expect(kept).toEqual({
      isEnabled: true,
      port: 162,
      userCount: 1,
      refusals: REPORT.refusals,
    });
  });

  test("a global probe keeps no report and still gets the users of the devices assigned to it", async () => {
    recordReport.mockResolvedValue(false as never);

    await call(request({ body: { snmpTrapReceiver: REPORT } }));

    expect(sentBody()).toEqual({ users: USERS, isReportKept: false });
  });

  test("a receiver that is off is handed no users, and none are read", async () => {
    await call(
      request({
        body: { snmpTrapReceiver: { isEnabled: false, refusals: [] } },
      }),
    );

    expect(getUsers).not.toHaveBeenCalled();
    expect(sentBody()).toEqual({ users: [], isReportKept: true });
  });
});

describe("refused", () => {
  test("a body with no report", async () => {
    for (const body of [
      {},
      { snmpTrapReceiver: "on" },
      { snmpTrapReceiver: { port: 162 } },
    ]) {
      jest.clearAllMocks();

      await call(request({ body: body }));

      expect(responseUtil.sendErrorResponse).toHaveBeenCalledTimes(1);
      const error: unknown = responseUtil.sendErrorResponse.mock.calls[0]![2];
      expect(error).toBeInstanceOf(BadDataException);
      expect((error as Error).message).toBe(INVALID_REPORT_MESSAGE);
      expect(recordReport).not.toHaveBeenCalled();
      expect(getUsers).not.toHaveBeenCalled();
    }
  });

  test("a request with no probe", async () => {
    await call(request({ probeId: null, body: { snmpTrapReceiver: REPORT } }));

    expect(
      (responseUtil.sendErrorResponse.mock.calls[0]![2] as Error).message,
    ).toBe("Probe not found");
    expect(recordReport).not.toHaveBeenCalled();
  });

  test("users that cannot be read fail the request, so the probe keeps the ones it has", async () => {
    getUsers.mockRejectedValue(new Error("database unavailable") as never);

    const { next } = await call(
      request({ body: { snmpTrapReceiver: REPORT } }),
    );

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(responseUtil.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});
