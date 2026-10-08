import {
  NETWORK_HEALTH_COPY,
  NetworkHealthPlural,
  NetworkHealthVerdictKind,
} from "../../../FeatureSet/Dashboard/src/Components/Network/NetworkHealthVerdict";
import {
  ADD_DEVICE_CREATE_VERB,
  ADD_DEVICE_MORE_FIELDS,
  ADD_DEVICE_PING_MONITOR_TITLE,
  ADD_DEVICE_SINGULAR_NAME,
  ADD_DEVICE_SNMP_SECTION,
} from "../../../FeatureSet/Dashboard/src/Pages/NetworkDevice/AddDeviceForm";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Network guides tell the story the Network area now tells.
 *
 * The area was made simpler - a menu of five open rows, an Overview that
 * opens on a one-sentence verdict, Add Device on one page, a scan in two
 * steps (one for a ping sweep), Add Site in three - and the guides walked
 * the old forms: Create Network Device through three steps, Create
 * Discovery Scan, menu paths through sections that moved. Markdown is not
 * compiled, so this reads the dashboard's own sources and checks the guides,
 * in English and in Persian (which keeps the dashboard's English labels),
 * name what a reader will actually see.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const DASHBOARD: string = "App/FeatureSet/Dashboard/src";
const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const DEVICE_GUIDE: string = "monitor/network-device-monitor.md";
const SITES_GUIDE: string = "monitor/network-sites.md";

// Both guides exist in these, and both keep the dashboard's English labels.
const LANGUAGES: Array<string> = ["en", "fa"];

// The arrow each language writes a menu path with.
const MENU_ARROW: Record<string, string> = { en: "->", fa: "→" };

function readRepoFile(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

function readGuide(language: string, guide: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, language, guide), "utf8");
}

function bold(label: string): string {
  return `**${label}**`;
}

/*
 * The Network menu as its source declares it: each section's title (six
 * spaces in) followed by its items' titles (twelve spaces in).
 */
const SECTION_TITLE_LINE: RegExp = /^ {6}title: "([^"]+)",$/;
const ITEM_TITLE_LINE: RegExp = /^ {12}title: "([^"]+)",$/;

function networkMenu(): Map<string, Array<string>> {
  const source: string = readRepoFile(
    `${DASHBOARD}/Components/Network/NetworkSideMenu.tsx`,
  );
  const menu: Map<string, Array<string>> = new Map();
  let section: string | null = null;

  for (const line of source.split("\n")) {
    const sectionMatch: RegExpMatchArray | null =
      line.match(SECTION_TITLE_LINE);

    if (sectionMatch) {
      section = sectionMatch[1]!;
      menu.set(section, []);
      continue;
    }

    const itemMatch: RegExpMatchArray | null = line.match(ITEM_TITLE_LINE);

    if (itemMatch && section) {
      menu.get(section)!.push(itemMatch[1]!);
    }
  }

  return menu;
}

// "**Network** -> **Rules** -> **Auto Import Rules**", as [section, item].
function menuPathsIn(markdown: string, arrow: string): Array<[string, string]> {
  const escapedArrow: string = arrow.replace(ESCAPE_PATTERN, "\\$&");
  const pathPattern: RegExp = new RegExp(
    `\\*\\*Network\\*\\* ${escapedArrow} \\*\\*([^*]+)\\*\\* ${escapedArrow} \\*\\*([^*]+)\\*\\*`,
    "g",
  );
  const paths: Array<[string, string]> = [];

  for (const match of markdown.matchAll(pathPattern)) {
    paths.push([match[1]!, match[2]!]);
  }

  return paths;
}

const ESCAPE_PATTERN: RegExp = /[.*+?^${}()|[\]\\]/g;

// "{{count}} devices are down" as a pattern any count satisfies.
function headlinePattern(form: string): RegExp {
  return new RegExp(
    `^${form.replace(ESCAPE_PATTERN, "\\$&").replace("\\{\\{count\\}\\}", "\\d+")}$`,
  );
}

const OVERVIEW_TABLE_ROW: RegExp = /^\| \*\*([^*]+)\*\* \|/gm;

// The verdicts a guide's Overview table quotes, in order.
function documentedVerdicts(markdown: string, heading: string): Array<string> {
  const start: number = markdown.indexOf(heading);

  expect(start).toBeGreaterThan(-1);

  const end: number = markdown.indexOf("\n## ", start + heading.length);
  const section: string = markdown.slice(start, end === -1 ? undefined : end);

  return Array.from(section.matchAll(OVERVIEW_TABLE_ROW)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

function verdictKindOf(sentence: string): NetworkHealthVerdictKind | null {
  for (const kind of Object.values(NetworkHealthVerdictKind)) {
    const headline: NetworkHealthPlural = NETWORK_HEALTH_COPY[kind].headline;

    if (
      headlinePattern(headline.one).test(sentence) ||
      headlinePattern(headline.other).test(sentence)
    ) {
      return kind;
    }
  }

  return null;
}

const OVERVIEW_HEADING: Record<string, string> = {
  en: "## The Network Overview",
  fa: "## نمای کلی شبکه",
};

// The wizard's steps, from the one list the create and edit forms share.
function discoveryStepTitles(): Array<string> {
  const source: string = readRepoFile(
    `${DASHBOARD}/Pages/NetworkDevice/Discovery.tsx`,
  );
  const start: number = source.indexOf("const DISCOVERY_SCAN_FORM_STEPS");
  const end: number = source.indexOf("];", start);

  return Array.from(
    source.slice(start, end).matchAll(STEP_TITLE_PATTERN),
  ).map((match: RegExpMatchArray): string => {
    return match[1]!;
  });
}

const STEP_TITLE_PATTERN: RegExp = /\{ title: "([^"]+)", id: "/g;

// The Add Site steps, from the Sites list's create form.
function addSiteStepTitles(): Array<string> {
  const source: string = readRepoFile(`${DASHBOARD}/Pages/NetworkSite/Sites.tsx`);
  const start: number = source.indexOf("formSteps={[");
  const end: number = source.indexOf("]}", start);

  return Array.from(
    source.slice(start, end).matchAll(STEP_TITLE_PATTERN),
  ).map((match: RegExpMatchArray): string => {
    return match[1]!;
  });
}

describe("the device guide adds a device the way the dashboard does", () => {
  test.each(LANGUAGES)("%s: by Add Device, not Create Network Device", (language: string) => {
    const guide: string = readGuide(language, DEVICE_GUIDE);

    expect(`${ADD_DEVICE_CREATE_VERB} ${ADD_DEVICE_SINGULAR_NAME}`).toBe(
      "Add Device",
    );
    expect(guide).toContain(bold("Add Device"));
    // The diagnostic permission keeps its name; the button does not.
    expect(guide).not.toMatch(OLD_CREATE_BUTTON);
  });

  test.each(LANGUAGES)("%s: no longer walks the three steps the form had", (language: string) => {
    const guide: string = readGuide(language, DEVICE_GUIDE);

    for (const oldHeading of OLD_DEVICE_STEP_HEADINGS[language]!) {
      expect(guide).not.toContain(oldHeading);
    }
  });

  test.each(LANGUAGES)("%s: names the two folds and the opt-in as the form does", (language: string) => {
    const guide: string = readGuide(language, DEVICE_GUIDE);

    expect(guide).toContain(bold(ADD_DEVICE_SNMP_SECTION.title));
    expect(guide).toContain(bold(ADD_DEVICE_MORE_FIELDS.title));
    expect(guide).toContain(`| ${ADD_DEVICE_PING_MONITOR_TITLE} |`);
  });

  test("en: says the name may be left for the hostname to fill", () => {
    const guide: string = readGuide("en", DEVICE_GUIDE);

    expect(guide).toContain(
      "Leave it empty and the device is named after its hostname.",
    );
    expect(guide).toContain("The form is one page");
  });

  test("en: the Name row is not required, the Hostname and Probe rows are", () => {
    const guide: string = readGuide("en", DEVICE_GUIDE);

    expect(guide).toMatch(NAME_ROW_OPTIONAL);
    expect(guide).toMatch(HOSTNAME_ROW_REQUIRED);
    expect(guide).toMatch(PROBE_ROW_REQUIRED);
  });
});

const OLD_CREATE_BUTTON: RegExp = /Create Network Device\*\*/;
// The device table's rows, told apart from the scan table's by what they say.
const NAME_ROW_OPTIONAL: RegExp =
  /^\| Name +\|[^\n]*named after its hostname[^\n]*\| No +\|$/m;
const HOSTNAME_ROW_REQUIRED: RegExp =
  /^\| Hostname +\|[^\n]*the probe pings[^\n]*\| Yes +\|$/m;
const PROBE_ROW_REQUIRED: RegExp =
  /^\| Probe +\|[^\n]*pings this device[^\n]*\| Yes +\|$/m;

const OLD_DEVICE_STEP_HEADINGS: Record<string, Array<string>> = {
  en: ["### Device Details", "### Probe & Site", "### SNMP (Optional)"],
  fa: ["### جزئیات دستگاه", "### پروب و سایت", "### SNMP (اختیاری)"],
};

describe("the device guide opens on the Overview's verdict", () => {
  test.each(LANGUAGES)("%s: every verdict it quotes is one the Overview says", (language: string) => {
    const verdicts: Array<string> = documentedVerdicts(
      readGuide(language, DEVICE_GUIDE),
      OVERVIEW_HEADING[language]!,
    );

    expect(verdicts.length).toBeGreaterThan(0);

    for (const verdict of verdicts) {
      expect({ verdict, kind: verdictKindOf(verdict) }).not.toEqual({
        verdict,
        kind: null,
      });
    }
  });

  test.each(LANGUAGES)("%s: it quotes every kind of verdict, worst news first", (language: string) => {
    const kinds: Array<NetworkHealthVerdictKind | null> = documentedVerdicts(
      readGuide(language, DEVICE_GUIDE),
      OVERVIEW_HEADING[language]!,
    ).map(verdictKindOf);

    // The ladder getNetworkHealthVerdict climbs, in its order.
    expect(kinds).toEqual([
      NetworkHealthVerdictKind.DevicesDown,
      NetworkHealthVerdictKind.SitesUnhealthy,
      NetworkHealthVerdictKind.InterfacesDown,
      NetworkHealthVerdictKind.SnmpFailing,
      NetworkHealthVerdictKind.Waiting,
      NetworkHealthVerdictKind.Healthy,
    ]);
  });

  test.each(LANGUAGES)("%s: names the two ways in and the alerting link", (language: string) => {
    const guide: string = readGuide(language, DEVICE_GUIDE);
    const getStarted: string = readRepoFile(
      `${DASHBOARD}/Components/Network/NetworkGetStarted.tsx`,
    );
    const hero: string = readRepoFile(
      `${DASHBOARD}/Components/Network/NetworkHealthHero.tsx`,
    );

    for (const label of ["Discover devices", "Add one device"]) {
      expect(getStarted).toContain(`title: "${label}"`);
      expect(guide).toContain(bold(label));
    }

    for (const label of ["Discover Devices", "Add Device"]) {
      expect(hero).toContain(`title="${label}"`);
      expect(guide).toContain(bold(label));
    }

    expect(hero).toContain('translator.translateText("Set up alerts")');
    expect(guide).toContain(bold("Set up alerts"));
  });
});

describe("the guides' menu paths lead somewhere", () => {
  const menu: Map<string, Array<string>> = networkMenu();

  test("the menu parsed is the menu: five open rows first", () => {
    expect(menu.get("Network")).toEqual([
      "Overview",
      "Devices",
      "Sites",
      "Map",
      "Discovery",
    ]);
    expect(menu.get("Rules")).toContain("Auto Import Rules");
    expect(menu.get("Topology")).toContain("Device Topology");
  });

  test.each(
    LANGUAGES.flatMap((language: string): Array<[string, string]> => {
      return [
        [language, DEVICE_GUIDE],
        [language, SITES_GUIDE],
      ];
    }),
  )("%s %s: every Network -> section -> page is in that section", (language: string, guide: string) => {
    const paths: Array<[string, string]> = menuPathsIn(
      readGuide(language, guide),
      MENU_ARROW[language]!,
    );

    for (const [section, item] of paths) {
      expect({ section, item, found: menu.get(section)?.includes(item) }).toEqual({
        section,
        item,
        found: true,
      });
    }
  });

  test.each(LANGUAGES)("%s: the device guide reaches Auto Import Rules and Device Topology by their sections", (language: string) => {
    const paths: Array<string> = menuPathsIn(
      readGuide(language, DEVICE_GUIDE),
      MENU_ARROW[language]!,
    ).map(([section, item]: [string, string]): string => {
      return `${section} / ${item}`;
    });

    expect(paths).toContain("Rules / Auto Import Rules");
    expect(paths).toContain("Topology / Device Topology");
    expect(paths).not.toContain("Settings / Auto Import Rules");
    expect(paths).not.toContain("Network Map / Topology");
    expect(paths).not.toContain("Discovery / Discovery Scans");
  });
});

describe("the device guide starts a scan the way the dashboard does", () => {
  test("the wizard is the two steps the guide names", () => {
    expect(discoveryStepTitles()).toEqual(["Scan Target", "SNMP Credentials"]);
  });

  test.each(LANGUAGES)("%s: Start Scan, the two steps, and More fields", (language: string) => {
    const guide: string = readGuide(language, DEVICE_GUIDE);

    expect(guide).toContain(bold("Start Scan"));
    expect(guide).not.toContain("Create Discovery Scan");

    for (const step of discoveryStepTitles()) {
      expect(guide).toContain(bold(step));
    }

    expect(guide).toContain(bold("Repeat this scan"));
  });
});

describe("the sites guide adds a site the way the dashboard does", () => {
  test("Add Site walks the three steps the guide names", () => {
    expect(addSiteStepTitles()).toEqual([
      "Site Details",
      "Hierarchy",
      "Monitoring Defaults",
    ]);
  });

  test.each(LANGUAGES)("%s: Add Site with its steps, Add Child Site, and the Map", (language: string) => {
    const guide: string = readGuide(language, SITES_GUIDE);

    expect(guide).toContain(bold("Add Site"));
    expect(guide).toContain(bold("Add Child Site"));

    for (const step of addSiteStepTitles()) {
      expect(guide).toContain(bold(step));
    }

    // The location is no longer a step of its own.
    expect(guide).not.toContain(bold("Location"));
    expect(guide).toContain(bold("More fields"));
    expect(guide).toContain(`${bold("Network")} ${MENU_ARROW[language]} ${bold("Map")}`);
  });
});
