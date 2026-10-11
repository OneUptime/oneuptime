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
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { dashboardLocale } from "./DocsDashboardLabels";
import { boldSpans, prose, toLatinDigits } from "./DocsTranslationChecks";
import {
  PATH_SEPARATOR,
  drawnNetworkLabel,
  drawnPath,
  localeValue,
} from "./NetworkDocsLabels";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Network guides tell the story the Network area now tells.
 *
 * The area was made simpler - a menu of six open rows, an Overview that
 * opens on a one-sentence verdict, Add Device on one page, a scan in two
 * steps (one for a ping sweep), Add Site in three - and the guides walked
 * the old forms: Create Network Device through three steps, Create
 * Discovery Scan, menu paths through sections that moved. Markdown is not
 * compiled, so this reads the dashboard's own sources and checks the guides
 * name what a reader will actually see: the English guides by the
 * dashboard's English labels, and every translation by the labels its
 * language's Dashboard draws (drawnNetworkLabel), with each English menu
 * path drawn segment by segment (drawnPath).
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const DASHBOARD: string = "App/FeatureSet/Dashboard/src";
const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const DEVICE_GUIDE: string = "monitor/network-device-monitor.md";
const SITES_GUIDE: string = "monitor/network-sites.md";

// Both guides exist in every docs language.
const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];
const TRANSLATIONS: Array<string> = LANGUAGES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

function readRepoFile(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

function readGuide(language: string, guide: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, language, guide), "utf8");
}

function bold(label: string): string {
  return `**${label}**`;
}

// A Dashboard label in bold, as a guide in a language names it.
function drawn(language: string, label: string): string {
  return bold(drawnNetworkLabel(language, label));
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

/*
 * Every Network path an English guide names, "**Network → Rules → Auto
 * Import Rules**", as its segments after Network: ["Rules", "Auto Import
 * Rules"], or ["Map"] for a row of the menu's open part.
 */
function networkPathsIn(markdown: string): Array<Array<string>> {
  return boldSpans(prose(markdown))
    .filter((span: string): boolean => {
      return span.startsWith(`Network${PATH_SEPARATOR}`);
    })
    .map((span: string): Array<string> => {
      return span
        .split(PATH_SEPARATOR)
        .slice(1)
        .map((segment: string): string => {
          return segment.trim();
        });
    });
}

const ESCAPE_PATTERN: RegExp = /[.*+?^${}()|[\]\\]/g;
const PLURAL_SUFFIX: RegExp = /_(?:zero|one|two|few|many|other)$/;

// "{{count}} devices are down" as a pattern any count satisfies.
function headlinePattern(form: string): RegExp {
  return new RegExp(
    `^${form.replace(ESCAPE_PATTERN, "\\$&").replace("\\{\\{count\\}\\}", "\\d+")}$`,
  );
}

/*
 * A headline key as a language's Dashboard words it, in each plural form
 * its locale has (one, few, many, other), or the key itself in English.
 */
function headlineForms(language: string, key: string): Array<string> {
  if (language === "en") {
    return [key];
  }

  const forms: Array<string> = Object.keys(dashboardLocale(language))
    .filter((candidate: string): boolean => {
      return candidate === key || candidate.replace(PLURAL_SUFFIX, "") === key;
    })
    .map((candidate: string): string => {
      return localeValue(language, candidate);
    });

  return forms.length > 0 ? forms : [key];
}

const OVERVIEW_TABLE_ROW: RegExp = /^\| \*\*([^*]+)\*\* \|/;
const OVERVIEW_HEADING: string = "## The Network Overview";

/*
 * The verdicts the Overview section's first table quotes, in order. A
 * translation lies line for line beside the English guide, so its table is
 * on the lines the English one takes.
 */
function documentedVerdicts(language: string): Array<string> {
  const english: Array<string> = readGuide("en", DEVICE_GUIDE).split("\n");
  const heading: number = english.indexOf(OVERVIEW_HEADING);

  expect(heading).toBeGreaterThan(-1);

  const start: number = english.findIndex(
    (line: string, index: number): boolean => {
      return index > heading && line.startsWith("|");
    },
  );
  const end: number = english.findIndex(
    (line: string, index: number): boolean => {
      return index > start && !line.startsWith("|");
    },
  );

  return readGuide(language, DEVICE_GUIDE)
    .split("\n")
    .slice(start, end)
    .map((line: string): string | undefined => {
      return line.match(OVERVIEW_TABLE_ROW)?.[1];
    })
    .filter((verdict: string | undefined): verdict is string => {
      return verdict !== undefined;
    })
    .map((verdict: string): string => {
      return toLatinDigits(verdict.trim());
    });
}

function verdictKindOf(
  language: string,
  sentence: string,
): NetworkHealthVerdictKind | null {
  for (const kind of Object.values(NetworkHealthVerdictKind)) {
    const headline: NetworkHealthPlural = NETWORK_HEALTH_COPY[kind].headline;
    const forms: Array<string> = [headline.one, headline.other].flatMap(
      (key: string): Array<string> => {
        return headlineForms(language, key);
      },
    );

    if (
      forms.some((form: string): boolean => {
        return headlinePattern(form).test(sentence);
      })
    ) {
      return kind;
    }
  }

  return null;
}

// The wizard's steps, from the one list the create and edit forms share.
function discoveryStepTitles(): Array<string> {
  const source: string = readRepoFile(
    `${DASHBOARD}/Pages/NetworkDevice/Discovery.tsx`,
  );
  const start: number = source.indexOf("const DISCOVERY_SCAN_FORM_STEPS");
  const end: number = source.indexOf("];", start);

  return Array.from(source.slice(start, end).matchAll(STEP_TITLE_PATTERN)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

const STEP_TITLE_PATTERN: RegExp = /\{ title: "([^"]+)", id: "/g;

// The Add Site steps, from the Sites list's create form.
function addSiteStepTitles(): Array<string> {
  const source: string = readRepoFile(
    `${DASHBOARD}/Pages/NetworkSite/Sites.tsx`,
  );
  const start: number = source.indexOf("formSteps={[");
  const end: number = source.indexOf("]}", start);

  return Array.from(source.slice(start, end).matchAll(STEP_TITLE_PATTERN)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

const OLD_CREATE_BUTTON: RegExp = /Create Network Device\*\*/;
// The device table's rows, told apart from the scan table's by what they say.
const NAME_ROW_OPTIONAL: RegExp =
  /^\| Name +\|[^\n]*named after its hostname[^\n]*\| No +\|$/m;
const HOSTNAME_ROW_REQUIRED: RegExp =
  /^\| Hostname +\|[^\n]*the probe pings[^\n]*\| Yes +\|$/m;
const PROBE_ROW_REQUIRED: RegExp =
  /^\| Probe +\|[^\n]*pings this device[^\n]*\| Yes +\|$/m;

// The step headings of the three-step form, in the guides that walked it.
const OLD_DEVICE_STEP_HEADINGS: Record<string, Array<string>> = {
  en: ["### Device Details", "### Probe & Site", "### SNMP (Optional)"],
  fa: ["### جزئیات دستگاه", "### پروب و سایت", "### SNMP (اختیاری)"],
};

describe("the device guide adds a device the way the dashboard does", () => {
  test.each(LANGUAGES)(
    "%s: by Add Device, not Create Network Device",
    (language: string) => {
      const guide: string = readGuide(language, DEVICE_GUIDE);

      expect(`${ADD_DEVICE_CREATE_VERB} ${ADD_DEVICE_SINGULAR_NAME}`).toBe(
        "Add Device",
      );
      expect(guide).toContain(drawn(language, "Add Device"));
      // The diagnostic permission keeps its name; the button does not.
      expect(guide).not.toMatch(OLD_CREATE_BUTTON);
    },
  );

  test.each(Object.keys(OLD_DEVICE_STEP_HEADINGS))(
    "%s: no longer walks the three steps the form had",
    (language: string) => {
      const guide: string = readGuide(language, DEVICE_GUIDE);

      for (const oldHeading of OLD_DEVICE_STEP_HEADINGS[language]!) {
        expect(guide).not.toContain(oldHeading);
      }
    },
  );

  test.each(LANGUAGES)(
    "%s: names the two folds and the opt-in as the form does",
    (language: string) => {
      const guide: string = readGuide(language, DEVICE_GUIDE);

      expect(guide).toContain(drawn(language, ADD_DEVICE_SNMP_SECTION.title));
      expect(guide).toContain(drawn(language, ADD_DEVICE_MORE_FIELDS.title));
      expect(guide).toContain(
        `| ${drawnNetworkLabel(language, ADD_DEVICE_PING_MONITOR_TITLE)} |`,
      );
    },
  );

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

describe("the device guide opens on the Overview's verdict", () => {
  test.each(LANGUAGES)(
    "%s: every verdict it quotes is one the Overview says",
    (language: string) => {
      const verdicts: Array<string> = documentedVerdicts(language);

      expect(verdicts.length).toBeGreaterThan(0);

      for (const verdict of verdicts) {
        expect({ verdict, kind: verdictKindOf(language, verdict) }).not.toEqual(
          {
            verdict,
            kind: null,
          },
        );
      }
    },
  );

  test.each(LANGUAGES)(
    "%s: it quotes every kind of verdict, worst news first",
    (language: string) => {
      const kinds: Array<NetworkHealthVerdictKind | null> = documentedVerdicts(
        language,
      ).map((verdict: string): NetworkHealthVerdictKind | null => {
        return verdictKindOf(language, verdict);
      });

      // The ladder getNetworkHealthVerdict climbs, in its order.
      expect(kinds).toEqual([
        NetworkHealthVerdictKind.DevicesDown,
        NetworkHealthVerdictKind.SitesUnhealthy,
        NetworkHealthVerdictKind.InterfacesDown,
        NetworkHealthVerdictKind.SnmpFailing,
        NetworkHealthVerdictKind.Waiting,
        NetworkHealthVerdictKind.Healthy,
      ]);
    },
  );

  test.each(LANGUAGES)(
    "%s: names the two ways in and the alerting link",
    (language: string) => {
      const guide: string = readGuide(language, DEVICE_GUIDE);
      const getStarted: string = readRepoFile(
        `${DASHBOARD}/Components/Network/NetworkGetStarted.tsx`,
      );
      const hero: string = readRepoFile(
        `${DASHBOARD}/Components/Network/NetworkHealthHero.tsx`,
      );

      for (const label of ["Discover devices", "Add one device"]) {
        expect(getStarted).toContain(`title: "${label}"`);
        expect(guide).toContain(drawn(language, label));
      }

      for (const label of ["Discover Devices", "Add Device"]) {
        expect(hero).toContain(`title="${label}"`);
        expect(guide).toContain(drawn(language, label));
      }

      expect(hero).toContain('translator.translateText("Set up alerts")');
      expect(guide).toContain(drawn(language, "Set up alerts"));
    },
  );
});

describe("the guides' menu paths lead somewhere", () => {
  const menu: Map<string, Array<string>> = networkMenu();

  test("the menu parsed is the menu: six open rows first", () => {
    expect(menu.get("Network")).toEqual([
      "Overview",
      "Devices",
      "Sites",
      "Map",
      "Traffic",
      "Discovery",
    ]);
    expect(menu.get("Rules")).toContain("Auto Import Rules");
    expect(menu.get("Topology")).toContain("Device Topology");
  });

  test.each([DEVICE_GUIDE, SITES_GUIDE])(
    "en %s: every Network → page is an open row, and every Network → section → page is in that section",
    (guide: string) => {
      const paths: Array<Array<string>> = networkPathsIn(
        readGuide("en", guide),
      );

      expect(paths.length).toBeGreaterThan(0);

      for (const segments of paths) {
        const [first, second] = segments as [string, string | undefined];
        const found: boolean =
          segments.length === 1
            ? Boolean(menu.get("Network")?.includes(first))
            : segments.length === 2 &&
              Boolean(menu.get(first)?.includes(second as string));

        expect({ segments, found }).toEqual({ segments, found: true });
      }
    },
  );

  test.each(
    TRANSLATIONS.flatMap((language: string): Array<[string, string]> => {
      return [
        [language, DEVICE_GUIDE],
        [language, SITES_GUIDE],
      ];
    }),
  )(
    "%s %s: names every path the English guide names, as its Dashboard draws it",
    (language: string, guide: string) => {
      const translated: string = readGuide(language, guide);
      const missing: Array<string> = networkPathsIn(readGuide("en", guide))
        .map((segments: Array<string>): string => {
          return drawnPath(language, ["Network", ...segments]);
        })
        .filter((drawnSegments: string): boolean => {
          return !translated.includes(drawnSegments);
        });

      expect(missing).toEqual([]);
    },
  );

  test("en: the device guide reaches Auto Import Rules and Device Topology by their sections", () => {
    const paths: Array<string> = networkPathsIn(
      readGuide("en", DEVICE_GUIDE),
    ).map((segments: Array<string>): string => {
      return segments.join(" / ");
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

  test.each(LANGUAGES)(
    "%s: Start Scan, the two steps, and More fields",
    (language: string) => {
      const guide: string = readGuide(language, DEVICE_GUIDE);

      expect(guide).toContain(drawn(language, "Start Scan"));
      expect(guide).not.toContain("Create Discovery Scan");

      for (const step of discoveryStepTitles()) {
        expect(guide).toContain(drawn(language, step));
      }

      expect(guide).toContain(drawn(language, "Repeat this scan"));
    },
  );
});

describe("the sites guide adds a site the way the dashboard does", () => {
  test("Add Site walks the three steps the guide names", () => {
    expect(addSiteStepTitles()).toEqual([
      "Site Details",
      "Hierarchy",
      "Monitoring Defaults",
    ]);
  });

  test.each(LANGUAGES)(
    "%s: Add Site with its steps, Add Child Site, and the Map",
    (language: string) => {
      const guide: string = readGuide(language, SITES_GUIDE);

      expect(guide).toContain(drawn(language, "Add Site"));
      expect(guide).toContain(drawn(language, "Add Child Site"));

      for (const step of addSiteStepTitles()) {
        expect(guide).toContain(drawn(language, step));
      }

      // The location is no longer a step of its own.
      expect(guide).not.toContain(drawn(language, "Location"));
      expect(guide).toContain(drawn(language, "More fields"));
      expect(guide).toContain(drawnPath(language, ["Network", "Map"]));
    },
  );
});
