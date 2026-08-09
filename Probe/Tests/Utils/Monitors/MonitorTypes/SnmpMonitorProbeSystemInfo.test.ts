// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import SnmpSecurityLevel from "Common/Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import SnmpAuthProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpSystemInfo from "Common/Types/Monitor/SnmpMonitor/SnmpSystemInfo";

/*
 * A fake net-snmp session whose `get` is scripted per test, so the probe's
 * behaviour on an agent that answers, times out, or actively refuses can be
 * exercised without a UDP socket. Only the session factories are mocked; the
 * real module still supplies the protocol constants and isVarbindError.
 */
type SessionScript = {
  error: Error | null;
  varbinds: Array<unknown> | undefined;
};

const sessionScript: SessionScript = { error: null, varbinds: undefined };

/*
 * A sweep opens one session per address, so leaking them exhausts the probe's
 * sockets long before a /24 finishes. Counted with a plain object rather than
 * jest.fn() so the mock factory below can close over it without dragging
 * jest's generic Mock typing into the module scope.
 */
const sessionCloses: { count: number } = { count: 0 };

jest.mock("net-snmp", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "net-snmp",
  ) as Record<string, unknown>;

  const makeSession: () => Record<string, unknown> = () => {
    return {
      on: jest.fn(),
      close: (): void => {
        sessionCloses.count++;
      },
      get: (
        _oids: Array<string>,
        callback: (
          error: Error | null,
          varbinds: Array<unknown> | undefined,
        ) => void,
      ): void => {
        callback(sessionScript.error, sessionScript.varbinds);
      },
    };
  };

  return {
    ...actual,
    createSession: jest.fn(makeSession),
    createV3Session: jest.fn(makeSession),
  };
});

import snmp from "net-snmp";
import SnmpMonitor from "../../../../Utils/Monitors/MonitorTypes/SnmpMonitor";

function buildConfig(
  overrides?: Partial<MonitorStepSnmpMonitor>,
): MonitorStepSnmpMonitor {
  return {
    snmpVersion: SnmpVersion.V2c,
    hostname: "10.244.102.11",
    port: 161,
    communityString: "public",
    oids: [],
    timeout: 2000,
    retries: 0,
    ...overrides,
  } as MonitorStepSnmpMonitor;
}

// The six system-group scalars readSystemInfo asks for, in order.
function systemGroupVarbinds(): Array<unknown> {
  return [
    {
      oid: "1.3.6.1.2.1.1.1.0",
      type: snmp.ObjectType.OctetString,
      value: Buffer.from("Cisco IOS"),
    },
    {
      oid: "1.3.6.1.2.1.1.2.0",
      type: snmp.ObjectType.OID,
      value: "1.3.6.1.4.1.9.1.1",
    },
    { oid: "1.3.6.1.2.1.1.3.0", type: snmp.ObjectType.TimeTicks, value: 12345 },
    {
      oid: "1.3.6.1.2.1.1.4.0",
      type: snmp.ObjectType.OctetString,
      value: Buffer.from("noc@example.com"),
    },
    {
      oid: "1.3.6.1.2.1.1.5.0",
      type: snmp.ObjectType.OctetString,
      value: Buffer.from("core-sw1"),
    },
    {
      oid: "1.3.6.1.2.1.1.6.0",
      type: snmp.ObjectType.OctetString,
      value: Buffer.from("Rack 3"),
    },
  ];
}

beforeEach(() => {
  sessionScript.error = null;
  sessionScript.varbinds = systemGroupVarbinds();
  sessionCloses.count = 0;
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("SnmpMonitor.probeSystemInfo — a host that answers", () => {
  test("returns the system identity discovery imports devices from", async () => {
    const info: SnmpSystemInfo | null =
      await SnmpMonitor.probeSystemInfo(buildConfig());

    expect(info?.sysName).toBe("core-sw1");
    expect(info?.sysDescr).toBe("Cisco IOS");
  });

  test("reports no error for a host that answered", async () => {
    const errors: Array<unknown> = [];

    await SnmpMonitor.probeSystemInfo(buildConfig(), (err: unknown) => {
      errors.push(err);
    });

    expect(errors).toEqual([]);
  });

  test("closes the session — a subnet sweep opens one per address", async () => {
    await SnmpMonitor.probeSystemInfo(buildConfig());

    expect(sessionCloses.count).toBe(1);
  });
});

/*
 * The seam this whole fix hangs on. probeSystemInfo returns null for BOTH
 * "nothing is at this address" and "the agent refused these credentials",
 * and a discovery sweep applies one credential set to every host — so a
 * single wrong v3 key used to blank all 254 results and report a clean zero,
 * indistinguishable from an empty subnet.
 */
describe("SnmpMonitor.probeSystemInfo — surfacing why a host did not answer", () => {
  test("hands an authentication failure to the caller instead of swallowing it", async () => {
    sessionScript.error = new Error("Authentication failure");
    sessionScript.varbinds = undefined;

    const errors: Array<unknown> = [];
    const info: SnmpSystemInfo | null = await SnmpMonitor.probeSystemInfo(
      buildConfig(),
      (err: unknown) => {
        errors.push(err);
      },
    );

    // The return contract is unchanged: still null, never a throw.
    expect(info).toBeNull();
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe("Authentication failure");
  });

  test("a timeout reaches the caller too — classifying it is the caller's job", async () => {
    sessionScript.error = new Error("Request timed out");
    sessionScript.varbinds = undefined;

    const errors: Array<unknown> = [];
    await SnmpMonitor.probeSystemInfo(buildConfig(), (err: unknown) => {
      errors.push(err);
    });

    expect((errors[0] as Error).message).toBe("Request timed out");
  });

  test("a response with no varbinds is an error, not a silent empty device", async () => {
    sessionScript.error = null;
    sessionScript.varbinds = undefined;

    const errors: Array<unknown> = [];
    const info: SnmpSystemInfo | null = await SnmpMonitor.probeSystemInfo(
      buildConfig(),
      (err: unknown) => {
        errors.push(err);
      },
    );

    expect(info).toBeNull();
    expect(errors).toHaveLength(1);
  });

  test("still closes the session when the read failed", async () => {
    sessionScript.error = new Error("Unknown user name");
    sessionScript.varbinds = undefined;

    await SnmpMonitor.probeSystemInfo(buildConfig());

    expect(sessionCloses.count).toBe(1);
  });

  /*
   * A scan-wide misconfiguration throws while the session is being built, so
   * it never reaches the read. Without this branch it would look like one
   * more quiet address — on every host in the sweep.
   */
  test("a configuration that cannot even open a session is reported, not silently null", async () => {
    const errors: Array<unknown> = [];

    const info: SnmpSystemInfo | null = await SnmpMonitor.probeSystemInfo(
      buildConfig({
        snmpVersion: SnmpVersion.V3,
        // v3 selected with no credentials at all.
        snmpV3Auth: undefined,
      }),
      (err: unknown) => {
        errors.push(err);
      },
    );

    expect(info).toBeNull();
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toContain(
      "no v3 credentials (username) are configured",
    );
    // Nothing was opened, so nothing must be closed.
    expect(sessionCloses.count).toBe(0);
  });

  test("an unrecognized v3 auth protocol is reported rather than quietly downgraded", async () => {
    const errors: Array<unknown> = [];

    await SnmpMonitor.probeSystemInfo(
      buildConfig({
        snmpVersion: SnmpVersion.V3,
        snmpV3Auth: {
          securityLevel: SnmpSecurityLevel.AuthNoPriv,
          username: "WBNOC",
          authProtocol: "sha-3" as SnmpAuthProtocol,
          authKey: "auth-passphrase",
        },
      }),
      (err: unknown) => {
        errors.push(err);
      },
    );

    expect((errors[0] as Error).message).toContain("not a recognized value");
  });
});

/*
 * The callback is optional so the existing contract is untouched for callers
 * that do not want it.
 */
describe("SnmpMonitor.probeSystemInfo — callers that pass no callback", () => {
  test("a failing read is still just null, with no throw", async () => {
    sessionScript.error = new Error("Authentication failure");
    sessionScript.varbinds = undefined;

    await expect(
      SnmpMonitor.probeSystemInfo(buildConfig()),
    ).resolves.toBeNull();
  });

  test("an unopenable session is still just null, with no throw", async () => {
    await expect(
      SnmpMonitor.probeSystemInfo(
        buildConfig({ snmpVersion: SnmpVersion.V3, snmpV3Auth: undefined }),
      ),
    ).resolves.toBeNull();
  });
});
