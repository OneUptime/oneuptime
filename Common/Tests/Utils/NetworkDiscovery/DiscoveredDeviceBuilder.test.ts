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
import { MAX_REVERSE_DNS_NAME_LENGTH } from "../../../Utils/NetworkDiscovery/ReverseDnsNameUtil";
import ColumnLength from "../../../Types/Database/ColumnLength";
import Slug from "../../../Utils/Slug";
import { describe, expect, it, test } from "@jest/globals";

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

    test("a padded sysName is trimmed before it becomes the name", () => {
      /*
       * The whitespace-ONLY case above pins the fall-through; this pins the
       * other half of the same `.trim()`, which nothing asserted. A padded
       * DisplayString is ordinary on real gear, and the padding must not
       * survive: leading spaces go into the varchar, into the slug, and into
       * every site/label rule that matches on the name. Delete the `.trim()`
       * and the sysName is still truthy, still wins the contest, and this
       * reads "  core-switch-01  " instead.
       */
      const paddedHost: DiscoveredNetworkDevice = {
        ipAddress: "10.18.166.51",
        sysName: "  core-switch-01  ",
        dnsHostname: "sw1.corp.example.com",
      };

      expect(getDiscoveredHostDisplayName(paddedHost)).toBe("core-switch-01");
      expect(build({ host: paddedHost }).name).toBe("core-switch-01");
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
    test("the device is created under the clamped display name", () => {
      /*
       * Rows 1-4 are the four naming outcomes; row 5 is what makes the loop
       * mean anything. Every fixture used to be far under the 80-character
       * ceiling, so `truncate` was the identity function on all of them and
       * "buildDeviceName === the display name" held for ANY clamp, including
       * no clamp at all. The long-PTR row is asserted to be genuinely cut at
       * the bottom, so deleting the truncate() reddens this.
       */
      const longPtrName: string = `${"a".repeat(63)}.${"b".repeat(
        40,
      )}.example.com`;

      const hosts: Array<DiscoveredNetworkDevice> = [
        { ipAddress: "10.0.0.1" },
        { ipAddress: "10.0.0.2", dnsHostname: "gw.corp.example.com" },
        { ipAddress: "10.0.0.3", sysName: "sw-3" },
        {
          ipAddress: "10.0.0.4",
          sysName: "sw-4",
          dnsHostname: "sw4.corp.example.com",
        },
        { ipAddress: "10.0.0.5", dnsHostname: longPtrName },
      ];

      for (const discoveredHost of hosts) {
        const displayed: string = getDiscoveredHostDisplayName(discoveredHost);

        expect(buildDeviceName(discoveredHost)).toBe(
          displayed.substring(0, MAX_DEVICE_NAME_LENGTH),
        );

        /*
         * And the DEVICE carries that name. This is the half with teeth: the
         * operator ticks a box next to the displayed name, and `device.name`
         * is what the create writes. An edit that gave the builder its own
         * naming rule would pass the assertion above and fail this one.
         */
        expect(build({ host: discoveredHost }).name).toBe(
          buildDeviceName(discoveredHost),
        );
      }

      // The clamp is exercised rather than skipped: row 5 really is cut.
      const clampedHost: DiscoveredNetworkDevice = hosts[
        hosts.length - 1
      ] as DiscoveredNetworkDevice;

      expect(getDiscoveredHostDisplayName(clampedHost)).not.toBe(
        buildDeviceName(clampedHost),
      );
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

    test("neither throws nor stringifies on a non-string column", () => {
      /*
       * Two halves, because they fail against two different mutations.
       *
       * 51 is the jsonb-read-at-render-time case: an unguarded `.trim()` is a
       * TypeError thrown inside the modal body. On its own it cannot tell a
       * type-checking normaliser from a COERCING one, because String(51) is
       * "51" and a single all-numeric label is refused anyway.
       */
      expect(
        buildDeviceName({
          ipAddress: "10.18.166.51",
          dnsHostname: 51 as unknown as string,
        }),
      ).toBe("10.18.166.51");

      /*
       * `true` is the half that can. String(true) is "true" — a syntactically
       * perfect single label that passes every content rule in
       * ReverseDnsNameUtil. Swap the `typeof value !== "string"` guard for
       * String(value) and this host is named "true" instead of by its
       * address, and this line is the only thing in the file that notices.
       */
      expect(
        buildDeviceName({
          ipAddress: "10.18.166.51",
          dnsHostname: true as unknown as string,
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

  /*
   * `sysName` is read out of the SAME verbatim jsonb blob as `dnsHostname`,
   * so its declared `string | undefined` type is a description of what the
   * probe SHOULD send rather than a fact about what is stored. Since
   * getDiscoveredHostDisplayName became the Review dialog's name line, a
   * `(42).trim()` TypeError in here is thrown DURING RENDER: React unmounts
   * the subtree, so one malformed row takes out the entire modal and the
   * operator cannot import any of the hosts the scan found, not just that
   * one. Each of these must fall through to the next naming source instead.
   */
  describe("an untrusted sysName never reaches .trim()", () => {
    const UNTRUSTED_SYS_NAMES: Array<{ reason: string; value: unknown }> = [
      /*
       * An agent whose sysName OID returned an INTEGER rather than a
       * DisplayString. Discriminating despite "42" being a poor name: unlike
       * `dnsHostname` there is no normaliser behind `sysName ||`, so a
       * String() coercion makes "42" TRUTHY and it wins the naming contest
       * outright, beating a perfectly good PTR record on the same row.
       *
       * (The boolean row that sat here was removed: `true` fails
       * `typeof === "string"` and coerces to a truthy string in exactly the
       * same way this one does, so it could not fail unless this one did.)
       */
      { reason: "a number", value: 42 },
      // What a hand-written API row looks like when someone nests the name.
      { reason: "an object", value: { name: "core-switch-01" } },
      /*
       * The sharpest of the four: `["sw-1"].toString()` is "sw-1", so a
       * String() coercion instead of the typeof guard would quietly ACCEPT
       * this and name a device after a JSON array's join.
       */
      { reason: "an array", value: ["sw-1"] },
      /*
       * jsonb stores an explicit null. The old WHY here claimed `??` would
       * miss it, which is backwards — `null ?? ""` is "". The failures this
       * row really pins are the other two shapes the guard could have taken:
       * `host.sysName !== undefined ? host.sysName.trim() : ""` THROWS on
       * null, and `String(null)` is the truthy "null", which would beat the
       * PTR record on the same row and create a device called "null".
       */
      { reason: "null", value: null },
    ];

    for (const untrusted of UNTRUSTED_SYS_NAMES) {
      test(`${untrusted.reason} sysName falls through to the PTR name`, () => {
        const host: DiscoveredNetworkDevice = {
          ipAddress: "10.18.166.51",
          sysName: untrusted.value as unknown as string,
          dnsHostname: "core-gw.corp.example.com",
        };

        expect(getDiscoveredHostDisplayName(host)).toBe(
          "core-gw.corp.example.com",
        );
        expect(buildDeviceName(host)).toBe("core-gw.corp.example.com");
      });

      test(`${untrusted.reason} sysName falls through to the address`, () => {
        // The same host on an estate with no reverse zone: nothing left but the IP.
        const host: DiscoveredNetworkDevice = {
          ipAddress: "10.18.166.51",
          sysName: untrusted.value as unknown as string,
        };

        expect(getDiscoveredHostDisplayName(host)).toBe("10.18.166.51");
        expect(buildDeviceName(host)).toBe("10.18.166.51");
      });
    }
  });

  /*
   * The last resort is the last thing standing between the Review dialog and
   * a blank modal, so it may not throw either — `String(...)` rather than
   * `host.ipAddress.trim()` or a template read of a property.
   */
  describe("an untrusted address as the last resort", () => {
    test("a numeric address still names the row", () => {
      expect(buildDeviceName({ ipAddress: 42 as unknown as string })).toBe(
        "42",
      );
    });

    test("a null address degrades to an empty name rather than a throw", () => {
      /*
       * Empty is not a good name; it is a name the create path rejects with
       * a validation error the operator can see, which is strictly better
       * than a TypeError that removes the dialog.
       */
      expect(
        getDiscoveredHostDisplayName({ ipAddress: null as unknown as string }),
      ).toBe("");
    });

    test("an object address is named by its coercion, not by a throw", () => {
      /*
       * The assertion here was `expect(typeof name).toBe("string")` against a
       * function whose declared return type IS string: the only way it could
       * fail was a throw, and it passed happily with the device named
       * "[object Object]". Pin the value instead.
       *
       * "[object Object]" is a terrible device name and that is the point: it
       * is a name the operator can SEE is wrong and that the create path
       * rejects on its own merits, rather than a TypeError that unmounts the
       * Review dialog. Delete the String(...) coercion and the expression
       * yields the object itself; replace it with a template read and this
       * still holds, which is why the null case above is asserted too.
       */
      expect(
        buildDeviceName({
          ipAddress: { v4: "10.18.166.51" } as unknown as string,
        }),
      ).toBe("[object Object]");
    });

    test("a non-string address is NAMED by coercion but ADDRESSED raw", () => {
      /*
       * BOTH readings coerce, and the hostname one matters more than the name.
       *
       * `hostname` is the registered-host dedup key:
       * NetworkDeviceService.getRegisteredHostnames matches it with
       * `Set.has()` against hostnames read back out of the database as
       * strings, and `Set.has` does not coerce. A device stored with the
       * NUMBER 42 in that column would therefore never match its own
       * registration, so the host would read as unregistered on every review
       * and import again, and again.
       *
       * The dashboard path never reached that, because normalizeDiscoveredHosts
       * stringifies the address first. The builder is also called directly by
       * the rule engine, so it coerces on its own account rather than relying
       * on a caller having been careful.
       */
      const device: NetworkDevice = build({
        host: { ipAddress: 42 as unknown as string },
      });

      expect(device.name).toBe("42");
      expect(device.hostname).toBe("42");
      expect(typeof device.hostname).toBe("string");
    });
  });

  /*
   * A dnsHostname that is not a string at all, alongside the number and
   * boolean cases above.
   *
   * Every fixture here is chosen so that String(value) is a name the
   * normaliser would HAPPILY ACCEPT, because that is the only kind that
   * discriminates. The plain object `{ name: "gw.corp.example.com" }` that
   * used to sit here proved nothing: String() of it is "[object Object]",
   * whose spaces and brackets LABEL_PATTERN refuses on their own, so the
   * case passed against a coercing normaliser exactly as well as against the
   * type-checking one it claimed to be about.
   */
  describe("an untrusted PTR record of the wrong TYPE", () => {
    const WRONGLY_TYPED_PTR_ANSWERS: Array<{
      reason: string;
      value: unknown;
    }> = [
      /*
       * The realistic one: dns.reverse() answers with an ARRAY of names, and
       * a probe that forgot to take [0] stores the array. `["gw.corp.
       * example.com"].toString()` is exactly "gw.corp.example.com", so a
       * String() coercion would store it verbatim as the device name.
       */
      {
        reason: "the resolver's whole answer array",
        value: ["gw.corp.example.com"],
      },
      /*
       * Not a shape JSON.parse can produce, and deliberately so: it is the
       * question in its pure form. String(value) here IS, byte for byte, the
       * hostname that would otherwise be stored. Only a real
       * `typeof value !== "string"` test rejects it — a coercion, a duck-type
       * ("does it have .trim()?") or an `instanceof String` check would all
       * name the device gw.corp.example.com off a value that is not a string.
       */
      {
        reason: "a string-like object",
        value: {
          toString: (): string => {
            return "gw.corp.example.com";
          },
        },
      },
    ];

    for (const answer of WRONGLY_TYPED_PTR_ANSWERS) {
      test(`${answer.reason} falls back to the address`, () => {
        const hostWithBadPtr: DiscoveredNetworkDevice = {
          ipAddress: "10.18.166.51",
          dnsHostname: answer.value as unknown as string,
        };

        expect(getDiscoveredHostDisplayName(hostWithBadPtr)).toBe(
          "10.18.166.51",
        );
        // The device, not just the name: a coercion would reach the column.
        expect(build({ host: hostWithBadPtr }).name).toBe("10.18.166.51");
      });
    }
  });

  /*
   * THE WILDCARD REVERSE ZONE.
   *
   * A DHCP range is routinely published as one record —
   * `*.166.18.10.in-addr.arpa IN PTR dhcp-pool.corp.example.com` — so every
   * address in the range resolves to the SAME name. Nothing about that answer
   * is malformed, so normalisation keeps it, and the estate the issue came
   * from is exactly the kind that has one.
   *
   * Device names are unique per project, so the second host of such a range
   * fails its create on a duplicate name. That is what the dashboard's import
   * retry exists for, and the retry is only useful if the fallback name is
   * actually DIFFERENT per host — which is what the second half pins.
   */
  describe("a wildcard reverse zone gives many hosts one name", () => {
    const WILDCARD_PTR_NAME: string = "dhcp-pool.corp.example.com";

    const firstPoolHost: DiscoveredNetworkDevice = {
      ipAddress: "10.18.166.51",
      dnsHostname: WILDCARD_PTR_NAME,
    };
    const secondPoolHost: DiscoveredNetworkDevice = {
      ipAddress: "10.18.166.52",
      dnsHostname: WILDCARD_PTR_NAME,
    };

    const thirdPoolHost: DiscoveredNetworkDevice = {
      ipAddress: "10.18.166.53",
      dnsHostname: WILDCARD_PTR_NAME,
    };

    const POOL_HOSTS: Array<DiscoveredNetworkDevice> = [
      firstPoolHost,
      secondPoolHost,
      thirdPoolHost,
    ];

    test("three hosts in the range import as one name, three addresses", () => {
      /*
       * The second assertion used to be
       * `expect(buildDeviceName(first)).toBe(buildDeviceName(second))` over
       * two fixtures built from the same constant — a statement about the
       * test data, true of any implementation that reads the same field
       * twice. Phrased over the DEVICES the builder emits it has bite in both
       * directions: `names.size` is 1 only because the name ignores the
       * address, and `hostnames.size` is 3 only because the hostname ignores
       * the name. The tempting edit (put the resolved name in `hostname`)
       * breaks the second; an edit that disambiguated names eagerly breaks
       * the first, and would hide the collision the retry below exists for.
       */
      const devices: Array<NetworkDevice> = POOL_HOSTS.map(
        (poolHost: DiscoveredNetworkDevice) => {
          return build({ host: poolHost });
        },
      );

      const names: Set<string> = new Set<string>(
        devices.map((device: NetworkDevice) => {
          return device.name as string;
        }),
      );
      const hostnames: Set<string> = new Set<string>(
        devices.map((device: NetworkDevice) => {
          return device.hostname as unknown as string;
        }),
      );

      expect(names).toEqual(new Set<string>([WILDCARD_PTR_NAME]));
      expect(hostnames.size).toBe(POOL_HOSTS.length);
    });

    test("buildFallbackDeviceName tells them apart by their own address", () => {
      expect(buildFallbackDeviceName(firstPoolHost)).not.toBe(
        buildFallbackDeviceName(secondPoolHost),
      );
      expect(buildFallbackDeviceName(firstPoolHost)).toBe(
        "dhcp-pool.corp.example.com (10.18.166.51)",
      );
      expect(buildFallbackDeviceName(secondPoolHost)).toBe(
        "dhcp-pool.corp.example.com (10.18.166.52)",
      );
    });

    test("the retry creates the device under the fallback name", () => {
      /*
       * End to end, in the shape both import paths actually use: the create
       * fails on a duplicate name and the caller rebuilds the SAME device
       * with `name: buildFallbackDeviceName(host)`. Nothing else may move —
       * `hostname` is still the bare address, which is what the dedup key and
       * any hostname-keyed rule depend on. Nothing else in the suite passes a
       * PTR-named host's fallback name through the builder, so an edit that
       * ignored `data.name`, or that followed the name into `hostname`, would
       * only be caught here.
       */
      const device: NetworkDevice = build({
        host: secondPoolHost,
        name: buildFallbackDeviceName(secondPoolHost),
      });

      expect(device.name).toBe("dhcp-pool.corp.example.com (10.18.166.52)");
      expect(device.hostname).toBe("10.18.166.52");
    });

    test("an address-less host fabricates one shared fallback name", () => {
      /*
       * An address-less host gets NO SUFFIX, not a fabricated one.
       *
       * The suffix used to be composed with a raw template read —
       * ` (${host.ipAddress})` — so a missing address produced the literal
       * token "(undefined)". That is worse than useless here: every
       * address-less host produced the SAME token, so the fallback handed the
       * retry a name that collided all over again, failing on the very
       * duplicate it was retrying.
       *
       * The honest answer is that a host with no address cannot be told apart
       * from another one, so the fallback returns the base name unchanged and
       * the create fails on a real duplicate. What must never happen is a
       * name that LOOKS address-qualified while carrying no address.
       */
      const addresslessHost: DiscoveredNetworkDevice = {
        dnsHostname: WILDCARD_PTR_NAME,
      } as unknown as DiscoveredNetworkDevice;

      const fallbackName: string = buildFallbackDeviceName(addresslessHost);

      expect(fallbackName).toBe(WILDCARD_PTR_NAME);
      expect(fallbackName).not.toContain("undefined");
      expect(fallbackName).not.toContain("(");
    });

    test("a null address is composed into the name as the token (null)", () => {
      /*
       * ONE value, ONE reading — which is the point of the fix.
       *
       * A null address used to be read two ways: "" by the display path
       * (`String(host.ipAddress ?? "")`) and " (null)" by the fallback path,
       * which interpolated it raw. Two readings of one field in two functions
       * that have to agree about the same host is how a retry ends up
       * composing a name nobody can act on.
       */
      const nullAddressHost: DiscoveredNetworkDevice = {
        ipAddress: null as unknown as string,
        dnsHostname: WILDCARD_PTR_NAME,
      };

      expect(buildFallbackDeviceName(nullAddressHost)).toBe(WILDCARD_PTR_NAME);
      expect(buildFallbackDeviceName(nullAddressHost)).not.toContain("null)");
    });
  });

  /*
   * FALLBACK NAME ARITHMETIC at both extremes at once.
   *
   * The longest name DNS can express (253 characters) combined with the
   * widest address is the worst case the composition has to survive, and a
   * PTR name is the one naming source that can hit its own ceiling with no
   * help from a misconfigured device. Two things have to hold: the composed
   * name still fits under the ceiling the slug needs, and the ADDRESS
   * survives the cut. A fallback that truncated the address away would hand
   * both hosts of a wildcard range the same name again — the exact collision
   * it is there to break.
   *
   * "Widest address" is IPv6, not 255.255.255.255. A full v6 address is 39
   * characters, so its suffix is 42 — more than half the whole ceiling, and
   * 24 characters wider than the v4 case. The v4 rows come first because
   * they are the ordinary case; the v6 rows at the end are the real extreme,
   * and the probe resolves ip6.arpa PTRs, so v6 hosts are in scope.
   */
  describe("the fallback name at the longest PTR name and the widest address", () => {
    // 63 + 1 + 63 + 1 + 63 + 1 + 61 = 253: maximal labels, maximal total.
    const MAXIMAL_PTR_NAME: string = `${"a".repeat(63)}.${"b".repeat(
      63,
    )}.${"c".repeat(63)}.${"d".repeat(61)}`;

    const WIDEST_ADDRESS_SUFFIX: string = " (255.255.255.255)";

    test("the maximal name is a name this builder actually accepts", () => {
      /*
       * Anti-vacuity for everything below: if normalisation rejected a
       * 253-character name, every case here would be measuring the ADDRESS
       * fallback and would pass for the wrong reason.
       */
      expect(MAXIMAL_PTR_NAME).toHaveLength(MAX_REVERSE_DNS_NAME_LENGTH);
      expect(
        buildDeviceName({
          ipAddress: "255.255.255.255",
          dnsHostname: MAXIMAL_PTR_NAME,
        }),
      ).toBe(MAXIMAL_PTR_NAME.substring(0, MAX_DEVICE_NAME_LENGTH));
    });

    test("the composed name uses the whole ceiling and keeps the address", () => {
      /*
       * The re-derived expectation is gone. This used to assert the base
       * equals `MAXIMAL_PTR_NAME.substring(0, MAX - suffix.length)`, which is
       * buildFallbackDeviceName's own arithmetic restated: an implementation
       * that computed the WRONG cut would compute it identically on both
       * sides and still pass. The contract instead — all 80 characters are
       * used, the suffix is the host's address in full (it is never what
       * gives way, or the wildcard range collides again), and what precedes
       * it is a genuine prefix of the PTR name rather than some other string.
       */
      const name: string = buildFallbackDeviceName({
        ipAddress: "255.255.255.255",
        dnsHostname: MAXIMAL_PTR_NAME,
      });

      expect(name).toHaveLength(MAX_DEVICE_NAME_LENGTH);
      expect(name.endsWith(WIDEST_ADDRESS_SUFFIX)).toBe(true);

      const base: string = name.substring(
        0,
        name.length - WIDEST_ADDRESS_SUFFIX.length,
      );

      expect(base.length).toBeGreaterThan(0);
      expect(MAXIMAL_PTR_NAME.startsWith(base)).toBe(true);
    });

    test("two maximal-name hosts still get different fallback names", () => {
      /*
       * The point of the whole fallback, at the length where losing the
       * address is most tempting: these two share 253 characters of name and
       * differ only in their last octet.
       */
      expect(
        buildFallbackDeviceName({
          ipAddress: "255.255.255.255",
          dnsHostname: MAXIMAL_PTR_NAME,
        }),
      ).not.toBe(
        buildFallbackDeviceName({
          ipAddress: "255.255.255.254",
          dnsHostname: MAXIMAL_PTR_NAME,
        }),
      );
    });

    /*
     * IPV6 — the actual worst case, and untested anywhere in the feature
     * until now. 39 characters of address means a 42-character suffix, so
     * the base is cut to 38: more than half the composed name is the address.
     * The `Math.max(1, MAX_DEVICE_NAME_LENGTH - suffix.length)` in
     * buildFallbackDeviceName is written to survive this; nothing proved it,
     * and a v4-only reading of "the widest address" would not have noticed a
     * regression that only bites past an 18-character suffix.
     */
    const FULL_IPV6_ADDRESS: string = "2001:0db8:85a3:0000:0000:8a2e:0370:7334";
    const IPV6_SUFFIX: string = ` (${FULL_IPV6_ADDRESS})`;

    test("an IPv6 address takes over half the ceiling and still fits", () => {
      // Anti-vacuity: this really is the wider of the two suffixes.
      expect(IPV6_SUFFIX.length).toBeGreaterThan(WIDEST_ADDRESS_SUFFIX.length);

      const name: string = buildFallbackDeviceName({
        ipAddress: FULL_IPV6_ADDRESS,
        dnsHostname: MAXIMAL_PTR_NAME,
      });

      expect(name).toHaveLength(MAX_DEVICE_NAME_LENGTH);
      expect(name.endsWith(IPV6_SUFFIX)).toBe(true);
      expect(
        MAXIMAL_PTR_NAME.startsWith(
          name.substring(0, name.length - IPV6_SUFFIX.length),
        ),
      ).toBe(true);

      /*
       * And it still slugs. Asserted here rather than for the v4 case
       * because the maths is genuinely different: slugify's `remove` set
       * strips the colons and the brackets, so a v6 fallback's slug base is
       * nine characters SHORTER than its name.
       */
      expect(Slug.getSlug(name).length).toBeLessThanOrEqual(ColumnLength.Slug);
    });

    test("two IPv6 hosts in one wildcard zone still get different names", () => {
      /*
       * Where "cut the suffix instead of the base" would collide: these two
       * share 253 characters of PTR name and differ only in the last group of
       * an address that occupies 42 of the 80 characters available.
       */
      expect(
        buildFallbackDeviceName({
          ipAddress: FULL_IPV6_ADDRESS,
          dnsHostname: MAXIMAL_PTR_NAME,
        }),
      ).not.toBe(
        buildFallbackDeviceName({
          ipAddress: "2001:0db8:85a3:0000:0000:8a2e:0370:7335",
          dnsHostname: MAXIMAL_PTR_NAME,
        }),
      );
    });

    /*
     * SLUG HEADROOM — the ceiling that actually bites.
     *
     * NetworkDevice.name is varchar(100) but @SlugifyColumn writes a slug
     * beside it, and Slug.getSlug appends a dash and ten digits into its own
     * varchar(100). So a name of 95 characters fits the name column and fails
     * the CREATE on the slug, with an error that says nothing about names.
     * MAX_DEVICE_NAME_LENGTH is 80 for this reason and nothing else, so the
     * arithmetic is asserted here against the real column length and the real
     * slug function rather than restated as a comment.
     */
    test("the ceiling is what keeps the slug inside its own column", () => {
      /*
       * This replaces three tests that were each measuring less than they
       * claimed: one asserted `MAX_DEVICE_NAME_LENGTH + "-1234567890".length
       * <= ColumnLength.Slug`, pure arithmetic over two constants that
       * invoked none of the code under test and hard-coded Faker's suffix
       * shape as a literal; the other two slugged names that slugify SHRINKS,
       * so they had headroom the real worst case does not.
       *
       * The fixture is chosen to be that worst case. Every dotted PTR name
       * loses a character per dot on the way into a slug (slugify's `remove`
       * set eats them), so a PTR-named device can never be the widest slug a
       * name of this length produces. A hyphenated sysName has nothing to
       * remove, so its slug base is the full 80 characters — and 255-octet
       * sysNames are routine on real gear, which is why the clamp exists.
       *
       * Raise MAX_DEVICE_NAME_LENGTH past what the slug column can hold and
       * this fails at the constant, rather than in production on whichever
       * device happens to have a long enough name.
       */
      const SLUG_PROBE: string = "device";
      // Measured off the real Slug, not restated: it tracks Faker's suffix.
      const slugSuffixLength: number =
        Slug.getSlug(SLUG_PROBE).length - SLUG_PROBE.length;

      const name: string = buildDeviceName({
        ipAddress: "10.18.166.51",
        sysName: "long-sysname-".repeat(20),
      });

      expect(name).toHaveLength(MAX_DEVICE_NAME_LENGTH);

      const slug: string = Slug.getSlug(name);

      // Nothing was removed: the whole clamped name is still in the slug.
      expect(slug.substring(0, slug.length - slugSuffixLength)).toBe(
        name.toLowerCase(),
      );
      expect(slug.length).toBeLessThanOrEqual(ColumnLength.Slug);
    });
  });

  /*
   * `hostname` is the registered-host dedup key, what the SNMP poller dials,
   * and what a trap's source IP is correlated to — so it is the ADDRESS for
   * every host, whatever the host ended up being NAMED. Table-driven across
   * both naming sources because the risk is a future edit that "uses the
   * resolved name where we have one": that would look correct on five of
   * these six rows and would silently stop a device polling the day its
   * reverse zone changed.
   */
  describe("the address is the hostname for every naming combination", () => {
    const NAMING_COMBINATIONS: Array<{
      reason: string;
      host: DiscoveredNetworkDevice;
      expectedName: string;
    }> = [
      {
        reason: "sysName and a usable PTR name",
        host: {
          ipAddress: "10.18.166.51",
          sysName: "core-switch-01",
          dnsHostname: "sw1.corp.example.com",
        },
        expectedName: "core-switch-01",
      },
      {
        reason: "sysName and no PTR name",
        host: { ipAddress: "10.18.166.51", sysName: "core-switch-01" },
        expectedName: "core-switch-01",
      },
      {
        reason: "sysName and a PTR name that normalises away",
        host: {
          ipAddress: "10.18.166.51",
          sysName: "core-switch-01",
          dnsHostname: "51.166.18.10.in-addr.arpa",
        },
        expectedName: "core-switch-01",
      },
      {
        reason: "no sysName and a usable PTR name",
        host: {
          ipAddress: "10.18.166.51",
          dnsHostname: "sw1.corp.example.com",
        },
        expectedName: "sw1.corp.example.com",
      },
      {
        reason: "no sysName and no PTR name",
        host: { ipAddress: "10.18.166.51" },
        expectedName: "10.18.166.51",
      },
      {
        reason: "no sysName and a PTR name that normalises away",
        host: { ipAddress: "10.18.166.51", dnsHostname: "core switch" },
        expectedName: "10.18.166.51",
      },
    ];

    for (const combination of NAMING_COMBINATIONS) {
      test(`${combination.reason}: named ${combination.expectedName}, addressed 10.18.166.51`, () => {
        const device: NetworkDevice = build({ host: combination.host });

        expect(device.name).toBe(combination.expectedName);
        expect(device.hostname).toBe("10.18.166.51");
      });
    }
  });
});
