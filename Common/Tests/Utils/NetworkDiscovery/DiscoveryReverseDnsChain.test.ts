import {
  DiscoveredDeviceScanSource,
  buildDeviceName,
  buildFallbackDeviceName,
  buildNetworkDeviceFromDiscoveredHost,
  getDiscoveredHostDisplayName,
} from "../../../Utils/NetworkDiscovery/DiscoveredDeviceBuilder";
import { normalizeDiscoveredHosts } from "../../../Utils/NetworkDiscovery/DiscoveredHostUtil";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import { DiscoveredNetworkDevice } from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import NetworkDeviceMonitoringMethod from "../../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, it } from "@jest/globals";

/*
 * The WHOLE journey a PTR record makes, end to end, in one place.
 *
 * Every other suite around OneUptime issue #3529 tests one link:
 * ReverseDnsNameUtil pins what a name may contain, DiscoveredHostUtil pins
 * what normalisation does to a row, DiscoveredDeviceBuilder pins which field
 * becomes which device column. Each of those can be green while the chain
 * they form is broken, because the interesting failures live in the JOINTS —
 * a value that survives normalisation but is re-read differently by the
 * builder, a name one module accepts at its own ceiling and the next must
 * cut down, or a row two layers deliberately disagree about.
 *
 * So this file runs the real path a resolved hostname actually travels:
 *
 *   probe payload
 *     -> stored jsonb (modelled honestly as JSON.parse(JSON.stringify(...)),
 *        because `discoveredDevices` is written VERBATIM from the probe's
 *        payload by ProbeIngest/DiscoveryScan.ts — no schema, no coercion,
 *        so the column is exactly a JSON round trip of whatever was sent)
 *     -> normalizeDiscoveredHosts
 *     -> getDiscoveredHostDisplayName / buildDeviceName
 *     -> buildNetworkDeviceFromDiscoveredHost
 *
 * Nothing here is mocked. The point is that these five steps agree, and a
 * double or a stub would be agreeing with itself.
 *
 * The JSON round trip is not ceremony. It is what erases `undefined`-valued
 * keys, and what leaves numbers, nulls, objects and arrays sitting in fields
 * the TypeScript interface declares as `string | undefined` — every hostile
 * shape below reaches the readers only because the column cannot refuse it.
 *
 * SCOPE NOTE, so no comment here over-claims: the Dashboard's Discovery page
 * is NOT imported by this file, and nothing below observes what the Review
 * dialog renders. What is pinned is that the functions the dialog and the
 * import loop both call return the same answers on the same row. Where a
 * comment mentions the dialog it is explaining WHY a case matters, not
 * claiming the dialog is under test.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

/*
 * A scan with no credentials at all — the shape a ping-only sweep really has.
 *
 * The reporter's hosts answer ICMP and nothing else, so they import down the
 * Monitor branch of the builder, which returns before it ever asks for a
 * credential set. Supplying a rich SNMP fixture here would only invite a
 * reader to think credentials were part of what these tests pin; they are
 * pinned in DiscoveredDeviceBuilder.test.ts and AutoImportScanCredentialSelect
 * .test.ts instead.
 */
const PING_ONLY_SCAN: DiscoveredDeviceScanSource = {};

/*
 * The two ceilings this chain has to reconcile, written as literals rather
 * than imported from the modules under test.
 *
 * ReverseDnsNameUtil accepts a presentation-form DNS name up to 253
 * characters; DiscoveredDeviceBuilder clamps a device name to 80 because the
 * slug is slugify(name) plus eleven characters into its own varchar(100).
 * Importing MAX_DEVICE_NAME_LENGTH and asserting against it would make the
 * length tests below survive someone raising the constant to 253 — which is
 * exactly the change that starts failing device creates with a slug-length
 * error. The numbers are the contract, so the numbers are what is asserted.
 */
const MAX_DNS_NAME_LENGTH: number = 253;
const MAX_NAME_LENGTH: number = 80;

/*
 * A PTR name that is perfectly legal DNS and too long to be a device name:
 * one label at RFC 1035's 63-octet ceiling, in a three-label zone. 85
 * characters — under 253, over 80 — so it is accepted whole by one module and
 * cut down by the next. Long labels like this are ordinary on estates that
 * encode rack, unit and role into the hostname.
 */
const LONG_LABEL: string = `hq-fileserver-${"a".repeat(49)}`;
const LONG_PTR_NAME: string = `${LONG_LABEL}.dc14.corp.example.net`;

/**
 * The payload as it comes back OUT of the jsonb column.
 *
 * Typed `Array<unknown>` on the way in on purpose: the probe payloads below
 * deliberately hold values the `DiscoveredNetworkDevice` interface forbids,
 * and pretending otherwise would be testing a payload the column cannot
 * actually contain. The cast on the way out is exactly the lie the real code
 * lives with — `getDiscoveredHosts` checks that the VALUE is an array and
 * hands the elements on as hosts without looking at them.
 */
function storedScanResults(
  payload: Array<unknown>,
): Array<DiscoveredNetworkDevice> {
  return JSON.parse(JSON.stringify(payload)) as Array<DiscoveredNetworkDevice>;
}

/** Store the payload and normalise it, exactly as every reader does. */
function hostsFromPayload(
  payload: Array<unknown>,
): Array<DiscoveredNetworkDevice> {
  return normalizeDiscoveredHosts(storedScanResults(payload));
}

/** Store the payload, normalise it, and name every surviving row. */
function namesFromPayload(payload: Array<unknown>): Array<string> {
  return hostsFromPayload(payload).map(
    (host: DiscoveredNetworkDevice): string => {
      return buildDeviceName(host);
    },
  );
}

/** Store the payload, normalise it, and build the devices it imports as. */
function devicesFromPayload(payload: Array<unknown>): Array<NetworkDevice> {
  return hostsFromPayload(payload).map(
    (host: DiscoveredNetworkDevice): NetworkDevice => {
      return buildNetworkDeviceFromDiscoveredHost({
        projectId: PROJECT_ID,
        host: host,
        scan: PING_ONLY_SCAN,
      });
    },
  );
}

/** The names of a built batch, which is what an operator ticks. */
function deviceNames(devices: Array<NetworkDevice>): Array<string | undefined> {
  return devices.map((device: NetworkDevice): string | undefined => {
    return device.name;
  });
}

/** The addresses of a built batch, which is what the poller dials. */
function deviceHostnames(
  devices: Array<NetworkDevice>,
): Array<string | undefined> {
  return devices.map((device: NetworkDevice): string | undefined => {
    return device.hostname;
  });
}

describe("Reverse DNS, probe payload to created NetworkDevice", () => {
  it("names the reporter's four ping-only hosts by PTR and still addresses them by IP", () => {
    /*
     * Issue #3529 as filed. Four hosts on 10.18.166.0/24 that answer ping and
     * have nothing readable over SNMP, on an estate that publishes a DNS
     * record for each. Before the feature the name line was
     * `sysName || ipAddress`, and with no sysName that is four bare
     * addresses — the exact screenshot in the issue.
     *
     * .55's PTR carries the trailing root label. Resolvers differ on whether
     * they include it, so the fully qualified spelling is in the payload
     * rather than in a unit test of the normaliser alone: if the root-dot
     * strip were ever dropped, THIS is where an operator would see it, as a
     * device named "hq-camera-11.corp.example.net." with a stray dot.
     */
    const payload: Array<unknown> = [
      {
        ipAddress: "10.18.166.51",
        snmpReachable: false,
        dnsHostname: "hq-fileserver.corp.example.net",
      },
      {
        ipAddress: "10.18.166.53",
        snmpReachable: false,
        dnsHostname: "hq-printer-02.corp.example.net",
      },
      // No PTR record at all: this one must still read as its address.
      { ipAddress: "10.18.166.54", snmpReachable: false },
      {
        ipAddress: "10.18.166.55",
        snmpReachable: false,
        dnsHostname: "hq-camera-11.corp.example.net.",
      },
    ];

    const devices: Array<NetworkDevice> = devicesFromPayload(payload);

    expect(deviceNames(devices)).toEqual([
      "hq-fileserver.corp.example.net",
      "hq-printer-02.corp.example.net",
      "10.18.166.54",
      "hq-camera-11.corp.example.net",
    ]);

    /*
     * The other half of what the issue asked for, in its own words: "retain
     * the IP address as the address/IP field". `hostname` is what the SNMP
     * poller dials, what a trap's source address is correlated against, and
     * the dedup key NetworkDeviceService.getRegisteredHostnames matches a
     * later scan's results on. A device that stored its PTR name here would
     * stop polling the day its reverse zone changed, and would be discovered
     * as a second, "unregistered" host on the very next sweep.
     */
    expect(deviceHostnames(devices)).toEqual([
      "10.18.166.51",
      "10.18.166.53",
      "10.18.166.54",
      "10.18.166.55",
    ]);

    /*
     * Naming a host by DNS must not change how it is monitored: a ping-only
     * host is a Probe device the scan's probe pings, with polling on.
     */
    for (const device of devices) {
      expect(device.monitoringMethod).toBe(NetworkDeviceMonitoringMethod.Probe);
      expect(device.isPollingEnabled).toBe(true);
    }
  });

  it("names a payload that predates the feature exactly as it always did", () => {
    /*
     * The back-compat guarantee, taken end to end rather than at one function.
     *
     * Two populations send payloads with no `dnsHostname` key: probes running
     * a build from before #3529, and every row already sitting in a
     * `discoveredDevices` column. Both must keep producing the names they
     * produced yesterday — `sysName` when there is one, the address when
     * there is not. A regression here is worse than a missing feature: it
     * renames devices that import correctly today.
     */
    const payload: Array<unknown> = [
      { ipAddress: "10.18.166.51", sysName: "core-switch-01" },
      { ipAddress: "10.18.166.53", snmpReachable: false },
      /*
       * `dnsHostname: undefined` is what a NEW probe sends for a host with no
       * PTR record, and JSON.stringify erases the key entirely. So the modern
       * no-record row and the legacy row are byte-identical in the column,
       * which is precisely why no reader needs to tell them apart.
       */
      {
        ipAddress: "10.18.166.54",
        snmpReachable: false,
        dnsHostname: undefined,
      },
    ];

    const hosts: Array<DiscoveredNetworkDevice> = hostsFromPayload(payload);

    expect(
      hosts.map((host: DiscoveredNetworkDevice): string => {
        return buildDeviceName(host);
      }),
    ).toEqual(["core-switch-01", "10.18.166.53", "10.18.166.54"]);

    /*
     * Normalisation must not INVENT the key either. Readers are entitled to
     * ask `"dnsHostname" in host`, and a blank-but-present key would show an
     * empty DNS line under every legacy host. `toHaveProperty` rather than a
     * value comparison on purpose: `toEqual` treats an absent key and a key
     * set to `undefined` as the same thing, and that is the exact distinction
     * DiscoveredHostUtil promises to keep.
     */
    for (const host of hosts) {
      expect(host).not.toHaveProperty("dnsHostname");
    }
  });

  it("falls back to the address for every hostile PTR value the column can hold", () => {
    /*
     * `dnsHostname` is the only field in a scan result whose value is chosen
     * by the scanned network. A discovery sweep is routinely pointed at a
     * subnet nobody in the project administers, so "whoever runs that
     * resolver picks a device's name, its slug and a line in the dashboard"
     * is the actual threat model — not a hypothetical one.
     *
     * Deliberately a SHORT list. ReverseDnsNameUtil.test.ts and
     * DiscoveredDeviceBuilder.test.ts already enumerate hostile spellings one
     * function at a time; repeating all of them here would buy coverage the
     * chain does not add anything to. What is kept is the rows where the
     * chain itself is the interesting part:
     *
     *   - markup, the payload that makes a name dangerous rather than merely
     *     ugly once it is rendered and slugified;
     *   - a name with interior spaces, which would become a device whose name
     *     and slug disagree;
     *   - the bare "in-addr.arpa" apex, which a suffix-only zone check lets
     *     straight through and which is a strictly WORSE label than the
     *     address it was derived from;
     *   - the address restated as a dotted quad, which defeats the entire
     *     purpose of the feature by dressing an address up as a resolved name;
     *   - `null`, which the interface forbids and the jsonb column will
     *     happily store.
     *
     * The assertion is the same for all of them: name the device by its
     * ADDRESS, and do not throw. Throwing matters as much as the value does —
     * these functions run inside a React render, where a TypeError takes out
     * the whole modal rather than one row, so a thrown error fails the
     * `toEqual` below and that is the intended way for it to be caught.
     */
    const payload: Array<unknown> = [
      {
        ipAddress: "10.18.166.60",
        snmpReachable: false,
        dnsHostname: '<script>alert("pwned")</script>',
      },
      {
        ipAddress: "10.18.166.61",
        snmpReachable: false,
        dnsHostname: "  hq server 01  ",
      },
      {
        ipAddress: "10.18.166.63",
        snmpReachable: false,
        dnsHostname: "in-addr.arpa",
      },
      {
        ipAddress: "10.18.166.64",
        snmpReachable: false,
        dnsHostname: "10.18.166.64",
      },
      { ipAddress: "10.18.166.68", snmpReachable: false, dnsHostname: null },
    ];

    const addresses: Array<string> = [
      "10.18.166.60",
      "10.18.166.61",
      "10.18.166.63",
      "10.18.166.64",
      "10.18.166.68",
    ];

    const hosts: Array<DiscoveredNetworkDevice> = hostsFromPayload(payload);

    expect(
      hosts.map((host: DiscoveredNetworkDevice): string => {
        return buildDeviceName(host);
      }),
    ).toEqual(addresses);

    // Nothing survives into the column's cleaned reading either.
    for (const host of hosts) {
      expect(host).not.toHaveProperty("dnsHostname");
    }

    expect(deviceHostnames(devicesFromPayload(payload))).toEqual(addresses);

    /*
     * The SECOND line of defence, pinned separately because it is the one a
     * refactor is most likely to remove as redundant.
     *
     * `getDiscoveredHostDisplayName` re-normalises `dnsHostname` itself
     * rather than trusting the row it was handed. That is what protects a row
     * written straight through the API, and a row stored by a probe whose
     * version never heard of these rules — neither of which passed through
     * normalizeDiscoveredHosts on the way in. Building names from the RAW
     * stored payload must give the same answers.
     */
    expect(
      storedScanResults(payload).map(
        (host: DiscoveredNetworkDevice): string => {
          return getDiscoveredHostDisplayName(host);
        },
      ),
    ).toEqual(addresses);
  });

  it("cuts a legal-but-long PTR name down to the device ceiling and refuses one no resolver could return", () => {
    /*
     * THE sharpest joint in the chain: two modules with different ceilings.
     *
     * ReverseDnsNameUtil accepts up to 253 characters, because that is what a
     * DNS presentation-form name may be. DiscoveredDeviceBuilder clamps to
     * 80, because the name is slugified into its own varchar(100) and the
     * create path THROWS on overflow rather than truncating. So a name in
     * between is accepted whole by the first module and MUST be cut by the
     * second — and it is the only place in the feature where the string an
     * operator reads and the string written to the column are not identical.
     *
     * Both rows are needed, and they pull in opposite directions:
     *
     *   - 85 characters is a real hostname, so it is TRUNCATED. If the clamp
     *     were dropped the device create would fail on the slug and the host
     *     would silently never import.
     *   - 304 characters was never a DNS name, so it is REJECTED outright and
     *     the host falls back to its address. Truncating it instead would put
     *     an 80-character fragment of an untrusted string into the name
     *     column and present it as a resolved hostname.
     */
    const tooLongForDns: string = ["a", "b", "c", "d", "e"]
      .map((letter: string): string => {
        return letter.repeat(60);
      })
      .join(".");

    // Fixture self-check: labels stay legal, only the total length offends.
    expect(LONG_PTR_NAME.length).toBe(85);
    expect(tooLongForDns.length).toBeGreaterThan(MAX_DNS_NAME_LENGTH);

    const payload: Array<unknown> = [
      {
        ipAddress: "10.18.166.51",
        snmpReachable: false,
        dnsHostname: LONG_PTR_NAME,
      },
      {
        ipAddress: "10.18.166.53",
        snmpReachable: false,
        dnsHostname: tooLongForDns,
      },
    ];

    const hosts: Array<DiscoveredNetworkDevice> = hostsFromPayload(payload);

    /*
     * The 85-character name survives normalisation INTACT — the column keeps
     * the resolver's answer, not a device-shaped abbreviation of it, so a
     * later reader with a wider column is not stuck with this one's ceiling.
     */
    expect(hosts[0]?.dnsHostname).toBe(LONG_PTR_NAME);
    expect(getDiscoveredHostDisplayName(hosts[0]!)).toBe(LONG_PTR_NAME);

    // The 304-character one is not a name at all, so the key is gone.
    expect(hosts[1]).not.toHaveProperty("dnsHostname");

    /*
     * The clamped name spelled out rather than derived with `.substring(80)`,
     * so this asserts the ANSWER instead of restating the implementation:
     * the 63-character label, then ".dc14.corp." and the first six letters of
     * "example", which is where character 80 lands.
     */
    const clampedName: string = `${LONG_LABEL}.dc14.corp.exampl`;

    expect(clampedName.length).toBe(MAX_NAME_LENGTH);

    const devices: Array<NetworkDevice> = devicesFromPayload(payload);

    expect(deviceNames(devices)).toEqual([clampedName, "10.18.166.53"]);
    expect(deviceHostnames(devices)).toEqual(["10.18.166.51", "10.18.166.53"]);
  });

  it("keeps naming the good rows when the payload contains junk rows", () => {
    /*
     * One bad element must not poison the batch.
     *
     * The only guard on `discoveredDevices` checks that the VALUE is an
     * array; it never looks at the elements. A single `null` row used to
     * throw a TypeError the moment the operator clicked a filter button —
     * inside the modal body, during render. This pins that the rows around
     * the junk still name and address correctly.
     *
     * `null`, the number and the string are dropped because they are not
     * objects. The address-less OBJECT is kept, and the contract for it is
     * the second assertion below, not its mere survival: it becomes a device
     * with `hostname: ""`, which is a row that carries its sysName as a name
     * and collides on the dedup key with every other address-less row. That
     * is the deliberate choice — a visibly broken row beats a vanished one —
     * and it is stated here so a change to it has to be a decision.
     */
    const payload: Array<unknown> = [
      null,
      42,
      "10.18.166.51",
      { sysName: "orphan-no-address" },
      {
        ipAddress: "10.18.166.53",
        snmpReachable: false,
        dnsHostname: "hq-ups-01.corp.example.net",
      },
      { ipAddress: "10.18.166.54", snmpReachable: false },
    ];

    const devices: Array<NetworkDevice> = devicesFromPayload(payload);

    expect(deviceNames(devices)).toEqual([
      "orphan-no-address",
      "hq-ups-01.corp.example.net",
      "10.18.166.54",
    ]);

    expect(deviceHostnames(devices)).toEqual([
      "",
      "10.18.166.53",
      "10.18.166.54",
    ]);
  });

  it("normalises to a fixed point, so every reader of a row agrees", () => {
    /*
     * The chain has to be IDEMPOTENT, because it is not run once.
     *
     * The dashboard normalises the scan's rows when the Review dialog opens
     * and again on re-render; the server-side auto-import rule engine
     * normalises its own copy of the same jsonb; the import loop names a host
     * that has already been through both. If a second pass could change an
     * answer, the name an operator ticked and the name the device was created
     * with could differ — which is the exact class of bug the shared
     * normaliser was written to end.
     *
     * The payload is chosen so the first pass genuinely CHANGES every row:
     * a root dot is stripped, a padded address is trimmed, a numeric sysName
     * is blanked, and a rejected PTR key is deleted. A payload that was
     * already clean would make this test pass no matter what.
     */
    const payload: Array<unknown> = [
      {
        ipAddress: "10.18.166.51",
        snmpReachable: false,
        dnsHostname: "hq-router-01.corp.example.net.",
      },
      { ipAddress: " 10.18.166.53 ", sysName: 42 },
      {
        ipAddress: "10.18.166.54",
        snmpReachable: false,
        dnsHostname: "in-addr.arpa",
      },
    ];

    const stored: Array<DiscoveredNetworkDevice> = storedScanResults(payload);
    const once: Array<DiscoveredNetworkDevice> =
      normalizeDiscoveredHosts(stored);
    const twice: Array<DiscoveredNetworkDevice> =
      normalizeDiscoveredHosts(once);

    /*
     * `toStrictEqual`, NOT `toEqual`. `toEqual` ignores keys whose value is
     * `undefined`, so it cannot tell `delete row.dnsHostname` from
     * `row.dnsHostname = undefined` — and that distinction IS the contract
     * ("a reader that checks `if (host.dnsHostname)` and one that checks
     * `"dnsHostname" in host` cannot disagree"). With `toEqual` this
     * assertion would stay green through exactly the regression it is here to
     * catch. The key lists are compared as well, so the failure message names
     * the key that appeared or vanished rather than just the row.
     */
    expect(twice).toStrictEqual(once);
    expect(
      twice.map((host: DiscoveredNetworkDevice): Array<string> => {
        return Object.keys(host).sort();
      }),
    ).toEqual(
      once.map((host: DiscoveredNetworkDevice): Array<string> => {
        return Object.keys(host).sort();
      }),
    );

    // The rejected PTR key is absent after BOTH passes, not present-and-blank.
    expect(once[2]).not.toHaveProperty("dnsHostname");
    expect(twice[2]).not.toHaveProperty("dnsHostname");

    const namesOnce: Array<string> = once.map(
      (host: DiscoveredNetworkDevice): string => {
        return buildDeviceName(host);
      },
    );
    const namesTwice: Array<string> = twice.map(
      (host: DiscoveredNetworkDevice): string => {
        return buildDeviceName(host);
      },
    );

    expect(namesOnce).toEqual([
      "hq-router-01.corp.example.net",
      "10.18.166.53",
      "10.18.166.54",
    ]);
    expect(namesTwice).toEqual(namesOnce);
  });

  it("gives a wildcard PTR zone one shared name and three distinct fallbacks", () => {
    /*
     * A wildcard reverse zone — "*.166.18.10.in-addr.arpa PTR
     * unassigned.dhcp.corp.example.net" — is common on DHCP ranges, and it is
     * what makes the naming feature collide with a database constraint:
     * NetworkDevice names are unique per project, so the first host imports
     * and the next two fail the create.
     *
     * Both halves are load-bearing and pull in opposite directions. The
     * primary name must be SHARED (it is what the resolver actually said, and
     * showing three different names for one PTR record would be a fiction),
     * while the retry name must be DISTINCT or the retry is pointless — the
     * second create fails exactly as the first did. The address is the only
     * thing that tells these three hosts apart, which is why it is what the
     * fallback appends.
     */
    const payload: Array<unknown> = [
      {
        ipAddress: "10.18.166.51",
        snmpReachable: false,
        dnsHostname: "unassigned.dhcp.corp.example.net",
      },
      {
        ipAddress: "10.18.166.53",
        snmpReachable: false,
        dnsHostname: "unassigned.dhcp.corp.example.net",
      },
      {
        ipAddress: "10.18.166.54",
        snmpReachable: false,
        dnsHostname: "unassigned.dhcp.corp.example.net",
      },
    ];

    const hosts: Array<DiscoveredNetworkDevice> = hostsFromPayload(payload);

    expect(
      hosts.map((host: DiscoveredNetworkDevice): string => {
        return buildDeviceName(host);
      }),
    ).toEqual([
      "unassigned.dhcp.corp.example.net",
      "unassigned.dhcp.corp.example.net",
      "unassigned.dhcp.corp.example.net",
    ]);

    const fallbacks: Array<string> = hosts.map(
      (host: DiscoveredNetworkDevice): string => {
        return buildFallbackDeviceName(host);
      },
    );

    expect(fallbacks).toEqual([
      "unassigned.dhcp.corp.example.net (10.18.166.51)",
      "unassigned.dhcp.corp.example.net (10.18.166.53)",
      "unassigned.dhcp.corp.example.net (10.18.166.54)",
    ]);

    // The property the retry depends on, stated as a property.
    expect(new Set<string>(fallbacks).size).toBe(3);
  });

  it("keeps the collision fallback under the name ceiling however long the PTR name and the address are", () => {
    /*
     * The wildcard case above with a name that is already AT the ceiling,
     * which is the realistic version: long DHCP zone names are the norm, so
     * "shared name" and "long name" arrive together, and this is the only
     * shape where `buildFallbackDeviceName`'s own truncation does anything.
     *
     * The fallback appends " (address)" to a name that is already the full 80
     * characters, so the base has to be cut AGAIN — by exactly the suffix's
     * width — or the composed name overflows the slug and the retry fails for
     * a different reason than the collision it was meant to fix. Distinctness
     * has to survive that second cut, which is why the suffix goes on the END:
     * the two names are identical for their first 65 characters.
     */
    const payload: Array<unknown> = [
      {
        ipAddress: "10.18.166.51",
        snmpReachable: false,
        dnsHostname: LONG_PTR_NAME,
      },
      {
        ipAddress: "10.18.166.53",
        snmpReachable: false,
        dnsHostname: LONG_PTR_NAME,
      },
    ];

    const hosts: Array<DiscoveredNetworkDevice> = hostsFromPayload(payload);

    const fallbacks: Array<string> = hosts.map(
      (host: DiscoveredNetworkDevice): string => {
        return buildFallbackDeviceName(host);
      },
    );

    /*
     * 65 characters of name (80 minus the 15-character suffix) plus the
     * suffix. Written out rather than computed so a regression that cut to
     * the wrong width is a visible diff and not an arithmetic identity.
     */
    expect(fallbacks).toEqual([
      `${LONG_LABEL}.d (10.18.166.51)`,
      `${LONG_LABEL}.d (10.18.166.53)`,
    ]);

    for (const fallback of fallbacks) {
      expect(fallback.length).toBe(MAX_NAME_LENGTH);
    }

    expect(new Set<string>(fallbacks).size).toBe(2);

    /*
     * The degenerate end of the same branch: an "address" longer than the
     * whole name ceiling, so the suffix alone overflows it and the width left
     * for the base name goes NEGATIVE. `ipAddress` is not validated anywhere
     * on this path — it is whatever the probe wrote into jsonb — so a broken
     * probe build really can put a line of sweep output here.
     *
     * TWO floors have to hold at once, and they pull against each other.
     * Without the `Math.max(1, ...)`, `substring(0, -6)` returns "" and the
     * device is named for the junk address alone, with nothing of the
     * resolver's answer left in it. But that floor is also what used to let
     * the COMPOSED name run past the ceiling — one base character plus an
     * 83-character suffix is 84 — and a name over the ceiling fails the create
     * on the slug's own length, which is a different error than the collision
     * the retry was for, on a path whose whole job is to recover from one.
     *
     * So the composition is clamped as a whole: the first character of the
     * name survives, and the result still fits.
     */
    const junkAddress: string = `10.18.166.55-${"z".repeat(70)}`;
    const junkHosts: Array<DiscoveredNetworkDevice> = hostsFromPayload([
      {
        ipAddress: junkAddress,
        snmpReachable: false,
        dnsHostname: "hq-nas-01.corp.example.net",
      },
    ]);

    const junkFallback: string = buildFallbackDeviceName(junkHosts[0]!);

    expect(junkFallback.length).toBe(MAX_NAME_LENGTH);
    expect(junkFallback.startsWith("h (10.18.166.55-")).toBe(true);
  });

  it("creates the retried device under the fallback name while still addressing it by IP", () => {
    /*
     * The retry as `importSelectedDevices` and the rule engine actually
     * perform it, rather than as a string.
     *
     * Both paths build the device, catch the unique-name failure, and rebuild
     * it with `name: buildFallbackDeviceName(host)`. Two things have to hold
     * for that to work and neither is visible from the naming functions
     * alone: the builder must PREFER the supplied name over its own default
     * (otherwise the retry recreates the colliding name and fails again), and
     * the retry must change nothing else — above all not `hostname`, because
     * a retried device that addressed itself by name would poll the wrong
     * thing forever.
     *
     * The default half is pinned on the same host in the same test, so the
     * two names are visibly different strings produced by one builder.
     */
    const host: DiscoveredNetworkDevice = hostsFromPayload([
      {
        ipAddress: "10.18.166.51",
        snmpReachable: false,
        dnsHostname: "unassigned.dhcp.corp.example.net",
      },
    ])[0]!;

    const firstAttempt: NetworkDevice = buildNetworkDeviceFromDiscoveredHost({
      projectId: PROJECT_ID,
      host: host,
      scan: PING_ONLY_SCAN,
    });

    // No name supplied: the builder's default IS the displayed name.
    expect(firstAttempt.name).toBe("unassigned.dhcp.corp.example.net");

    const retry: NetworkDevice = buildNetworkDeviceFromDiscoveredHost({
      projectId: PROJECT_ID,
      host: host,
      scan: PING_ONLY_SCAN,
      name: buildFallbackDeviceName(host),
    });

    expect(retry.name).toBe("unassigned.dhcp.corp.example.net (10.18.166.51)");
    expect(retry.name).not.toBe(firstAttempt.name);

    // Everything the retry must NOT have changed.
    expect(retry.hostname).toBe("10.18.166.51");
    expect(retry.hostname).toBe(firstAttempt.hostname);
    expect(retry.monitoringMethod).toBe(NetworkDeviceMonitoringMethod.Probe);
    expect(retry.isPollingEnabled).toBe(true);
    expect(retry.projectId).toBe(PROJECT_ID);
  });

  it("stringifies a numeric address while naming the host by its PTR record", () => {
    /*
     * A number in `ipAddress` is a shipped probe bug the normaliser exists to
     * absorb: the selection record keys the host as the string "10" (object
     * keys always are), while the imported-set is matched with `Set.has(10)`,
     * which does not coerce — so the host imported and then could never be
     * retired, and pressing Import again duplicated it.
     *
     * With a PTR name on the same row it becomes a chain claim, and the two
     * fields must be treated OPPOSITELY: `ipAddress` is stringified (it is
     * still an address, just badly typed) while `sysName` and `dnsHostname`
     * are not (see the sysName test below). `hostname` must come out as the
     * string "10", because NetworkDeviceService.getRegisteredHostnames dedups
     * against a Set of strings and a number would silently never match.
     */
    const hosts: Array<DiscoveredNetworkDevice> = hostsFromPayload([
      {
        ipAddress: 10,
        snmpReachable: false,
        dnsHostname: "hq-gw-01.corp.example.net",
      },
    ]);

    expect(hosts[0]?.ipAddress).toBe("10");

    const device: NetworkDevice = devicesFromPayload([
      {
        ipAddress: 10,
        snmpReachable: false,
        dnsHostname: "hq-gw-01.corp.example.net",
      },
    ])[0]!;

    expect(device.name).toBe("hq-gw-01.corp.example.net");
    expect(device.hostname).toBe("10");
    // `toBe("10")` would also pass for the number under `==`, so say it.
    expect(typeof device.hostname).toBe("string");
  });

  it("preserves a PTR record's own capitalisation and still rejects an upper-case in-addr.arpa echo", () => {
    /*
     * Case is a joint, in both directions, and neither direction is visible
     * from one module.
     *
     * (a) ReverseDnsNameUtil PRESERVES case deliberately — the reverse zone's
     *     spelling is as close to the operator's intent as this data gets —
     *     so a device must be created as "HQ-FileServer.Corp.Example.NET".
     *     Any lower-casing added for "consistency" between here and the
     *     device name would be caught here.
     * (b) The zone check compares the LOWER-CASED name but the function
     *     returns the original. A resolver that echoes the query name back in
     *     upper case (they exist; DNS is case-insensitive on the wire and
     *     0x20 encoding makes mixed-case echoes ordinary) must still be
     *     rejected. Comparing the un-lowered string against the zone list is
     *     the classic version of this bug, and every other hostile-value case
     *     in this file spells the zone in lower case, so this row is the only
     *     one that would catch it.
     */
    const payload: Array<unknown> = [
      {
        ipAddress: "10.18.166.51",
        snmpReachable: false,
        dnsHostname: "HQ-FileServer.Corp.Example.NET",
      },
      {
        ipAddress: "10.18.166.53",
        snmpReachable: false,
        dnsHostname: "53.166.18.10.IN-ADDR.ARPA",
      },
      // The apex spelled the same way, which a suffix-only check misses.
      {
        ipAddress: "10.18.166.54",
        snmpReachable: false,
        dnsHostname: "In-Addr.Arpa.",
      },
    ];

    const hosts: Array<DiscoveredNetworkDevice> = hostsFromPayload(payload);

    expect(hosts[0]?.dnsHostname).toBe("HQ-FileServer.Corp.Example.NET");
    expect(hosts[1]).not.toHaveProperty("dnsHostname");
    expect(hosts[2]).not.toHaveProperty("dnsHostname");

    expect(deviceNames(devicesFromPayload(payload))).toEqual([
      "HQ-FileServer.Corp.Example.NET",
      "10.18.166.53",
      "10.18.166.54",
    ]);
  });

  it("blanks a non-string sysName so the PTR name wins, rather than stringifying it", () => {
    /*
     * `sysName` comes out of the same verbatim jsonb blob as everything else,
     * so its declared `string | undefined` type describes what the probe
     * SHOULD send, not what is stored. `(42).trim()` is a TypeError thrown
     * during render, which takes out the whole modal rather than one row.
     *
     * EXPECTED BEHAVIOUR, stated plainly because the interesting part is what
     * does NOT happen. A non-string sysName is BLANKED, not coerced, and that
     * is the difference between this field and `ipAddress` (which IS
     * stringified, as the numeric-address test above pins). Blanking is what
     * these rows prove is right:
     *
     *   - sysName 42    -> "" -> the PTR name wins. Not "42".
     *   - sysName {...} -> "" -> the PTR name wins. NOT "[object Object]",
     *                      which is what `String()` returns and which, being
     *                      truthy, would beat a perfectly good PTR record on
     *                      the very same row.
     *   - sysName null  -> "" -> the PTR name wins. NOT "null" (typeof null
     *                      is "object", so it is not the `undefined` the
     *                      guard already skips).
     *
     * The blanking is asserted on the ROW as well as through the name,
     * because the two layers guard it independently: delete the blanking from
     * normalizeDiscoveredHosts and getDiscoveredHostDisplayName's own `typeof`
     * check still produces every name below. Only `hosts[n].sysName` can tell
     * that the normalised row — which is what an auto-import rule matches on
     * and what the selection record holds — was cleaned too.
     *
     * The fourth row is the one that makes blanking visible in the NAME as
     * well: junk in `sysName` and no PTR record either, so the name has
     * nowhere to fall but the address.
     */
    const payload: Array<unknown> = [
      {
        ipAddress: "10.18.166.51",
        sysName: 42,
        dnsHostname: "hq-switch-01.corp.example.net",
      },
      {
        ipAddress: "10.18.166.53",
        sysName: { oid: "1.3.6.1.2.1.1.5.0" },
        dnsHostname: "hq-switch-02.corp.example.net",
      },
      {
        ipAddress: "10.18.166.54",
        sysName: null,
        dnsHostname: "hq-switch-03.corp.example.net",
      },
      { ipAddress: "10.18.166.56", sysName: 42 },
      /*
       * An ABSENT sysName must not GAIN the key: `sysName` is optional and
       * `"sysName" in host` is a question other code is entitled to ask. Note
       * `sysName: undefined` is erased by the JSON round trip, so "absent" is
       * the only form the column can actually store.
       */
      {
        ipAddress: "10.18.166.57",
        sysName: undefined,
        dnsHostname: "hq-switch-04.corp.example.net",
      },
    ];

    const hosts: Array<DiscoveredNetworkDevice> = hostsFromPayload(payload);

    expect(hosts[0]?.sysName).toBe("");
    expect(hosts[1]?.sysName).toBe("");
    expect(hosts[2]?.sysName).toBe("");
    expect(hosts[3]?.sysName).toBe("");
    expect(hosts[4]).not.toHaveProperty("sysName");

    const devices: Array<NetworkDevice> = devicesFromPayload(payload);

    expect(deviceNames(devices)).toEqual([
      "hq-switch-01.corp.example.net",
      "hq-switch-02.corp.example.net",
      "hq-switch-03.corp.example.net",
      "10.18.166.56",
      "hq-switch-04.corp.example.net",
    ]);

    expect(deviceHostnames(devices)).toEqual([
      "10.18.166.51",
      "10.18.166.53",
      "10.18.166.54",
      "10.18.166.56",
      "10.18.166.57",
    ]);
  });

  it("leaves a whitespace-only sysName on the row but never lets it become a name", () => {
    /*
     * The one place the two layers deliberately DISAGREE, which is why it can
     * only be pinned end to end.
     *
     * normalizeDiscoveredHosts passes a string sysName through untouched — it
     * only rewrites non-strings — so "   " is still "   " on the row an
     * auto-import rule matches against. getDiscoveredHostDisplayName trims
     * before testing for emptiness, so the same value does not name anything
     * and the PTR record wins.
     *
     * Both halves are asserted because either one alone is satisfiable by the
     * wrong implementation: if the normaliser started trimming, the row
     * assertion fails; if the display stopped trimming, "   " is truthy, it
     * beats the PTR record, and a device is created whose name is three
     * spaces and whose slug is empty.
     */
    const payload: Array<unknown> = [
      {
        ipAddress: "10.18.166.51",
        sysName: "   ",
        dnsHostname: "hq-esxi-04.corp.example.net",
      },
      // The same blank sysName with nothing to fall through to but the address.
      { ipAddress: "10.18.166.53", sysName: "   " },
    ];

    const hosts: Array<DiscoveredNetworkDevice> = hostsFromPayload(payload);

    expect(hosts[0]?.sysName).toBe("   ");
    expect(hosts[1]?.sysName).toBe("   ");

    expect(namesFromPayload(payload)).toEqual([
      "hq-esxi-04.corp.example.net",
      "10.18.166.53",
    ]);

    expect(deviceNames(devicesFromPayload(payload))).toEqual([
      "hq-esxi-04.corp.example.net",
      "10.18.166.53",
    ]);
  });

  it("gives two rows for one address a single registration state but two different PTR names", () => {
    /*
     * The dedup pass and the naming feature meet here, and the meeting is
     * only visible in the chain.
     *
     * A scan can list the same address twice — two interfaces answering, a
     * re-scan merged in, a probe retry — and the rows need not agree. The
     * normaliser fixes ONE of those disagreements: `isAlreadyRegistered` is a
     * property of the ADDRESS, so if any row says the address is registered,
     * every row for it does. Without that pass one checkbox governs both rows
     * while only one of them refuses to import, and whether an inventoried
     * device got created a second time depended on the probe's ordering.
     *
     * It deliberately does NOT unify the names, and it cannot: the two rows
     * hold two different PTR answers and neither is more true than the other.
     * So the operator ticks one row, sees one name, and — if the import walks
     * the other row — creates a device under the other name. Pinning the
     * disagreement is the point: it is a real hazard of naming devices by
     * DNS, and this assertion is where anyone who later tries to dedup rows
     * by address will find out that the names were never dedupable.
     */
    const payload: Array<unknown> = [
      {
        ipAddress: "10.18.166.51",
        snmpReachable: false,
        dnsHostname: "hq-nas-01.corp.example.net",
        isAlreadyRegistered: true,
      },
      {
        ipAddress: "10.18.166.51",
        snmpReachable: false,
        dnsHostname: "hq-nas-01-old.corp.example.net",
      },
    ];

    const hosts: Array<DiscoveredNetworkDevice> = hostsFromPayload(payload);

    // One address, one registration state, whatever order the probe sent.
    expect(
      hosts.map((host: DiscoveredNetworkDevice): boolean | undefined => {
        return host.isAlreadyRegistered;
      }),
    ).toEqual([true, true]);

    const names: Array<string | undefined> = deviceNames(
      devicesFromPayload(payload),
    );

    expect(names).toEqual([
      "hq-nas-01.corp.example.net",
      "hq-nas-01-old.corp.example.net",
    ]);
    // Two names for one checkbox: the hazard, stated as a property.
    expect(new Set<string | undefined>(names).size).toBe(2);

    // Both still address the one host they are, which is the dedup key.
    expect(deviceHostnames(devicesFromPayload(payload))).toEqual([
      "10.18.166.51",
      "10.18.166.51",
    ]);
  });
});
