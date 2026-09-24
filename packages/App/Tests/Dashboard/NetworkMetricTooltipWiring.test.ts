import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  NETWORK_DEVICE_METRIC_DESCRIPTIONS,
  NetworkDeviceMetric,
} from "../../FeatureSet/Dashboard/src/Components/MetricDescriptions/NetworkDeviceMetricDescriptions";
import {
  NETWORK_SITE_METRIC_DESCRIPTIONS,
  NetworkSiteMetric,
} from "../../FeatureSet/Dashboard/src/Components/MetricDescriptions/NetworkSiteMetricDescriptions";
import {
  DEVICE_SUMMARY_TILES,
  DeviceSummaryTile,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceSummaryTiles";
import {
  SITE_SUMMARY_TILES,
  SiteSummaryTile,
} from "../../FeatureSet/Dashboard/src/Components/NetworkSite/SiteSummaryTiles";
import {
  DiagnosticRow,
  PingResultSummary,
  describePingResult,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceDiagnosticsViewModel";

/*
 * Every metric on the network device and network site pages carries an (i)
 * that says what it means. The texts live in the two description modules
 * (their accuracy is pinned in Common/Tests/App/Dashboard/
 * NetworkMetricTooltips.test.ts); what is pinned here is that each number is
 * paired with ITS text — the Down tile with the down text, not the up one —
 * and that no tile, column or section title was left without one.
 *
 * The App suite has no renderer, so the pages are read as source, comments
 * stripped and whitespace squashed so a Prettier reflow or a rationale
 * comment can neither pass nor fail a test (the idiom of
 * CloudResourcePages.test.ts). The data-driven definitions — the summary
 * tiles and the ping rows — are imported and run for real. What a person
 * sees on hover is asserted in the jsdom render tests beside the text tests
 * in Common/Tests/App/Dashboard.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\{\s*\}/g, " ");
}

/*
 * Prettier breaks a long `description={RECORD.key}` onto three lines, which
 * squashes to `description={ RECORD.key }`; the braces are closed up so a
 * reflow cannot change what matches.
 */
function readCode(relativePath: string): string {
  return squash(
    stripComments(
      fs.readFileSync(
        path.join(DASHBOARD_SRC, ...relativePath.split("/")),
        "utf8",
      ),
    ),
  )
    .replace(/\{ /g, "{")
    .replace(/ \}/g, "}");
}

function between(source: string, from: string, to: string): string {
  const start: number = source.indexOf(from);

  if (start < 0) {
    throw new Error(`Expected the source to contain "${from}".`);
  }

  const end: number = source.indexOf(to, start + from.length);

  return end >= 0 ? source.slice(start, end) : source.slice(start);
}

function count(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

/*
 * How many times the JSX element `<Name` opens — word-bounded, so the props
 * type `FunctionComponent<NameProps>` is not counted as a use.
 */
function countTag(source: string, name: string): number {
  return (source.match(new RegExp(`<${name}\\b`, "g")) || []).length;
}

const DEVICE_RECORD: string = "NETWORK_DEVICE_METRIC_DESCRIPTIONS";
const SITE_RECORD: string = "NETWORK_SITE_METRIC_DESCRIPTIONS";
const INFO_TOOLTIP_IMPORT: string =
  'import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";';

function deviceRef(key: NetworkDeviceMetric): string {
  return `${DEVICE_RECORD}.${key}`;
}

function siteRef(key: NetworkSiteMetric): string {
  return `${SITE_RECORD}.${key}`;
}

/*
 * The JSX element that opens at `opening` (e.g. `<DeviceHeroTileTitle
 * title="Site"`) up to its self-closing `/>`.
 */
function element(source: string, opening: string): string {
  return between(source, opening, "/>");
}

/*
 * A ModelTable column literal, from its title to the next column's `field:`
 * (or the end of the columns array).
 */
function column(source: string, title: string): string {
  return between(source, `title: "${title}",`, "field: {");
}

describe("the device Overview hero", () => {
  const code: string = readCode(
    "Components/NetworkDevice/DeviceStatusHero.tsx",
  );

  test("every tile opens with the shared title, which carries the (i)", () => {
    expect(code).toContain(INFO_TOOLTIP_IMPORT);
    expect(code).toContain(
      "<InfoTooltip label={props.title} text={props.description} />",
    );
    expect(countTag(code, "DeviceHeroTileTitle")).toBe(6);

    // No tile kept a bare title div without an (i) slot.
    expect(code).not.toContain(
      '<div className="text-sm font-medium text-gray-500">',
    );
  });

  test.each([
    ["Reachability", "reachability"],
    ["Monitor Status", "monitorStatus"],
    ["Interfaces", "heroInterfaces"],
    ["Hardware Uptime", "hardwareUptime"],
  ] as Array<[string, NetworkDeviceMetric]>)(
    "the %s tile is explained by NETWORK_DEVICE_METRIC_DESCRIPTIONS.%s",
    (title: string, key: NetworkDeviceMetric) => {
      expect(element(code, `<DeviceHeroTileTitle title="${title}"`)).toContain(
        `description={${deviceRef(key)}}`,
      );
    },
  );

  test.each(["Site", "Polled By"])(
    "the %s tile only names something, so it has no (i)",
    (title: string) => {
      expect(
        element(code, `<DeviceHeroTileTitle title="${title}"`),
      ).not.toContain("description=");
    },
  );

  test("exactly the four metric tiles carry a description", () => {
    expect(count(code, `description={${DEVICE_RECORD}.`)).toBe(4);
  });
});

describe("the site Overview hero", () => {
  const code: string = readCode("Components/NetworkSite/SiteStatusHero.tsx");

  test("every tile opens with the shared title, which carries the (i)", () => {
    expect(code).toContain(INFO_TOOLTIP_IMPORT);
    expect(code).toContain(
      "<InfoTooltip label={props.title} text={props.description} />",
    );
    expect(countTag(code, "SiteHeroTileTitle")).toBe(7);
    expect(code).not.toContain(
      '<div className="text-sm font-medium text-gray-500">',
    );
  });

  test.each([
    ['title="Health"', "health"],
    ["title={`Uptime (${DAILY_UPTIME_WINDOW_DAYS * 24}h)`}", "uptime24h"],
    ["title={`Uptime (${UPTIME_WINDOW_DAYS}d)`}", "uptime30d"],
    ['title="Devices"', "devices"],
    ['title="Child Sites"', "childSites"],
    ['title="Endpoints"', "endpoints"],
  ] as Array<[string, NetworkSiteMetric]>)(
    "the tile %s is explained by NETWORK_SITE_METRIC_DESCRIPTIONS.%s",
    (titleProp: string, key: NetworkSiteMetric) => {
      expect(element(code, `<SiteHeroTileTitle ${titleProp}`)).toContain(
        `description={${siteRef(key)}}`,
      );
    },
  );

  test("the two uptime tiles each get their own window's text", () => {
    const daily: string = element(
      code,
      "<SiteHeroTileTitle title={`Uptime (${DAILY_UPTIME_WINDOW_DAYS * 24}h)`}",
    );
    const monthly: string = element(
      code,
      "<SiteHeroTileTitle title={`Uptime (${UPTIME_WINDOW_DAYS}d)`}",
    );

    expect(daily).not.toContain(siteRef("uptime30d"));
    expect(monthly).not.toContain(siteRef("uptime24h"));
  });

  test("Site Type only names something, so it has no (i)", () => {
    expect(element(code, '<SiteHeroTileTitle title="Site Type"')).not.toContain(
      "description=",
    );
    expect(count(code, `description={${SITE_RECORD}.`)).toBe(6);
  });
});

describe("the latency trend", () => {
  const code: string = readCode(
    "Components/NetworkDevice/DeviceLatencyTrend.tsx",
  );

  test("the header's (i) explains now / avg / max", () => {
    expect(code).toContain(INFO_TOOLTIP_IMPORT);
    expect(code).toContain(
      `<InfoTooltip label={trendTitle} text={${deviceRef("latencyTrend")}} />`,
    );
  });

  test("the packet-loss line has its own (i), after the value", () => {
    const loss: string = between(
      code,
      'data-testid="network-device-loss-summary"',
      "</p>",
    );

    expect(loss).toContain(
      `<InfoTooltip label={lossTitle} text={${deviceRef("packetLossPeak")}} />`,
    );
    expect(loss.indexOf("formatPercent(lossSummary.max)")).toBeLessThan(
      loss.indexOf("<InfoTooltip"),
    );
  });

  test("the (i) never sits inside the Open metrics link", () => {
    const link: string = between(code, "<Link", "</Link>");

    expect(link).not.toContain("InfoTooltip");
  });
});

describe("the device list summary strip", () => {
  test("each tile's description is its own record entry", () => {
    const expected: Record<string, string> = {
      "devices-up": NETWORK_DEVICE_METRIC_DESCRIPTIONS.devicesUp,
      "devices-down": NETWORK_DEVICE_METRIC_DESCRIPTIONS.devicesDown,
      "devices-pending": NETWORK_DEVICE_METRIC_DESCRIPTIONS.devicesPending,
      "interfaces-down": NETWORK_DEVICE_METRIC_DESCRIPTIONS.totalInterfacesDown,
    };

    expect(
      DEVICE_SUMMARY_TILES.map((tile: DeviceSummaryTile): string => {
        return tile.key;
      }),
    ).toEqual(Object.keys(expected));

    for (const tile of DEVICE_SUMMARY_TILES) {
      expect({ key: tile.key, description: tile.description }).toEqual({
        key: tile.key,
        description: expected[tile.key],
      });
    }
  });

  test("the descriptions are distinct and say more than the caption", () => {
    const descriptions: Set<string> = new Set<string>(
      DEVICE_SUMMARY_TILES.map((tile: DeviceSummaryTile): string => {
        return tile.description;
      }),
    );

    expect(descriptions.size).toBe(DEVICE_SUMMARY_TILES.length);

    for (const tile of DEVICE_SUMMARY_TILES) {
      expect(tile.description).not.toBe(tile.caption);
      expect(tile.description.length).toBeGreaterThan(tile.caption.length);
    }
  });

  test("the definitions reference the record rather than copying its words", () => {
    const code: string = readCode(
      "Components/NetworkDevice/DeviceSummaryTiles.ts",
    );

    expect(count(code, `description: ${DEVICE_RECORD}.`)).toBe(
      DEVICE_SUMMARY_TILES.length,
    );
  });

  test("the cards hand each tile's description to the InfoCard's (i)", () => {
    const code: string = readCode(
      "Components/NetworkDevice/DeviceSummaryCards.tsx",
    );
    const card: string = between(code, "<InfoCard", "value={");

    expect(card).toContain("title={tile.label}");
    expect(card).toContain("tooltip={tile.description}");
  });
});

describe("the Sites list summary strip", () => {
  test("each tile's description is its own record entry", () => {
    const expected: Record<string, string> = {
      "total-sites": NETWORK_SITE_METRIC_DESCRIPTIONS.totalSites,
      "unhealthy-sites": NETWORK_SITE_METRIC_DESCRIPTIONS.unhealthySites,
      "sites-no-data": NETWORK_SITE_METRIC_DESCRIPTIONS.sitesWithoutData,
      "devices-without-site":
        NETWORK_SITE_METRIC_DESCRIPTIONS.unassignedDevices,
    };

    expect(
      SITE_SUMMARY_TILES.map((tile: SiteSummaryTile): string => {
        return tile.key;
      }),
    ).toEqual(Object.keys(expected));

    for (const tile of SITE_SUMMARY_TILES) {
      expect({ key: tile.key, description: tile.description }).toEqual({
        key: tile.key,
        description: expected[tile.key],
      });
    }
  });

  test("the definitions reference the record rather than copying its words", () => {
    const code: string = readCode("Components/NetworkSite/SiteSummaryTiles.ts");

    expect(count(code, `description: ${SITE_RECORD}.`)).toBe(
      SITE_SUMMARY_TILES.length,
    );
  });

  test("the cards hand each tile's description to the InfoCard's (i)", () => {
    const code: string = readCode(
      "Components/NetworkSite/SiteSummaryCards.tsx",
    );
    const card: string = between(code, "<InfoCard", "value={");

    expect(card).toContain("title={tile.label}");
    expect(card).toContain("tooltip={tile.description}");
  });
});

describe("the on-demand ping rows", () => {
  const PING: PingResultSummary = describePingResult(
    {
      isOnline: true,
      failureCause: "",
      pingResponse: {
        packetsSent: 5,
        packetsReceived: 4,
        packetLossPercent: 20,
        minRoundTripTimeInMs: 1.2,
        maxRoundTripTimeInMs: 9.8,
        avgRoundTripTimeInMs: 3.4,
        jitterInMs: 0.7,
      },
    },
    "10.0.0.1",
  );

  function rowNamed(label: string): DiagnosticRow {
    const found: DiagnosticRow | undefined = PING.rows.find(
      (candidate: DiagnosticRow): boolean => {
        return candidate.label === label;
      },
    );

    if (!found) {
      throw new Error(`No ping row labelled ${label}`);
    }

    return found;
  }

  test.each([
    ["Average RTT", "pingAverageRtt"],
    ["Min / Max RTT", "pingMinMaxRtt"],
    ["Jitter", "pingJitter"],
    ["Packet loss", "pingPacketLoss"],
  ] as Array<[string, NetworkDeviceMetric]>)(
    "the %s row carries NETWORK_DEVICE_METRIC_DESCRIPTIONS.%s",
    (label: string, key: NetworkDeviceMetric) => {
      expect(rowNamed(label).description).toBe(
        NETWORK_DEVICE_METRIC_DESCRIPTIONS[key],
      );
    },
  );

  test("the Host row names something and gets no (i)", () => {
    expect(rowNamed("Host").description).toBeUndefined();
  });

  test("a ping that could not run has only a Reason row, with no (i)", () => {
    const failed: PingResultSummary = describePingResult({
      isOnline: false,
      failureCause: "ICMP is not usable on this probe.",
    });

    expect(failed.rows).toEqual([
      { label: "Reason", value: "ICMP is not usable on this probe." },
    ]);
    expect(failed.rows[0]!.description).toBeUndefined();
  });

  test("the drawer renders each row's description in an (i) beside its label", () => {
    const code: string = readCode(
      "Components/NetworkDevice/DeviceDiagnostics.tsx",
    );
    const term: string = between(code, "<dt", "</dt>");

    expect(code).toContain(INFO_TOOLTIP_IMPORT);
    expect(term).toContain(
      "<InfoTooltip label={label} text={diagnosticRow.description} />",
    );
  });
});

describe("the traceroute table", () => {
  test("the RTT header carries its (i); Hop and Host do not", () => {
    const code: string = readCode(
      "Components/NetworkDevice/TracerouteHopsTable.tsx",
    );
    const header: string = between(code, "<thead>", "</thead>");

    expect(count(header, "<InfoTooltip")).toBe(1);
    expect(between(header, "RTT", "/>")).toContain(
      `text={${deviceRef("tracerouteRtt")}}`,
    );
  });
});

describe("the device Overview's interface digest", () => {
  test("the card title carries the (i) for the unlabelled per-port numbers", () => {
    const code: string = readCode(
      "Components/NetworkDevice/DeviceInterfacesPreview.tsx",
    );
    const title: string = between(code, "<Card title={", "description=");

    expect(title).toContain("{PREVIEW_TITLE}");
    expect(title).toContain(
      `<InfoTooltip label={PREVIEW_TITLE} text={${deviceRef("interfacesPreview")}} />`,
    );
  });
});

describe("the Traffic tab's top talkers", () => {
  const code: string = readCode("Components/NetworkDevice/FlowTopTalkers.tsx");

  test("the stat tile and section title components render the (i)", () => {
    expect(code).toContain(INFO_TOOLTIP_IMPORT);
    expect(
      count(
        code,
        "<InfoTooltip label={props.title} text={props.description} />",
      ),
    ).toBe(2);
  });

  test.each([
    ["Total Traffic", "flowTotalTraffic"],
    ["Packets", "flowPackets"],
    ["Flows", "flowCount"],
  ] as Array<[string, NetworkDeviceMetric]>)(
    "the %s tile is explained by NETWORK_DEVICE_METRIC_DESCRIPTIONS.%s",
    (title: string, key: NetworkDeviceMetric) => {
      expect(element(code, `<FlowStatTile title="${title}"`)).toContain(
        `description={${deviceRef(key)}}`,
      );
    },
  );

  test.each([
    ["Bandwidth Over Time", "flowBandwidth"],
    ["Top Conversations", "flowTopConversations"],
    ["Top Protocols & Ports", "flowTopProtocolsPorts"],
  ] as Array<[string, NetworkDeviceMetric]>)(
    "the %s section is explained by NETWORK_DEVICE_METRIC_DESCRIPTIONS.%s",
    (title: string, key: NetworkDeviceMetric) => {
      expect(element(code, `<FlowSectionTitle title="${title}"`)).toContain(
        `description={${deviceRef(key)}}`,
      );
    },
  );

  test.each([
    ["Top Sources", "flowTopSources"],
    ["Top Destinations", "flowTopDestinations"],
  ] as Array<[string, NetworkDeviceMetric]>)(
    "the %s table is explained by NETWORK_DEVICE_METRIC_DESCRIPTIONS.%s",
    (title: string, key: NetworkDeviceMetric) => {
      expect(element(code, `<TopEntryTable title="${title}"`)).toContain(
        `description={${deviceRef(key)}}`,
      );
    },
  );

  test("the top-N tables title themselves through the section title", () => {
    const table: string = between(
      code,
      "const TopEntryTable",
      "<table className",
    );

    expect(table).toContain(
      "<FlowSectionTitle title={props.title} description={props.description} />",
    );
  });

  test("every stat tile and every section title has a description", () => {
    expect(countTag(code, "FlowStatTile")).toBe(3);
    expect(countTag(code, "FlowSectionTitle")).toBe(4);
    expect(countTag(code, "TopEntryTable")).toBe(2);
    expect(count(code, `description={${DEVICE_RECORD}.`)).toBe(3 + 3 + 2);

    // No section kept a bare, unexplained heading.
    expect(code).not.toContain(
      '<div className="text-sm font-medium text-gray-900 mb-2">',
    );
  });
});

describe("the Interfaces tab", () => {
  const code: string = readCode("Pages/NetworkDevice/View/Interfaces.tsx");

  test.each([
    ["Total Interfaces", "totalInterfaces"],
    ["Up", "interfacesUp"],
    ["Down", "interfacesDown"],
    ["Monitored", "interfacesMonitored"],
  ] as Array<[string, NetworkDeviceMetric]>)(
    "the %s card is explained by NETWORK_DEVICE_METRIC_DESCRIPTIONS.%s",
    (title: string, key: NetworkDeviceMetric) => {
      expect(between(code, `<InfoCard title="${title}"`, "value={")).toContain(
        `tooltip={${deviceRef(key)}}`,
      );
    },
  );

  test("every count card has a tooltip", () => {
    expect(countTag(code, "InfoCard")).toBe(4);
    expect(count(code, `tooltip={${DEVICE_RECORD}.`)).toBe(4);
  });

  test.each([
    ["Status", "interfaceStatus"],
    ["Speed (Mbps)", "interfaceSpeed"],
    ["In / Out (Mbps)", "interfaceInOutRate"],
    ["Utilization", "interfaceUtilization"],
    ["Errors / sec", "interfaceErrorsPerSecond"],
  ] as Array<[string, NetworkDeviceMetric]>)(
    "the %s column header is explained by NETWORK_DEVICE_METRIC_DESCRIPTIONS.%s",
    (title: string, key: NetworkDeviceMetric) => {
      expect(column(code, title)).toContain(`headerTooltip: ${deviceRef(key)}`);
    },
  );

  test.each(["Index", "MAC Address"])(
    "the %s column is metadata and has no header (i)",
    (title: string) => {
      expect(column(code, title)).not.toContain("headerTooltip");
    },
  );

  test("exactly the five metric columns carry a header tooltip", () => {
    expect(count(code, "headerTooltip:")).toBe(5);
  });
});

describe("the device list", () => {
  const code: string = readCode("Pages/NetworkDevice/Devices.tsx");

  test.each([
    ["Status", "deviceStatus"],
    ["Interfaces (Up / Down)", "deviceInterfacesUpDown"],
  ] as Array<[string, NetworkDeviceMetric]>)(
    "the %s column header is explained by NETWORK_DEVICE_METRIC_DESCRIPTIONS.%s",
    (title: string, key: NetworkDeviceMetric) => {
      // Each title appears once in the page, in its column literal.
      expect(count(code, `title: "${title}",`)).toBe(1);
      expect(column(code, title)).toContain(`headerTooltip: ${deviceRef(key)}`);
    },
  );

  test("metadata columns (names, hostnames, Last Seen) have no header (i)", () => {
    expect(count(code, "headerTooltip:")).toBe(2);
  });

  test("the summary strip above the list is the one with the tile (i)s", () => {
    expect(code).toContain("<DeviceSummaryCards");
  });
});

describe("the Network Overview", () => {
  const code: string = readCode("Pages/NetworkDevice/Overview.tsx");

  test.each([
    ["Devices", "fleetDevices"],
    ["Interfaces Down", "fleetInterfacesDown"],
    ["Sites", "fleetSites"],
    ["Endpoints", "fleetEndpoints"],
  ] as Array<[string, NetworkDeviceMetric]>)(
    "the %s card is explained by NETWORK_DEVICE_METRIC_DESCRIPTIONS.%s",
    (title: string, key: NetworkDeviceMetric) => {
      expect(between(code, `<InfoCard title="${title}"`, "value={")).toContain(
        `tooltip={${deviceRef(key)}}`,
      );
    },
  );

  test("every fleet card has a tooltip", () => {
    expect(countTag(code, "InfoCard")).toBe(4);
    expect(count(code, `tooltip={${DEVICE_RECORD}.`)).toBe(4);
  });

  test("the vendor card's title carries the (i) for its bars", () => {
    expect(code).toContain(INFO_TOOLTIP_IMPORT);
    expect(code).toContain(
      'const FLEET_BY_VENDOR_TITLE: string = "Fleet by vendor";',
    );
    expect(code).toContain(
      `<InfoTooltip label={FLEET_BY_VENDOR_TITLE} text={${deviceRef("fleetByVendor")}} />`,
    );
  });

  test("no (i) sits inside a row's AppLink", () => {
    for (const link of code.split("<AppLink").slice(1)) {
      expect(link.slice(0, link.indexOf("</AppLink>"))).not.toContain(
        "InfoTooltip",
      );
    }
  });
});

describe("the site Status Timeline tab", () => {
  const code: string = readCode("Pages/NetworkSite/View/StatusTimeline.tsx");

  test("each uptime card carries the window text", () => {
    const card: string = between(code, "<InfoCard", "value={");

    expect(card).toContain(`tooltip={${siteRef("uptimeWindow")}}`);
    expect(countTag(code, "InfoCard")).toBe(1);
  });

  test("the daily strip's heading carries the legend", () => {
    expect(code).toContain(INFO_TOOLTIP_IMPORT);
    expect(code).toContain(
      "const DAILY_UPTIME_TITLE: string = `Daily Uptime — Last ${DAILY_STRIP_DAYS} Days`;",
    );
    expect(code).toContain(
      `<InfoTooltip label={DAILY_UPTIME_TITLE} text={${siteRef("dailyUptime")}} />`,
    );
  });
});

describe("the Child Sites tab", () => {
  test("the Status column explains the rollup it shows", () => {
    const code: string = readCode("Pages/NetworkSite/View/ChildSites.tsx");

    expect(column(code, "Status")).toContain(
      `headerTooltip: ${siteRef("childSiteStatus")}`,
    );
    expect(count(code, "headerTooltip:")).toBe(1);
  });
});

describe("every description in the two records is wired to exactly the surfaces above", () => {
  const SOURCES: Array<string> = [
    "Components/NetworkDevice/DeviceStatusHero.tsx",
    "Components/NetworkDevice/DeviceLatencyTrend.tsx",
    "Components/NetworkDevice/DeviceSummaryTiles.ts",
    "Components/NetworkDevice/DeviceInterfacesPreview.tsx",
    "Components/NetworkDevice/FlowTopTalkers.tsx",
    "Components/NetworkDevice/DeviceDiagnosticsViewModel.ts",
    "Components/NetworkDevice/TracerouteHopsTable.tsx",
    "Pages/NetworkDevice/View/Interfaces.tsx",
    "Pages/NetworkDevice/Devices.tsx",
    "Pages/NetworkDevice/Overview.tsx",
    "Components/NetworkSite/SiteStatusHero.tsx",
    "Components/NetworkSite/SiteSummaryTiles.ts",
    "Pages/NetworkSite/View/StatusTimeline.tsx",
    "Pages/NetworkSite/View/ChildSites.tsx",
  ].map((file: string): string => {
    return readCode(file);
  });

  test.each(Object.keys(NETWORK_DEVICE_METRIC_DESCRIPTIONS))(
    "NETWORK_DEVICE_METRIC_DESCRIPTIONS.%s is shown on a network page",
    (key: string) => {
      const reference: string = `${DEVICE_RECORD}.${key}`;

      expect(
        SOURCES.filter((source: string): boolean => {
          return new RegExp(`${reference.replace(/\./g, "\\.")}\\b`).test(
            source,
          );
        }).length,
      ).toBeGreaterThan(0);
    },
  );

  test.each(Object.keys(NETWORK_SITE_METRIC_DESCRIPTIONS))(
    "NETWORK_SITE_METRIC_DESCRIPTIONS.%s is shown on a network page",
    (key: string) => {
      const reference: string = `${SITE_RECORD}.${key}`;

      expect(
        SOURCES.filter((source: string): boolean => {
          return new RegExp(`${reference.replace(/\./g, "\\.")}\\b`).test(
            source,
          );
        }).length,
      ).toBeGreaterThan(0);
    },
  );
});
