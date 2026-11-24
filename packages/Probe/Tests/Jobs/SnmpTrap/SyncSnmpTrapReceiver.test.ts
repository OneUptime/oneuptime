// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "6c0ae2b4-9a51-4b1e-8f3f-3f0b1c9f2a11";

import {
  SnmpTrapReceiverSync,
  SyncDependencies,
  resetReportedProblem,
  syncSnmpTrapReceiver,
} from "../../../Jobs/SnmpTrap/SyncSnmpTrapReceiver";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import SnmpAuthProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpSecurityLevel from "Common/Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import {
  SnmpTrapReceiverReport,
  SnmpTrapReceiverUser,
  SnmpTrapRefusalReason,
} from "Common/Types/Probe/SnmpTrapReceiver";
import logger from "Common/Server/Utils/Logger";
import ConfigLogLevel from "Common/Server/Types/ConfigLogLevel";
import LocalCache from "Common/Server/Infrastructure/LocalCache";
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
 * Every thirty seconds the probe reports its trap receiver and takes back
 * the SNMPv3 users of its devices. What OneUptime answers replaces the
 * receiver's users; what it does not answer leaves them as they were, so a
 * server that cannot be reached for a while never starts refusing traps.
 */

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

const USER: SnmpTrapReceiverUser = {
  userName: "san-monitor",
  securityLevel: SnmpSecurityLevel.AuthNoPriv,
  authProtocol: SnmpAuthProtocol.SHA256,
  authKey: "a-passphrase-nobody-logs",
  addresses: ["10.20.0.5"],
};

interface Harness {
  dependencies: SyncDependencies;
  sent: Array<{ url: URL; body: JSONObject }>;
  handedOver: Array<Array<SnmpTrapReceiverUser>>;
}

function harness(
  answer: () => Promise<HTTPResponse<JSONObject> | HTTPErrorResponse>,
  report: SnmpTrapReceiverReport = REPORT,
): Harness {
  const sent: Array<{ url: URL; body: JSONObject }> = [];
  const handedOver: Array<Array<SnmpTrapReceiverUser>> = [];

  return {
    sent: sent,
    handedOver: handedOver,
    dependencies: {
      getReport: () => {
        return report;
      },
      setUsers: (users: Array<SnmpTrapReceiverUser>) => {
        handedOver.push(users);
      },
      fetch: (data: { url: URL; body: JSONObject }) => {
        sent.push(data);
        return answer();
      },
    },
  };
}

function ok(data: JSONObject): Promise<HTTPResponse<JSONObject>> {
  return Promise.resolve(new HTTPResponse<JSONObject>(200, data, {}));
}

function failed(statusCode: number): Promise<HTTPErrorResponse> {
  return Promise.resolve(
    new HTTPErrorResponse(statusCode, { message: "nope" }, {}),
  );
}

let warn: ReturnType<typeof jest.spyOn>;

beforeAll(() => {
  LocalCache.setString("PROBE", "PROBE_ID", process.env["PROBE_ID"]!);
});

beforeEach(() => {
  resetReportedProblem();
  warn = jest.spyOn(logger, "warn").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the report", () => {
  test("goes to /probe/snmp-trap/receiver with the probe's key, its ID and the receiver", async () => {
    const run: Harness = harness(() => {
      return ok({ users: [] });
    });

    await syncSnmpTrapReceiver(run.dependencies);

    expect(run.sent).toHaveLength(1);
    expect(run.sent[0]!.url.toString()).toMatch(
      /\/probe-ingest\/probe\/snmp-trap\/receiver$/,
    );
    expect(run.sent[0]!.body).toMatchObject({
      probeKey: "test-probe-key",
      probeId: process.env["PROBE_ID"],
      snmpTrapReceiver: REPORT,
    });
  });
});

describe("the users OneUptime answers with", () => {
  test("replace the receiver's", async () => {
    const run: Harness = harness(() => {
      return ok({ users: [USER] as unknown as JSONObject["users"] });
    });

    await syncSnmpTrapReceiver(run.dependencies);

    expect(run.handedOver).toEqual([[USER]]);
  });

  test("an empty list is handed over too: the devices' users went away", async () => {
    const run: Harness = harness(() => {
      return ok({ users: [] });
    });

    await syncSnmpTrapReceiver(run.dependencies);

    expect(run.handedOver).toEqual([[]]);
  });

  test("what is not a user is left out, the rest kept", async () => {
    const run: Harness = harness(() => {
      return ok({
        users: [
          USER,
          { userName: "", securityLevel: "authNoPriv" },
          { ...USER, userName: "no-key", authKey: "" },
          "not even an object",
        ] as unknown as JSONObject["users"],
      });
    });

    await syncSnmpTrapReceiver(run.dependencies);

    expect(run.handedOver).toEqual([[USER]]);
  });

  test("no passphrase reaches the log while they are handed over", async () => {
    // What the logger writes at INFO: the console and its recent-log buffer.
    jest.spyOn(logger, "getLogLevel").mockReturnValue(ConfigLogLevel.INFO);
    const written: Array<string> = [];
    jest
      .spyOn(console, "info")
      .mockImplementation((...args: Array<unknown>): void => {
        written.push(args.map(String).join(" "));
      });
    const recentBefore: number = logger.getRecentLogs().length;

    const run: Harness = harness(() => {
      return ok({ users: [USER] as unknown as JSONObject["users"] });
    });
    run.dependencies.setUsers = (users: Array<SnmpTrapReceiverUser>): void => {
      // Whatever logs inside the hand-over has the passphrases hidden.
      logger.info(`handing over ${JSON.stringify(users)}`);
    };

    await syncSnmpTrapReceiver(run.dependencies);

    const recent: string = JSON.stringify(
      logger.getRecentLogs().slice(recentBefore),
    );

    expect(written.join("\n")).toContain("handing over");
    expect(written.join("\n")).not.toContain("a-passphrase-nobody-logs");
    expect(recent).not.toContain("a-passphrase-nobody-logs");
  });

  test("the passphrases to hide are every auth and privacy key in the answer", () => {
    expect(
      SnmpTrapReceiverSync.getPassphrases([
        { authKey: "one", privKey: "two" },
        { authKey: "three" },
        null,
        "x",
      ]),
    ).toEqual(["one", "two", "three"]);
    expect(SnmpTrapReceiverSync.getPassphrases(undefined)).toEqual([]);
  });
});

describe("when there is no answer, the receiver keeps its users", () => {
  test("a refused request: said once, nothing handed over", async () => {
    const run: Harness = harness(() => {
      return failed(500);
    });

    await syncSnmpTrapReceiver(run.dependencies);
    await syncSnmpTrapReceiver(run.dependencies);

    expect(run.handedOver).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("HTTP 500");
  });

  test("a request that never got there: said once, nothing handed over", async () => {
    const run: Harness = harness(() => {
      return Promise.reject(new Error("ECONNREFUSED"));
    });

    await syncSnmpTrapReceiver(run.dependencies);
    await syncSnmpTrapReceiver(run.dependencies);

    expect(run.handedOver).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("ECONNREFUSED");
  });

  test("a OneUptime older than SNMPv3 traps (404) has no users to give: the receiver stops waiting for them", async () => {
    const run: Harness = harness(() => {
      return failed(404);
    });

    await syncSnmpTrapReceiver(run.dependencies);

    expect(run.handedOver).toEqual([[]]);
    expect(String(warn.mock.calls[0]![0])).toMatch(/older than SNMPv3 traps/);
  });

  test("an answer after a failure is taken, and the next failure is said again", async () => {
    let answer: () => Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> =
      () => {
        return failed(503);
      };
    const run: Harness = harness(() => {
      return answer();
    });

    await syncSnmpTrapReceiver(run.dependencies);
    answer = () => {
      return ok({ users: [USER] as unknown as JSONObject["users"] });
    };
    await syncSnmpTrapReceiver(run.dependencies);
    answer = () => {
      return failed(503);
    };
    await syncSnmpTrapReceiver(run.dependencies);

    expect(run.handedOver).toEqual([[USER]]);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

test("a receiver turned off is still reported, and is handed no users", async () => {
  const run: Harness = harness(
    () => {
      return ok({ users: [USER] as unknown as JSONObject["users"] });
    },
    { isEnabled: false, refusals: [] },
  );

  await syncSnmpTrapReceiver(run.dependencies);

  expect(run.sent[0]!.body["snmpTrapReceiver"]).toEqual({
    isEnabled: false,
    refusals: [],
  });
  expect(run.handedOver).toEqual([]);
});
