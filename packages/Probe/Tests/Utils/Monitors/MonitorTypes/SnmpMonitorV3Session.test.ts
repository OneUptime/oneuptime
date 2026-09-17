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
import SnmpMonitorResponse from "Common/Types/Monitor/SnmpMonitor/SnmpMonitorResponse";

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

/*
 * The v3 protocol columns are free text with no check constraint, so a direct
 * API call, a hand-edited row or a restored backup can put anything in them.
 * Every value below is a string the enums do not contain, cast through the
 * SnmpV3Auth type exactly as hydration hands it to the probe.
 */
describe("SnmpMonitor.createSnmpSession — an unreadable v3 protocol is refused", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  /*
   * The severe one. The old code compared the stored string against the enum
   * and fell through to noAuthNoPriv, which drops authProtocol/authKey and
   * privProtocol/privKey from the user entirely — the device's username goes
   * out in cleartext with nothing encrypted. Refusing to poll is the only
   * defensible response, since no guess can be right.
   */
  test("an unreadable security level throws instead of polling with no security", () => {
    const config: MonitorStepSnmpMonitor = buildConfig({
      snmpV3Auth: buildV3Auth({
        securityLevel: "authpriv-typo" as unknown as SnmpSecurityLevel,
      }),
    });

    expect(() => {
      return SnmpMonitorInternal.createSnmpSession(config, {});
    }).toThrow(/security level "authpriv-typo".*not a recognized value/i);

    expect(snmp.createV3Session).not.toHaveBeenCalled();
    expect(snmp.createSession).not.toHaveBeenCalled();
  });

  test("an unreadable privacy protocol throws instead of silently using DES", () => {
    const config: MonitorStepSnmpMonitor = buildConfig({
      snmpV3Auth: buildV3Auth({
        privProtocol: "AES192" as unknown as SnmpPrivProtocol,
      }),
    });

    expect(() => {
      return SnmpMonitorInternal.createSnmpSession(config, {});
    }).toThrow(/privacy protocol "AES192".*not a recognized value/i);

    expect(snmp.createV3Session).not.toHaveBeenCalled();
  });

  test("an unreadable authentication protocol throws instead of silently using MD5", () => {
    const config: MonitorStepSnmpMonitor = buildConfig({
      snmpV3Auth: buildV3Auth({
        authProtocol: "SHA3" as unknown as SnmpAuthProtocol,
      }),
    });

    expect(() => {
      return SnmpMonitorInternal.createSnmpSession(config, {});
    }).toThrow(/authentication protocol "SHA3".*not a recognized value/i);

    expect(snmp.createV3Session).not.toHaveBeenCalled();
  });

  // The message has to carry the bad value and the host to be actionable.
  test("the error names the offending value, the host and the valid options", () => {
    const config: MonitorStepSnmpMonitor = buildConfig({
      hostname: "10.20.30.40",
      snmpV3Auth: buildV3Auth({
        privProtocol: "rc4" as unknown as SnmpPrivProtocol,
      }),
    });

    expect(() => {
      return SnmpMonitorInternal.createSnmpSession(config, {});
    }).toThrow(/rc4/);
    expect(() => {
      return SnmpMonitorInternal.createSnmpSession(config, {});
    }).toThrow(/10\.20\.30\.40/);
    expect(() => {
      return SnmpMonitorInternal.createSnmpSession(config, {});
    }).toThrow(/DES, AES, AES256/);
  });

  /*
   * A protocol that the level never reads must not block the poll. A device at
   * authNoPriv ignores privProtocol entirely, so a stale value left there from
   * an earlier authPriv configuration is harmless and must stay harmless.
   */
  test("an unreadable privacy protocol is ignored at authNoPriv, where it is unused", () => {
    const config: MonitorStepSnmpMonitor = buildConfig({
      snmpV3Auth: buildV3Auth({
        securityLevel: SnmpSecurityLevel.AuthNoPriv,
        privProtocol: "nonsense" as unknown as SnmpPrivProtocol,
      }),
    });

    expect(() => {
      return SnmpMonitorInternal.createSnmpSession(config, {});
    }).not.toThrow();

    expect(createdV3User()["privProtocol"]).toBeUndefined();
  });

  test("unreadable auth and privacy protocols are ignored at noAuthNoPriv", () => {
    const config: MonitorStepSnmpMonitor = buildConfig({
      snmpV3Auth: buildV3Auth({
        securityLevel: SnmpSecurityLevel.NoAuthNoPriv,
        authProtocol: "nonsense" as unknown as SnmpAuthProtocol,
        privProtocol: "nonsense" as unknown as SnmpPrivProtocol,
      }),
    });

    expect(() => {
      return SnmpMonitorInternal.createSnmpSession(config, {});
    }).not.toThrow();

    expect(createdV3User()).toEqual({
      name: "monitoring",
      level: snmp.SecurityLevel.noAuthNoPriv,
    });
  });

  /*
   * Unset is not the same as unreadable. Devices configured before these
   * columns were mandatory have nothing stored, and must keep polling on the
   * historical defaults rather than start failing.
   */
  test("protocols left unset still fall back to defaults rather than throwing", () => {
    expect(() => {
      return SnmpMonitorInternal.createSnmpSession(
        buildConfig({
          snmpV3Auth: buildV3Auth({
            authProtocol: undefined,
            privProtocol: undefined,
          }),
        }),
        {},
      );
    }).not.toThrow();

    const user: Record<string, unknown> = createdV3User();

    expect(user["authProtocol"]).toBe(snmp.AuthProtocols.md5);
    expect(user["privProtocol"]).toBe(snmp.PrivProtocols.des);
  });

  test("an empty-string protocol counts as unset, not unreadable", () => {
    expect(() => {
      return SnmpMonitorInternal.createSnmpSession(
        buildConfig({
          snmpV3Auth: buildV3Auth({
            privProtocol: "" as unknown as SnmpPrivProtocol,
          }),
        }),
        {},
      );
    }).not.toThrow();
  });
});

describe("SnmpMonitor.createSnmpSession — stored spelling drift still polls correctly", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  /*
   * The quiet half of this fix. These spellings are all legitimate — they are
   * the enum keys, or the labels the form displays — and under the old bare
   * cast every one of them fell through to the weakest algorithm. Nothing
   * threw; the device just stopped answering.
   */
  test.each([
    ["AuthPriv", snmp.SecurityLevel.authPriv],
    ["authPriv", snmp.SecurityLevel.authPriv],
    ["AUTHPRIV", snmp.SecurityLevel.authPriv],
  ])(
    "a security level stored as %j is polled at the level it names",
    (stored: string, expected: unknown) => {
      SnmpMonitorInternal.createSnmpSession(
        buildConfig({
          snmpV3Auth: buildV3Auth({
            securityLevel: stored as unknown as SnmpSecurityLevel,
          }),
        }),
        {},
      );

      expect(createdV3User()["level"]).toBe(expected);
    },
  );

  /*
   * The key-spelled level is the dangerous case: getting the level right but
   * dropping the credentials would still poll insecurely, so assert the
   * material travels with it.
   */
  test("a key-spelled authPriv level still carries its auth and privacy material", () => {
    SnmpMonitorInternal.createSnmpSession(
      buildConfig({
        snmpV3Auth: buildV3Auth({
          securityLevel: "AuthPriv" as unknown as SnmpSecurityLevel,
        }),
      }),
      {},
    );

    expect(createdV3User()).toEqual({
      name: "monitoring",
      level: snmp.SecurityLevel.authPriv,
      authProtocol: snmp.AuthProtocols.sha,
      authKey: "auth-passphrase",
      privProtocol: snmp.PrivProtocols.aes,
      privKey: "priv-passphrase",
    });
  });

  test.each([
    ["AES-256", "aes256b"],
    ["aes256", "aes256b"],
    ["aes", "aes"],
    ["AES-128", "aes"],
    ["des", "des"],
  ])(
    "a privacy protocol stored as %j maps to the net-snmp %s constant",
    (stored: string, expected: string) => {
      SnmpMonitorInternal.createSnmpSession(
        buildConfig({
          snmpV3Auth: buildV3Auth({
            privProtocol: stored as unknown as SnmpPrivProtocol,
          }),
        }),
        {},
      );

      expect(createdV3User()["privProtocol"]).toBe(
        (snmp.PrivProtocols as unknown as Record<string, unknown>)[expected],
      );
    },
  );

  test.each([
    ["SHA-256", "sha256"],
    ["SHA-512", "sha512"],
    ["sha1", "sha"],
    ["md5", "md5"],
  ])(
    "an auth protocol stored as %j maps to the net-snmp %s constant",
    (stored: string, expected: string) => {
      SnmpMonitorInternal.createSnmpSession(
        buildConfig({
          snmpV3Auth: buildV3Auth({
            authProtocol: stored as unknown as SnmpAuthProtocol,
          }),
        }),
        {},
      );

      expect(createdV3User()["authProtocol"]).toBe(
        (snmp.AuthProtocols as unknown as Record<string, unknown>)[expected],
      );
    },
  );
});

/*
 * Placement matters as much as the check. This is the reason the validation
 * lives in the probe rather than in server-side hydration: here a bad value
 * fails exactly one monitor and the operator reads why, whereas hydration runs
 * inside the batched monitor-list request after nextPingAt has already been
 * advanced, so a throw there would stall every monitor in the batch.
 */
describe("SnmpMonitor.query — an unreadable protocol surfaces as the monitor's failure cause", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test("the monitor reports offline with the bad value in its failure cause", async () => {
    const response: SnmpMonitorResponse | null = await SnmpMonitor.query(
      buildConfig({
        snmpV3Auth: buildV3Auth({
          privProtocol: "aes192" as unknown as SnmpPrivProtocol,
        }),
      }),
      // Skip retries and the probe-online check so this stays a unit test.
      { retry: 0, isOnlineCheckRequest: true },
    );

    expect(response).not.toBeNull();
    expect(response?.isOnline).toBe(false);
    expect(response?.isTimeout).toBe(false);
    expect(response?.failureCause).toMatch(/privacy protocol "aes192"/i);
  });

  // A config error must not be mistaken for an unreachable device.
  test("the failure is not reported as a timeout", async () => {
    const response: SnmpMonitorResponse | null = await SnmpMonitor.query(
      buildConfig({
        snmpV3Auth: buildV3Auth({
          securityLevel: "bogus" as unknown as SnmpSecurityLevel,
        }),
      }),
      { retry: 0, isOnlineCheckRequest: true },
    );

    expect(response?.isTimeout).toBe(false);
    expect(response?.failureCause).toMatch(/security level "bogus"/i);
  });
});
