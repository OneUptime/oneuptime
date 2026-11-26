import NetworkDeviceHydrationUtil from "../../../../Server/Utils/Monitor/NetworkDeviceHydrationUtil";
import MonitorStepSnmpMonitor from "../../../../Types/Monitor/MonitorStepSnmpMonitor";
import SnmpVersion from "../../../../Types/Monitor/SnmpMonitor/SnmpVersion";
import { describe, expect, test } from "@jest/globals";

/*
 * The SNMPv3 context a device is polled in (#11014): a Brocade chassis
 * with Virtual Fabrics answers each logical switch in its own context,
 * "VF:<fabric ID>". It says WHERE on the agent the device is - like the
 * hostname - so it comes from the device (NetworkDevice.snmpV3ContextName)
 * whichever row its credentials came from (its own, its site's profile),
 * and only over SNMPv3: v1 and v2c have no contexts.
 */

const V3_CREDENTIALS: {
  snmpVersion: string;
  snmpPort: number;
  snmpV3Username: string;
  snmpV3SecurityLevel: string;
  snmpV3AuthProtocol: string;
  snmpV3AuthKey: string;
  snmpV3PrivProtocol: string;
  snmpV3PrivKey: string;
} = {
  snmpVersion: SnmpVersion.V3,
  snmpPort: 161,
  snmpV3Username: "oneuptime",
  snmpV3SecurityLevel: "authPriv",
  snmpV3AuthProtocol: "SHA",
  snmpV3AuthKey: "an-auth-passphrase",
  snmpV3PrivProtocol: "AES",
  snmpV3PrivKey: "a-priv-passphrase",
};

function build(
  credentials: Record<string, unknown>,
  snmpV3ContextName: string | null | undefined,
): MonitorStepSnmpMonitor {
  return NetworkDeviceHydrationUtil.buildSnmpMonitorConfig({
    hostname: "10.20.0.5",
    credentials: credentials,
    oids: [],
    monitorInterfaces: true,
    snmpV3ContextName: snmpV3ContextName,
  });
}

describe("NetworkDeviceHydrationUtil.getSnmpV3ContextName", () => {
  test("over SNMPv3, the device's context, trimmed", () => {
    expect(
      NetworkDeviceHydrationUtil.getSnmpV3ContextName({
        snmpVersion: SnmpVersion.V3,
        snmpV3ContextName: " VF:128 ",
      }),
    ).toBe("VF:128");
  });

  test.each([undefined, null, "", "   "])(
    "a context of %j is the default context: none",
    (snmpV3ContextName: string | null | undefined) => {
      expect(
        NetworkDeviceHydrationUtil.getSnmpV3ContextName({
          snmpVersion: SnmpVersion.V3,
          snmpV3ContextName: snmpV3ContextName,
        }),
      ).toBeUndefined();
    },
  );

  test.each([SnmpVersion.V1, SnmpVersion.V2c, undefined, null])(
    "over %s, never a context",
    (snmpVersion: SnmpVersion | null | undefined) => {
      expect(
        NetworkDeviceHydrationUtil.getSnmpV3ContextName({
          snmpVersion: snmpVersion,
          snmpV3ContextName: "VF:20",
        }),
      ).toBeUndefined();
    },
  );
});

describe("NetworkDeviceHydrationUtil.buildSnmpMonitorConfig", () => {
  test("the context rides the v3 credentials the probe polls with", () => {
    const config: MonitorStepSnmpMonitor = build(V3_CREDENTIALS, "VF:20");

    expect(config.snmpVersion).toBe(SnmpVersion.V3);
    expect(config.snmpV3Auth?.contextName).toBe("VF:20");
    expect(config.snmpV3Auth?.username).toBe("oneuptime");
  });

  test("no context, no contextName: the probe polls the default context", () => {
    const config: MonitorStepSnmpMonitor = build(V3_CREDENTIALS, undefined);

    expect(config.snmpV3Auth).toBeDefined();
    expect(config.snmpV3Auth).not.toHaveProperty("contextName");
  });

  test("a v2c device's context is ignored: v2c has none", () => {
    const config: MonitorStepSnmpMonitor = build(
      {
        snmpVersion: SnmpVersion.V2c,
        snmpCommunityString: "public",
        snmpPort: 161,
      },
      "VF:20",
    );

    expect(config.snmpVersion).toBe(SnmpVersion.V2c);
    expect(config.snmpV3Auth?.contextName).toBeUndefined();
  });
});
