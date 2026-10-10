import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import CriteriaFilterUtil from "../../../FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import { CheckOn } from "Common/Types/Monitor/CriteriaFilter";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import {
  MAX_MONITOR_REQUEST_TIMEOUT_IN_MS,
  MAX_MONITOR_RETRY_COUNT,
} from "Common/Types/Monitor/MonitorStep";
import MonitorType, {
  MonitorTypeCategory,
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import NtpMonitorUtil, {
  DEFAULT_NTP_MAX_CLOCK_OFFSET_IN_MS,
  DEFAULT_NTP_PORT,
  DEFAULT_NTP_REQUEST_TIMEOUT_IN_MS,
} from "Common/Types/Monitor/NtpMonitor/NtpMonitorUtil";
import ObjectID from "Common/Types/ObjectID";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { JSONObject } from "Common/Types/JSON";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { DOCS_DIR, DOCS_LANGUAGES, readPage } from "./DocsContentSupport";

/*
 * The NTP monitor page against the product it describes (#4617).
 *
 * Markdown is not compiled, so nothing else notices when a default the page
 * quotes moves (the port, the timeout, the 1000 ms offset bound, the
 * incident title), a check is renamed, a condition is added to the criteria
 * form, or a translation names a button the dashboard does not have. Each
 * test reads the source of truth - the criteria, the form's options, the
 * dashboard's own locale files - and checks every language's page still
 * says the same thing.
 */

const PAGE: string = "monitor/ntp-monitor";
const PAGE_URL: string = `/docs/${PAGE}`;

const DASHBOARD_LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Dashboard/src/Locales",
);

const NTP_CHECK_ONS: Array<CheckOn> = [
  CheckOn.NtpIsOnline,
  CheckOn.NtpIsSynchronized,
  CheckOn.NtpStratum,
  CheckOn.NtpClockOffset,
  CheckOn.NtpResponseTime,
  CheckOn.NtpRootDispersion,
];

/*
 * The dashboard labels the page tells a reader to look for or click, by
 * their English text: each language's page has to bold the label as that
 * language's dashboard shows it.
 */
const UI_LABELS: Array<string> = [
  "Monitors",
  "Create Monitor",
  "Monitor Type",
  "More monitor types",
  "Name",
  "Next",
  "NTP Server",
  "Port",
  "More fields",
  "Request Timeout (seconds)",
  "Retries on Failure",
  "Test Monitor",
  "Select Probe",
  "Run Test",
  "Monitor Test Result",
  "Monitor Criteria",
  "Probes",
  "Monitoring Interval",
  "Every 5 Minutes",
  "Operational",
  "Offline",
  "Match Condition",
  "All",
  "Any",
  "Actions",
  "Evaluate this criteria over a period of time",
  "Evaluate",
  "For the last (in minutes)",
  "If No Data",
  "Average",
  "Synchronized",
  "Clock Offset",
  "Stratum",
  "Reference",
  "Leap Indicator",
  "Root Dispersion",
  "Root Delay",
  "Response Time",
  "Server Time",
  "Network Path at Time of Failure",
  "True",
  "False",
];

const localeCache: Map<string, JSONObject> = new Map();

function dashboardLocale(lang: string): JSONObject {
  const cached: JSONObject | undefined = localeCache.get(lang);

  if (cached) {
    return cached;
  }

  const locale: JSONObject = JSON.parse(
    fs.readFileSync(path.join(DASHBOARD_LOCALES_DIR, `${lang}.json`), "utf8"),
  ) as JSONObject;

  localeCache.set(lang, locale);
  return locale;
}

// The label as the dashboard shows it in `lang`.
function uiLabel(lang: string, english: string): string {
  const value: unknown = dashboardLocale(lang)[english];

  return typeof value === "string" && value ? value : english;
}

/* The body of one heading's section, up to the next heading of the same or a higher level. */
function section(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return line.trim() === heading;
  });

  expect(start).toBeGreaterThanOrEqual(0);

  const level: number = (heading.match(/^#+/) as RegExpMatchArray)[0].length;
  const body: Array<string> = [];

  for (const line of lines.slice(start + 1)) {
    const match: RegExpMatchArray | null = line.match(/^(#{1,6})\s/);

    if (match && (match[1] as string).length <= level) {
      break;
    }

    body.push(line);
  }

  return body.join("\n");
}

// A table's body rows, as arrays of trimmed cells.
function tableRows(markdown: string): Array<Array<string>> {
  return markdown
    .split("\n")
    .filter((line: string): boolean => {
      return line.trim().startsWith("|");
    })
    .slice(2)
    .map((line: string): Array<string> => {
      return line
        .trim()
        .slice(1, -1)
        .split("|")
        .map((cell: string): string => {
          return cell.trim();
        });
    });
}

// "**A**, **B**" -> ["A", "B"]
function boldItems(cell: string): Array<string> {
  return Array.from(cell.matchAll(/\*\*([^*]+)\*\*/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

function defaultCriteria(): Array<MonitorCriteriaInstance> {
  return (
    MonitorCriteria.getDefaultMonitorCriteria({
      monitorType: MonitorType.NTP,
      monitorName: "Acme",
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
    }).data?.monitorCriteriaInstanceArray || []
  );
}

describe("the NTP monitor page is reachable", () => {
  test("the nav links it right after the DNSSEC monitor", () => {
    const links: Array<NavLink> = DocsNav.flatMap((group: NavGroup) => {
      return group.links;
    });

    const index: number = links.findIndex((link: NavLink) => {
      return link.url === PAGE_URL;
    });

    expect(index).toBeGreaterThan(0);
    expect(links[index]!.title).toBe("NTP Monitor");
    expect(links[index - 1]!.url).toBe("/docs/monitor/dnssec-monitor");
  });

  test.each(DOCS_LANGUAGES)("the %s docs name the nav link", (lang: string) => {
    const locale: JSONObject = JSON.parse(
      fs.readFileSync(path.join(DOCS_DIR, "Locales", `${lang}.json`), "utf8"),
    ) as JSONObject;
    const title: unknown = (locale["navLinks"] as JSONObject)["NTP Monitor"];

    expect(typeof title).toBe("string");
    expect((title as string).length).toBeGreaterThan(0);
    expect(title as string).toContain("NTP");
  });

  test("the create monitor page lists NTP among the probe checks", () => {
    expect(
      section(readPage("en", "monitor/create-monitor"), "## Probes & Interval"),
    ).toContain(" NTP,");
  });
});

describe("the page quotes the product's defaults", () => {
  const page: string = readPage("en", PAGE);

  test("the configuration table: server, port 123, a 5-second timeout and the probe's retries", () => {
    const rows: Array<Array<string>> = tableRows(
      section(page, "## Configuration options"),
    );

    expect(
      rows.map((row: Array<string>) => {
        return [row[0], row[1]];
      }),
    ).toEqual([
      ["**NTP Server**", "None"],
      ["**Port** (under **More fields**)", `\`${DEFAULT_NTP_PORT}\``],
      [
        "**Request Timeout (seconds)** (under **More fields**)",
        `\`${DEFAULT_NTP_REQUEST_TIMEOUT_IN_MS / 1000}\``,
      ],
      [
        "**Retries on Failure** (under **More fields**)",
        "Probe default, usually `3`",
      ],
    ]);

    expect(page).toContain(
      `The maximum is ${MAX_MONITOR_REQUEST_TIMEOUT_IN_MS / 1000} seconds.`,
    );
    expect(page).toContain(`The maximum is ${MAX_MONITOR_RETRY_COUNT}.`);
  });

  test("the default criteria section quotes the offset bound and the incident a new monitor opens", () => {
    const defaults: string = section(page, "### Default Criteria");
    const [offline] = defaultCriteria();

    expect(defaults.match(/`1000` ms/g)).toHaveLength(2);
    expect(DEFAULT_NTP_MAX_CLOCK_OFFSET_IN_MS).toBe(1000);
    expect(defaults).toContain(
      `"${offline!.data!.incidents[0]!.title.replace("Acme", "_monitor name_")}"`,
    );
  });

  test("the Monitoring Criteria table lists exactly the checks the form offers, in its order", () => {
    const rows: Array<Array<string>> = tableRows(
      section(page, "## Monitoring Criteria"),
    ).slice(0, NTP_CHECK_ONS.length);

    expect(
      rows.map((row: Array<string>) => {
        return boldItems(row[0]!)[0];
      }),
    ).toEqual(
      CriteriaFilterUtil.getCheckOnOptionsByMonitorType(MonitorType.NTP).map(
        (option: DropdownOption) => {
          return option.value.toString();
        },
      ),
    );
  });

  test.each(NTP_CHECK_ONS)(
    "the conditions listed for %s are the ones the form offers",
    (checkOn: CheckOn) => {
      const row: Array<string> | undefined = tableRows(
        section(page, "## Monitoring Criteria"),
      ).find((candidate: Array<string>) => {
        return candidate[0] === `**${checkOn}**`;
      });

      expect(row).toBeDefined();
      expect([...boldItems(row![1]!)].sort()).toEqual(
        CriteriaFilterUtil.getFilterTypeOptionsByCheckOn(checkOn)
          .map((option: DropdownOption) => {
            return option.value.toString();
          })
          .sort(),
      );
    },
  );

  test("every example criteria uses a check and a condition the form offers", () => {
    for (const row of tableRows(section(page, "### Example criteria"))) {
      const checkOn: string = boldItems(row[1]!)[0]!;
      const condition: string = boldItems(row[2]!)[0]!;

      expect(NTP_CHECK_ONS.map(String)).toContain(checkOn);
      expect(
        CriteriaFilterUtil.getFilterTypeOptionsByCheckOn(
          checkOn as CheckOn,
        ).map((option: DropdownOption) => {
          return option.value.toString();
        }),
      ).toContain(condition);
      expect(row[3]).toMatch(/^`\d+`$/);
    }
  });

  test("the kiss codes the page explains are ones the monitor knows", () => {
    for (const code of ["RATE", "DENY", "RSTR", "INIT", "STEP"]) {
      expect(page).toContain(`\`${code}\``);
      expect(NtpMonitorUtil.isKnownKissCode(code)).toBe(true);
    }
  });

  test("it is found the way the page says: by typing ntp, or under Network", () => {
    expect(page).toContain("type `ntp` into the search box and pick **NTP**");
    expect(MonitorTypeHelper.getTitle(MonitorType.NTP)).toBe("NTP");

    const network: MonitorTypeCategory | undefined =
      MonitorTypeHelper.getMonitorTypeCategories().find(
        (category: MonitorTypeCategory) => {
          return category.label === "Network";
        },
      );

    expect(network?.monitorTypes).toContain(MonitorType.NTP);
    expect(page).toContain("in the Network group");
  });
});

describe.each(DOCS_LANGUAGES)("the %s page", (lang: string) => {
  const page: string = readPage(lang, PAGE);

  test("names every check exactly as the criteria form does", () => {
    for (const checkOn of NTP_CHECK_ONS) {
      expect({ checkOn, named: page.includes(`**${checkOn}**`) }).toEqual({
        checkOn,
        named: true,
      });
    }
  });

  test("names the dashboard's buttons and fields as that language's dashboard shows them", () => {
    const missing: Array<string> = UI_LABELS.filter((english: string) => {
      return !page.includes(`**${uiLabel(lang, english)}**`);
    }).map((english: string) => {
      return `${english} -> ${uiLabel(lang, english)}`;
    });

    expect(missing).toEqual([]);
  });

  test("keeps the defaults the English page quotes", () => {
    expect(page).toContain(`\`${DEFAULT_NTP_PORT}\``);
    expect(page).toContain(`\`${DEFAULT_NTP_MAX_CLOCK_OFFSET_IN_MS}\``);
    expect(page).toContain("is not serving good time");
    expect(page).toContain("PROBE_MONITOR_RETRY_LIMIT");
  });
});

describe("the labels the pages bold exist in the dashboard", () => {
  test.each(UI_LABELS)("%s is a dashboard string", (english: string) => {
    expect(Object.keys(dashboardLocale("en"))).toContain(english);
  });
});
