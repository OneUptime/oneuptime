import {
  MAX_DEVICE_DESCRIPTION_LENGTH,
  MAX_DEVICE_DNS_NAME_LENGTH,
  MAX_DEVICE_NAME_LENGTH,
  buildDeviceName,
  buildFallbackDeviceName,
  buildNetworkDeviceFromDiscoveredHost,
  getDiscoveredHostDisplayName,
  getDiscoveredHostFullName,
  DiscoveredDeviceScanSource,
  DiscoveredHostNaming,
} from "../../../Utils/NetworkDiscovery/DiscoveredDeviceBuilder";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import { DiscoveredNetworkDevice } from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import NetworkDeviceMonitoringMethod from "../../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import ObjectID from "../../../Types/ObjectID";
import { DiscoveryScanSnmpConfig } from "../../../Utils/NetworkDiscovery/SnmpScanConfigUtil";
import { MAX_REVERSE_DNS_NAME_LENGTH } from "../../../Utils/NetworkDiscovery/ReverseDnsNameUtil";
import { getShortHostname } from "../../../Utils/NetworkDiscovery/ShortHostnameUtil";
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

/*
 * The naming choice every case written before issue #3678 was written
 * against: full names, exactly as every scan named its devices before the
 * short-name setting existed. Spelled `false` rather than `{}` so a reader
 * sees which behaviour the expectations below pin; the "off by default"
 * cases further down prove `{}` means the same thing.
 */
const FULL_NAMES: DiscoveredHostNaming = { useShortDeviceNames: false };

// The scan setting from issue #3678, switched on.
const SHORT_NAMES: DiscoveredHostNaming = { useShortDeviceNames: true };

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

/*
 * fullScanSource() with issue #3678's short-name setting switched on — the
 * shape a scan row has when the operator ticked "Use Short Device Names".
 */
function shortNamesScan(): DiscoveredDeviceScanSource {
  return { ...fullScanSource(), useShortDeviceNames: true };
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
   * A ping-only host imports with no credentials, so no poll fingerprints
   * its vendor until an operator adds some — the flag would be a dead toggle
   * that reads as a promise. The device is still the scan's probe's to ping;
   * what it lacks is the SNMP data the template auto-apply keys off.
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
    expect(device.monitoringMethod).toBe(NetworkDeviceMonitoringMethod.Probe);
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
   * A ping-only host becomes a Probe device the scan's probe pings: it has
   * a status from its first poll, belongs to a site, appears on the topology
   * map, and gets walked the day an operator adds credentials. Credentials
   * it never answered to must not ride along.
   *
   * (It used to become a monitor-backed device with no probe and polling
   * off, and sat on "Pending" until a Ping monitor was hand-bound — issue
   * #3447. The three assertions that changed here are the ones that end
   * that: Probe, the scan's probe, polling on.)
   */
  it("builds a Probe device on the scan's probe with polling on and no credentials", () => {
    const device: NetworkDevice = build({
      host: snmpHost({ snmpReachable: false, sysName: undefined }),
    });

    expect(device.monitoringMethod).toBe(NetworkDeviceMonitoringMethod.Probe);
    expect(device.isPollingEnabled).toBe(true);
    expect(device.probeId).toBeInstanceOf(ObjectID);
    expect(device.probeId?.toString()).toBe(PROBE_ID.toString());
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
   * that the host is ping-only and return BEFORE it ever looks a config up, so
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

    expect(device.monitoringMethod).toBe(NetworkDeviceMonitoringMethod.Probe);
    expect(device.isPollingEnabled).toBe(true);
    expect(device.probeId?.toString()).toBe(PROBE_ID.toString());
    expect(device.snmpVersion).toBeUndefined();
    expect(device.snmpCommunityString).toBeUndefined();
    expect(device.snmpPort).toBeUndefined();
    expectNoV3Credentials(device);
  });

  /*
   * The OID template an auto-import rule links is SNMP data the host did not
   * supply; attaching it would promise a collection that cannot start until
   * credentials exist. Kept off, like the vendor-template flag above.
   */
  it("does not attach the rule's OID template to a ping-only host", () => {
    const device: NetworkDevice = buildNetworkDeviceFromDiscoveredHost({
      projectId: PROJECT_ID,
      host: snmpHost({ snmpReachable: false }),
      scan: fullScanSource(),
      oidTemplateId: new ObjectID("44444444-4444-4444-8444-444444444444"),
    });

    expect(device.oidTemplateId).toBeUndefined();
  });

  /*
   * A scan with no probe at all — an API-written row, or a scan whose probe
   * was deleted between the sweep and the import. The device is still a
   * Probe device with polling on; it simply has no probe to be claimed by
   * until one is assigned, which the Settings form requires. Nothing here
   * may throw or silently fall back to Monitor.
   */
  it("still builds a Probe device with polling on when the scan names no probe", () => {
    const device: NetworkDevice = build({
      host: snmpHost({ snmpReachable: false }),
      scan: { ...fullScanSource(), probeId: undefined },
    });

    expect(device.monitoringMethod).toBe(NetworkDeviceMonitoringMethod.Probe);
    expect(device.isPollingEnabled).toBe(true);
    expect(device.probeId).toBeUndefined();
  });
});

describe("buildNetworkDeviceFromDiscoveredHost - both kinds of host share the recipe", () => {
  /*
   * The point of ping-first polling from the import side: the ONLY thing
   * that differs between an SNMP host and a ping-only one is the credentials.
   * Method, probe and polling are identical, so an edit that reintroduced a
   * "ping-only hosts are different" branch on any of the three fails here.
   */
  it("differ only in the credentials they carry", () => {
    const snmpDevice: NetworkDevice = build({
      host: snmpHost({ snmpReachable: true }),
    });
    const pingOnlyDevice: NetworkDevice = build({
      host: snmpHost({ snmpReachable: false }),
    });

    expect(pingOnlyDevice.monitoringMethod).toBe(snmpDevice.monitoringMethod);
    expect(pingOnlyDevice.isPollingEnabled).toBe(snmpDevice.isPollingEnabled);
    expect(pingOnlyDevice.probeId?.toString()).toBe(
      snmpDevice.probeId?.toString(),
    );

    // Anti-vacuity: the SNMP device really does carry what the other lacks.
    expect(snmpDevice.snmpCommunityString).toBe("public");
    expect(pingOnlyDevice.snmpCommunityString).toBeUndefined();
  });

  it("writes polling on explicitly rather than leaving it to the column", () => {
    for (const snmpReachable of [true, false, undefined]) {
      expect(
        build({ host: snmpHost({ snmpReachable: snmpReachable }) })
          .isPollingEnabled,
      ).toBe(true);
    }
  });
});

describe("buildDeviceName", () => {
  it("prefers the sysName", () => {
    expect(buildDeviceName(snmpHost(), FULL_NAMES)).toBe("core-switch-01");
  });

  // A ping-only host has no SNMP identity; the address is all there is.
  it("falls back to the address when sysName is missing", () => {
    expect(buildDeviceName(snmpHost({ sysName: undefined }), FULL_NAMES)).toBe(
      "10.0.0.5",
    );
  });

  it("falls back to the address when sysName is whitespace", () => {
    expect(buildDeviceName(snmpHost({ sysName: "   " }), FULL_NAMES)).toBe(
      "10.0.0.5",
    );
  });

  /*
   * SNMP sysName is a DisplayString of up to 255 octets, so over-long names
   * are routine on real gear — and the create path THROWS on an over-long
   * name (via the slug ceiling) rather than truncating, so the clamp has to
   * happen here.
   */
  it("clamps a 255-character sysName to MAX_DEVICE_NAME_LENGTH", () => {
    const longSysName: string = "x".repeat(255);
    const name: string = buildDeviceName(
      snmpHost({ sysName: longSysName }),
      FULL_NAMES,
    );

    expect(name.length).toBe(MAX_DEVICE_NAME_LENGTH);
    expect(name).toBe(longSysName.substring(0, MAX_DEVICE_NAME_LENGTH));
  });
});

describe("buildFallbackDeviceName", () => {
  it("appends the address that tells name-twins apart", () => {
    expect(buildFallbackDeviceName(snmpHost(), FULL_NAMES)).toBe(
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
      FULL_NAMES,
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
        buildDeviceName(
          {
            ipAddress: "10.18.166.51",
            dnsHostname: "core-gw.corp.example.com",
          },
          FULL_NAMES,
        ),
      ).toBe("core-gw.corp.example.com");
    });

    test("sysName still wins when the host has both", () => {
      expect(
        buildDeviceName(
          {
            ipAddress: "10.18.166.51",
            sysName: "core-switch-01",
            dnsHostname: "sw1.corp.example.com",
          },
          FULL_NAMES,
        ),
      ).toBe("core-switch-01");
    });

    test("a blank sysName falls through to the PTR name", () => {
      /*
       * A whitespace-only sysName is truthy and is a real thing to read off a
       * device with a half-configured system group. It used to produce a
       * device named " ".
       */
      expect(
        buildDeviceName(
          {
            ipAddress: "10.18.166.51",
            sysName: "   ",
            dnsHostname: "sw1.corp.example.com",
          },
          FULL_NAMES,
        ),
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

      expect(getDiscoveredHostDisplayName(paddedHost, FULL_NAMES)).toBe(
        "core-switch-01",
      );
      expect(build({ host: paddedHost }).name).toBe("core-switch-01");
    });

    test("the address is still the last resort", () => {
      expect(buildDeviceName({ ipAddress: "10.18.166.51" }, FULL_NAMES)).toBe(
        "10.18.166.51",
      );
      expect(
        buildDeviceName(
          { ipAddress: "10.18.166.51", dnsHostname: "" },
          FULL_NAMES,
        ),
      ).toBe("10.18.166.51");
    });

    test("a host stored before the field existed is named exactly as it was", () => {
      /*
       * Back-compat, and it is not hypothetical: every scan result already in
       * the database predates this field, as does every result from a probe
       * that has not been upgraded yet.
       */
      expect(
        buildDeviceName(
          { ipAddress: "10.0.0.5", sysName: "core-switch-01" },
          FULL_NAMES,
        ),
      ).toBe("core-switch-01");
      expect(buildDeviceName({ ipAddress: "10.0.0.5" }, FULL_NAMES)).toBe(
        "10.0.0.5",
      );
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
        const displayed: string = getDiscoveredHostDisplayName(
          discoveredHost,
          FULL_NAMES,
        );

        expect(buildDeviceName(discoveredHost, FULL_NAMES)).toBe(
          displayed.substring(0, MAX_DEVICE_NAME_LENGTH),
        );

        /*
         * And the DEVICE carries that name. This is the half with teeth: the
         * operator ticks a box next to the displayed name, and `device.name`
         * is what the create writes. An edit that gave the builder its own
         * naming rule would pass the assertion above and fail this one.
         */
        expect(build({ host: discoveredHost }).name).toBe(
          buildDeviceName(discoveredHost, FULL_NAMES),
        );
      }

      // The clamp is exercised rather than skipped: row 5 really is cut.
      const clampedHost: DiscoveredNetworkDevice = hosts[
        hosts.length - 1
      ] as DiscoveredNetworkDevice;

      expect(getDiscoveredHostDisplayName(clampedHost, FULL_NAMES)).not.toBe(
        buildDeviceName(clampedHost, FULL_NAMES),
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
        getDiscoveredHostDisplayName(
          {
            ipAddress: "10.0.0.1",
            dnsHostname: longName,
          },
          FULL_NAMES,
        ),
      ).toBe(longName);
      expect(
        buildDeviceName(
          { ipAddress: "10.0.0.1", dnsHostname: longName },
          FULL_NAMES,
        ),
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
        buildDeviceName(
          {
            ipAddress: "10.18.166.51",
            dnsHostname: "<script>alert(1)</script>",
          },
          FULL_NAMES,
        ),
      ).toBe("10.18.166.51");
    });

    test("falls back to the address for a name with whitespace in it", () => {
      expect(
        buildDeviceName(
          {
            ipAddress: "10.18.166.51",
            dnsHostname: "core switch",
          },
          FULL_NAMES,
        ),
      ).toBe("10.18.166.51");
    });

    test("falls back to the address for a PTR that merely restates it", () => {
      /*
       * Not a name. Showing it as one would assert a resolved hostname nobody
       * published, which is worse than showing the address as an address.
       */
      expect(
        buildDeviceName(
          {
            ipAddress: "10.18.166.51",
            dnsHostname: "10.18.166.51",
          },
          FULL_NAMES,
        ),
      ).toBe("10.18.166.51");
      expect(
        buildDeviceName(
          {
            ipAddress: "10.18.166.51",
            dnsHostname: "51.166.18.10.in-addr.arpa",
          },
          FULL_NAMES,
        ),
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
        buildDeviceName(
          {
            ipAddress: "10.18.166.51",
            dnsHostname: 51 as unknown as string,
          },
          FULL_NAMES,
        ),
      ).toBe("10.18.166.51");

      /*
       * `true` is the half that can. String(true) is "true" — a syntactically
       * perfect single label that passes every content rule in
       * ReverseDnsNameUtil. Swap the `typeof value !== "string"` guard for
       * String(value) and this host is named "true" instead of by its
       * address, and this line is the only thing in the file that notices.
       */
      expect(
        buildDeviceName(
          {
            ipAddress: "10.18.166.51",
            dnsHostname: true as unknown as string,
          },
          FULL_NAMES,
        ),
      ).toBe("10.18.166.51");
    });

    test("stores the normalised form, not the raw answer", () => {
      expect(
        buildDeviceName(
          {
            ipAddress: "10.0.0.1",
            dnsHostname: "  gw.corp.example.com.  ",
          },
          FULL_NAMES,
        ),
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

    test("a ping-only host still imports as a credential-less Probe device", () => {
      /*
       * Naming must not change WHAT a host imports as. A PTR record says
       * nothing about whether the device answered SNMP.
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
      expect(device.monitoringMethod).toBe(NetworkDeviceMonitoringMethod.Probe);
      expect(device.isPollingEnabled).toBe(true);
      expect(device.probeId?.toString()).toBe(PROBE_ID.toString());
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
        buildFallbackDeviceName(
          {
            ipAddress: "10.18.166.51",
            dnsHostname: "dhcp-pool.corp.example.com",
          },
          FULL_NAMES,
        ),
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

        expect(getDiscoveredHostDisplayName(host, FULL_NAMES)).toBe(
          "core-gw.corp.example.com",
        );
        expect(buildDeviceName(host, FULL_NAMES)).toBe(
          "core-gw.corp.example.com",
        );
      });

      test(`${untrusted.reason} sysName falls through to the address`, () => {
        // The same host on an estate with no reverse zone: nothing left but the IP.
        const host: DiscoveredNetworkDevice = {
          ipAddress: "10.18.166.51",
          sysName: untrusted.value as unknown as string,
        };

        expect(getDiscoveredHostDisplayName(host, FULL_NAMES)).toBe(
          "10.18.166.51",
        );
        expect(buildDeviceName(host, FULL_NAMES)).toBe("10.18.166.51");
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
      expect(
        buildDeviceName({ ipAddress: 42 as unknown as string }, FULL_NAMES),
      ).toBe("42");
    });

    test("a null address degrades to an empty name rather than a throw", () => {
      /*
       * Empty is not a good name; it is a name the create path rejects with
       * a validation error the operator can see, which is strictly better
       * than a TypeError that removes the dialog.
       */
      expect(
        getDiscoveredHostDisplayName(
          { ipAddress: null as unknown as string },
          FULL_NAMES,
        ),
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
        buildDeviceName(
          {
            ipAddress: { v4: "10.18.166.51" } as unknown as string,
          },
          FULL_NAMES,
        ),
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

        expect(getDiscoveredHostDisplayName(hostWithBadPtr, FULL_NAMES)).toBe(
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
      expect(buildFallbackDeviceName(firstPoolHost, FULL_NAMES)).not.toBe(
        buildFallbackDeviceName(secondPoolHost, FULL_NAMES),
      );
      expect(buildFallbackDeviceName(firstPoolHost, FULL_NAMES)).toBe(
        "dhcp-pool.corp.example.com (10.18.166.51)",
      );
      expect(buildFallbackDeviceName(secondPoolHost, FULL_NAMES)).toBe(
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
        name: buildFallbackDeviceName(secondPoolHost, FULL_NAMES),
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

      const fallbackName: string = buildFallbackDeviceName(
        addresslessHost,
        FULL_NAMES,
      );

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

      expect(buildFallbackDeviceName(nullAddressHost, FULL_NAMES)).toBe(
        WILDCARD_PTR_NAME,
      );
      expect(
        buildFallbackDeviceName(nullAddressHost, FULL_NAMES),
      ).not.toContain("null)");
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
        buildDeviceName(
          {
            ipAddress: "255.255.255.255",
            dnsHostname: MAXIMAL_PTR_NAME,
          },
          FULL_NAMES,
        ),
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
      const name: string = buildFallbackDeviceName(
        {
          ipAddress: "255.255.255.255",
          dnsHostname: MAXIMAL_PTR_NAME,
        },
        FULL_NAMES,
      );

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
        buildFallbackDeviceName(
          {
            ipAddress: "255.255.255.255",
            dnsHostname: MAXIMAL_PTR_NAME,
          },
          FULL_NAMES,
        ),
      ).not.toBe(
        buildFallbackDeviceName(
          {
            ipAddress: "255.255.255.254",
            dnsHostname: MAXIMAL_PTR_NAME,
          },
          FULL_NAMES,
        ),
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

      const name: string = buildFallbackDeviceName(
        {
          ipAddress: FULL_IPV6_ADDRESS,
          dnsHostname: MAXIMAL_PTR_NAME,
        },
        FULL_NAMES,
      );

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
        buildFallbackDeviceName(
          {
            ipAddress: FULL_IPV6_ADDRESS,
            dnsHostname: MAXIMAL_PTR_NAME,
          },
          FULL_NAMES,
        ),
      ).not.toBe(
        buildFallbackDeviceName(
          {
            ipAddress: "2001:0db8:85a3:0000:0000:8a2e:0370:7335",
            dnsHostname: MAXIMAL_PTR_NAME,
          },
          FULL_NAMES,
        ),
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

      const name: string = buildDeviceName(
        {
          ipAddress: "10.18.166.51",
          sysName: "long-sysname-".repeat(20),
        },
        FULL_NAMES,
      );

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

/*
 * OneUptime issue #3678 — "discovered devices are named by their full DNS
 * name".
 *
 * The reporter's estate is one corporate domain, so every device in the list
 * reads "wb-0660-kds01.wbhq.com", "wb-0660-kds02.wbhq.com", ... and the part
 * an operator recognises is pushed to the far left of a truncated column. The
 * scan setting `useShortDeviceNames` names imports by the first label
 * instead. What these cases pin:
 *
 *   - OFF unless the setting is exactly `true`. Every scan that existed before
 *     the setting must keep importing under the names it always did, and a
 *     value that arrives as "true" or 1 out of an API payload must not
 *     quietly rename a project's devices.
 *   - ON shortens whichever name WON — sysName or PTR — and never changes
 *     which one wins. A sysName an operator typed ("Core Switch") beats a PTR
 *     record with the setting on exactly as it does with it off.
 *   - What cannot be shortened safely is kept whole: an address, an OS
 *     version string, an address spelled with dashes.
 *   - The Review dialog's name, the device's name, and the collision fallback
 *     all agree, because they all go through the same naming argument.
 */
describe("short device names (issue #3678)", () => {
  const CUSTOMER_PTR_NAME: string = "wb-0660-kds01.wbhq.com";

  const customerHost: DiscoveredNetworkDevice = {
    ipAddress: "10.18.167.31",
    snmpReachable: false,
    dnsHostname: CUSTOMER_PTR_NAME,
  };

  describe("the setting is off unless it is exactly true", () => {
    test("an empty naming choice imports the full name", () => {
      expect(buildDeviceName(customerHost, {})).toBe(CUSTOMER_PTR_NAME);
      expect(getDiscoveredHostDisplayName(customerHost, {})).toBe(
        CUSTOMER_PTR_NAME,
      );
      expect(buildFallbackDeviceName(customerHost, {})).toBe(
        `${CUSTOMER_PTR_NAME} (10.18.167.31)`,
      );
    });

    test("false imports the full name", () => {
      expect(buildDeviceName(customerHost, FULL_NAMES)).toBe(CUSTOMER_PTR_NAME);
    });

    /*
     * Values that are truthy but not `true`. A jsonb row, an API client that
     * stringifies booleans, or a form library that submits 1 — none of them
     * is an operator saying "rename my devices".
     */
    const NOT_TRUE: Array<{ reason: string; value: unknown }> = [
      { reason: "the string true", value: "true" },
      { reason: "the number 1", value: 1 },
      { reason: "null", value: null },
      { reason: "undefined", value: undefined },
      { reason: "an object", value: {} },
      { reason: "the string yes", value: "yes" },
    ];

    for (const notTrue of NOT_TRUE) {
      test(`${notTrue.reason} imports the full name`, () => {
        const naming: DiscoveredHostNaming = {
          useShortDeviceNames: notTrue.value as boolean,
        };

        expect(getDiscoveredHostDisplayName(customerHost, naming)).toBe(
          CUSTOMER_PTR_NAME,
        );
        expect(buildDeviceName(customerHost, naming)).toBe(CUSTOMER_PTR_NAME);
        expect(
          build({
            host: customerHost,
            scan: {
              ...fullScanSource(),
              useShortDeviceNames: notTrue.value as boolean,
            },
          }).name,
        ).toBe(CUSTOMER_PTR_NAME);
      });
    }

    // Anti-vacuity for the block: the same host really is shortened when on.
    test("true imports the short name", () => {
      expect(buildDeviceName(customerHost, SHORT_NAMES)).toBe("wb-0660-kds01");
    });
  });

  describe("with the setting on", () => {
    test("a PTR name is shortened to its first label", () => {
      expect(getDiscoveredHostDisplayName(customerHost, SHORT_NAMES)).toBe(
        "wb-0660-kds01",
      );
      expect(buildDeviceName(customerHost, SHORT_NAMES)).toBe("wb-0660-kds01");
    });

    test("a PTR name with a root dot is shortened the same way", () => {
      expect(
        buildDeviceName(
          { ipAddress: "10.18.167.31", dnsHostname: `${CUSTOMER_PTR_NAME}.` },
          SHORT_NAMES,
        ),
      ).toBe("wb-0660-kds01");
    });

    test("the PTR name's case is preserved", () => {
      expect(
        buildDeviceName(
          { ipAddress: "10.18.167.31", dnsHostname: "WB-0660-KDS01.WBHQ.COM" },
          SHORT_NAMES,
        ),
      ).toBe("WB-0660-KDS01");
    });

    /*
     * Network gear routinely reports its FQDN as sysName. Shortening only
     * PTR-named hosts would leave a list where half the switches carry the
     * domain and half do not, which reads as broken. The full sysName is not
     * lost: the poller keeps writing it to the device's sysName column.
     */
    test("a fully qualified sysName is shortened too", () => {
      const host: DiscoveredNetworkDevice = snmpHost({
        sysName: "core-sw-01.corp.example.com",
      });

      expect(getDiscoveredHostDisplayName(host, SHORT_NAMES)).toBe(
        "core-sw-01",
      );
      expect(build({ host: host, scan: shortNamesScan() }).name).toBe(
        "core-sw-01",
      );
    });

    test("a padded fully qualified sysName is trimmed and shortened", () => {
      expect(
        buildDeviceName(
          snmpHost({ sysName: "  core-sw-01.corp.example.com  " }),
          SHORT_NAMES,
        ),
      ).toBe("core-sw-01");
    });

    test("a sysName that is not a hostname is kept exactly", () => {
      expect(
        buildDeviceName(snmpHost({ sysName: "Core Switch" }), SHORT_NAMES),
      ).toBe("Core Switch");
      expect(
        buildDeviceName(snmpHost({ sysName: "Core Switch 1.5" }), SHORT_NAMES),
      ).toBe("Core Switch 1.5");
    });

    test("a single-label sysName is kept exactly", () => {
      expect(buildDeviceName(snmpHost(), SHORT_NAMES)).toBe("core-switch-01");
    });

    // An address has no domain. "10.18.167.31" must not become "10".
    test("an IPv4 address is kept whole", () => {
      expect(buildDeviceName({ ipAddress: "10.18.167.31" }, SHORT_NAMES)).toBe(
        "10.18.167.31",
      );
    });

    test("an IPv6 address is kept whole", () => {
      expect(
        buildDeviceName(
          { ipAddress: "2001:0db8:85a3:0000:0000:8a2e:0370:7334" },
          SHORT_NAMES,
        ),
      ).toBe("2001:0db8:85a3:0000:0000:8a2e:0370:7334");
      expect(buildDeviceName({ ipAddress: "2001:db8::5" }, SHORT_NAMES)).toBe(
        "2001:db8::5",
      );
    });

    /*
     * Names that pass as DNS names but that the short-name rule refuses. Kept
     * FULL, not cut: "ubuntu-22" is a name nobody chose, and
     * "10-18-167-31" is an address dressed up as a hostname.
     */
    test("a name the short-name rule refuses is kept in full", () => {
      for (const unshortenable of [
        "ubuntu-22.04",
        "10-18-167-31.dhcp.corp.com",
        "a.b.v2",
      ]) {
        expect(
          buildDeviceName(
            { ipAddress: "10.18.167.31", dnsHostname: unshortenable },
            SHORT_NAMES,
          ),
        ).toBe(unshortenable);
        expect(
          buildDeviceName(snmpHost({ sysName: unshortenable }), SHORT_NAMES),
        ).toBe(unshortenable);
      }
    });

    test("an untrusted PTR record still falls back to the address", () => {
      for (const hostile of [
        "<script>alert(1)</script>",
        "core switch.corp.example.com",
        "31.167.18.10.in-addr.arpa",
      ]) {
        expect(
          buildDeviceName(
            { ipAddress: "10.18.167.31", dnsHostname: hostile },
            SHORT_NAMES,
          ),
        ).toBe("10.18.167.31");
      }
    });
  });

  /*
   * Shortening is applied to the WINNER, after the contest. If it were
   * applied to each candidate first, a sysName the rule refuses could lose to
   * a shortenable PTR record, and turning the setting on would silently
   * change which of the device's names it is known by.
   */
  describe("shortening never changes which name wins", () => {
    test('a sysName of "Core Switch" still beats a PTR name', () => {
      const host: DiscoveredNetworkDevice = {
        ipAddress: "10.18.167.31",
        sysName: "Core Switch",
        dnsHostname: CUSTOMER_PTR_NAME,
      };

      expect(getDiscoveredHostDisplayName(host, FULL_NAMES)).toBe(
        "Core Switch",
      );
      expect(getDiscoveredHostDisplayName(host, SHORT_NAMES)).toBe(
        "Core Switch",
      );
      expect(build({ host: host, scan: shortNamesScan() }).name).toBe(
        "Core Switch",
      );
    });

    test("an unshortenable sysName still beats a shortenable PTR name", () => {
      const host: DiscoveredNetworkDevice = {
        ipAddress: "10.18.167.31",
        sysName: "ubuntu-22.04",
        dnsHostname: CUSTOMER_PTR_NAME,
      };

      expect(buildDeviceName(host, SHORT_NAMES)).toBe("ubuntu-22.04");
    });

    test("a fully qualified sysName wins and is shortened, not the PTR name", () => {
      const host: DiscoveredNetworkDevice = {
        ipAddress: "10.18.167.31",
        sysName: "kds-controller.corp.example.com",
        dnsHostname: CUSTOMER_PTR_NAME,
      };

      expect(buildDeviceName(host, SHORT_NAMES)).toBe("kds-controller");
    });

    /*
     * The general statement, over every naming combination: the short name
     * is always the short form of the FULL name the host would get with the
     * setting off, or that full name itself.
     */
    test("the short name is always the full name or its first label", () => {
      const hosts: Array<DiscoveredNetworkDevice> = [
        { ipAddress: "10.0.0.1" },
        { ipAddress: "10.0.0.2", dnsHostname: "gw.corp.example.com" },
        { ipAddress: "10.0.0.3", sysName: "sw-3" },
        { ipAddress: "10.0.0.4", sysName: "sw-4.corp.example.com" },
        {
          ipAddress: "10.0.0.5",
          sysName: "Core Switch",
          dnsHostname: "sw5.corp.example.com",
        },
        { ipAddress: "10.0.0.6", dnsHostname: "ubuntu-22.04" },
        { ipAddress: "2001:db8::7", dnsHostname: "v6.corp.example.com" },
      ];

      for (const host of hosts) {
        const full: string = getDiscoveredHostDisplayName(host, FULL_NAMES);
        const short: string = getDiscoveredHostDisplayName(host, SHORT_NAMES);

        expect([full, full.split(".")[0]]).toContain(short);
        expect(full.startsWith(short)).toBe(true);
      }
    });
  });

  describe("the Review name, the device name and the fallback agree", () => {
    test("the device is created under the clamped short display name", () => {
      const longPtrName: string = `${"a".repeat(63)}.${"b".repeat(
        40,
      )}.example.com`;

      const hosts: Array<DiscoveredNetworkDevice> = [
        { ipAddress: "10.0.0.1" },
        customerHost,
        snmpHost({ sysName: "core-sw-01.corp.example.com" }),
        snmpHost({ sysName: "Core Switch" }),
        { ipAddress: "10.0.0.5", dnsHostname: longPtrName },
        snmpHost({ sysName: "long-sysname-".repeat(20) }),
      ];

      for (const host of hosts) {
        const displayed: string = getDiscoveredHostDisplayName(
          host,
          SHORT_NAMES,
        );

        expect(buildDeviceName(host, SHORT_NAMES)).toBe(
          displayed.substring(0, MAX_DEVICE_NAME_LENGTH),
        );
        expect(build({ host: host, scan: shortNamesScan() }).name).toBe(
          buildDeviceName(host, SHORT_NAMES),
        );
      }
    });

    /*
     * Clamping happens AFTER shortening. A PTR name too long to be a device
     * name with the setting off becomes a first label that fits whole with it
     * on — the operator gets the entire hostname rather than an 80-character
     * fragment of the FQDN.
     */
    test("a long PTR name is shortened first, so its first label is not clamped", () => {
      const label: string = "a".repeat(63);
      const host: DiscoveredNetworkDevice = {
        ipAddress: "10.0.0.5",
        dnsHostname: `${label}.${"b".repeat(40)}.example.com`,
      };

      expect(buildDeviceName(host, FULL_NAMES)).toHaveLength(
        MAX_DEVICE_NAME_LENGTH,
      );
      expect(buildDeviceName(host, SHORT_NAMES)).toBe(label);
    });

    test("a long name the rule refuses is still clamped with the setting on", () => {
      const name: string = buildDeviceName(
        snmpHost({ sysName: "x".repeat(255) }),
        SHORT_NAMES,
      );

      expect(name).toHaveLength(MAX_DEVICE_NAME_LENGTH);

      const versionLike: string = buildDeviceName(
        snmpHost({ sysName: `${"v".repeat(100)}.22.04` }),
        SHORT_NAMES,
      );

      expect(versionLike).toBe(
        `${"v".repeat(100)}.22.04`.substring(0, MAX_DEVICE_NAME_LENGTH),
      );
    });

    /*
     * A wildcard reverse zone gives many hosts one PTR name, so with the
     * setting on they share one SHORT name too, and the second create
     * collides. The retry name is the short name plus the address.
     */
    test("the collision fallback is the short name plus the address", () => {
      expect(
        buildFallbackDeviceName(
          { ipAddress: "10.0.0.5", dnsHostname: "web.corp.example.com" },
          SHORT_NAMES,
        ),
      ).toBe("web (10.0.0.5)");

      expect(
        buildFallbackDeviceName(
          { ipAddress: "2001:db8::5", dnsHostname: "web.corp.example.com" },
          SHORT_NAMES,
        ),
      ).toBe("web (2001:db8::5)");

      expect(
        buildFallbackDeviceName(
          snmpHost({ sysName: "Core Switch" }),
          SHORT_NAMES,
        ),
      ).toBe("Core Switch (10.0.0.5)");
    });

    test("the fallback still tells a wildcard range apart", () => {
      const first: string = buildFallbackDeviceName(
        {
          ipAddress: "10.18.166.51",
          dnsHostname: "dhcp-pool.corp.example.com",
        },
        SHORT_NAMES,
      );
      const second: string = buildFallbackDeviceName(
        {
          ipAddress: "10.18.166.52",
          dnsHostname: "dhcp-pool.corp.example.com",
        },
        SHORT_NAMES,
      );

      expect(first).toBe("dhcp-pool (10.18.166.51)");
      expect(second).toBe("dhcp-pool (10.18.166.52)");
    });

    test("the fallback with a long first label keeps the address and the ceiling", () => {
      const name: string = buildFallbackDeviceName(
        {
          ipAddress: "2001:0db8:85a3:0000:0000:8a2e:0370:7334",
          dnsHostname: `${"a".repeat(63)}.example.com`,
        },
        SHORT_NAMES,
      );

      expect(name).toHaveLength(MAX_DEVICE_NAME_LENGTH);
      expect(name.endsWith(" (2001:0db8:85a3:0000:0000:8a2e:0370:7334)")).toBe(
        true,
      );
      expect(Slug.getSlug(name).length).toBeLessThanOrEqual(ColumnLength.Slug);
    });
  });

  describe("the builder reads the scan's own setting", () => {
    /*
     * buildNetworkDeviceFromDiscoveredHost takes no naming argument of its
     * own: the scan it is handed IS the naming choice. That is what makes a
     * caller that selected the scan without the column fail loudly (a type
     * error on DiscoveredDeviceScanSource) instead of importing full names
     * from a scan that asked for short ones.
     */
    test("a scan with the setting on imports the short name", () => {
      const device: NetworkDevice = build({
        host: customerHost,
        scan: shortNamesScan(),
      });

      expect(device.name).toBe("wb-0660-kds01");
      expect(device.hostname).toBe("10.18.167.31");
    });

    test("a scan without the setting imports the full name", () => {
      expect(build({ host: customerHost }).name).toBe(CUSTOMER_PTR_NAME);
      expect(
        build({
          host: customerHost,
          scan: { ...fullScanSource(), useShortDeviceNames: false },
        }).name,
      ).toBe(CUSTOMER_PTR_NAME);
    });

    /*
     * Naming is independent of credentials. A multi-config scan with the
     * setting on must still hand each host its own config.
     */
    test("the setting changes the name and nothing else about the device", () => {
      const host: DiscoveredNetworkDevice = snmpHost({
        sysName: "core-rtr-01.corp.example.com",
        snmpConfigId: CORE_CONFIG_ID,
      });

      const withFullNames: NetworkDevice = build({
        host: host,
        scan: multiConfigScanSource(),
      });
      const withShortNames: NetworkDevice = build({
        host: host,
        scan: { ...multiConfigScanSource(), useShortDeviceNames: true },
      });

      expect(withFullNames.name).toBe("core-rtr-01.corp.example.com");
      expect(withShortNames.name).toBe("core-rtr-01");

      expect(withShortNames.hostname).toBe(withFullNames.hostname);
      expect(withShortNames.description).toBe(withFullNames.description);
      expect(withShortNames.monitoringMethod).toBe(
        withFullNames.monitoringMethod,
      );
      expect(withShortNames.isPollingEnabled).toBe(
        withFullNames.isPollingEnabled,
      );
      expect(withShortNames.probeId?.toString()).toBe(
        withFullNames.probeId?.toString(),
      );
      expect(withShortNames.snmpVersion).toBe("V3");
      expect(withShortNames.snmpV3Username).toBe("core-observer");
      expect(withShortNames.snmpCommunityString).toBeUndefined();
    });

    /*
     * The collision retry passes the fallback name explicitly, and it must
     * be used verbatim — the builder may not shorten a name it was handed,
     * or "web (10.0.0.5)" and a hand-supplied FQDN would both be rewritten.
     */
    test("an explicit name still wins, verbatim, with the setting on", () => {
      expect(
        build({
          host: customerHost,
          scan: shortNamesScan(),
          name: "custom-kds-name",
        }).name,
      ).toBe("custom-kds-name");

      expect(
        build({
          host: customerHost,
          scan: shortNamesScan(),
          name: "kds-override.corp.example.com",
        }).name,
      ).toBe("kds-override.corp.example.com");
    });

    test("the retry creates the device under the short fallback name", () => {
      const scan: DiscoveredDeviceScanSource = shortNamesScan();

      const device: NetworkDevice = build({
        host: customerHost,
        scan: scan,
        name: buildFallbackDeviceName(customerHost, scan),
      });

      expect(device.name).toBe("wb-0660-kds01 (10.18.167.31)");
      expect(device.hostname).toBe("10.18.167.31");
      expect(device.dnsName).toBe(CUSTOMER_PTR_NAME);
    });

    // The scan model itself is a naming choice, structurally.
    test("a scan source is accepted wherever a naming choice is", () => {
      const scan: DiscoveredDeviceScanSource = shortNamesScan();
      const naming: DiscoveredHostNaming = scan;

      expect(buildDeviceName(customerHost, naming)).toBe("wb-0660-kds01");
    });
  });
});

/*
 * The unshortened winner, which the Review dialog shows beside a shortened
 * name so the operator can see what was cut. It must be exactly what the
 * display name WOULD be with short names off.
 */
describe("getDiscoveredHostFullName", () => {
  test("returns the full PTR name a short display name was cut from", () => {
    const host: DiscoveredNetworkDevice = {
      ipAddress: "10.18.167.31",
      dnsHostname: "wb-0660-kds01.wbhq.com.",
    };

    expect(getDiscoveredHostFullName(host)).toBe("wb-0660-kds01.wbhq.com");
    expect(getDiscoveredHostDisplayName(host, SHORT_NAMES)).toBe(
      "wb-0660-kds01",
    );
  });

  test("returns the full sysName, trimmed, when the sysName won", () => {
    expect(
      getDiscoveredHostFullName(
        snmpHost({ sysName: "  core-sw-01.corp.example.com " }),
      ),
    ).toBe("core-sw-01.corp.example.com");
  });

  test("keeps the sysName ahead of the PTR name", () => {
    expect(
      getDiscoveredHostFullName({
        ipAddress: "10.0.0.5",
        sysName: "Core Switch",
        dnsHostname: "sw.corp.example.com",
      }),
    ).toBe("Core Switch");
  });

  test("falls back to the address, and never throws on junk", () => {
    expect(getDiscoveredHostFullName({ ipAddress: "10.0.0.5" })).toBe(
      "10.0.0.5",
    );
    expect(
      getDiscoveredHostFullName({
        ipAddress: "10.0.0.5",
        sysName: 42 as unknown as string,
        dnsHostname: "<b>x</b>",
      }),
    ).toBe("10.0.0.5");
    expect(
      getDiscoveredHostFullName({ ipAddress: null as unknown as string }),
    ).toBe("");
  });

  /*
   * Stated as the relationship the dialog depends on, across every naming
   * combination: the full name IS the display name with short names off, and
   * the short display name is derived from it and nothing else.
   */
  test("is the display name with short names off, whatever the host", () => {
    const hosts: Array<DiscoveredNetworkDevice> = [
      { ipAddress: "10.0.0.1" },
      { ipAddress: "10.0.0.2", dnsHostname: "gw.corp.example.com" },
      { ipAddress: "10.0.0.3", sysName: "sw-3.corp.example.com" },
      { ipAddress: "10.0.0.4", sysName: "   ", dnsHostname: "a.b.example" },
      { ipAddress: "10.0.0.5", dnsHostname: "ubuntu-22.04" },
      { ipAddress: 42 as unknown as string },
    ];

    for (const host of hosts) {
      expect(getDiscoveredHostFullName(host)).toBe(
        getDiscoveredHostDisplayName(host, FULL_NAMES),
      );
      expect(getDiscoveredHostFullName(host)).toBe(
        getDiscoveredHostDisplayName(host, {}),
      );
    }
  });

  test("differs from the short display name only when something was cut", () => {
    expect(
      getDiscoveredHostFullName({ ipAddress: "10.0.0.5", sysName: "sw-3" }),
    ).toBe(
      getDiscoveredHostDisplayName(
        { ipAddress: "10.0.0.5", sysName: "sw-3" },
        SHORT_NAMES,
      ),
    );
    expect(
      getDiscoveredHostFullName({
        ipAddress: "10.0.0.5",
        dnsHostname: "sw-3.corp.example.com",
      }),
    ).not.toBe(
      getDiscoveredHostDisplayName(
        { ipAddress: "10.0.0.5", dnsHostname: "sw-3.corp.example.com" },
        SHORT_NAMES,
      ),
    );
  });

  // It is the unclamped winner: the dialog shows it whole.
  test("is not clamped", () => {
    const longName: string = `${"a".repeat(63)}.${"b".repeat(40)}.example.com`;

    expect(
      getDiscoveredHostFullName({
        ipAddress: "10.0.0.5",
        dnsHostname: longName,
      }),
    ).toBe(longName);
  });
});

/*
 * NetworkDevice.dnsName (issue #3678): the host's full reverse-DNS name, kept
 * on the device whatever it ends up being called.
 *
 * With short names on it is the ONLY place the FQDN survives, which is what
 * the issue's follow-up comment asked for; and it is what a site rule written
 * against "*.wbhq.com" still matches after the name loses the domain. So it is
 * a fact about the host, not a presentation choice, and these cases pin that
 * it is written from the PTR record, normalised, and from nowhere else.
 */
describe("the device's DNS name", () => {
  test("is the PTR name, with short names on", () => {
    const device: NetworkDevice = build({
      host: {
        ipAddress: "10.18.167.31",
        dnsHostname: "wb-0660-kds01.wbhq.com",
      },
      scan: shortNamesScan(),
    });

    expect(device.name).toBe("wb-0660-kds01");
    expect(device.dnsName).toBe("wb-0660-kds01.wbhq.com");
  });

  test("is the PTR name, with short names off", () => {
    const device: NetworkDevice = build({
      host: {
        ipAddress: "10.18.167.31",
        dnsHostname: "wb-0660-kds01.wbhq.com",
      },
    });

    expect(device.name).toBe("wb-0660-kds01.wbhq.com");
    expect(device.dnsName).toBe("wb-0660-kds01.wbhq.com");
  });

  test("is set even when the sysName names the device", () => {
    const device: NetworkDevice = build({
      host: snmpHost({ dnsHostname: "sw1.corp.example.com" }),
      scan: shortNamesScan(),
    });

    expect(device.name).toBe("core-switch-01");
    expect(device.dnsName).toBe("sw1.corp.example.com");
  });

  test("is set on a ping-only host", () => {
    const device: NetworkDevice = build({
      host: {
        ipAddress: "10.18.167.31",
        snmpReachable: false,
        dnsHostname: "cam-lobby.corp.example.com",
      },
    });

    expect(device.dnsName).toBe("cam-lobby.corp.example.com");
    expect(device.snmpCommunityString).toBeUndefined();
  });

  test("is stored normalised: no root dot, no padding, case preserved", () => {
    expect(
      build({
        host: {
          ipAddress: "10.18.167.31",
          dnsHostname: "  WB-0660-KDS01.WbHq.com.  ",
        },
      }).dnsName,
    ).toBe("WB-0660-KDS01.WbHq.com");
  });

  test("is set even when the short-name rule refuses the name", () => {
    const device: NetworkDevice = build({
      host: { ipAddress: "10.18.167.31", dnsHostname: "ubuntu-22.04" },
      scan: shortNamesScan(),
    });

    expect(device.name).toBe("ubuntu-22.04");
    expect(device.dnsName).toBe("ubuntu-22.04");
  });

  /*
   * A PTR name is at most 253 characters, which is far more than the
   * 80-character device name but well inside the column. It is stored WHOLE:
   * clamping it like the name would store half a DNS name.
   */
  test("is stored whole at the longest name DNS allows, unlike the device name", () => {
    const maximalName: string = `${"a".repeat(63)}.${"b".repeat(
      63,
    )}.${"c".repeat(63)}.${"d".repeat(61)}`;

    const device: NetworkDevice = build({
      host: { ipAddress: "10.18.167.31", dnsHostname: maximalName },
    });

    expect(maximalName).toHaveLength(MAX_DEVICE_DNS_NAME_LENGTH);
    expect(device.dnsName).toBe(maximalName);
    expect(device.name).toHaveLength(MAX_DEVICE_NAME_LENGTH);
  });

  test("its ceiling is the DNS ceiling, and fits the column", () => {
    expect(MAX_DEVICE_DNS_NAME_LENGTH).toBe(MAX_REVERSE_DNS_NAME_LENGTH);
    expect(MAX_DEVICE_DNS_NAME_LENGTH).toBeLessThanOrEqual(
      ColumnLength.LongText,
    );
  });

  test("survives the collision retry's explicit name", () => {
    const host: DiscoveredNetworkDevice = {
      ipAddress: "10.18.166.52",
      dnsHostname: "dhcp-pool.corp.example.com",
    };

    const device: NetworkDevice = build({
      host: host,
      name: buildFallbackDeviceName(host, FULL_NAMES),
    });

    expect(device.name).toBe("dhcp-pool.corp.example.com (10.18.166.52)");
    expect(device.dnsName).toBe("dhcp-pool.corp.example.com");
  });

  describe("is absent when there is no usable PTR name", () => {
    /*
     * "Absent", not "blank": an empty string is still a value on a create
     * payload, and a device with no PTR record should read as having no DNS
     * name rather than one that happens to be empty. The model initialises
     * the property to undefined, so undefined is what "not written" looks
     * like.
     */
    const NO_USABLE_PTR: Array<{ reason: string; dnsHostname: unknown }> = [
      { reason: "no PTR record", dnsHostname: undefined },
      { reason: "an empty PTR answer", dnsHostname: "" },
      { reason: "a blank PTR answer", dnsHostname: "   " },
      { reason: "markup", dnsHostname: "<script>alert(1)</script>" },
      { reason: "a name with spaces", dnsHostname: "core switch" },
      { reason: "the address restated", dnsHostname: "10.18.167.31" },
      {
        reason: "an in-addr.arpa echo",
        dnsHostname: "31.167.18.10.in-addr.arpa",
      },
      {
        reason: "a name longer than DNS allows",
        dnsHostname: ["a", "b", "c", "d", "e"]
          .map((letter: string): string => {
            return letter.repeat(60);
          })
          .join("."),
      },
      { reason: "a number", dnsHostname: 42 },
      { reason: "null", dnsHostname: null },
      {
        reason: "the resolver's whole answer array",
        dnsHostname: ["gw.corp.example.com"],
      },
      {
        reason: "a string-like object",
        dnsHostname: {
          toString: (): string => {
            return "gw.corp.example.com";
          },
        },
      },
    ];

    for (const noPtr of NO_USABLE_PTR) {
      test(`${noPtr.reason}`, () => {
        for (const scan of [fullScanSource(), shortNamesScan()]) {
          const device: NetworkDevice = build({
            host: {
              ipAddress: "10.18.167.31",
              dnsHostname: noPtr.dnsHostname as string,
            },
            scan: scan,
          });

          expect(device.dnsName).toBeUndefined();
          expect(device.dnsName).not.toBe("");
          expect(device.name).toBe("10.18.167.31");
        }
      });
    }
  });

  /*
   * sysName is the name the device gives ITSELF. It is already stored as
   * sysName by the first poll, and calling it a DNS name would be a claim no
   * resolver made — even when it looks exactly like one.
   */
  test("is never taken from the sysName", () => {
    for (const scan of [fullScanSource(), shortNamesScan()]) {
      const device: NetworkDevice = build({
        host: snmpHost({ sysName: "core-sw-01.corp.example.com" }),
        scan: scan,
      });

      expect(device.dnsName).toBeUndefined();
    }
  });

  test("is never taken from the device name or the address", () => {
    const device: NetworkDevice = build({
      host: { ipAddress: "10.18.167.31" },
      name: "kds01.wbhq.com",
    });

    expect(device.name).toBe("kds01.wbhq.com");
    expect(device.dnsName).toBeUndefined();
  });
});

/*
 * OneUptime issue #3677 — hosts with no DNS and no SNMP show only as raw IPs.
 *
 * The reporter's 10.18.167.31-36 have no PTR record and answer no SNMP, so the
 * naming chain above had nothing for them but the address. A scan with NetBIOS
 * lookup on asks those hosts for their NetBIOS name, and the probe stores the
 * answer as `netbiosName`. These cases pin where that name sits in the chain
 * — third, below both names that existed before it — and that it is treated
 * as what it is: a SELF-REPORTED value read out of jsonb, normalised again at
 * the point of use, allowed to name the device and nothing more.
 */
describe("the NetBIOS name (issue #3677)", () => {
  // The reporter's address, and a name one of those hosts could answer with.
  const REPORTER_ADDRESS: string = "10.18.167.31";

  const netbiosHost: DiscoveredNetworkDevice = {
    ipAddress: REPORTER_ADDRESS,
    snmpReachable: false,
    netbiosName: "reg01",
  };

  describe("precedence: sysName, then PTR name, then NetBIOS name, then address", () => {
    test("a host with only a NetBIOS name is named by it, not by its address", () => {
      // The reported case, in one line.
      expect(buildDeviceName(netbiosHost, FULL_NAMES)).toBe("reg01");
      expect(getDiscoveredHostDisplayName(netbiosHost, FULL_NAMES)).toBe(
        "reg01",
      );
      expect(getDiscoveredHostFullName(netbiosHost)).toBe("reg01");
    });

    test("the sysName beats both the PTR name and the NetBIOS name", () => {
      const host: DiscoveredNetworkDevice = {
        ipAddress: REPORTER_ADDRESS,
        sysName: "core-switch-01",
        dnsHostname: "reg01.corp.example.com",
        netbiosName: "workstation01",
      };

      expect(buildDeviceName(host, FULL_NAMES)).toBe("core-switch-01");
    });

    test("the sysName beats the NetBIOS name on its own", () => {
      expect(
        buildDeviceName(
          { ...netbiosHost, sysName: "core-switch-01" },
          FULL_NAMES,
        ),
      ).toBe("core-switch-01");
    });

    /*
     * The PTR name is published by whoever runs DNS for the subnet; the
     * NetBIOS name is whatever the host says about itself. Where both exist,
     * the published one wins.
     */
    test("the PTR name beats the NetBIOS name", () => {
      const host: DiscoveredNetworkDevice = {
        ...netbiosHost,
        dnsHostname: "wb-0660-kds01.wbhq.com",
      };

      expect(buildDeviceName(host, FULL_NAMES)).toBe("wb-0660-kds01.wbhq.com");
      expect(buildDeviceName(host, SHORT_NAMES)).toBe("wb-0660-kds01");
    });

    test("a whitespace sysName does not block the NetBIOS name", () => {
      expect(
        buildDeviceName({ ...netbiosHost, sysName: "   " }, FULL_NAMES),
      ).toBe("reg01");
    });

    test("an unusable PTR name falls through to the NetBIOS name, not to the address", () => {
      expect(
        buildDeviceName(
          { ...netbiosHost, dnsHostname: "<script>alert(1)</script>" },
          FULL_NAMES,
        ),
      ).toBe("reg01");
      expect(
        buildDeviceName(
          { ...netbiosHost, dnsHostname: REPORTER_ADDRESS },
          FULL_NAMES,
        ),
      ).toBe("reg01");
    });

    test("the NetBIOS name beats the address", () => {
      expect(buildDeviceName(netbiosHost, FULL_NAMES)).not.toBe(
        REPORTER_ADDRESS,
      );
      expect(buildDeviceName({ ipAddress: REPORTER_ADDRESS }, FULL_NAMES)).toBe(
        REPORTER_ADDRESS,
      );
    });
  });

  /*
   * `discoveredDevices` is jsonb stored verbatim, so "the probe normalised it"
   * holds only for the probe that wrote the row. A row an older or modified
   * probe stored in the raw wire form — upper case, padded to fifteen bytes —
   * must name the device exactly as the normalised row would.
   */
  describe("the raw jsonb value is normalised again at the point of use", () => {
    const RAW_FORMS: Array<{ reason: string; netbiosName: string }> = [
      { reason: "upper case", netbiosName: "REG01" },
      {
        reason: "space-padded to fifteen bytes",
        netbiosName: "REG01          ",
      },
      {
        reason: "NUL-padded",
        netbiosName: `REG01${String.fromCharCode(0).repeat(10)}`,
      },
      { reason: "leading and trailing spaces", netbiosName: "  Reg01  " },
    ];

    for (const raw of RAW_FORMS) {
      test(`${raw.reason} names the device "reg01"`, () => {
        const host: DiscoveredNetworkDevice = {
          ipAddress: REPORTER_ADDRESS,
          netbiosName: raw.netbiosName,
        };

        expect(getDiscoveredHostFullName(host)).toBe("reg01");
        expect(buildDeviceName(host, FULL_NAMES)).toBe("reg01");
        expect(build({ host: host }).name).toBe("reg01");
      });
    }
  });

  describe("an unusable NetBIOS name falls through to the address", () => {
    const UNUSABLE: Array<{ reason: string; netbiosName: unknown }> = [
      { reason: "a dotted name", netbiosName: "reg01.corp" },
      { reason: "a trailing root dot", netbiosName: "REG01." },
      { reason: "an inner space", netbiosName: "REG 01" },
      { reason: "sixteen characters", netbiosName: "ABCDEFGHIJKLMNOP" },
      { reason: "only digits", netbiosName: "123456" },
      { reason: "an address spelled with dashes", netbiosName: "10-18-167" },
      { reason: "markup", netbiosName: "<b>x</b>" },
      {
        reason: "the browser-election pseudo-name",
        netbiosName: "__MSBROWSE__",
      },
      { reason: "only padding", netbiosName: "               " },
      { reason: "the empty string", netbiosName: "" },
      { reason: "a number", netbiosName: 42 },
      { reason: "null", netbiosName: null },
      { reason: "an array", netbiosName: ["REG01"] },
      {
        reason: "a string-like object",
        netbiosName: {
          toString: (): string => {
            return "REG01";
          },
        },
      },
    ];

    for (const unusable of UNUSABLE) {
      test(`${unusable.reason}`, () => {
        const host: DiscoveredNetworkDevice = {
          ipAddress: REPORTER_ADDRESS,
          netbiosName: unusable.netbiosName as string,
        };

        expect(() => {
          return getDiscoveredHostFullName(host);
        }).not.toThrow();

        for (const naming of [FULL_NAMES, SHORT_NAMES]) {
          expect(buildDeviceName(host, naming)).toBe(REPORTER_ADDRESS);
        }
        expect(build({ host: host }).name).toBe(REPORTER_ADDRESS);
      });
    }
  });

  /*
   * The short-name option cuts an FQDN to its first label. A NetBIOS name is
   * one dot-free label by construction, so there is nothing to cut — the
   * option must neither change it nor make it lose to anything else.
   */
  describe("short names do not change a NetBIOS name", () => {
    test("getShortHostname declines a NetBIOS name, so there is nothing to cut", () => {
      expect(getShortHostname("reg01")).toBeUndefined();
      expect(getShortHostname("workstation01")).toBeUndefined();
    });

    test("the name is the same with short names on, off, or unset", () => {
      expect(getDiscoveredHostDisplayName(netbiosHost, SHORT_NAMES)).toBe(
        "reg01",
      );
      expect(getDiscoveredHostDisplayName(netbiosHost, FULL_NAMES)).toBe(
        "reg01",
      );
      expect(getDiscoveredHostDisplayName(netbiosHost, {})).toBe("reg01");
    });

    test("the device and its fallback name are the same with short names on or off", () => {
      for (const scan of [fullScanSource(), shortNamesScan()]) {
        expect(build({ host: netbiosHost, scan: scan }).name).toBe("reg01");
        expect(buildFallbackDeviceName(netbiosHost, scan)).toBe(
          "reg01 (10.18.167.31)",
        );
      }
    });

    test("a raw upper-case name is lower-cased, not shortened, with short names on", () => {
      expect(
        getDiscoveredHostDisplayName(
          { ipAddress: REPORTER_ADDRESS, netbiosName: "REG01   " },
          SHORT_NAMES,
        ),
      ).toBe("reg01");
    });
  });

  /*
   * Several Windows hosts answering with the same name — a cloned image, a
   * rebuilt machine that kept its predecessor's name — collide on the device
   * name exactly as a wildcard PTR zone does, and the same fallback breaks
   * the tie.
   */
  describe("the collision fallback", () => {
    test("appends the address to the NetBIOS name", () => {
      expect(buildFallbackDeviceName(netbiosHost, FULL_NAMES)).toBe(
        "reg01 (10.18.167.31)",
      );
    });

    test("two hosts answering with one name get distinct fallback names", () => {
      const twin: DiscoveredNetworkDevice = {
        ...netbiosHost,
        ipAddress: "10.18.167.32",
      };

      expect(buildDeviceName(twin, FULL_NAMES)).toBe(
        buildDeviceName(netbiosHost, FULL_NAMES),
      );
      expect(buildFallbackDeviceName(twin, FULL_NAMES)).toBe(
        "reg01 (10.18.167.32)",
      );
      expect(buildFallbackDeviceName(twin, FULL_NAMES)).not.toBe(
        buildFallbackDeviceName(netbiosHost, FULL_NAMES),
      );
    });

    test("the fallback name survives into the device through the name override", () => {
      const device: NetworkDevice = build({
        host: netbiosHost,
        name: buildFallbackDeviceName(netbiosHost, FULL_NAMES),
      });

      expect(device.name).toBe("reg01 (10.18.167.31)");
      expect(device.hostname).toBe(REPORTER_ADDRESS);
    });
  });

  /*
   * A NetBIOS name is what the host says about itself, not a record anyone
   * published. Storing it as `dnsName` would make it searchable, and matched
   * by site-assignment hostname patterns, as though DNS had vouched for it.
   * It names the device; it goes nowhere else on it.
   */
  describe("the NetBIOS name names the device and does nothing else", () => {
    test("the device's DNS name is never taken from the NetBIOS name", () => {
      for (const scan of [fullScanSource(), shortNamesScan()]) {
        const device: NetworkDevice = build({ host: netbiosHost, scan: scan });

        expect(device.name).toBe("reg01");
        expect(device.dnsName).toBeUndefined();
      }
    });

    test("the device's DNS name is still the PTR name when a host has both", () => {
      const device: NetworkDevice = build({
        host: { ...netbiosHost, dnsHostname: "reg01.corp.example.com" },
      });

      expect(device.dnsName).toBe("reg01.corp.example.com");
    });

    test("the device's hostname stays the address", () => {
      const device: NetworkDevice = build({ host: netbiosHost });

      expect(device.hostname).toBe(REPORTER_ADDRESS);
      expect(device.name).toBe("reg01");
    });

    test("a ping-only NetBIOS-named host still carries no credentials", () => {
      const device: NetworkDevice = build({ host: netbiosHost });

      expect(device.monitoringMethod).toBe(NetworkDeviceMonitoringMethod.Probe);
      expect(device.snmpCommunityString).toBeUndefined();
      expect(device.snmpVersion).toBeUndefined();
      expect(device.probeId?.toString()).toBe(PROBE_ID.toString());
    });

    test("a NetBIOS-named device's name produces a valid slug", () => {
      const device: NetworkDevice = build({ host: netbiosHost });

      expect(Slug.getSlug(device.name!)).toContain("reg01");
    });
  });

  test("the full name is still the display name with short names off, across every source", () => {
    const hosts: Array<DiscoveredNetworkDevice> = [
      { ipAddress: "10.0.0.1", netbiosName: "reg01" },
      { ipAddress: "10.0.0.2", netbiosName: "REG02   " },
      { ipAddress: "10.0.0.3", netbiosName: "not valid" },
      {
        ipAddress: "10.0.0.4",
        dnsHostname: "gw.corp.example.com",
        netbiosName: "reg04",
      },
      { ipAddress: "10.0.0.5", sysName: "sw-5", netbiosName: "reg05" },
    ];

    for (const host of hosts) {
      expect(getDiscoveredHostFullName(host)).toBe(
        getDiscoveredHostDisplayName(host, FULL_NAMES),
      );
    }
  });
});
