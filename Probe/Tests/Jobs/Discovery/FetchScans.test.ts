// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import { describe, expect, test } from "@jest/globals";
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import SnmpAuthProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpPrivProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpPrivProtocol";
import SnmpSecurityLevel from "Common/Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import SnmpV3Auth from "Common/Types/Monitor/SnmpMonitor/SnmpV3Auth";
import { buildSnmpV3Auth } from "../../../Jobs/Discovery/FetchScans";

/*
 * Discovery builds ONE credential set per scan and reuses it for every host in
 * the subnet, so a single unreadable protocol blanks the whole sweep. The
 * check lives here rather than deeper in SnmpMonitor because this runs inside
 * runScan's try: a throw is reported back as a failed scan the operator can
 * read. Thrown per-host instead, it would land in SubnetScanner's debug-level
 * catch and the scan would report success having found nothing — identical to
 * a subnet with no SNMP devices on it.
 */

/*
 * Overrides are a loose record rather than Partial<NetworkDeviceDiscoveryScan>
 * so tests can store the unreadable strings this file is about, and can clear a
 * column back to undefined under exactOptionalPropertyTypes.
 */
function buildScan(
  overrides?: Record<string, unknown>,
): NetworkDeviceDiscoveryScan {
  return {
    cidr: "10.0.0.0/24",
    snmpV3Username: "monitoring",
    snmpV3SecurityLevel: SnmpSecurityLevel.AuthPriv,
    snmpV3AuthProtocol: SnmpAuthProtocol.SHA,
    snmpV3AuthKey: "auth-passphrase",
    snmpV3PrivProtocol: SnmpPrivProtocol.AES,
    snmpV3PrivKey: "priv-passphrase",
    ...overrides,
  } as NetworkDeviceDiscoveryScan;
}

describe("FetchScans.buildSnmpV3Auth — scans without v3 credentials", () => {
  test("a scan with no v3 username carries no v3 config at all", () => {
    expect(
      buildSnmpV3Auth(buildScan({ snmpV3Username: undefined })),
    ).toBeUndefined();
  });

  /*
   * A v1/v2c scan has no credentials to validate, so a stale protocol left on
   * the row must not stop the sweep.
   */
  test("an unreadable protocol on a scan with no username is ignored", () => {
    expect(() => {
      return buildSnmpV3Auth(
        buildScan({
          snmpV3Username: undefined,
          snmpV3PrivProtocol: "nonsense",
        }),
      );
    }).not.toThrow();
  });
});

describe("FetchScans.buildSnmpV3Auth — unreadable protocols fail the scan", () => {
  test("an unreadable security level throws and names the scan", () => {
    expect(() => {
      return buildSnmpV3Auth(
        buildScan({ snmpV3SecurityLevel: "authpriv-typo" }),
      );
    }).toThrow(/security level "authpriv-typo".*not a recognized value/i);

    expect(() => {
      return buildSnmpV3Auth(
        buildScan({ snmpV3SecurityLevel: "authpriv-typo" }),
      );
    }).toThrow(/10\.0\.0\.0\/24/);
  });

  test("an unreadable privacy protocol throws instead of sweeping with DES", () => {
    expect(() => {
      return buildSnmpV3Auth(buildScan({ snmpV3PrivProtocol: "AES192" }));
    }).toThrow(/privacy protocol "AES192".*not a recognized value/i);
  });

  test("an unreadable authentication protocol throws instead of sweeping with MD5", () => {
    expect(() => {
      return buildSnmpV3Auth(buildScan({ snmpV3AuthProtocol: "SHA3" }));
    }).toThrow(/authentication protocol "SHA3".*not a recognized value/i);
  });

  // Falls back to the scan id when the CIDR is missing, so the message still points somewhere.
  test("the error identifies the scan even without a cidr", () => {
    expect(() => {
      return buildSnmpV3Auth(
        buildScan({ cidr: undefined, snmpV3PrivProtocol: "rc4" }),
      );
    }).toThrow(/rc4/);
  });
});

describe("FetchScans.buildSnmpV3Auth — recognized values, including drift", () => {
  test("canonical values pass through unchanged", () => {
    const auth: SnmpV3Auth | undefined = buildSnmpV3Auth(buildScan());

    expect(auth).toEqual({
      securityLevel: SnmpSecurityLevel.AuthPriv,
      username: "monitoring",
      authProtocol: SnmpAuthProtocol.SHA,
      authKey: "auth-passphrase",
      privProtocol: SnmpPrivProtocol.AES,
      privKey: "priv-passphrase",
    });
  });

  /*
   * The spellings a hand-written scan row realistically holds — enum keys and
   * the labels the form displays — are normalized rather than rejected.
   */
  test("key and label spellings are normalized to canonical members", () => {
    const auth: SnmpV3Auth | undefined = buildSnmpV3Auth(
      buildScan({
        snmpV3SecurityLevel: "AuthPriv",
        snmpV3AuthProtocol: "SHA-256",
        snmpV3PrivProtocol: "AES-256",
      }),
    );

    expect(auth?.securityLevel).toBe(SnmpSecurityLevel.AuthPriv);
    expect(auth?.authProtocol).toBe(SnmpAuthProtocol.SHA256);
    expect(auth?.privProtocol).toBe(SnmpPrivProtocol.AES256);
  });

  test("unset protocols stay undefined rather than becoming a default", () => {
    const auth: SnmpV3Auth | undefined = buildSnmpV3Auth(
      buildScan({
        snmpV3AuthProtocol: undefined,
        snmpV3PrivProtocol: undefined,
      }),
    );

    expect(auth?.authProtocol).toBeUndefined();
    expect(auth?.privProtocol).toBeUndefined();
    expect(auth?.username).toBe("monitoring");
  });

  test("an unset security level falls back to noAuthNoPriv", () => {
    expect(
      buildSnmpV3Auth(buildScan({ snmpV3SecurityLevel: undefined }))
        ?.securityLevel,
    ).toBe(SnmpSecurityLevel.NoAuthNoPriv);
  });
});
