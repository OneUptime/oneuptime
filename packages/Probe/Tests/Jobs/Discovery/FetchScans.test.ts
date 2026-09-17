// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import { describe, expect, test } from "@jest/globals";
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import SnmpAuthProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpPrivProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpPrivProtocol";
import SnmpSecurityLevel from "Common/Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import SnmpV3Auth from "Common/Types/Monitor/SnmpMonitor/SnmpV3Auth";
import { DiscoveryScanSnmpConfig } from "Common/Utils/NetworkDiscovery/SnmpScanConfigUtil";
import { SubnetScanSnmpConfig } from "../../../Utils/Discovery/SubnetScanner";
import {
  buildProbeSnmpConfigs,
  buildSnmpV3Auth,
} from "../../../Jobs/Discovery/FetchScans";
import { stubReverseDnsAsResolvingNothing } from "../../TestingUtils/StubReverseDns";

/*
 * Discovery builds each credential set ONCE per scan and reuses it for every
 * host in the subnet, so a single unreadable protocol blanks that credential
 * across the whole sweep. The check lives here rather than deeper in
 * SnmpMonitor because this runs inside runScan's try: a throw is reported back
 * as a failed scan the operator can read. Thrown per-host instead, it would
 * land in SubnetScanner's debug-level catch and the scan would report success
 * having found nothing — identical to a subnet with no SNMP devices on it.
 *
 * A scan now carries an ORDERED LIST of credential sets, so buildSnmpV3Auth
 * takes ONE config rather than a whole scan row, plus an optional label naming
 * the scan it belongs to. Both halves are exercised below:
 *
 *   - the pure function, against a single config, for what it parses and what
 *     it refuses;
 *   - buildProbeSnmpConfigs, which is the real call site and the only thing
 *     that knows which scan a config came from, for what the failure NAMES.
 *
 * Routing the naming assertions through the real call site rather than
 * hand-passing a label is deliberate: "the operator can tell which scan
 * failed" is a property of the scan-to-message path, not of a string argument.
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
    /*
     * A v3 scan, stated explicitly.
     *
     * buildProbeSnmpConfigs only assembles (and therefore only validates) the
     * v3 block for a set whose VERSION is v3 — a v1/v2c set legitimately
     * carries leftover v3 values, because switching a card's version back and
     * forth must not lose the keys already typed into it, and the server's
     * validator skips them for exactly that reason. Without this the fixture
     * would default to V2c and every "an unreadable value fails the scan" test
     * below would pass vacuously, by never reaching the check at all.
     */
    snmpVersion: "V3",
    snmpV3Username: "monitoring",
    snmpV3SecurityLevel: SnmpSecurityLevel.AuthPriv,
    snmpV3AuthProtocol: SnmpAuthProtocol.SHA,
    snmpV3AuthKey: "auth-passphrase",
    snmpV3PrivProtocol: SnmpPrivProtocol.AES,
    snmpV3PrivKey: "priv-passphrase",
    ...overrides,
  } as NetworkDeviceDiscoveryScan;
}

/*
 * The same credentials as ONE entry of a scan's list. Identical field names to
 * the flattened columns above, which is the whole point of the shared
 * interface — a legacy scan row needs no translation to become a config.
 */
function buildConfig(
  overrides?: Record<string, unknown>,
): DiscoveryScanSnmpConfig {
  return {
    snmpV3Username: "monitoring",
    snmpV3SecurityLevel: SnmpSecurityLevel.AuthPriv,
    snmpV3AuthProtocol: SnmpAuthProtocol.SHA,
    snmpV3AuthKey: "auth-passphrase",
    snmpV3PrivProtocol: SnmpPrivProtocol.AES,
    snmpV3PrivKey: "priv-passphrase",
    ...overrides,
  } as DiscoveryScanSnmpConfig;
}

/*
 * The message a throwing call produced. Written out rather than leaning on
 * expect().toThrow(regex) for the assertions that need to check what is NOT in
 * the sentence — a regex that fails to match proves nothing about a message
 * nobody has read.
 */
function messageFrom(work: () => unknown): string {
  try {
    work();
  } catch (err) {
    return (err as Error).message;
  }

  throw new Error("Expected the call to throw, but it returned normally.");
}

/*
 * Reverse DNS (issue #3529) runs at the end of scanWithDeadline, on whatever
 * hosts the sweep returned — including the hosts a MOCKED SubnetScanner.scan
 * hands back. Stubbed for this whole file so no test here queries the
 * machine's real resolver; ReverseDnsStubIntegrity.test.ts fails the build if
 * a file that drives this path forgets.
 */
stubReverseDnsAsResolvingNothing();

describe("FetchScans.buildSnmpV3Auth — configs without v3 credentials", () => {
  test("a config with no v3 username carries no v3 config at all", () => {
    expect(
      buildSnmpV3Auth(buildConfig({ snmpV3Username: undefined })),
    ).toBeUndefined();
  });

  /*
   * A v1/v2c config has no credentials to validate, so a stale protocol left
   * on the row must not stop the sweep.
   */
  test("an unreadable protocol on a config with no username is ignored", () => {
    expect(() => {
      return buildSnmpV3Auth(
        buildConfig({
          snmpV3Username: undefined,
          snmpV3PrivProtocol: "nonsense",
        }),
      );
    }).not.toThrow();
  });
});

describe("FetchScans.buildSnmpV3Auth — unreadable protocols fail the scan", () => {
  test("an unreadable security level throws instead of downgrading to noAuthNoPriv", () => {
    expect(() => {
      return buildSnmpV3Auth(
        buildConfig({ snmpV3SecurityLevel: "authpriv-typo" }),
      );
    }).toThrow(/security level "authpriv-typo".*not a recognized value/i);
  });

  test("an unreadable privacy protocol throws instead of sweeping with DES", () => {
    expect(() => {
      return buildSnmpV3Auth(buildConfig({ snmpV3PrivProtocol: "AES192" }));
    }).toThrow(/privacy protocol "AES192".*not a recognized value/i);
  });

  test("an unreadable authentication protocol throws instead of sweeping with MD5", () => {
    expect(() => {
      return buildSnmpV3Auth(buildConfig({ snmpV3AuthProtocol: "SHA3" }));
    }).toThrow(/authentication protocol "SHA3".*not a recognized value/i);
  });

  /*
   * The failure has to name the credential set even when nobody told it which
   * scan the set came from — buildSnmpV3Auth is callable without a scan label,
   * and a sentence with a hole where the subject should be is not actionable.
   */
  test("without a scan label the message still names the config", () => {
    const message: string = messageFrom(() => {
      return buildSnmpV3Auth(
        buildConfig({
          name: "Printers - factory default",
          snmpVersion: "V2c",
          snmpV3PrivProtocol: "nonsense",
        }),
      );
    });

    expect(message).toContain("Printers - factory default (V2c)");
    // Nothing claimed a scan, so nothing must pretend to name one.
    expect(message).not.toContain("discovery scan");
  });
});

describe("FetchScans.buildSnmpV3Auth — recognized values, including drift", () => {
  test("canonical values pass through unchanged", () => {
    const auth: SnmpV3Auth | undefined = buildSnmpV3Auth(buildConfig());

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
      buildConfig({
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
      buildConfig({
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
      buildSnmpV3Auth(buildConfig({ snmpV3SecurityLevel: undefined }))
        ?.securityLevel,
    ).toBe(SnmpSecurityLevel.NoAuthNoPriv);
  });

  /*
   * A legacy scan row — flattened columns, no stored list — is the shape most
   * of the estate is still in, and it has to reach exactly the same credential
   * block through the real call site as a hand-built config does.
   */
  test("a legacy scan's flattened columns reach the sweep as one parsed credential set", () => {
    const configs: Array<SubnetScanSnmpConfig> = buildProbeSnmpConfigs(
      buildScan({ snmpVersion: "V3" }),
    );

    expect(configs).toHaveLength(1);
    expect(configs[0]!.snmpV3Auth).toEqual({
      securityLevel: SnmpSecurityLevel.AuthPriv,
      username: "monitoring",
      authProtocol: SnmpAuthProtocol.SHA,
      authKey: "auth-passphrase",
      privProtocol: SnmpPrivProtocol.AES,
      privKey: "priv-passphrase",
    });
  });
});

/*
 * Which scan a probe-side failure is about (issue #3391).
 *
 * Each credential set is built once per scan and reused for every host, so
 * this message is the operator's whole explanation of a sweep that found
 * nothing. A probe runs scans for many address ranges, and since scans can be
 * named, naming the failing one by the name its operator gave it is the
 * difference between a log line they recognise and one they have to look up.
 *
 * These go through buildProbeSnmpConfigs rather than buildSnmpV3Auth directly:
 * that is the function that knows the scan, and the scan label it passes down
 * is the only reason the sentence can name one at all.
 */
describe("FetchScans.buildProbeSnmpConfigs — which scan the failure names", () => {
  test("a named scan is named, with the range it sweeps", () => {
    expect(() => {
      return buildProbeSnmpConfigs(
        buildScan({
          name: "Router Discovery - Region 1100",
          snmpV3PrivProtocol: "nonsense",
        }),
      );
    }).toThrow("Router Discovery - Region 1100 (10.0.0.0/24)");
  });

  // Exactly what the message said before scans could be named.
  test("an unnamed scan is named by its target", () => {
    expect(() => {
      return buildProbeSnmpConfigs(
        buildScan({ snmpV3PrivProtocol: "nonsense" }),
      );
    }).toThrow("10.0.0.0/24");
  });

  test("a blank name does not blank out the label", () => {
    expect(() => {
      return buildProbeSnmpConfigs(
        buildScan({ name: "   ", snmpV3PrivProtocol: "nonsense" }),
      );
    }).toThrow("10.0.0.0/24");
  });

  /*
   * The last-resort fallback. A row that carries neither still has to produce
   * a sentence, rather than one with a hole in it.
   */
  test("a scan with neither still produces a readable message", () => {
    expect(() => {
      return buildProbeSnmpConfigs(
        buildScan({ cidr: undefined, snmpV3PrivProtocol: "nonsense" }),
      );
    }).toThrow("discovery scan scan");
  });

  test("the offending value is quoted even when the scan cannot be identified", () => {
    expect(() => {
      return buildProbeSnmpConfigs(
        buildScan({ cidr: undefined, snmpV3PrivProtocol: "rc4" }),
      );
    }).toThrow(/rc4/);
  });

  /*
   * An unreadable security level is the most consequential of the three,
   * because its silent fallback is not a weaker algorithm but no security at
   * all. The scan must be named on that path too.
   */
  test("an unreadable security level names the scan as well as the value", () => {
    const message: string = messageFrom(() => {
      return buildProbeSnmpConfigs(
        buildScan({ snmpV3SecurityLevel: "authpriv-typo" }),
      );
    });

    expect(message).toContain("authpriv-typo");
    expect(message).toContain("discovery scan 10.0.0.0/24");
  });
});
