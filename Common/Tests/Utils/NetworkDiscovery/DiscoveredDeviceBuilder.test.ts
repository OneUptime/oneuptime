import {
  MAX_DEVICE_DESCRIPTION_LENGTH,
  MAX_DEVICE_NAME_LENGTH,
  buildDeviceName,
  buildFallbackDeviceName,
  buildNetworkDeviceFromDiscoveredHost,
  getDiscoveredHostDisplayName,
  DiscoveredDeviceScanSource,
} from "../../../Utils/NetworkDiscovery/DiscoveredDeviceBuilder";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import { DiscoveredNetworkDevice } from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import NetworkDeviceMonitoringMethod from "../../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import ObjectID from "../../../Types/ObjectID";
import { DiscoveryScanSnmpConfig } from "../../../Utils/NetworkDiscovery/SnmpScanConfigUtil";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test — one discovered host maps to one NetworkDevice the
 * SAME way everywhere. The builder is the shared recipe behind the
 * dashboard's Review-dialog import and the server-side auto-import rule
 * engine, so what these tests pin is the device both paths must agree on:
 * which host field lands in which device column, which scan credentials ride
 * along (and when they must NOT), and the length ceilings that keep a
 * real-world 255-octet sysName from failing the create on the slug.
 *
 * Since OneUptime issue #3458 a scan carries an ORDERED LIST of credential
 * sets rather than one, the probe stamps each discovered host with the id of
 * the set that answered it, and "which scan credentials ride along" therefore
 * has a per-host answer. That is the guarantee most of the new cases below
 * pin, because getting it wrong is invisible: the device is created, it
 * carries a perfectly valid-looking community string belonging to a DIFFERENT
 * config, and it simply never polls.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROBE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");

function snmpHost(
  overrides: Partial<DiscoveredNetworkDevice> = {},
): DiscoveredNetworkDevice {
  return {
    ipAddress: "10.0.0.5",
    sysName: "core-switch-01",
    sysDescr: "Cisco IOS Software, C2960X",
    ...overrides,
  };
}

/*
 * A LEGACY scan: every credential column the builder knows how to copy, in
 * the flattened columns, and NO `snmpConfigs` list.
 *
 * It deliberately stays that shape. Every scan created before issue #3458 is
 * stored exactly like this, as is every scan written by an API client that
 * only knows the old fields, and their imports must keep producing the device
 * they always did — which is what makes this fixture the back-compat half of
 * the suite. The multi-config half is `multiConfigScanSource()` below.
 */
function fullScanSource(): DiscoveredDeviceScanSource {
  return {
    probeId: PROBE_ID,
    snmpVersion: "V3",
    snmpCommunityString: "public",
    snmpPort: 1161,
    snmpV3SecurityLevel: "authPriv",
    snmpV3Username: "observer",
    snmpV3AuthProtocol: "SHA",
    snmpV3AuthKey: "auth-key-value",
    snmpV3PrivProtocol: "AES",
    snmpV3PrivKey: "priv-key-value",
  };
}

/*
 * The three credential sets a mixed subnet realistically needs — v2c access
 * switches, a v3 core, a vendor block on a community of its own — with values
 * chosen so that NO two configs share a single credential. Any leakage
 * between them therefore shows up as a wrong value rather than as a coincidence
 * that still passes.
 *
 * The ids are opaque literals because that is how they are really used: minted
 * by the form into the scan's jsonb, copied onto a discovered host by the
 * probe, and looked up again by the importer in another process, possibly days
 * later. Nothing may treat them as positions.
 */
const ACCESS_CONFIG_ID: string = "access-switches-v2c";
const CORE_CONFIG_ID: string = "core-routers-v3";
const PRINTER_CONFIG_ID: string = "printers-v1";

const ACCESS_CONFIG: DiscoveryScanSnmpConfig = {
  id: ACCESS_CONFIG_ID,
  name: "Access switches",
  snmpVersion: "V2c",
  snmpCommunityString: "access-community",
  snmpPort: 161,
};

const CORE_CONFIG: DiscoveryScanSnmpConfig = {
  id: CORE_CONFIG_ID,
  name: "Core routers",
  snmpVersion: "V3",
  snmpPort: 1161,
  snmpV3SecurityLevel: "authPriv",
  snmpV3Username: "core-observer",
  snmpV3AuthProtocol: "SHA",
  snmpV3AuthKey: "core-auth-key",
  snmpV3PrivProtocol: "AES",
  snmpV3PrivKey: "core-priv-key",
};

const PRINTER_CONFIG: DiscoveryScanSnmpConfig = {
  id: PRINTER_CONFIG_ID,
  name: "Printers - factory default",
  snmpVersion: "V1",
  snmpCommunityString: "printer-community",
  snmpPort: 3161,
};

/*
 * A scan configured the NEW way, in the exact shape one is actually stored:
 * the ordered list AND the flattened mirror of its FIRST entry.
 *
 * The mirror is not decoration. NetworkDeviceDiscoveryScanService writes it on
 * every save so that a probe deployed a version behind — one that has never
 * heard of `snmpConfigs` — still has credentials to sweep with. It is also
 * what makes these tests sharp: a builder that read the flattened columns (or
 * simply `snmpConfigs[0]`) instead of the host's own config would still
 * produce a fully credentialed device, so only a fixture carrying BOTH halves
 * can tell the correct device from the plausible one.
 */
function multiConfigScanSource(
  configs: Array<DiscoveryScanSnmpConfig> = [
    ACCESS_CONFIG,
    CORE_CONFIG,
    PRINTER_CONFIG,
  ],
): DiscoveredDeviceScanSource {
  const first: DiscoveryScanSnmpConfig = configs[0]!;

  return {
    probeId: PROBE_ID,
    snmpConfigs: configs,
    snmpVersion: first.snmpVersion,
    snmpCommunityString: first.snmpCommunityString,
    snmpPort: first.snmpPort,
    snmpV3SecurityLevel: first.snmpV3SecurityLevel,
    snmpV3Username: first.snmpV3Username,
    snmpV3AuthProtocol: first.snmpV3AuthProtocol,
    snmpV3AuthKey: first.snmpV3AuthKey,
    snmpV3PrivProtocol: first.snmpV3PrivProtocol,
    snmpV3PrivKey: first.snmpV3PrivKey,
  };
}

/*
 * Asserts a device carries NONE of the SNMP v3 block. Used where the point is
 * that a v2c config answered on a scan whose OTHER config is v3: the six v3
 * columns are the ones that would arrive from the flattened mirror if the
 * per-host lookup were skipped, and listing them one by one at every call site
 * would bury the assertion that matters.
 */
function expectNoV3Credentials(device: NetworkDevice): void {
  expect(device.snmpV3SecurityLevel).toBeUndefined();
  expect(device.snmpV3Username).toBeUndefined();
  expect(device.snmpV3AuthProtocol).toBeUndefined();
  expect(device.snmpV3AuthKey).toBeUndefined();
  expect(device.snmpV3PrivProtocol).toBeUndefined();
  expect(device.snmpV3PrivKey).toBeUndefined();
}

function build(data: {
  host?: DiscoveredNetworkDevice | undefined;
  scan?: DiscoveredDeviceScanSource | undefined;
  name?: string | undefined;
}): NetworkDevice {
  return buildNetworkDeviceFromDiscoveredHost({
    projectId: PROJECT_ID,
    host: data.host || snmpHost(),
    scan: data.scan || fullScanSource(),
    name: data.name,
  });
}

describe("buildNetworkDeviceFromDiscoveredHost - vendor template auto-apply flag", () => {
  it("is off unless the caller asks for it", () => {
    expect(build({}).autoApplyVendorHealthTemplate).toBeUndefined();
  });

  it("is set on an SNMP host when the caller asks (the rule engine does)", () => {
    const device: NetworkDevice = buildNetworkDeviceFromDiscoveredHost({
      projectId: PROJECT_ID,
      host: snmpHost(),
      scan: fullScanSource(),
      autoApplyVendorHealthTemplate: true,
    });

    expect(device.autoApplyVendorHealthTemplate).toBe(true);
  });

  /*
   * A ping-only host is never SNMP-polled, so no poll can ever fingerprint
   * its vendor — the flag would be a dead toggle that reads as a promise.
   */
  it("stays off on a ping-only host even when requested", () => {
    const device: NetworkDevice = buildNetworkDeviceFromDiscoveredHost({
      projectId: PROJECT_ID,
      host: snmpHost({ snmpReachable: false }),
      scan: fullScanSource(),
      autoApplyVendorHealthTemplate: true,
    });

    expect(device.autoApplyVendorHealthTemplate).toBeUndefined();
  });
});

describe("buildNetworkDeviceFromDiscoveredHost - SNMP host", () => {
  it("maps identity fields: sysName to name, address to hostname, sysDescr to description", () => {
    const device: NetworkDevice = build({});

    expect(device.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(device.name).toBe("core-switch-01");
    // The address is both the hostname and the registered-host dedup key.
    expect(device.hostname).toBe("10.0.0.5");
    expect(device.description).toBe("Cisco IOS Software, C2960X");
    expect(device.monitoringMethod).toBe(NetworkDeviceMonitoringMethod.Snmp);
  });

  /*
   * Every credential the scan swept with must land on the device, or the
   * imported device can never poll. The v3 block matters most: a v3 scan
   * that imported as a credential-less device would sit unreachable with no
   * error anywhere.
   *
   * THE BACK-COMPAT GUARANTEE. This scan has no `snmpConfigs` — its flattened
   * columns ARE its one credential set, which is the state every scan created
   * before issue #3458 is in. Resolving a host's credentials through the new
   * list must therefore still land on exactly these values, or the feature
   * silently un-credentials the entire existing estate on its first import.
   */
  it("copies the probe and every SNMP credential from a legacy scan's flattened columns", () => {
    const device: NetworkDevice = build({});

    // Anti-vacuity: this case is only the legacy one while there is no list.
    expect(fullScanSource().snmpConfigs).toBeUndefined();

    expect(device.probeId?.toString()).toBe(PROBE_ID.toString());
    expect(device.snmpVersion).toBe("V3");
    expect(device.snmpCommunityString).toBe("public");
    expect(device.snmpPort).toBe(1161);
    expect(device.snmpV3SecurityLevel).toBe("authPriv");
    expect(device.snmpV3Username).toBe("observer");
    expect(device.snmpV3AuthProtocol).toBe("SHA");
    expect(device.snmpV3AuthKey).toBe("auth-key-value");
    expect(device.snmpV3PrivProtocol).toBe("AES");
    expect(device.snmpV3PrivKey).toBe("priv-key-value");
  });

  /*
   * The scan row may hold a serialized id rather than an ObjectID instance
   * (the rule engine selects its scan itself); the builder re-wraps rather
   * than trusting the shape.
   */
  it("re-wraps the probe id so a serialized id still becomes an ObjectID", () => {
    const device: NetworkDevice = build({
      scan: {
        ...fullScanSource(),
        probeId: PROBE_ID.toString() as unknown as ObjectID,
      },
    });

    expect(device.probeId).toBeInstanceOf(ObjectID);
    expect(device.probeId?.toString()).toBe(PROBE_ID.toString());
  });
});

/*
 * The point of issue #3458, from the import side.
 *
 * The sweep tries a scan's credential sets in order against each host, stops
 * at the first that answers, and records WHICH one that was on the host row.
 * If the import then copies the scan's first config regardless, every device
 * found by anything but config #1 is created with credentials its agent will
 * reject — and the failure is mute. There is no error at import time, the
 * device looks completely ordinary on the form, and the only symptom is a
 * poll that times out forever with nothing anywhere saying the scan holds the
 * right credential two entries further down its own list.
 */
describe("buildNetworkDeviceFromDiscoveredHost - a scan with several SNMP configs", () => {
  /*
   * The core case, and the one that would pass on the old code by accident if
   * the configs were not deliberately different: a v2c-first scan whose SECOND
   * config is v3, with a host the v3 config answered. Copying config #1 (or
   * the flattened mirror of it, which holds the same values) would produce a
   * v2c device with the access switches' community string.
   */
  it("imports a host stamped with the second config using that config's credentials, not the first's", () => {
    const device: NetworkDevice = build({
      host: snmpHost({ snmpConfigId: CORE_CONFIG_ID }),
      scan: multiConfigScanSource(),
    });

    expect(device.snmpVersion).toBe("V3");
    expect(device.snmpPort).toBe(1161);
    expect(device.snmpV3SecurityLevel).toBe("authPriv");
    expect(device.snmpV3Username).toBe("core-observer");
    expect(device.snmpV3AuthProtocol).toBe("SHA");
    expect(device.snmpV3AuthKey).toBe("core-auth-key");
    expect(device.snmpV3PrivProtocol).toBe("AES");
    expect(device.snmpV3PrivKey).toBe("core-priv-key");
    /*
     * The v3 config carries no community string, so the device must not have
     * one either — this is the assertion that catches the first config
     * leaking in through the flattened mirror, which holds "access-community".
     */
    expect(device.snmpCommunityString).toBeUndefined();
    // The probe still rides along; only the credentials are per-host.
    expect(device.probeId?.toString()).toBe(PROBE_ID.toString());
  });

  /*
   * And the reverse, which is the shape that leaks most easily: a v3-FIRST
   * scan whose second config is v2c. Every v3 column is populated on the scan
   * row (the mirror), so a builder that fell back to the row would hand the
   * device a full v3 identity it never authenticated with — a device that
   * cannot poll AND whose form claims a security level nobody configured.
   */
  it("imports a host found by a v2c config on a v3-first scan with no v3 credentials at all", () => {
    const device: NetworkDevice = build({
      host: snmpHost({ snmpConfigId: ACCESS_CONFIG_ID }),
      scan: multiConfigScanSource([CORE_CONFIG, ACCESS_CONFIG, PRINTER_CONFIG]),
    });

    expect(device.snmpVersion).toBe("V2c");
    expect(device.snmpCommunityString).toBe("access-community");
    expect(device.snmpPort).toBe(161);
    expectNoV3Credentials(device);
  });

  /*
   * The third entry, pinned so the lookup can never be "the first, or the one
   * after it". Configs are found by ID; their position in the list is the
   * operator's ordering preference and nothing else.
   */
  it("imports a host found by the third config with the third config's credentials", () => {
    const device: NetworkDevice = build({
      host: snmpHost({ snmpConfigId: PRINTER_CONFIG_ID }),
      scan: multiConfigScanSource(),
    });

    expect(device.snmpVersion).toBe("V1");
    expect(device.snmpCommunityString).toBe("printer-community");
    expect(device.snmpPort).toBe(3161);
    expectNoV3Credentials(device);
  });

  /*
   * A host with no stamp at all. That is every result stored before this
   * feature existed and every result from a probe that is a version behind —
   * neither is an error, and both must import as something that can poll, so
   * the first config (the one such a probe was actually given, through the
   * mirror) is the answer.
   */
  it("falls back to the first config for a host that carries no config id", () => {
    const device: NetworkDevice = build({
      host: snmpHost(),
      scan: multiConfigScanSource(),
    });

    expect(device.snmpVersion).toBe("V2c");
    expect(device.snmpCommunityString).toBe("access-community");
    expect(device.snmpPort).toBe(161);
    expectNoV3Credentials(device);
  });

  /*
   * A host stamped with an id that is no longer in the list — the operator
   * deleted that credential set (or renamed the scan's configs wholesale)
   * between the sweep and the import, which is an entirely ordinary sequence
   * of events.
   *
   * The requirement is that this degrades rather than fails. A throw here
   * would take down the Review dialog mid-list, and a credential-LESS device
   * is strictly worse than a wrong one: a wrong credential is visible on the
   * device form and fixable in a click, whereas a device with no credentials
   * can never poll and gives the operator nothing to correct.
   */
  it("falls back to the first config for a host whose config id is no longer in the list", () => {
    const buildWithADeletedConfigId: () => NetworkDevice =
      (): NetworkDevice => {
        return build({
          host: snmpHost({ snmpConfigId: "a-config-that-was-deleted" }),
          scan: multiConfigScanSource(),
        });
      };

    expect(buildWithADeletedConfigId).not.toThrow();

    const device: NetworkDevice = buildWithADeletedConfigId();

    expect(device.snmpVersion).toBe("V2c");
    expect(device.snmpCommunityString).toBe("access-community");
    expect(device.snmpPort).toBe(161);
    expectNoV3Credentials(device);
  });
});

describe("buildNetworkDeviceFromDiscoveredHost - ping-only host", () => {
  /*
   * A ping-only host becomes a monitor-backed device: recorded so it can
   * belong to a site and appear on the topology map, with binding a monitor
   * to it a separate deliberate step. Credentials it never answered to must
   * not ride along.
   */
  it("builds a monitor-backed device with polling off and no credentials", () => {
    const device: NetworkDevice = build({
      host: snmpHost({ snmpReachable: false, sysName: undefined }),
    });

    expect(device.monitoringMethod).toBe(NetworkDeviceMonitoringMethod.Monitor);
    expect(device.isPollingEnabled).toBe(false);
    expect(device.probeId).toBeUndefined();
    expect(device.snmpVersion).toBeUndefined();
    expect(device.snmpCommunityString).toBeUndefined();
    expect(device.snmpPort).toBeUndefined();
    expect(device.snmpV3SecurityLevel).toBeUndefined();
    expect(device.snmpV3Username).toBeUndefined();
    expect(device.snmpV3AuthProtocol).toBeUndefined();
    expect(device.snmpV3AuthKey).toBeUndefined();
    expect(device.snmpV3PrivProtocol).toBeUndefined();
    expect(device.snmpV3PrivKey).toBeUndefined();
  });

  /*
   * The same guarantee against the multi-config path, with the host carrying
   * a config id it has no business carrying.
   *
   * Defensive on purpose. `snmpConfigId` and `snmpReachable` are two fields of
   * the same probe-written jsonb row, and nothing in the database enforces
   * that a ping-only row leaves the first one unset — an older result, a
   * partially-rewritten row, or a probe bug is enough. The builder must decide
   * on the monitoring method and return BEFORE it ever looks a config up, so
   * that a stray id can never conjure credentials onto a device that answered
   * nothing but a ping.
   */
  it("gives a ping-only host no credentials even when it carries an snmpConfigId", () => {
    const device: NetworkDevice = build({
      host: snmpHost({
        snmpReachable: false,
        snmpConfigId: CORE_CONFIG_ID,
      }),
      scan: multiConfigScanSource(),
    });

    expect(device.monitoringMethod).toBe(NetworkDeviceMonitoringMethod.Monitor);
    expect(device.isPollingEnabled).toBe(false);
    expect(device.probeId).toBeUndefined();
    expect(device.snmpVersion).toBeUndefined();
    expect(device.snmpCommunityString).toBeUndefined();
    expect(device.snmpPort).toBeUndefined();
    expectNoV3Credentials(device);
  });
});

describe("buildDeviceName", () => {
  it("prefers the sysName", () => {
    expect(buildDeviceName(snmpHost())).toBe("core-switch-01");
  });

  // A ping-only host has no SNMP identity; the address is all there is.
  it("falls back to the address when sysName is missing", () => {
    expect(buildDeviceName(snmpHost({ sysName: undefined }))).toBe("10.0.0.5");
  });

  it("falls back to the address when sysName is whitespace", () => {
    expect(buildDeviceName(snmpHost({ sysName: "   " }))).toBe("10.0.0.5");
  });

  /*
   * SNMP sysName is a DisplayString of up to 255 octets, so over-long names
   * are routine on real gear — and the create path THROWS on an over-long
   * name (via the slug ceiling) rather than truncating, so the clamp has to
   * happen here.
   */
  it("clamps a 255-character sysName to MAX_DEVICE_NAME_LENGTH", () => {
    const longSysName: string = "x".repeat(255);
    const name: string = buildDeviceName(snmpHost({ sysName: longSysName }));

    expect(name.length).toBe(MAX_DEVICE_NAME_LENGTH);
    expect(name).toBe(longSysName.substring(0, MAX_DEVICE_NAME_LENGTH));
  });
});

describe("buildFallbackDeviceName", () => {
  it("appends the address that tells name-twins apart", () => {
    expect(buildFallbackDeviceName(snmpHost())).toBe(
      "core-switch-01 (10.0.0.5)",
    );
  });

  /*
   * The collision fallback must fit under the SAME ceiling as the first
   * attempt: the widest possible suffix is " (255.255.255.255)", so the base
   * name is cut down first rather than the composed string overflowing into
   * the very slug-length failure the ceiling exists to avoid.
   */
  it("keeps the composed name within MAX_DEVICE_NAME_LENGTH at the widest address", () => {
    const name: string = buildFallbackDeviceName(
      snmpHost({
        sysName: "y".repeat(255),
        ipAddress: "255.255.255.255",
      }),
    );

    expect(name.length).toBeLessThanOrEqual(MAX_DEVICE_NAME_LENGTH);
    expect(name.endsWith(" (255.255.255.255)")).toBe(true);
  });
});

describe("description clamping", () => {
  it("clamps an over-long sysDescr to MAX_DEVICE_DESCRIPTION_LENGTH", () => {
    const longSysDescr: string = "d".repeat(700);
    const device: NetworkDevice = build({
      host: snmpHost({ sysDescr: longSysDescr }),
    });

    expect(device.description?.length).toBe(MAX_DEVICE_DESCRIPTION_LENGTH);
    expect(device.description).toBe(
      longSysDescr.substring(0, MAX_DEVICE_DESCRIPTION_LENGTH),
    );
  });

  it("sets no description when the host has no sysDescr", () => {
    const device: NetworkDevice = build({
      host: snmpHost({ sysDescr: undefined }),
    });

    expect(device.description).toBeUndefined();
  });
});

describe("the name override", () => {
  /*
   * The caller supplies the name so the collision retry can rebuild the SAME
   * device under the fallback name without re-deciding anything else — the
   * override must therefore be taken verbatim.
   */
  it("uses a supplied name verbatim instead of deriving one", () => {
    const device: NetworkDevice = build({
      name: "core-switch-01 (10.0.0.5)",
    });

    expect(device.name).toBe("core-switch-01 (10.0.0.5)");
    // Everything else is still derived from the host as usual.
    expect(device.hostname).toBe("10.0.0.5");
  });
});

/*
 * OneUptime issue #3529 — "Network Discovery Scan should perform reverse DNS
 * lookup and display hostnames".
 *
 * The reporter's Review dialog listed 10.18.166.51, .53, .54, .55 on an
 * estate where every one of those addresses has a DNS record. Those rows are
 * hosts with no readable SNMP: with no sysName, `sysName || ipAddress` had
 * nothing left to fall back to. `dnsHostname` is the missing middle term.
 *
 * What these cases pin is the ORDER, and the order is a deliberate judgement
 * rather than a reading of the issue text. The issue asks for the hostname to
 * be "the device name"; sysName is nonetheless kept ahead of it, because
 * sysName is the name the device asserts about itself, it is what every scan
 * imported under before this existed, and demoting it would silently rename
 * devices that already import correctly for people who never asked for
 * anything to change. The PTR name lands exactly where the complaint was —
 * the hosts that had no name at all — and the dialog surfaces both when they
 * disagree, so nothing is hidden by the choice.
 */
describe("the reverse-DNS name (issue #3529)", () => {
  describe("precedence", () => {
    test("a host with no sysName is named by its PTR record", () => {
      // The reported case, in one line.
      expect(
        buildDeviceName({
          ipAddress: "10.18.166.51",
          dnsHostname: "core-gw.corp.example.com",
        }),
      ).toBe("core-gw.corp.example.com");
    });

    test("sysName still wins when the host has both", () => {
      expect(
        buildDeviceName({
          ipAddress: "10.18.166.51",
          sysName: "core-switch-01",
          dnsHostname: "sw1.corp.example.com",
        }),
      ).toBe("core-switch-01");
    });

    test("a blank sysName falls through to the PTR name", () => {
      /*
       * A whitespace-only sysName is truthy and is a real thing to read off a
       * device with a half-configured system group. It used to produce a
       * device named " ".
       */
      expect(
        buildDeviceName({
          ipAddress: "10.18.166.51",
          sysName: "   ",
          dnsHostname: "sw1.corp.example.com",
        }),
      ).toBe("sw1.corp.example.com");
    });

    test("the address is still the last resort", () => {
      expect(buildDeviceName({ ipAddress: "10.18.166.51" })).toBe(
        "10.18.166.51",
      );
      expect(
        buildDeviceName({ ipAddress: "10.18.166.51", dnsHostname: "" }),
      ).toBe("10.18.166.51");
    });

    test("a host stored before the field existed is named exactly as it was", () => {
      /*
       * Back-compat, and it is not hypothetical: every scan result already in
       * the database predates this field, as does every result from a probe
       * that has not been upgraded yet.
       */
      expect(
        buildDeviceName({ ipAddress: "10.0.0.5", sysName: "core-switch-01" }),
      ).toBe("core-switch-01");
      expect(buildDeviceName({ ipAddress: "10.0.0.5" })).toBe("10.0.0.5");
    });
  });

  describe("the display name and the device name agree", () => {
    /*
     * The operator ticks a box next to a name and gets a device with that
     * name. The two used to be spelled out separately — the dialog said
     * `sysName || ipAddress` and the builder said the same thing again — and
     * that duplication is what this shared function exists to end.
     */
    test("buildDeviceName is getDiscoveredHostDisplayName, clamped", () => {
      const hosts: Array<DiscoveredNetworkDevice> = [
        { ipAddress: "10.0.0.1" },
        { ipAddress: "10.0.0.2", dnsHostname: "gw.corp.example.com" },
        { ipAddress: "10.0.0.3", sysName: "sw-3" },
        {
          ipAddress: "10.0.0.4",
          sysName: "sw-4",
          dnsHostname: "sw4.corp.example.com",
        },
      ];

      for (const discoveredHost of hosts) {
        expect(buildDeviceName(discoveredHost)).toBe(
          getDiscoveredHostDisplayName(discoveredHost),
        );
      }
    });

    test("the display name is returned unclamped", () => {
      /*
       * The 80-character ceiling exists for the SLUG, not for the eye. A
       * dialog row has its own truncation, and showing the operator a name cut
       * at a different point than the device gets is a smaller problem than
       * pretending the ceiling is a display concern.
       */
      const longName: string = `${"a".repeat(63)}.${"b".repeat(40)}.example.com`;

      expect(
        getDiscoveredHostDisplayName({
          ipAddress: "10.0.0.1",
          dnsHostname: longName,
        }),
      ).toBe(longName);
      expect(
        buildDeviceName({ ipAddress: "10.0.0.1", dnsHostname: longName }),
      ).toHaveLength(MAX_DEVICE_NAME_LENGTH);
    });
  });

  describe("an untrusted PTR record never becomes a name", () => {
    /*
     * `dnsHostname` is the ONE field in a scan result whose value is chosen by
     * the scanned network. The probe normalises it, and normalizeDiscoveredHosts
     * normalises it again on the way out of the jsonb — but this function is the
     * last point before the value becomes a rendered line and a slugified device
     * name, and a row written by an older probe or straight through the API
     * reaches it without having passed either.
     */
    test("falls back to the address rather than naming a device after markup", () => {
      expect(
        buildDeviceName({
          ipAddress: "10.18.166.51",
          dnsHostname: "<script>alert(1)</script>",
        }),
      ).toBe("10.18.166.51");
    });

    test("falls back to the address for a name with whitespace in it", () => {
      expect(
        buildDeviceName({
          ipAddress: "10.18.166.51",
          dnsHostname: "core switch",
        }),
      ).toBe("10.18.166.51");
    });

    test("falls back to the address for a PTR that merely restates it", () => {
      /*
       * Not a name. Showing it as one would assert a resolved hostname nobody
       * published, which is worse than showing the address as an address.
       */
      expect(
        buildDeviceName({
          ipAddress: "10.18.166.51",
          dnsHostname: "10.18.166.51",
        }),
      ).toBe("10.18.166.51");
      expect(
        buildDeviceName({
          ipAddress: "10.18.166.51",
          dnsHostname: "51.166.18.10.in-addr.arpa",
        }),
      ).toBe("10.18.166.51");
    });

    test("does not throw when the column holds a non-string", () => {
      // jsonb read at render time; a throw here lands inside the modal body.
      expect(
        buildDeviceName({
          ipAddress: "10.18.166.51",
          dnsHostname: 51 as unknown as string,
        }),
      ).toBe("10.18.166.51");
    });

    test("stores the normalised form, not the raw answer", () => {
      expect(
        buildDeviceName({
          ipAddress: "10.0.0.1",
          dnsHostname: "  gw.corp.example.com.  ",
        }),
      ).toBe("gw.corp.example.com");
    });
  });

  describe("the rest of the device", () => {
    test("the address stays the hostname even when the host resolved a name", () => {
      /*
       * The issue asks for this in as many words ("retain the IP address as
       * the address/IP field"), and the system needs it: `hostname` is the
       * registered-host dedup key, what the SNMP poller dials, and what a
       * trap's source IP correlates to. A name here would make a device stop
       * polling the day its reverse zone changed.
       */
      const device: NetworkDevice = buildNetworkDeviceFromDiscoveredHost({
        projectId: PROJECT_ID,
        host: {
          ipAddress: "10.18.166.51",
          dnsHostname: "core-gw.corp.example.com",
        },
        scan: fullScanSource(),
      });

      expect(device.hostname).toBe("10.18.166.51");
      expect(device.name).toBe("core-gw.corp.example.com");
    });

    test("a ping-only host still imports as a monitor-backed device", () => {
      /*
       * Naming must not change WHAT a host imports as. A PTR record says
       * nothing about whether the device can be SNMP-polled.
       */
      const device: NetworkDevice = buildNetworkDeviceFromDiscoveredHost({
        projectId: PROJECT_ID,
        host: {
          ipAddress: "10.18.166.51",
          snmpReachable: false,
          dnsHostname: "cam-lobby.corp.example.com",
        },
        scan: fullScanSource(),
      });

      expect(device.name).toBe("cam-lobby.corp.example.com");
      expect(device.monitoringMethod).toBe(
        NetworkDeviceMonitoringMethod.Monitor,
      );
      expect(device.isPollingEnabled).toBe(false);
      expect(device.snmpCommunityString).toBeUndefined();
    });

    test("the collision fallback appends the address to the PTR name", () => {
      /*
       * Two devices legitimately sharing a name is common — and a shared PTR
       * name is if anything MORE likely than a shared sysName, because a
       * wildcard reverse zone hands every address in a range the same answer.
       * The address is what tells them apart.
       */
      expect(
        buildFallbackDeviceName({
          ipAddress: "10.18.166.51",
          dnsHostname: "dhcp-pool.corp.example.com",
        }),
      ).toBe("dhcp-pool.corp.example.com (10.18.166.51)");
    });
  });
});
