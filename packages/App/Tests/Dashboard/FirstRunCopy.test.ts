import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import Alert from "Common/Models/DatabaseModels/Alert";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import Incident from "Common/Models/DatabaseModels/Incident";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import Service from "Common/Models/DatabaseModels/Service";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import Team from "Common/Models/DatabaseModels/Team";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import {
  NOTHING_HERE_YET,
  NOTHING_MATCHES_SEARCH_OR_FILTERS,
  toSentenceNoun,
} from "Common/UI/Components/Table/EmptyTableMessage";

/*
 * The copy a brand-new user meets on their first visit: Home's tiles, the
 * empty core lists, the list descriptions and the Create Monitor form.
 *
 * Copy fails quietly. A rewritten English string silently orphans its
 * translations and shows English to sixteen languages; a page that goes back
 * to its own "No X found." loses the Create button the table offers under
 * "No X yet."; and a word like "Inoperational" creeps back one label at a
 * time. The App suite runs in plain Node and cannot render the dashboard, so
 * these are source- and locale-level invariants. The rendered behaviour is
 * pinned by the Common suite and the FirstRunExperience E2E spec.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);
const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

type Locale = Record<string, unknown>;

const localeFiles: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".json");
  })
  .sort();

const locales: Record<string, Locale> = {};
for (const file of localeFiles) {
  locales[file.replace(/\.json$/, "")] = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
  ) as Locale;
}

const english: Locale = locales["en"]!;

const nonEnglish: Array<string> = Object.keys(locales).filter(
  (code: string): boolean => {
    return code !== "en";
  },
);

/*
 * Comments are stripped before anything is matched: these files explain the
 * old wording in prose, and an assertion about the code must read the code.
 */
function stripComments(raw: string): string {
  return raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8");
}

function readCode(relativePath: string): string {
  return stripComments(readSource(relativePath));
}

function unescapeLiteral(literal: string): string {
  return JSON.parse(`"${literal}"`) as string;
}

const STRING_LITERAL: string = `"((?:[^"\\\\]|\\\\.)*)"`;

/*
 * Every locale has the key, English maps it to itself, and each of the other
 * sixteen has a real translation - a string that is not the English text.
 */
function expectTranslatedEverywhere(key: string): void {
  expect([key, english[key]]).toEqual([key, key]);

  for (const code of nonEnglish) {
    const value: unknown = locales[code]![key];
    expect([code, key, typeof value]).toEqual([code, key, "string"]);
    expect((value as string).trim().length).toBeGreaterThan(0);
    expect([code, key, value]).not.toEqual([code, key, key]);
  }
}

// Named rather than inline: eslint's wrap-regex and prettier disagree on these.
const SOURCE_FILE_PATTERN: RegExp = new RegExp("\\.(ts|tsx)$");
const CAPITALISED_INOPERATIONAL: RegExp = new RegExp("\\bInoperational\\b");
const ANY_CASE_INOPERATIONAL: RegExp = new RegExp("inoperational", "i");

function listSourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "Locales" || entry.name === "node_modules") {
        continue;
      }
      files.push(...listSourceFiles(fullPath));
    } else if (SOURCE_FILE_PATTERN.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

describe("the locale files", () => {
  test("all 17 are present", () => {
    expect(localeFiles).toHaveLength(17);
  });

  test("have the same keys, in the same order, in every language", () => {
    /*
     * CI's i18n:validate compares key sets; the order is what keeps a
     * 17-language diff line-parallel and reviewable.
     */
    const englishKeys: Array<string> = Object.keys(english);

    for (const code of nonEnglish) {
      expect([code, Object.keys(locales[code]!)]).toEqual([code, englishKeys]);
    }
  });
});

describe('"Inoperational" is gone', () => {
  const sourceFiles: Array<string> = listSourceFiles(DASHBOARD_SRC);

  test("the scan reads the dashboard's source", () => {
    // Guards the scan below against a path that stopped matching anything.
    expect(sourceFiles.length).toBeGreaterThan(500);
    expect(
      sourceFiles.some((file: string): boolean => {
        return file.endsWith(path.join("Pages", "Monitor", "SideMenu.tsx"));
      }),
    ).toBe(true);
  });

  test("no dashboard source shows the word to a user", () => {
    /*
     * "Not Operational" is the label now. What may still say
     * "inoperational" is plumbing a user never reads: the PageMap key
     * (MONITORS_INOPERATIONAL, upper case) and the two route paths, kept so
     * bookmarks and links keep working.
     */
    const offenders: Array<string> = [];

    for (const file of sourceFiles) {
      const code: string = stripComments(fs.readFileSync(file, "utf8"));

      if (CAPITALISED_INOPERATIONAL.test(code)) {
        offenders.push(`${path.relative(DASHBOARD_SRC, file)}: Inoperational`);
      }

      const lowerCasePattern: RegExp = /inoperational/g;
      let match: RegExpExecArray | null = lowerCasePattern.exec(code);

      while (match !== null) {
        const before: string = code.slice(
          Math.max(0, match.index - 1),
          match.index,
        );
        const isRoutePath: boolean = before === '"' || before === "-";

        if (!isRoutePath) {
          offenders.push(
            `${path.relative(DASHBOARD_SRC, file)}: ${code.slice(
              Math.max(0, match.index - 30),
              match.index + 20,
            )}`,
          );
        }

        match = lowerCasePattern.exec(code);
      }
    }

    expect(offenders).toEqual([]);
  });

  test("the routes still use the old path, so links keep working", () => {
    const routeMap: string = readCode(path.join("Utils", "RouteMap.ts"));

    expect(routeMap).toContain(
      '[PageMap.MONITORS_INOPERATIONAL]: "inoperational"',
    );
    expect(routeMap).toContain("/home/monitors-inoperational");
  });

  test.each(Object.keys(locales))(
    "%s has no Inoperational key and no English value using it",
    (code: string) => {
      const locale: Locale = locales[code]!;

      expect(
        Object.keys(locale).filter((key: string): boolean => {
          return ANY_CASE_INOPERATIONAL.test(key);
        }),
      ).toEqual([]);

      if (code === "en") {
        expect(
          Object.values(locale).filter((value: unknown): boolean => {
            return (
              typeof value === "string" && ANY_CASE_INOPERATIONAL.test(value)
            );
          }),
        ).toEqual([]);
      }
    },
  );

  test("the Monitors and Home menus, the page titles and the breadcrumb say Not Operational", () => {
    const monitorMenu: string = readCode(
      path.join("Pages", "Monitor", "SideMenu.tsx"),
    );
    const homeMenu: string = readCode(
      path.join("Pages", "Home", "SideMenu.tsx"),
    );

    for (const menu of [monitorMenu, homeMenu]) {
      expect(menu).toMatch(
        /title: "Not Operational",\s*to: RouteUtil\.populateRouteParams\(\s*RouteMap\[\s*PageMap\.(?:MONITORS_INOPERATIONAL|HOME_NOT_OPERATIONAL_MONITORS)\s*\] as Route,?\s*\)/,
      );
    }

    for (const page of [
      path.join("Pages", "Home", "NotOperationalMonitors.tsx"),
      path.join("Pages", "Monitor", "NotOperationalMonitors.tsx"),
    ]) {
      expect(readCode(page)).toContain('title="Not Operational Monitors"');
    }

    const homeLayout: string = readCode(
      path.join("Pages", "Home", "Layout.tsx"),
    );
    expect(homeLayout.match(/"Not Operational Monitors"/g)).toHaveLength(2);

    expect(
      readCode(path.join("Utils", "Breadcrumbs", "MonitorBreadcrumbs.ts")),
    ).toMatch(/"Monitors",\s*"Not Operational",?\s*\]/);

    for (const key of [
      "Not Operational",
      "Not Operational Monitors",
      "Not operational monitors",
    ]) {
      expectTranslatedEverywhere(key);
    }
  });
});

/*
 * Every "Here is a list of ..." description rewritten on this branch, and the
 * page(s) carrying it. A description two pages share is one sentence, so one
 * translation serves both.
 */
interface DescribedPage {
  file: string;
  // JSX `description="..."` on a wrapper table, or `cardProps.description`.
  shape: "jsx" | "cardProps";
}

const DESCRIBED_PAGES: Array<[string, Array<DescribedPage>]> = [
  [
    "active incidents",
    [
      { file: "Pages/Home/Home.tsx", shape: "jsx" },
      { file: "Pages/Incidents/Unresolved.tsx", shape: "jsx" },
    ],
  ],
  [
    "active alerts",
    [
      { file: "Pages/Home/ActiveAlerts.tsx", shape: "jsx" },
      { file: "Pages/Alerts/Unresolved.tsx", shape: "jsx" },
    ],
  ],
  [
    "not operational monitors",
    [
      { file: "Pages/Home/NotOperationalMonitors.tsx", shape: "jsx" },
      { file: "Pages/Monitor/NotOperationalMonitors.tsx", shape: "jsx" },
    ],
  ],
  [
    "disabled monitors",
    [{ file: "Pages/Monitor/DisabledMonitors.tsx", shape: "jsx" }],
  ],
  [
    "monitors with every probe disconnected",
    [{ file: "Pages/Monitor/ProbeDisconnected.tsx", shape: "jsx" }],
  ],
  [
    "monitors with every probe disabled",
    [{ file: "Pages/Monitor/ProbeDisabled.tsx", shape: "jsx" }],
  ],
  [
    "ongoing scheduled maintenance",
    [
      { file: "Pages/ScheduledMaintenanceEvents/Ongoing.tsx", shape: "jsx" },
      { file: "Pages/Home/OngoingScheduledMaintenance.tsx", shape: "jsx" },
    ],
  ],
  [
    "active incident episodes",
    [
      { file: "Pages/Home/ActiveIncidentEpisodes.tsx", shape: "jsx" },
      { file: "Pages/Incidents/UnresolvedEpisodes.tsx", shape: "jsx" },
    ],
  ],
  [
    "active alert episodes",
    [
      { file: "Pages/Home/ActiveEpisodes.tsx", shape: "jsx" },
      { file: "Pages/Alerts/UnresolvedEpisodes.tsx", shape: "jsx" },
    ],
  ],
  ["workflows", [{ file: "Pages/Workflow/Workflows.tsx", shape: "cardProps" }]],
  [
    "dashboards",
    [{ file: "Pages/Dashboards/Dashboards.tsx", shape: "cardProps" }],
  ],
  ["teams", [{ file: "Pages/Teams/Index.tsx", shape: "cardProps" }]],
  ["users", [{ file: "Pages/Users/Index.tsx", shape: "cardProps" }]],
  [
    "on-call schedules",
    [{ file: "Pages/OnCallDuty/OnCallDutySchedules.tsx", shape: "cardProps" }],
  ],
  ["services", [{ file: "Pages/Service/Services.tsx", shape: "cardProps" }]],
];

function describedPageDescription(page: DescribedPage): string {
  const code: string = readCode(page.file);

  const pattern: RegExp =
    page.shape === "jsx"
      ? new RegExp(`\\bdescription=${STRING_LITERAL}`, "g")
      : new RegExp(
          `cardProps=\\{\\{[\\s\\S]*?\\bdescription:\\s*${STRING_LITERAL}`,
          "g",
        );

  const matches: Array<RegExpMatchArray> = Array.from(code.matchAll(pattern));

  // Exactly one: a second description would make "the" description ambiguous.
  expect([page.file, matches.length]).toEqual([page.file, 1]);

  return unescapeLiteral(matches[0]![1]!);
}

describe("list descriptions say what the list holds", () => {
  test.each(DESCRIBED_PAGES)(
    "%s: no boilerplate, a real sentence, one per concept",
    (_name: string, pages: Array<DescribedPage>) => {
      const descriptions: Array<string> = pages.map(describedPageDescription);

      for (const description of descriptions) {
        expect(description).not.toMatch(/^Here (is|are) (a|the) list of/i);
        expect(description).not.toMatch(/^List and manage/i);
        expect(description).not.toMatch(/for this project\.?$/i);
        expect(description.length).toBeGreaterThanOrEqual(60);
      }

      // Pages showing the same list use the same sentence.
      expect(new Set(descriptions).size).toBe(1);
    },
  );

  test.each(DESCRIBED_PAGES)(
    "%s: the description is translated in every locale",
    (_name: string, pages: Array<DescribedPage>) => {
      expectTranslatedEverywhere(describedPageDescription(pages[0]!));
    },
  );

  test("the concept-specific facts the descriptions promise are there", () => {
    const byName: Map<string, string> = new Map(
      DESCRIBED_PAGES.map(
        ([name, pages]: [string, Array<DescribedPage>]): [string, string] => {
          return [name, describedPageDescription(pages[0]!)];
        },
      ),
    );

    // Incidents are about users; alerts are for the team, before users notice.
    expect(byName.get("active incidents")).toContain("affecting your users");
    expect(byName.get("active alerts")).toContain("before users notice");
    // A new user does not know what an episode is.
    expect(byName.get("active incident episodes")).toMatch(
      /^Episodes group related incidents/,
    );
    expect(byName.get("active alert episodes")).toMatch(
      /^Episodes group related alerts/,
    );
    // The probe pages say nothing is checking those monitors.
    expect(byName.get("monitors with every probe disconnected")).toContain(
      "nothing is checking them",
    );
    expect(byName.get("monitors with every probe disabled")).toContain(
      "nothing is checking them",
    );
    // Schedules only page anyone once a policy's escalation rule uses them.
    expect(byName.get("on-call schedules")).toContain("escalation rules");
    // The Users page is where invitations happen.
    expect(byName.get("users")).toContain("Invite");
  });

  test("the not operational list no longer claims every monitor is operational", () => {
    /*
     * "All monitors in operational state." was said to projects with no
     * monitors at all. The replacement is true either way.
     */
    for (const file of [
      "Pages/Home/NotOperationalMonitors.tsx",
      "Pages/Monitor/NotOperationalMonitors.tsx",
    ]) {
      const code: string = readCode(file);

      expect(code).not.toContain("All monitors in operational state.");
      expect(code).toContain(
        'noItemsMessage="No monitors are reporting a problem."',
      );
    }

    expectTranslatedEverywhere("No monitors are reporting a problem.");
  });

  test("ongoing maintenance is not pluralised as 'Maintenances'", () => {
    for (const file of [
      "Pages/ScheduledMaintenanceEvents/Ongoing.tsx",
      "Pages/Home/OngoingScheduledMaintenance.tsx",
    ]) {
      const code: string = readCode(file);

      expect(code).toContain('title="Ongoing Scheduled Maintenance"');

      // In a string a user reads; the component's identifier is not one.
      const literals: Array<string> = Array.from(
        code.matchAll(new RegExp(STRING_LITERAL, "g")),
      ).map((match: RegExpMatchArray): string => {
        return unescapeLiteral(match[1]!);
      });

      expect(literals).toContain("Ongoing Scheduled Maintenance");
      expect(
        literals.filter((literal: string): boolean => {
          return literal.includes("Maintenances");
        }),
      ).toEqual([]);
    }
  });
});

/*
 * The core lists a new project opens empty. Each must leave the empty-state
 * wording to the table, which says "No <plural> yet." and puts the list's
 * Create button under it; a page's own sentence would take that button away
 * (BaseModelTable shows it only under its own wording).
 */
interface CoreList {
  name: string;
  file: string;
  // The model the table lists, for its plural name.
  pluralName: string;
  // A wrapper forwards the caller's own message, and adds none of its own.
  isWrapper: boolean;
}

const CORE_LISTS: Array<CoreList> = [
  {
    name: "Monitors",
    file: "Components/Monitor/MonitorTable.tsx",
    pluralName: new Monitor().pluralName!,
    isWrapper: true,
  },
  {
    name: "Incidents",
    file: "Components/Incident/IncidentsTable.tsx",
    pluralName: new Incident().pluralName!,
    isWrapper: true,
  },
  {
    name: "Alerts",
    file: "Components/Alert/AlertsTable.tsx",
    pluralName: new Alert().pluralName!,
    isWrapper: true,
  },
  {
    name: "Scheduled Maintenance",
    file: "Components/ScheduledMaintenance/ScheduledMaintenanceTable.tsx",
    pluralName: new ScheduledMaintenance().pluralName!,
    isWrapper: true,
  },
  {
    name: "Status Pages",
    file: "Pages/StatusPages/StatusPages.tsx",
    pluralName: new StatusPage().pluralName!,
    isWrapper: false,
  },
  {
    name: "On-Call Policies",
    file: "Pages/OnCallDuty/OnCallDutyPolicies.tsx",
    pluralName: new OnCallDutyPolicy().pluralName!,
    isWrapper: false,
  },
  {
    name: "On-Call Schedules",
    file: "Pages/OnCallDuty/OnCallDutySchedules.tsx",
    // The page names its rows itself; read below from its pluralName prop.
    pluralName: "",
    isWrapper: false,
  },
  {
    name: "Workflows",
    file: "Pages/Workflow/Workflows.tsx",
    pluralName: new Workflow().pluralName!,
    isWrapper: false,
  },
  {
    name: "Dashboards",
    file: "Pages/Dashboards/Dashboards.tsx",
    pluralName: new Dashboard().pluralName!,
    isWrapper: false,
  },
  {
    name: "Teams",
    file: "Pages/Teams/Index.tsx",
    pluralName: new Team().pluralName!,
    isWrapper: false,
  },
  {
    name: "Services",
    file: "Pages/Service/Services.tsx",
    pluralName: new Service().pluralName!,
    isWrapper: false,
  },
  {
    name: "Runbooks",
    file: "Pages/Runbook/Runbooks.tsx",
    pluralName: new Runbook().pluralName!,
    isWrapper: false,
  },
];

// The plural the table is given: the page's pluralName prop, else the model's.
function pluralNameOf(list: CoreList): string {
  const override: RegExpMatchArray | null = readCode(list.file).match(
    new RegExp(`\\bpluralName=${STRING_LITERAL}`),
  );

  if (override) {
    return unescapeLiteral(override[1]!);
  }

  expect([list.name, list.pluralName.length > 0]).toEqual([list.name, true]);

  return list.pluralName;
}

describe("the core lists leave the empty state to the table", () => {
  test.each(
    CORE_LISTS.map((list: CoreList): [string, CoreList] => {
      return [list.name, list];
    }),
  )(
    "%s adds no empty-state wording of its own",
    (_name: string, list: CoreList) => {
      const code: string = readCode(list.file);

      expect(code).not.toMatch(/No [^"]* found\./);
      expect(code).not.toMatch(/noItemsMessage=\{?\s*"/);

      if (list.isWrapper) {
        // Only what the caller passed - no `|| "No monitors found."` fallback.
        expect(code).toContain("noItemsMessage={props.noItemsMessage}");
        expect(code.match(/noItemsMessage=/g)).toHaveLength(1);
      } else {
        expect(code).not.toContain("noItemsMessage=");
      }
    },
  );

  test.each(
    CORE_LISTS.map((list: CoreList): [string, CoreList] => {
      return [list.name, list];
    }),
  )(
    "%s: the table's own sentence is translated in every locale",
    (_name: string, list: CoreList) => {
      const sentence: string = `No ${toSentenceNoun(pluralNameOf(list))} yet.`;

      expectTranslatedEverywhere(sentence);
    },
  );

  test("the sentences are the ones a user reads", () => {
    // Pins the noun handling: lower case, but hyphens and word order kept.
    expect(
      CORE_LISTS.map((list: CoreList): string => {
        return `No ${toSentenceNoun(pluralNameOf(list))} yet.`;
      }),
    ).toEqual([
      "No monitors yet.",
      "No incidents yet.",
      "No alerts yet.",
      "No scheduled maintenance events yet.",
      "No status pages yet.",
      "No on-call duty policies yet.",
      "No on-call schedules yet.",
      "No workflows yet.",
      "No dashboards yet.",
      "No teams yet.",
      "No services yet.",
      "No runbooks yet.",
    ]);
  });

  test("the noun-free fallbacks are translated in every locale", () => {
    /*
     * A language without a list's own sentence says one of these instead,
     * never a sentence stitched from English words.
     */
    expect(NOTHING_HERE_YET).toBe("Nothing here yet.");
    expect(NOTHING_MATCHES_SEARCH_OR_FILTERS).toBe(
      "Nothing matches your search or filters.",
    );

    expectTranslatedEverywhere(NOTHING_HERE_YET);
    expectTranslatedEverywhere(NOTHING_MATCHES_SEARCH_OR_FILTERS);
  });

  test("On-Call Schedules are named for the page, not for their table", () => {
    const code: string = readCode("Pages/OnCallDuty/OnCallDutySchedules.tsx");

    expect(code).toContain('singularName="On-Call Schedule"');
    expect(code).toContain('pluralName="On-Call Schedules"');

    // The create button reads the phrase whole: "Create On-Call Schedule".
    expectTranslatedEverywhere("Create On-Call Schedule");
  });

  test("On-Call Schedules keep their own table id and saved layout", () => {
    /*
     * The two tables shared "on-call-duty-table", so a column layout saved on
     * one page was applied to the other, whose columns differ.
     */
    const idsOf: (file: string) => { id: string; key: string } = (
      file: string,
    ): { id: string; key: string } => {
      const code: string = readCode(file);
      const id: RegExpMatchArray | null = code.match(/\bid="([^"]+)"/);
      const key: RegExpMatchArray | null = code.match(
        /\buserPreferencesKey="([^"]+)"/,
      );

      expect([file, Boolean(id), Boolean(key)]).toEqual([file, true, true]);

      return { id: id![1]!, key: key![1]! };
    };

    const policies: { id: string; key: string } = idsOf(
      "Pages/OnCallDuty/OnCallDutyPolicies.tsx",
    );
    const schedules: { id: string; key: string } = idsOf(
      "Pages/OnCallDuty/OnCallDutySchedules.tsx",
    );

    expect(schedules.id).not.toBe(policies.id);
    expect(schedules.key).not.toBe(policies.key);
    expect(schedules).toEqual({
      id: "on-call-schedules-table",
      key: "on-call-schedules-table",
    });
  });
});

describe("Home's overview tiles", () => {
  const code: string = readCode("Components/Home/OverviewStats.tsx");

  const literalsOf: (property: string) => Array<string> = (
    property: string,
  ): Array<string> => {
    return Array.from(
      code.matchAll(new RegExp(`\\b${property}:\\s*${STRING_LITERAL}`, "g")),
    ).map((match: RegExpMatchArray): string => {
      return unescapeLiteral(match[1]!);
    });
  };

  const constant: (name: string) => string = (name: string): string => {
    const match: RegExpMatchArray | null = code.match(
      new RegExp(`export const ${name}: string = ${STRING_LITERAL};`),
    );

    expect([name, Boolean(match)]).toEqual([name, true]);

    return unescapeLiteral(match![1]!);
  };

  test("the scan finds every tile", () => {
    expect(literalsOf("label")).toEqual([
      "Active incidents",
      "Active alerts",
      "Not operational monitors",
      "Ongoing maintenance",
      "SLOs at risk",
    ]);
  });

  test("the not-set-up labels are the ones the tiles show", () => {
    expect(constant("NO_MONITORS_YET_LABEL")).toBe("No monitors yet");
    expect(constant("NO_SLOS_YET_LABEL")).toBe("No SLOs yet");

    /*
     * Each is the label of one tile's not-set-up state. The monitors tile
     * opens the Monitors list, not the create form: the list's empty state
     * offers Create Monitor behind the same permission gate as its header,
     * while the form would open for someone who cannot submit it.
     */
    expect(code).toMatch(
      /notSetUp: \{\s*isNotSetUp: counts !== null && counts\.totalMonitors === 0,\s*label: NO_MONITORS_YET_LABEL,\s*pageMap: PageMap\.MONITORS,?\s*\}/,
    );
    expect(code).not.toContain("PageMap.MONITOR_CREATE");
    expect(code).toMatch(
      /notSetUp: \{\s*isNotSetUp: counts !== null && counts\.totalSlos === 0,\s*label: NO_SLOS_YET_LABEL,\s*pageMap: PageMap\.SLOS,?\s*\}/,
    );
  });

  test("every label and status line is translated in every locale", () => {
    const strings: Array<string> = Array.from(
      new Set([
        ...literalsOf("label"),
        ...literalsOf("attentionLabel"),
        ...literalsOf("allClearLabel"),
        constant("NO_MONITORS_YET_LABEL"),
        constant("NO_SLOS_YET_LABEL"),
      ]),
    );

    // 5 titles, 3 attention and 5 all-clear lines (some shared), 2 new ones.
    expect(strings.length).toBeGreaterThanOrEqual(13);

    for (const value of strings) {
      expectTranslatedEverywhere(value);
    }
  });

  test("the status line goes through the translator", () => {
    // The tile titles are translated by InfoCard; the status line was not.
    expect(code).toMatch(/<span>\{tx\(statusLabel\)\}<\/span>/);
  });
});

describe("Getting Started", () => {
  const code: string = readCode("Components/Home/GettingStarted.tsx");

  const taskBlock: (key: string) => string = (key: string): string => {
    const start: number = code.indexOf(`key: "${key}"`);

    expect(start).toBeGreaterThanOrEqual(0);

    const end: number = code.indexOf("isComplete:", start);

    expect(end).toBeGreaterThan(start);

    return code.slice(start, end);
  };

  test("Invite your team opens Users, where Invite User is", () => {
    const block: string = taskBlock("invite-team");

    expect(block).toContain("pageMap: PageMap.USERS");
    expect(block).not.toContain("PageMap.TEAMS");

    // …and the Users page does offer the button the step promises.
    expect(readCode("Pages/Users/Index.tsx")).toMatch(
      /title: "Invite User",\s*buttonStyle: ButtonStyleType\.NORMAL/,
    );
  });

  test("Create your first monitor opens the form, gated on the create permission", () => {
    const block: string = taskBlock("create-monitor");

    expect(block).toContain("pageMap: PageMap.MONITORS");
    expect(block).toMatch(
      /createPage: \{\s*pageMap: PageMap\.MONITOR_CREATE,\s*modelType: Monitor,?\s*\}/,
    );
    expect(code).toMatch(
      /PermissionGate\.check\(\s*new task\.createPage\.modelType\(\),\s*ModelAction\.Create,?\s*\)\s*\.isAllowed/,
    );
    expect(code).toContain("RouteMap[getTaskPageMap(task)]");
  });
});

describe("Create Monitor", () => {
  const code: string = readCode("Pages/Monitor/Create.tsx");

  test("the Probes help says what a probe is and is translated", () => {
    const match: RegExpMatchArray | null = code.match(
      new RegExp(`title: "Probes",\\s*description:\\s*${STRING_LITERAL}`),
    );

    expect(match).not.toBeNull();

    const help: string = unescapeLiteral(match![1]!);

    expect(help).toContain(
      "Probes are the machines that run this monitor's checks.",
    );
    // The old promise, that an empty selection means "use the defaults", is gone.
    expect(help).not.toMatch(/leave this empty/i);
    expect(code).not.toMatch(/Leave this empty to use every probe/);

    expectTranslatedEverywhere(help);
  });

  test("the form starts with the default interval and drops it for types without one", () => {
    expect(code).toMatch(
      /initialValues=\{\s*withDefaultMonitoringInterval\(\s*seededProbes\s*\?\s*\{ \.\.\.initialValues, probes: seededProbes \}\s*:\s*initialValues,?\s*\)\s*\}/,
    );
    expect(code).toMatch(
      /shouldDropDefaultMonitoringInterval\(\{\s*monitorType: item\.monitorType,\s*isIntervalPrefilled: Object\.prototype\.hasOwnProperty\.call\(\s*initialValues,\s*"monitoringInterval",?\s*\),?\s*\}\)/,
    );
    expect(code).toContain("delete item.monitoringInterval;");
  });
});
