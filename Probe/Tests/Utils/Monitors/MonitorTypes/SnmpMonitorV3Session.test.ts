// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import { afterEach, describe, expect, jest, test } from "@jest/globals";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import SnmpSecurityLevel from "Common/Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import SnmpAuthProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpPrivProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpPrivProtocol";
import SnmpV3Auth from "Common/Types/Monitor/SnmpMonitor/SnmpV3Auth";

/*
 * net-snmp is mocked at the session factories only: the real module still
 * supplies its protocol constants, so these tests assert against the very
 * values the library would consume rather than a restatement of them.
 */
jest.mock("net-snmp", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "net-snmp",
  ) as Record<string, unknown>;

  return {
    ...actual,
    createSession: jest.fn(() => {
      return { close: jest.fn(), on: jest.fn() };
    }),
    createV3Session: jest.fn(() => {
      return { close: jest.fn(), on: jest.fn() };
    }),
  };
});

import snmp from "net-snmp";
import SnmpMonitor from "../../../../Utils/Monitors/MonitorTypes/SnmpMonitor";

/*
 * createSnmpSession is private; the cast seam exposes it so the v3 user the
 * probe builds can be inspected without opening a real UDP socket.
 */
type SnmpMonitorPrivate = {
  createSnmpSession: (
    config: MonitorStepSnmpMonitor,
    options: { timeout?: number | undefined },
  ) => unknown;
};

const SnmpMonitorInternal: SnmpMonitorPrivate =
  SnmpMonitor as unknown as SnmpMonitorPrivate;

function buildV3Auth(overrides?: Partial<SnmpV3Auth>): SnmpV3Auth {
  return {
    securityLevel: SnmpSecurityLevel.AuthPriv,
    username: "monitoring",
    authProtocol: SnmpAuthProtocol.SHA,
    authKey: "auth-passphrase",
    privProtocol: SnmpPrivProtocol.AES,
    privKey: "priv-passphrase",
    ...overrides,
  } as SnmpV3Auth;
}

function buildConfig(
  overrides?: Partial<MonitorStepSnmpMonitor>,
): MonitorStepSnmpMonitor {
  return {
    snmpVersion: SnmpVersion.V3,
    hostname: "10.0.0.1",
    port: 161,
    oids: [{ oid: "1.3.6.1.2.1.1.1.0" }],
    timeout: 5000,
    retries: 3,
    monitorInterfaces: false,
    snmpV3Auth: buildV3Auth(),
    ...overrides,
  } as MonitorStepSnmpMonitor;
}

function createdV3User(): Record<string, unknown> {
  const createV3Session: jest.Mock =
    snmp.createV3Session as unknown as jest.Mock;

  return (createV3Session.mock.calls[0] as Array<unknown>)[1] as Record<
    string,
    unknown
  >;
}

describe("SnmpMonitor.createSnmpSession — SNMP v3", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("credential guard", () => {
    /*
     * Falling through to the v2c branch would poll a v3 device with community
     * "public" — an unexpected cleartext credential on the wire and a
     * meaningless result. Failing loudly is correct; this is the error surfaced
     * by Test Monitor when a v3 device has lost its credentials upstream.
     */
    test("a v3 config with no auth at all throws instead of downgrading to v2c", () => {
      const config: MonitorStepSnmpMonitor = buildConfig({
        snmpV3Auth: undefined,
      });

      expect(() => {
        return SnmpMonitorInternal.createSnmpSession(config, {});
      }).toThrow(/no v3 credentials/);

      expect(snmp.createSession).not.toHaveBeenCalled();
      expect(snmp.createV3Session).not.toHaveBeenCalled();
    });

    test("a v3 config with an empty username throws and names the host", () => {
      const config: MonitorStepSnmpMonitor = buildConfig({
        snmpV3Auth: buildV3Auth({ username: "" }),
      });

      expect(() => {
        return SnmpMonitorInternal.createSnmpSession(config, {});
      }).toThrow(/10\.0\.0\.1/);
    });

    test("a v3 device never falls back to the public community string", () => {
      const config: MonitorStepSnmpMonitor = buildConfig({
        snmpV3Auth: undefined,
        communityString: "public",
      });

      expect(() => {
        return SnmpMonitorInternal.createSnmpSession(config, {});
      }).toThrow();

      expect(snmp.createSession).not.toHaveBeenCalled();
    });
  });

  describe("v3 user construction", () => {
    test("an authPriv user carries name, level, auth and privacy material", () => {
      SnmpMonitorInternal.createSnmpSession(buildConfig(), {});

      expect(snmp.createV3Session).toHaveBeenCalledTimes(1);
      expect(createdV3User()).toEqual({
        name: "monitoring",
        level: snmp.SecurityLevel.authPriv,
        authProtocol: snmp.AuthProtocols.sha,
        authKey: "auth-passphrase",
        privProtocol: snmp.PrivProtocols.aes,
        privKey: "priv-passphrase",
      });
    });

    test("an authNoPriv user carries auth but no privacy material", () => {
      SnmpMonitorInternal.createSnmpSession(
        buildConfig({
          snmpV3Auth: buildV3Auth({
            securityLevel: SnmpSecurityLevel.AuthNoPriv,
          }),
        }),
        {},
      );

      const user: Record<string, unknown> = createdV3User();

      expect(user["level"]).toBe(snmp.SecurityLevel.authNoPriv);
      expect(user["authKey"]).toBe("auth-passphrase");
      expect(user["privProtocol"]).toBeUndefined();
      expect(user["privKey"]).toBeUndefined();
    });

    test("a noAuthNoPriv user carries neither auth nor privacy material", () => {
      SnmpMonitorInternal.createSnmpSession(
        buildConfig({
          snmpV3Auth: buildV3Auth({
            securityLevel: SnmpSecurityLevel.NoAuthNoPriv,
          }),
        }),
        {},
      );

      expect(createdV3User()).toEqual({
        name: "monitoring",
        level: snmp.SecurityLevel.noAuthNoPriv,
      });
    });

    test.each([
      [SnmpAuthProtocol.MD5, "md5"],
      [SnmpAuthProtocol.SHA, "sha"],
      [SnmpAuthProtocol.SHA256, "sha256"],
      [SnmpAuthProtocol.SHA512, "sha512"],
    ])(
      "auth protocol %s maps to the net-snmp %s constant",
      (stored: SnmpAuthProtocol, expected: string) => {
        SnmpMonitorInternal.createSnmpSession(
          buildConfig({
            snmpV3Auth: buildV3Auth({ authProtocol: stored }),
          }),
          {},
        );

        expect(createdV3User()["authProtocol"]).toBe(
          (snmp.AuthProtocols as unknown as Record<string, unknown>)[expected],
        );
      },
    );

    test.each([
      [SnmpPrivProtocol.DES, "des"],
      [SnmpPrivProtocol.AES, "aes"],
      [SnmpPrivProtocol.AES256, "aes256b"],
    ])(
      "privacy protocol %s maps to the net-snmp %s constant",
      (stored: SnmpPrivProtocol, expected: string) => {
        SnmpMonitorInternal.createSnmpSession(
          buildConfig({
            snmpV3Auth: buildV3Auth({ privProtocol: stored }),
          }),
          {},
        );

        expect(createdV3User()["privProtocol"]).toBe(
          (snmp.PrivProtocols as unknown as Record<string, unknown>)[expected],
        );
      },
    );

    /*
     * An authPriv level with protocols left unset must still produce a usable
     * user rather than an undefined protocol the library would reject.
     */
    test("missing protocols at authPriv fall back to concrete defaults", () => {
      SnmpMonitorInternal.createSnmpSession(
        buildConfig({
          snmpV3Auth: buildV3Auth({
            authProtocol: undefined,
            privProtocol: undefined,
          }),
        }),
        {},
      );

      const user: Record<string, unknown> = createdV3User();

      expect(user["authProtocol"]).toBeDefined();
      expect(user["privProtocol"]).toBeDefined();
    });

    test("missing keys at authPriv become empty strings rather than undefined", () => {
      SnmpMonitorInternal.createSnmpSession(
        buildConfig({
          snmpV3Auth: buildV3Auth({ authKey: undefined, privKey: undefined }),
        }),
        {},
      );

      const user: Record<string, unknown> = createdV3User();

      expect(user["authKey"]).toBe("");
      expect(user["privKey"]).toBe("");
    });
  });

  describe("v3 session options", () => {
    test("the v3 session targets the configured host, port and version", () => {
      SnmpMonitorInternal.createSnmpSession(
        buildConfig({ hostname: "192.168.5.9", port: 1610 }),
        {},
      );

      const createV3Session: jest.Mock =
        snmp.createV3Session as unknown as jest.Mock;
      const call: Array<unknown> = createV3Session.mock
        .calls[0] as Array<unknown>;

      expect(call[0]).toBe("192.168.5.9");
      expect(call[2]).toMatchObject({
        port: 1610,
        version: snmp.Version3,
      });
    });

    test("the caller's timeout wins over the stored one, and retries stay probe-managed", () => {
      SnmpMonitorInternal.createSnmpSession(buildConfig({ timeout: 5000 }), {
        timeout: 1234,
      });

      const createV3Session: jest.Mock =
        snmp.createV3Session as unknown as jest.Mock;
      const options: Record<string, unknown> = (
        createV3Session.mock.calls[0] as Array<unknown>
      )[2] as Record<string, unknown>;

      expect(options["timeout"]).toBe(1234);
      expect(options["retries"]).toBe(0);
    });
  });
});

describe("SnmpMonitor.createSnmpSession — v1/v2c are unaffected", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test("a v2c device opens a community session, not a v3 one", () => {
    SnmpMonitorInternal.createSnmpSession(
      buildConfig({
        snmpVersion: SnmpVersion.V2c,
        snmpV3Auth: undefined,
        communityString: "s3cret",
      }),
      {},
    );

    expect(snmp.createV3Session).not.toHaveBeenCalled();

    const createSession: jest.Mock = snmp.createSession as unknown as jest.Mock;
    const call: Array<unknown> = createSession.mock.calls[0] as Array<unknown>;

    expect(call[0]).toBe("10.0.0.1");
    expect(call[1]).toBe("s3cret");
    expect(call[2]).toMatchObject({ version: snmp.Version2c });
  });

  test("a v2c device with no community string falls back to public", () => {
    SnmpMonitorInternal.createSnmpSession(
      buildConfig({
        snmpVersion: SnmpVersion.V2c,
        snmpV3Auth: undefined,
        communityString: undefined,
      }),
      {},
    );

    const createSession: jest.Mock = snmp.createSession as unknown as jest.Mock;

    expect((createSession.mock.calls[0] as Array<unknown>)[1]).toBe("public");
  });

  test("a v1 device opens a Version1 session", () => {
    SnmpMonitorInternal.createSnmpSession(
      buildConfig({
        snmpVersion: SnmpVersion.V1,
        snmpV3Auth: undefined,
        communityString: "s3cret",
      }),
      {},
    );

    const createSession: jest.Mock = snmp.createSession as unknown as jest.Mock;

    expect(
      (createSession.mock.calls[0] as Array<unknown>)[2] as Record<
        string,
        unknown
      >,
    ).toMatchObject({ version: snmp.Version1 });
  });

  /*
   * v1/v2c carry no credentials to lose, which is why the customer's v2
   * devices keep working while v3 fails — pin that asymmetry.
   */
  test("a v2c device with no credentials configured still opens a session", () => {
    expect(() => {
      return SnmpMonitorInternal.createSnmpSession(
        buildConfig({ snmpVersion: SnmpVersion.V2c, snmpV3Auth: undefined }),
        {},
      );
    }).not.toThrow();
  });
});
