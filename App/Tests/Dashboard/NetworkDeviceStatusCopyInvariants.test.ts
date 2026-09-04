import { describe, expect, test } from "@jest/globals";
import {
  DEVICE_SUMMARY_TILES,
  DeviceSummaryTile,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceSummaryTiles";
import { DEVICE_STATUS_FACET_OPTIONS } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceFacets";
import { FilterChipDropdownOption } from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdownTypes";
import {
  NO_MONITOR_QUALIFIER,
  UNBOUND_MONITOR_BACKED_PENDING_TOOLTIP,
  BOUND_MONITOR_PENDING_TOOLTIP,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceStatusUtil";
import {
  HOSTNAME_FIELD_DESCRIPTION,
  MONITORING_METHOD_FIELD_DESCRIPTION,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/MonitoringMethodFormFields";
import fs from "fs";
import path from "path";

/*
 * WHY THIS FILE EXISTS
 *
 * Monitor-backed devices are now first-class in every count the product
 * prints: the server keeps `isReachable` in step with the bound monitor, so
 * the summary tiles, the Status chip and the pill agree by construction.
 * That only stays TRUE on screen if the words agree too. A tile captioned
 * "the last SNMP poll reached the device" over a count that includes fifty
 * ping-only phones is a caption describing a different query from the one
 * underneath it, and the operator who reads it will go looking for an SNMP
 * poll that never happened.
 *
 * The same goes for the state this change introduces. A monitor-backed
 * device with nothing bound reads Pending, tagged "No monitor", and the
 * create form, the list, the site's Devices tab, the Overview hero and the
 * device's own Monitors card all have to use that one word — an operator
 * who reads "No monitor" on the list has to be able to find the sentence
 * that says how to fix it.
 *
 * METHOD. Constants are imported and asserted directly; page wiring is
 * asserted against the sources (comments stripped, whitespace squashed),
 * the same way MonitorBackedDeviceColumnHonesty.test.ts does — the App
 * suite has no React renderer.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

// The old, SNMP-only wording; allowed only in a sentence that also names the monitor.
const SNMP_POLL_WORDING: RegExp = /SNMP poll/i;

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function readCode(...relativeParts: Array<string>): string {
  return stripComments(
    fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8"),
  ).replace(/\s+/g, " ");
}

/*
 * The surfaces that print a monitor-backed device's status. Every one of them
 * has to select `monitorId` (the qualifier is decided from it) and render the
 * shared qualifier rather than a private copy of the word.
 */
const QUALIFIER_SURFACES: Array<{ name: string; parts: Array<string> }> = [
  {
    name: "the device list",
    parts: ["Pages", "NetworkDevice", "Devices.tsx"],
  },
  {
    name: "the device Overview hero",
    parts: ["Components", "NetworkDevice", "DeviceStatusHero.tsx"],
  },
  {
    name: "a site's Devices tab",
    parts: ["Pages", "NetworkSite", "View", "Devices.tsx"],
  },
];

describe("the counts describe both kinds of device", () => {
  /*
   * "SNMP poll" alone is the old wording. It may still appear, but only in a
   * sentence that also names the monitor — otherwise the caption is back to
   * describing half the fleet.
   */
  test.each(
    DEVICE_SUMMARY_TILES.map((tile: DeviceSummaryTile): Array<string> => {
      return [tile.key, tile.caption];
    }),
  )(
    "the %s tile caption is method-neutral",
    (_key: string, caption: string) => {
      if (SNMP_POLL_WORDING.test(caption) === true) {
        expect(caption.toLowerCase()).toContain("monitor");
      }
    },
  );

  test.each(
    DEVICE_STATUS_FACET_OPTIONS.map(
      (option: FilterChipDropdownOption): Array<string> => {
        return [option.label, option.sublabel || ""];
      },
    ),
  )(
    "the Status chip's %s sublabel is method-neutral",
    (_label: string, sublabel: string) => {
      if (SNMP_POLL_WORDING.test(sublabel) === true) {
        expect(sublabel.toLowerCase()).toContain("monitor");
      }
    },
  );

  test("the Pending tile and chip say a missing monitor is one way to be pending", () => {
    const pendingTile: string =
      DEVICE_SUMMARY_TILES.find((tile: DeviceSummaryTile) => {
        return tile.key === "devices-pending";
      })?.caption || "";
    const pendingOption: string =
      DEVICE_STATUS_FACET_OPTIONS.find((option: FilterChipDropdownOption) => {
        return option.label === "Pending";
      })?.sublabel || "";

    expect(pendingTile.toLowerCase()).toContain("no monitor bound");
    expect(pendingOption.toLowerCase()).toContain("no monitor bound");
  });

  /*
   * The card ranks every unreachable device in the project, and there are
   * three ways to become one: a failed PING, a failed SNMP walk, or a bound
   * monitor reporting offline. Naming SNMP is wrong twice over now — a
   * ping-only device (a phone, a camera, a PDU with no credentials) has no
   * SNMP poll to have failed, and a device that answers ping while its walk
   * fails is not in this list at all; it wears the "SNMP failing" pill and
   * is ranked below, which is the clause after this one. "The last poll" is
   * the honest word for what all of them have in common.
   */
  test("the Overview's attention card does not attribute every outage to an SNMP poll", () => {
    const overview: string = readCode("Pages", "NetworkDevice", "Overview.tsx");

    expect(overview).toContain(
      "the last poll, or the bound monitor, could not reach them",
    );
    expect(overview).toContain("Monitor reports offline");
    expect(overview).toContain("device.isMonitorBacked");
  });
});

describe('the "No monitor" qualifier is one word on every surface', () => {
  test("the qualifier is a second pill beside Pending, not a fourth verdict", () => {
    expect(NO_MONITOR_QUALIFIER.text).toBe("No monitor");
    /*
     * The tooltip has to say what to do, and name both ways out — the
     * create button on the device page and the binding under Settings.
     */
    expect(NO_MONITOR_QUALIFIER.tooltip).toContain("Create Ping Monitor");
    expect(NO_MONITOR_QUALIFIER.tooltip).toContain("Settings");
  });

  test("the two Pending tooltips no longer hedge between unbound and unevaluated", () => {
    expect(UNBOUND_MONITOR_BACKED_PENDING_TOOLTIP).not.toMatch(/, or /);
    expect(BOUND_MONITOR_PENDING_TOOLTIP).not.toMatch(/, or /);
    expect(UNBOUND_MONITOR_BACKED_PENDING_TOOLTIP).toContain("no monitor");
    expect(BOUND_MONITOR_PENDING_TOOLTIP).toContain("bound");
  });

  test.each(QUALIFIER_SURFACES)(
    "$name selects monitorId beside the shared status columns",
    ({ parts }: { parts: Array<string> }) => {
      const code: string = readCode(...parts);
      const spreadAt: number = code.indexOf("...DEVICE_STATUS_SELECT,");

      expect(spreadAt).toBeGreaterThan(-1);
      // After the spread, inside the same select — the qualifier reads it.
      expect(code.indexOf("monitorId: true,", spreadAt)).toBeGreaterThan(
        spreadAt,
      );
    },
  );

  test.each(QUALIFIER_SURFACES)(
    "$name renders the shared qualifier through the shared predicate",
    ({ parts }: { parts: Array<string> }) => {
      const code: string = readCode(...parts);

      expect(code).toContain("isUnboundMonitorBackedDevice(");
      expect(code).toContain("NO_MONITOR_QUALIFIER.text");
      expect(code).toContain("NO_MONITOR_QUALIFIER.tooltip");
      // No private copy of the word that could drift from the constant.
      expect(code).not.toContain('text="No monitor"');
    },
  );

  test("the Overview hero offers both ways out of an unbound device", () => {
    const hero: string = readCode(
      "Components",
      "NetworkDevice",
      "DeviceStatusHero.tsx",
    );

    expect(hero).toContain("No monitor bound");
    expect(hero).toContain("Create Ping monitor");
    expect(hero).toContain("Bind a monitor");
    expect(hero).toContain("PageMap.NETWORK_DEVICE_VIEW_SETTINGS");
    expect(hero).toContain("PageMap.MONITOR_CREATE");
    expect(hero).toContain("?networkDeviceId=");
  });

  test("the device's Monitors card no longer sends the operator to bind by hand", () => {
    const card: string = readCode(
      "Components",
      "NetworkDevice",
      "DeviceMonitorsCard.tsx",
    );

    expect(card).not.toContain("under Settings → Device Details");
    expect(card).toContain("Create Ping Monitor");
  });
});

describe("the forms explain the method and the hostname the same way", () => {
  /*
   * The two forms that REGISTER a device. Neither asks how it is monitored:
   * every device they create is probe-polled, and the bound-monitor override
   * is a decision taken later, on a device that already exists.
   */
  const REGISTRATION_SURFACES: Array<{ name: string; parts: Array<string> }> = [
    {
      name: "the device create form",
      parts: ["Pages", "NetworkDevice", "Devices.tsx"],
    },
    {
      name: 'the topology "Add to Monitoring" dialog',
      parts: ["Components", "Topology", "AddNeighborToMonitoringModal.tsx"],
    },
  ];

  const HOSTNAME_SURFACES: Array<{ name: string; parts: Array<string> }> = [
    ...REGISTRATION_SURFACES,
    {
      name: "the device Overview card",
      parts: ["Pages", "NetworkDevice", "View", "Index.tsx"],
    },
    {
      name: "the device Settings form",
      parts: ["Pages", "NetworkDevice", "View", "Settings.tsx"],
    },
  ];

  /*
   * Asserted as an ABSENCE, because the method question came with a
   * paragraph explaining itself: a form that grows the picker back grows the
   * copy back with it, and the copy is the cheaper thing to watch for.
   */
  test.each(REGISTRATION_SURFACES)(
    "$name has no monitoring-method picker to explain",
    ({ parts }: { parts: Array<string> }) => {
      const code: string = readCode(...parts);

      expect(code).not.toContain("monitoringMethod: true");
      expect(code).not.toContain("MONITORING_METHOD_FIELD_DESCRIPTION");
      expect(code).not.toContain("MONITORING_METHOD_OPTIONS");
    },
  );

  /*
   * The one surface that still asks is the device's Settings page, where the
   * question is "should this device be an exception?" rather than "how does
   * monitoring work?". Its sentence must not read as a prerequisite — the
   * old one said "bind it to an existing Ping or IP monitor", which sounds
   * like something to go and do first — and it has to say that the override
   * is the unusual answer.
   */
  test("the method description reads as an exception, not a prerequisite", () => {
    expect(MONITORING_METHOD_FIELD_DESCRIPTION).not.toContain(
      "bind it to an existing",
    );
    expect(MONITORING_METHOD_FIELD_DESCRIPTION).toContain(
      "Probe is the normal choice",
    );
    expect(MONITORING_METHOD_FIELD_DESCRIPTION).toContain(
      "Pick Bound monitor only when",
    );
  });

  /*
   * And it must be honest about the device with no credentials, which is the
   * whole point of ping-first polling: it is not unmonitored, it is pinged.
   */
  test("the method description says a device without SNMP is still polled", () => {
    expect(MONITORING_METHOD_FIELD_DESCRIPTION).toContain("simply pinged");
  });

  test.each(HOSTNAME_SURFACES)(
    "$name uses the shared hostname description",
    ({ parts }: { parts: Array<string> }) => {
      expect(readCode(...parts)).toContain(
        "description: HOSTNAME_FIELD_DESCRIPTION",
      );
    },
  );

  /*
   * The address means something different to each kind of device, and the
   * one sentence has to be true of all of them: a probe-polled device is
   * PINGED here (which is what makes a credential-less device monitorable at
   * all), walked here only once it has credentials, and a monitor-backed
   * device is not polled here at all.
   *
   * The two negative assertions are the claims this copy used to make. "SNMP
   * device" was the old name for a probe-polled one, and saying the address
   * is where SNMP happens promises a walk to the phone, camera or PDU that
   * will only ever be pinged.
   */
  test("the hostname description covers every kind of device", () => {
    expect(HOSTNAME_FIELD_DESCRIPTION).toContain("pinged here");
    expect(HOSTNAME_FIELD_DESCRIPTION).toContain("once it has credentials");
    expect(HOSTNAME_FIELD_DESCRIPTION).toContain("monitor-backed device");

    expect(HOSTNAME_FIELD_DESCRIPTION).not.toContain("will poll via SNMP");
    expect(HOSTNAME_FIELD_DESCRIPTION).not.toContain("An SNMP device");
  });
});
