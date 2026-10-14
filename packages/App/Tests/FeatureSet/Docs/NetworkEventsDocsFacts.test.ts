/*
 * The set-up steps' module builds its docs link from the dashboard's
 * DOCS_URL, which reads the browser's window; the node environment has
 * none, so it is given here.
 */
jest.mock("Common/UI/Config", () => {
  const { default: URLType } = jest.requireActual("Common/Types/API/URL") as {
    default: { fromString: (url: string) => unknown };
  };

  return {
    __esModule: true,
    DOCS_URL: URLType.fromString("https://oneuptime.com/docs"),
  };
});

import { NETWORK_EVENT_ALERT_TEMPLATE_COPY } from "../../../FeatureSet/Dashboard/src/Components/NetworkEvents/NetworkEventAlertTemplateCopy";
import {
  NETWORK_EVENT_COPY,
  NETWORK_EVENT_KIND_TITLES,
} from "../../../FeatureSet/Dashboard/src/Components/NetworkEvents/NetworkEventCopy";
import {
  NETWORK_EVENTS_DOCS_PATH,
  PROBE_ADDRESS_PLACEHOLDER,
  SyslogSetupGuide,
  getSyslogSetupGuides,
} from "../../../FeatureSet/Dashboard/src/Components/NetworkEvents/NetworkEventsSetup";
import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  DocsFence,
  DocsHeading,
  NAV_PAGES,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import { tables } from "./DocsPageShape";
import {
  CEF_SAMPLES,
  SOPHOS_SAMPLES,
  SyslogVendorSample,
} from "Common/Tests/Helpers/SyslogVendorSamples";
import NetworkEventAlertTemplates, {
  FAILED_LOGINS_ALERT_THRESHOLD,
  NETWORK_EVENT_ALERT_WINDOW_IN_SECONDS,
  NetworkEventAlertTemplate,
  NetworkEventAlertTemplateId,
} from "Common/Types/NetworkEvent/NetworkEventAlertTemplates";
import NetworkEventAttribute, {
  NETWORK_EVENT_DOMAIN,
} from "Common/Types/NetworkEvent/NetworkEventAttribute";
import NetworkEventType, {
  NETWORK_EVENT_DEFINITIONS,
  NetworkEventCategory,
  NetworkEventDefinition,
  NetworkEventKind,
  NetworkEventTypeUtil,
} from "Common/Types/NetworkEvent/NetworkEventType";
import SyslogAttribute from "Common/Types/Syslog/SyslogAttribute";
import {
  DEFAULT_SYSLOG_RATE_LIMIT_PER_MINUTE,
  DEFAULT_SYSLOG_RECEIVER_PORT,
} from "Common/Types/Syslog/SyslogReceiverDefaults";
import { markNetworkEvent } from "Common/Utils/NetworkEvent/NetworkEventLog";
import { getSnmpTrapEventAttributes } from "Common/Utils/NetworkEvent/SnmpTrapEvent";
import SyslogEventNormalizer, {
  ReadSyslogLine,
} from "Common/Utils/Syslog/SyslogEventNormalizer";
import SyslogVendorCatalog from "Common/Utils/Syslog/SyslogVendorCatalog";
import {
  SyslogEventRule,
  SyslogParserId,
  SyslogVendorParser,
} from "Common/Utils/Syslog/SyslogVendorParser";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the English Network Events page says about the product, held to the
 * code that makes it true (#4728).
 *
 * Markdown is not compiled, so nothing else notices when a parser is added
 * or learns a new kind of event, an event is added to the vocabulary or its
 * title is reworded, an alert the Events page offers changes what it counts
 * or what closes it, the receiver moves port or the rule for a device's
 * clock changes. Each test reads the source of truth - the parser catalog
 * and the event vocabulary in Common, the Dashboard's own words for them,
 * the set-up steps the Events page shows, the probe's and the ingest's
 * sources (read as text: neither is loaded here) - and checks the page
 * still says what they do. The translations are held to this English page
 * by NetworkEventsDocsTranslations.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");

function readSource(relative: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relative), "utf8");
}

const PAGE_NAME: string = "monitor/network-events";
const TRAFFIC_PAGE_NAME: string = "monitor/network-traffic";
const PAGE: string = readPage("en", PAGE_NAME);

const PROBE_CONFIG: string = readSource("Probe/Config.ts");
const SYSLOG_RECEIVER: string = readSource("Probe/Services/SyslogReceiver.ts");
const PROBE_INGEST: string = readSource(
  "App/FeatureSet/Telemetry/Services/ProbeSyslogIngestService.ts",
);
const DEVICE_MATCHER: string = readSource(
  "Common/Server/Utils/Syslog/SyslogDeviceMatcher.ts",
);

// The page's tables, in the order it has them.
const ALL_TABLES: Array<Array<Array<string>>> = tables(PAGE);

enum PageTable {
  Vendors = 0,
  Events = 1,
  Attributes = 2,
  Settings = 3,
  Alerts = 4,
}

// A table's body rows.
function rowsOf(table: PageTable): Array<Array<string>> {
  return (ALL_TABLES[table] as Array<Array<string>>).slice(1);
}

function headerOf(table: PageTable): Array<string> {
  return (ALL_TABLES[table] as Array<Array<string>>)[0] as Array<string>;
}

function code(text: string): string {
  return `\`${text}\``;
}

// What the page calls each kind of event a parser reads, in its order.
const CATEGORY_WORDS: Record<NetworkEventCategory, string> = {
  [NetworkEventCategory.Interface]: "Interfaces",
  [NetworkEventCategory.Device]: "Devices",
  [NetworkEventCategory.HighAvailability]: "High availability",
  [NetworkEventCategory.Vpn]: "VPN",
  [NetworkEventCategory.Routing]: "Routing",
  [NetworkEventCategory.Wan]: "WAN",
  [NetworkEventCategory.Hardware]: "Hardware",
  [NetworkEventCategory.Switching]: "Switching",
  [NetworkEventCategory.Security]: "Sign-ins",
  [NetworkEventCategory.Wireless]: "Wi-Fi",
};

// What the Alerts table calls the thing an alert is raised once per.
const GROUP_WORDS: Record<string, string> = {
  [NetworkEventAttribute.Device]: "device",
  [NetworkEventAttribute.VpnTunnelName]: "tunnel",
  [NetworkEventAttribute.GatewayName]: "gateway",
  [NetworkEventAttribute.PeerAddress]: "neighbor",
  [NetworkEventAttribute.HardwareName]: "component",
  [NetworkEventAttribute.InterfaceName]: "interface",
};

// The categories of the events a parser's rules name, in the vocabulary's order.
function categoriesOf(parser: SyslogVendorParser): Array<NetworkEventCategory> {
  const read: Set<NetworkEventCategory> = new Set();

  for (const rule of parser.rules as Array<SyslogEventRule>) {
    const definition: NetworkEventDefinition | null = NetworkEventTypeUtil.get(
      rule.event,
    );

    expect(definition).not.toBeNull();
    read.add((definition as NetworkEventDefinition).category);
  }

  return Object.values(NetworkEventCategory).filter(
    (category: NetworkEventCategory): boolean => {
      return read.has(category);
    },
  );
}

// Where the page says a parser's own fields are stored.
function fieldsCellOf(parser: SyslogVendorParser): string {
  if (parser.attributePrefix) {
    return code(`${parser.attributePrefix}.*`);
  }

  // A CEF-only product's fields are the CEF message's.
  return parser.format === "CEF" ? code("cef.*") : "-";
}

function vendorRowOf(parser: SyslogVendorParser): Array<string> {
  return [
    parser.vendor || "Any",
    parser.product,
    categoriesOf(parser)
      .map((category: NetworkEventCategory): string => {
        return CATEGORY_WORDS[category];
      })
      .join(", "),
    fieldsCellOf(parser),
  ];
}

function byText(left: Array<string>, right: Array<string>): number {
  return left.join("|").localeCompare(right.join("|"));
}

// The section under a heading of the page: its lines up to the next heading of its level.
function sectionOf(heading: string): string {
  const lines: Array<string> = PAGE.split("\n");
  const start: number = lines.indexOf(heading);

  expect({ heading, found: start >= 0 }).toEqual({ heading, found: true });

  const level: number = heading.indexOf(" ");
  let end: number = lines.length;
  let inFence: boolean = false;

  for (let index: number = start + 1; index < lines.length; index++) {
    const line: string = lines[index] as string;

    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }

    if (inFence || !line.startsWith("#")) {
      continue;
    }

    if (line.indexOf(" ") <= level) {
      end = index;
      break;
    }
  }

  return lines.slice(start, end).join("\n");
}

// A product of whole numbers, as the sources write a duration: "5 * 60 * 1000".
function productOf(expression: string): number {
  return expression
    .split("*")
    .map((factor: string): number => {
      return Number(factor.trim());
    })
    .reduce((total: number, factor: number): number => {
      return total * factor;
    }, 1);
}

const NUMBER_CONSTANT: RegExp = /export const ([A-Z_]+): number = ([0-9* ]+);/g;

// The numeric constants a source exports, by name.
function numberConstants(source: string): Record<string, number> {
  const constants: Record<string, number> = {};

  for (const match of Array.from(source.matchAll(NUMBER_CONSTANT))) {
    constants[match[1] as string] = productOf(match[2] as string);
  }

  return constants;
}

const FLUSH_INTERVAL: RegExp = /const FLUSH_INTERVAL_MS: number = (\d+);/;
const SYSLOG_ENV_READ: RegExp = /process\.env\["(PROBE_SYSLOG_[A-Z_]+)"\]/g;
// The TCP listener is given the receiver's port, as the UDP socket is.
const TCP_LISTENS_ON_THE_PORT: RegExp =
  /server\.listen\(\{\s*port: PROBE_SYSLOG_RECEIVER_PORT,/;

const MINUTE_IN_MS: number = 60 * 1000;
const DAY_IN_MS: number = 24 * 60 * MINUTE_IN_MS;

// The standard traps (RFC 3418, RFC 2863), by the names the page gives them.
const STANDARD_TRAPS: Record<string, string> = {
  coldStart: "1.3.6.1.6.3.1.1.5.1",
  warmStart: "1.3.6.1.6.3.1.1.5.2",
  linkDown: "1.3.6.1.6.3.1.1.5.3",
  linkUp: "1.3.6.1.6.3.1.1.5.4",
};

function eventOfTrap(name: string): string | undefined {
  return getSnmpTrapEventAttributes({
    trapOid: STANDARD_TRAPS[name] as string,
    varbinds: [],
  })[NetworkEventAttribute.Name];
}

function titleOf(event: string): string {
  return NETWORK_EVENT_COPY[event as NetworkEventType].title;
}

describe("the Network Events page: where it is", () => {
  it("is in the docs menu right after Network Traffic, under the title its first line has", () => {
    const links: Array<NavLink> = DocsNav.flatMap(
      (group: NavGroup): Array<NavLink> => {
        return group.links;
      },
    );
    const link: NavLink | undefined = links.find(
      (candidate: NavLink): boolean => {
        return candidate.url === `/docs/${PAGE_NAME}`;
      },
    );

    expect(link).toBeDefined();
    expect(PAGE.split("\n")[0]).toBe(`# ${(link as NavLink).title}`);
    expect(NAV_PAGES.indexOf(PAGE_NAME)).toBe(
      NAV_PAGES.indexOf(TRAFFIC_PAGE_NAME) + 1,
    );
  });

  it("is the page the Events pages' set-up card links to", () => {
    expect(`/docs${NETWORK_EVENTS_DOCS_PATH}`).toBe(`/docs/${PAGE_NAME}`);
  });

  it("has the five tables these tests read, under the headers they expect", () => {
    expect(ALL_TABLES).toHaveLength(5);
    expect(headerOf(PageTable.Vendors)).toEqual([
      "Vendor",
      "Products",
      "Events it reads",
      "Attributes",
    ]);
    expect(headerOf(PageTable.Events)).toEqual([
      "Event",
      code(NetworkEventAttribute.Name),
      "Kind",
      "About",
    ]);
    expect(headerOf(PageTable.Attributes)).toEqual([
      "Attribute",
      "What it holds",
    ]);
    expect(headerOf(PageTable.Settings)).toEqual([
      "Variable",
      "What it does",
      "Default",
    ]);
    expect(headerOf(PageTable.Alerts)).toEqual([
      "Alert",
      "Tells you when",
      "One alert per",
      "Closes when",
    ]);
  });
});

describe("the Network Events page: what OneUptime reads", () => {
  const parsers: Array<SyslogVendorParser> = [
    ...SyslogVendorCatalog.getParsers(),
  ];

  it("has a word for every kind of event a parser can read", () => {
    expect(Object.keys(CATEGORY_WORDS).sort()).toEqual(
      (Object.values(NetworkEventCategory) as Array<string>).sort(),
    );
  });

  it("lists every parser of the catalog, and nothing else: its maker, its products, the kinds of event it reads and where its fields go", () => {
    const documented: Array<Array<string>> = rowsOf(PageTable.Vendors);

    expect(documented).toHaveLength(parsers.length);
    expect([...documented].sort(byText)).toEqual(
      parsers.map(vendorRowOf).sort(byText),
    );
  });

  it("keeps a maker's rows together, and ends on the parser no maker owns", () => {
    const makers: Array<string> = rowsOf(PageTable.Vendors).map(
      (row: Array<string>): string => {
        return row[0] as string;
      },
    );
    const once: Array<string> = makers.filter(
      (maker: string, index: number): boolean => {
        return makers[index - 1] !== maker;
      },
    );

    // Each maker starts one run of rows: no maker is split by another.
    expect(once).toEqual(Array.from(new Set(makers)));
    expect([...once].sort()).toEqual(
      [...SyslogVendorCatalog.getVendors(), "Any"].sort(),
    );
    expect(makers[makers.length - 1]).toBe("Any");
  });

  it("reads the Sophos example as it says: the message's own field under the sophos prefix", () => {
    const sample: SyslogVendorSample | undefined = SOPHOS_SAMPLES.find(
      (candidate: SyslogVendorSample): boolean => {
        return candidate.line.includes('con_name="HQ-Branch1"');
      },
    );

    expect(sample).toBeDefined();

    const read: ReadSyslogLine | null = SyslogEventNormalizer.readLine(
      (sample as SyslogVendorSample).line,
    );

    expect(read?.normalized.parserId).toBe(SyslogParserId.SophosFirewall);
    expect(read?.normalized.attributes["sophos.con_name"]).toBe("HQ-Branch1");
    expect(PAGE).toContain(
      'so `con_name="HQ-Branch1"` on a Sophos firewall is the attribute `sophos.con_name`.',
    );
  });

  it("stores a CEF message of a product with no parser under cef.*", () => {
    const sample: SyslogVendorSample | undefined = CEF_SAMPLES.find(
      (candidate: SyslogVendorSample): boolean => {
        return candidate.expect.parserId === SyslogParserId.Cef;
      },
    );

    expect(sample).toBeDefined();

    const read: ReadSyslogLine | null = SyslogEventNormalizer.readLine(
      (sample as SyslogVendorSample).line,
    );
    const stored: Array<string> = Object.keys(
      read?.normalized.attributes || {},
    ).filter((key: string): boolean => {
      return !key.startsWith("syslog.");
    });

    expect(read?.normalized.parserId).toBe(SyslogParserId.Cef);
    expect(stored.length).toBeGreaterThan(0);

    for (const key of stored) {
      expect({ key, underCef: key.startsWith("cef.") }).toEqual({
        key,
        underCef: true,
      });
    }

    expect(PAGE).toContain(
      "A CEF message from any other product has its header and extension fields stored under `cef.*`.",
    );
  });

  it("reads the four standard traps into the events it names", () => {
    expect(eventOfTrap("linkDown")).toBe(NetworkEventType.InterfaceDown);
    expect(eventOfTrap("linkUp")).toBe(NetworkEventType.InterfaceUp);
    expect(eventOfTrap("coldStart")).toBe(NetworkEventType.DeviceReboot);
    expect(eventOfTrap("warmStart")).toBe(NetworkEventType.DeviceReboot);
    expect(PAGE).toContain(
      `\`linkDown\` and \`linkUp\` become **${titleOf(NetworkEventType.InterfaceDown)}** and **${titleOf(NetworkEventType.InterfaceUp)}**, \`coldStart\` and \`warmStart\` become **${titleOf(NetworkEventType.DeviceReboot)}**.`,
    );
    expect(PAGE).toContain(
      "**Events from SNMP traps other than the four standard ones.**",
    );
    expect(Object.keys(STANDARD_TRAPS)).toHaveLength(4);
  });
});

describe("the Network Events page: the events", () => {
  it("lists every event of the vocabulary, in its order: the Dashboard's title, the name, the kind and what it is about", () => {
    expect(rowsOf(PageTable.Events)).toEqual(
      NETWORK_EVENT_DEFINITIONS.map(
        (definition: NetworkEventDefinition): Array<string> => {
          return [
            NETWORK_EVENT_COPY[definition.type].title,
            code(definition.type),
            NETWORK_EVENT_KIND_TITLES[definition.kind],
            definition.subjectAttribute
              ? code(definition.subjectAttribute)
              : "-",
          ];
        },
      ),
    );
  });

  it("names the attributes every event carries, with the values the code writes", () => {
    const rows: Array<Array<string>> = rowsOf(PageTable.Attributes);
    const kinds: Array<string> = Object.values(NetworkEventKind).map(code);
    const categories: Array<string> =
      Object.values(NetworkEventCategory).map(code);

    expect(
      rows.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual([
      code(NetworkEventAttribute.Domain),
      code(NetworkEventAttribute.Kind),
      code(NetworkEventAttribute.Category),
      code(NetworkEventAttribute.Device),
      code(NetworkEventAttribute.Message),
      `${code(SyslogAttribute.Vendor)}, ${code(SyslogAttribute.Parser)}`,
    ]);
    expect(rows[0]?.[1]).toBe(
      `${code(NETWORK_EVENT_DOMAIN)}, on every network event`,
    );
    expect(rows[1]?.[1]).toBe(
      `${kinds.slice(0, -1).join(", ")} or ${kinds[kinds.length - 1]}`,
    );
    expect(rows[2]?.[1]).toBe(
      `${categories.slice(0, -1).join(", ")} or ${categories[categories.length - 1]}, on the events above`,
    );
  });

  it("gives a project's own event a kind when it names none, and no category", () => {
    const attributes: Record<string, unknown> = {
      [NetworkEventAttribute.Name]: "ups.on_battery",
    };

    expect(markNetworkEvent(attributes, { device: "rack-ups" })).toBe(true);
    expect(attributes[NetworkEventAttribute.Domain]).toBe(NETWORK_EVENT_DOMAIN);
    expect(attributes[NetworkEventAttribute.Kind]).toBe(NetworkEventKind.Info);
    expect(attributes[NetworkEventAttribute.Device]).toBe("rack-ups");
    expect(attributes).not.toHaveProperty([NetworkEventAttribute.Category]);
    expect(PAGE).toContain(
      `Unless your pipeline sets \`${NetworkEventAttribute.Kind}\` to \`${NetworkEventKind.Problem}\` or \`${NetworkEventKind.Recovery}\`, the event is listed under **${NETWORK_EVENT_KIND_TITLES[NetworkEventKind.Info]}**.`,
    );
  });

  it("keeps the kind a project's pipeline gives its own event", () => {
    const attributes: Record<string, unknown> = {
      [NetworkEventAttribute.Name]: "ups.on_battery",
      [NetworkEventAttribute.Kind]: NetworkEventKind.Problem,
    };

    markNetworkEvent(attributes, { device: "rack-ups" });

    expect(attributes[NetworkEventAttribute.Kind]).toBe(
      NetworkEventKind.Problem,
    );
  });

  it("makes the built-in event of a rule named after one, as its example says", () => {
    const attributes: Record<string, unknown> = {
      [NetworkEventAttribute.Name]: NetworkEventType.InterfaceDown,
    };

    markNetworkEvent(attributes, { device: "core-switch" });

    expect(attributes[NetworkEventAttribute.Kind]).toBe(
      NetworkEventKind.Problem,
    );
    expect(attributes[NetworkEventAttribute.Category]).toBe(
      NetworkEventCategory.Interface,
    );
    expect(PAGE).toContain(
      `A rule named after a built-in event, such as \`${NetworkEventType.InterfaceDown}\`, makes the built-in event, with its kind and its alerts.`,
    );
  });

  it("names its own events the way the vocabulary accepts a name", () => {
    expect(NetworkEventTypeUtil.isValidName("ups.on_battery")).toBe(true);
    expect(NetworkEventTypeUtil.isValidName("UPS On Battery")).toBe(false);
    expect(NetworkEventTypeUtil.isBuiltIn("ups.on_battery")).toBe(false);
    expect(PAGE).toContain(
      "Name each like the events above, in lowercase with dots or underscores: `ups.on_battery`.",
    );
    // What it is about goes in an attribute of the events table.
    expect(
      rowsOf(PageTable.Events).some((row: Array<string>): boolean => {
        return row[3] === code(NetworkEventAttribute.HardwareName);
      }),
    ).toBe(true);
    expect(PAGE).toContain(
      `one of the attributes in the events table, such as \`${NetworkEventAttribute.HardwareName}\`.`,
    );
  });
});

describe("the Network Events page: how events get here", () => {
  it("names the port the probe listens on, over UDP and over TCP", () => {
    expect(PROBE_CONFIG).toContain(
      "defaultValue: DEFAULT_SYSLOG_RECEIVER_PORT,",
    );
    expect(SYSLOG_RECEIVER).toContain(
      "socket.bind(PROBE_SYSLOG_RECEIVER_PORT);",
    );
    expect(SYSLOG_RECEIVER).toMatch(TCP_LISTENS_ON_THE_PORT);
    expect(PAGE).toContain(
      `Every probe listens for syslog on port ${DEFAULT_SYSLOG_RECEIVER_PORT}, over UDP and over TCP.`,
    );
  });

  it("forwards what it hears every few seconds", () => {
    const interval: RegExpMatchArray | null =
      SYSLOG_RECEIVER.match(FLUSH_INTERVAL);

    expect(interval).not.toBeNull();

    const seconds: number = Number((interval as RegExpMatchArray)[1]) / 1000;

    // "Every few seconds": more than one, well under a minute.
    expect(seconds).toBeGreaterThan(1);
    expect(seconds).toBeLessThanOrEqual(10);
    expect(PAGE).toContain(
      "The probe forwards what it hears to OneUptime every few seconds",
    );
  });

  it("gives the rule for a device's clock with the ingest's own limits", () => {
    const limits: Record<string, number> = numberConstants(PROBE_INGEST);
    const skewInMinutes: number =
      (limits["MAX_DEVICE_CLOCK_SKEW_IN_MS"] as number) / MINUTE_IN_MS;
    const ageInDays: number =
      (limits["MAX_BUFFERED_MESSAGE_AGE_IN_MS"] as number) / DAY_IN_MS;

    expect(Number.isInteger(skewInMinutes)).toBe(true);
    expect(Number.isInteger(ageInDays)).toBe(true);
    expect(PAGE).toContain(
      `and is more than ${skewInMinutes} minutes old - keeps the device's time, up to ${ageInDays} days back. Any other timestamp more than ${skewInMinutes} minutes away from the probe's clock is not believed: the log is stored at the time it was received, and the device's time is kept in \`${SyslogAttribute.DeviceTime}\`.`,
    );
  });

  it("names the attribute that keeps the controller a message came through", () => {
    expect(PAGE).toContain(
      `the log keeps the name of the controller that passed it on in \`${SyslogAttribute.RelayName}\`.`,
    );
  });

  it("says a newly added address takes effect from the next minute, the matcher's memory", () => {
    const limits: Record<string, number> = numberConstants(DEVICE_MATCHER);

    expect(limits["CACHE_TTL_MS"]).toBe(MINUTE_IN_MS);
    expect(PAGE).toContain(
      "Its messages go to that device from the next minute on.",
    );
  });
});

describe("the Network Events page: setting it up", () => {
  const guides: Array<SyslogSetupGuide> = getSyslogSetupGuides();
  const setup: string = sectionOf("## Setting it up");

  it("lists the receiver's settings, all of them, with the probe's defaults", () => {
    const read: Array<string> = Array.from(
      new Set(
        Array.from(PROBE_CONFIG.matchAll(SYSLOG_ENV_READ)).map(
          (match: RegExpMatchArray): string => {
            return match[1] as string;
          },
        ),
      ),
    );

    expect(PROBE_CONFIG).toContain(
      'process.env["PROBE_SYSLOG_RECEIVER_ENABLED"] !== "false"',
    );
    expect(PROBE_CONFIG).toContain(
      "defaultValue: DEFAULT_SYSLOG_RATE_LIMIT_PER_MINUTE,",
    );
    expect(rowsOf(PageTable.Settings)).toEqual([
      [
        code("PROBE_SYSLOG_RECEIVER_ENABLED"),
        "Set to `false` to turn the syslog receiver off",
        code("true"),
      ],
      [
        code("PROBE_SYSLOG_RECEIVER_PORT"),
        "The port, for UDP and TCP",
        code(String(DEFAULT_SYSLOG_RECEIVER_PORT)),
      ],
      [
        code("PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE"),
        "Messages forwarded per minute, across every device",
        code(String(DEFAULT_SYSLOG_RATE_LIMIT_PER_MINUTE)),
      ],
    ]);
    expect([...read].sort()).toEqual(
      rowsOf(PageTable.Settings)
        .map((row: Array<string>): string => {
          return (row[0] as string).split("`").join("");
        })
        .sort(),
    );
    expect(setup).toContain("The syslog receiver is on by default.");
  });

  it("publishes the probe's port in its Docker examples", () => {
    const port: number = DEFAULT_SYSLOG_RECEIVER_PORT;

    expect(setup).toContain(`Allow port ${port}, UDP or TCP,`);
    expect(setup).toContain(
      `publish the port with \`-p ${port}:${port}/udp -p ${port}:${port}/tcp\``,
    );
    expect(setup).toContain(`publish it as \`-p 514:${port}/udp\``);
    expect(setup).toContain("set `PROBE_SYSLOG_RECEIVER_PORT=514`");
  });

  it("has a section for every device the Events page's set-up card has a tab for, in its order", () => {
    const sections: Array<string> = scanMarkdown(setup)
      .headings.filter((heading: DocsHeading): boolean => {
        return heading.level === 3;
      })
      .map((heading: DocsHeading): string => {
        return heading.text;
      });

    expect(sections).toHaveLength(guides.length);

    guides.forEach((guide: SyslogSetupGuide, index: number): void => {
      // The card's tab is a short name; the section's heading says it in full.
      const lastWord: string = guide.name.split(" ").pop() as string;

      expect({
        guide: guide.name,
        section: sections[index],
        named: (sections[index] as string).includes(lastWord),
      }).toEqual({ guide: guide.name, section: sections[index], named: true });
    });
  });

  it("gives each device the lines the set-up card gives it to paste, word for word", () => {
    const pasted: Array<string> = scanMarkdown(setup).fences.map(
      (fence: DocsFence): string => {
        expect(fence.lang).toBe("text");

        return fence.code;
      },
    );
    const configurations: Array<string> = guides
      .map((guide: SyslogSetupGuide): string | null => {
        return guide.configuration;
      })
      .filter((configuration: string | null): configuration is string => {
        return configuration !== null;
      });

    expect(pasted).toEqual(configurations);

    for (const configuration of configurations) {
      expect(configuration).toContain(PROBE_ADDRESS_PLACEHOLDER);
      expect(configuration).toContain(String(DEFAULT_SYSLOG_RECEIVER_PORT));
    }
  });

  it("names the probe's port in the steps of the devices set up in a web interface", () => {
    for (const heading of [
      "### Sophos Firewall",
      "### Ubiquiti UniFi",
      "### Cambium Networks",
    ]) {
      expect(sectionOf(heading)).toContain(
        `port \`${DEFAULT_SYSLOG_RECEIVER_PORT}\``,
      );
    }

    expect(sectionOf("### Other devices")).toContain(
      `port ${DEFAULT_SYSLOG_RECEIVER_PORT}, over UDP or TCP`,
    );
  });

  it("says what the probe keeps past its limit, as the receiver does", () => {
    expect(setup).toContain(
      "Past the limit, the probe still forwards the messages it reads as network events, up to as many again",
    );
    expect(SYSLOG_RECEIVER).toContain(
      "SyslogReceiver.eventsKeptPastLimitThisMinute++;",
    );
  });
});

describe("the Network Events page: alerts", () => {
  const featured: Array<NetworkEventAlertTemplate> = [
    ...NetworkEventAlertTemplates.getFeatured(),
  ];
  const rows: Array<Array<string>> = rowsOf(PageTable.Alerts);
  const windowInMinutes: number = NETWORK_EVENT_ALERT_WINDOW_IN_SECONDS / 60;

  function rowOf(id: NetworkEventAlertTemplateId): Array<string> {
    const index: number = featured.findIndex(
      (template: NetworkEventAlertTemplate): boolean => {
        return template.id === id;
      },
    );

    expect(index).toBeGreaterThan(-1);

    return rows[index] as Array<string>;
  }

  it("lists the alerts the Events page offers, in its order, under the titles it gives them", () => {
    expect(
      rows.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual(
      featured.map((template: NetworkEventAlertTemplate): string => {
        return NETWORK_EVENT_ALERT_TEMPLATE_COPY[
          template.id as NetworkEventAlertTemplateId
        ].title;
      }),
    );
  });

  it("says what each one counts: its event, or every hardware problem", () => {
    featured.forEach(
      (template: NetworkEventAlertTemplate, index: number): void => {
        const tellsYouWhen: string = (
          rows[index] as Array<string>
        )[1] as string;

        if (template.event) {
          expect(tellsYouWhen).toContain(code(template.event));
        } else {
          expect(template.attributes[NetworkEventAttribute.Category]).toBe(
            NetworkEventCategory.Hardware,
          );
          expect(tellsYouWhen).toBe("a fan, a power supply or the temperature");
        }
      },
    );
  });

  it("says what each one is raised once per: the device, and what the event is about", () => {
    featured.forEach(
      (template: NetworkEventAlertTemplate, index: number): void => {
        const words: Array<string> = template.groupByAttributes.map(
          (attribute: string): string => {
            expect(GROUP_WORDS[attribute]).toBeDefined();

            return GROUP_WORDS[attribute] as string;
          },
        );

        expect({
          alert: template.id,
          oneAlertPer: (rows[index] as Array<string>)[2],
        }).toEqual({ alert: template.id, oneAlertPer: words.join(" and ") });
      },
    );
  });

  it("says what closes each one: the event that clears it, or a quiet window", () => {
    featured.forEach(
      (template: NetworkEventAlertTemplate, index: number): void => {
        const closesWhen: string = (rows[index] as Array<string>)[3] as string;
        const clearedBy: string | undefined =
          template.resolvedByAttributes[NetworkEventAttribute.Name];

        if (clearedBy) {
          expect(closesWhen.startsWith(code(clearedBy))).toBe(true);
        } else if (Object.keys(template.resolvedByAttributes).length > 0) {
          // The hardware alert: any recovery of the same component.
          expect(
            template.resolvedByAttributes[NetworkEventAttribute.Kind],
          ).toBe(NetworkEventKind.Recovery);
          expect(closesWhen).toBe(
            "the same component is reported working again",
          );
        } else {
          expect(closesWhen).toContain(`${windowInMinutes} minutes pass`);
        }
      },
    );
  });

  it("gives the failed sign-ins alert its threshold and its window", () => {
    const row: Array<string> = rowOf(NetworkEventAlertTemplateId.FailedLogins);

    expect(
      NetworkEventAlertTemplates.get(NetworkEventAlertTemplateId.FailedLogins)
        ?.moreThan,
    ).toBe(FAILED_LOGINS_ALERT_THRESHOLD);
    expect(row[1]).toBe(
      `more than ${FAILED_LOGINS_ALERT_THRESHOLD} ${code(NetworkEventType.AuthLoginFailed)} in ${windowInMinutes} minutes`,
    );
    expect(row[3]).toBe(
      `${windowInMinutes} minutes pass with ${FAILED_LOGINS_ALERT_THRESHOLD} or fewer`,
    );
  });

  it("counts every alert over the window it names", () => {
    for (const template of featured) {
      expect(template.windowInSeconds).toBe(
        NETWORK_EVENT_ALERT_WINDOW_IN_SECONDS,
      );
    }

    expect(Number.isInteger(windowInMinutes)).toBe(true);
    expect(PAGE).toContain(
      `that counts the event over the last ${windowInMinutes} minutes`,
    );
  });

  it("says a temperature alert has no event to close it", () => {
    expect(
      NetworkEventTypeUtil.get(NetworkEventType.HardwareTemperatureHigh)
        ?.clearedBy,
    ).toBeUndefined();
    expect(
      NetworkEventTypeUtil.getByKind(NetworkEventKind.Recovery).some(
        (definition: NetworkEventDefinition): boolean => {
          return definition.type.includes("temperature");
        },
      ),
    ).toBe(false);
    expect(PAGE).toContain(
      "OneUptime reads no event that says a temperature is back to normal, so a temperature alert stays open until you resolve it.",
    );
  });

  it("watches one device only when made from a device's Events tab", () => {
    const template: NetworkEventAlertTemplate = NetworkEventAlertTemplates.get(
      NetworkEventAlertTemplateId.VpnTunnelDown,
    ) as NetworkEventAlertTemplate;
    const scoped: NetworkEventAlertTemplate =
      NetworkEventAlertTemplates.forDevice(template, "device-id");

    expect(scoped.attributes["networkDevice.id"]).toBe("device-id");
    expect(scoped.resolvedByAttributes["networkDevice.id"]).toBe("device-id");
    expect(template.attributes).not.toHaveProperty(["networkDevice.id"]);
    expect(PAGE).toContain(
      "From a device's **Events** tab the monitors watch that device only.",
    );
  });

  it("makes a monitor for any other event, built-in or a project's own", () => {
    const builtIn: NetworkEventAlertTemplate | null =
      NetworkEventAlertTemplates.get(NetworkEventType.SdwanSlaNotMet);
    const own: NetworkEventAlertTemplate | null =
      NetworkEventAlertTemplates.get("ups.on_battery");

    expect(NetworkEventAlertTemplates.isFeatured(builtIn?.id)).toBe(false);
    expect(builtIn?.groupByAttributes).toEqual([
      NetworkEventAttribute.Device,
      NetworkEventAttribute.GatewayName,
    ]);
    expect(builtIn?.resolvedByAttributes[NetworkEventAttribute.Name]).toBe(
      NetworkEventType.SdwanSlaMet,
    );
    expect(own?.groupByAttributes).toEqual([NetworkEventAttribute.Device]);
    expect(own?.resolvedByAttributes).toEqual({});
    expect(PAGE).toContain(
      "For any other event, open one on the Events page and click **Create alert for this event**.",
    );
  });
});

describe("the Network Events page: troubleshooting", () => {
  const troubleshooting: string = sectionOf("## Troubleshooting");

  it("quotes what the probe logs when it starts, and when it sheds messages", () => {
    expect(SYSLOG_RECEIVER).toContain(
      "`Syslog receiver starting on ${socketType} port ${PROBE_SYSLOG_RECEIVER_PORT}`",
    );
    expect(SYSLOG_RECEIVER).toContain(
      "`Syslog receiver starting on ${family} TCP port ${PROBE_SYSLOG_RECEIVER_PORT}`",
    );
    expect(SYSLOG_RECEIVER).toContain(
      "Syslog receiver could not bind UDP port ${PROBE_SYSLOG_RECEIVER_PORT}",
    );
    expect(SYSLOG_RECEIVER).toContain(
      "Syslog receiver dropped ${SyslogReceiver.droppedThisMinute} messages in the last minute",
    );
    expect(troubleshooting).toContain(
      "At startup the probe logs the port it listens on, or that it could not open it. When it drops messages over `PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE`, it logs how many, once a minute.",
    );
  });

  it("sends a device that listens elsewhere to the probe's port, and names the port devices default to", () => {
    expect(troubleshooting).toContain(
      `Allow port ${DEFAULT_SYSLOG_RECEIVER_PORT} from the device to the probe`,
    );
    expect(troubleshooting).toContain(
      "Many devices send to port 514 unless told otherwise.",
    );
  });
});
