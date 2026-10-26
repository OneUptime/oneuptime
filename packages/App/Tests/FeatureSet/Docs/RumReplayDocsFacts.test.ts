/*
 * Docs overhaul task 25b: what the Managing Applications, Session Replay,
 * Session Replay Troubleshooting and RUM Troubleshooting pages say about
 * OneUptime, held to the code that does it.
 *
 * The Session Replay pages were already held, sentence by sentence, to the
 * recorder, the ingest and the player by the SessionReplay*Docs suites.
 * This suite holds what the rewrite added or corrected: the Replay Policy's
 * settings as Edit Policy names them, with their defaults; the setup guide's
 * place; ignored error patterns; how an application is created, matched,
 * renamed, labelled, archived and kept; the rules that run on it; its
 * permissions and recommendations; and the refusals the troubleshooting
 * page explains. Where a page shows an example, the example is run through
 * the product code it describes.
 *
 * App tests read no React module, so the Dashboard's words are read from its
 * source files as text. Retention overrides are drawn by the Enterprise
 * Edition (ee/): that half of the suite runs where ee/ is checked out, which
 * is the Enterprise Edition Test workflow (.github/workflows/test.ee.yaml).
 */

import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import { readPage, scanMarkdown } from "./DocsContentSupport";
import { stepCount, tables } from "./DocsPageShape";
import { cardLines, escapeRegExp } from "./DocsTranslationChecks";
import { sectionInLanguage } from "./NetworkDocsLabels";
import {
  RUM_APPLICATIONS,
  RUM_REPLAY_PAGES,
  RUM_TROUBLESHOOTING,
  RumDocsPageEntry,
  SESSION_REPLAY,
  SESSION_REPLAY_TROUBLESHOOTING,
  SESSION_SIGNAL_OPTIONS,
  SESSION_SORT_OPTIONS,
} from "./RumDocsPages";
import {
  RumAlertTemplate,
  getAllRumAlertTemplates,
} from "Common/Types/Monitor/RumAlertTemplates";
import {
  DEFAULT_SESSION_REPLAY_RETENTION_IN_DAYS,
  SESSION_REPLAY_ALLOWED_RETENTION_DAYS,
} from "Common/Types/Rum/SessionReplay";
import { DEFAULT_BROWSER_KEY_REQUESTS_PER_MINUTE } from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import Permission from "Common/Types/Permission";
import { JSONArray } from "Common/Types/JSON";
import { extractOneuptimeLabelNames } from "Common/Server/Utils/Telemetry/OneuptimeLabel";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

const REPO_DIR: string = path.resolve(__dirname, "../../../../..");
const EE_DIR: string = path.join(REPO_DIR, "ee");
const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src";

const SOURCES: Record<string, string> = {
  rumApplications: `${DASHBOARD}/Pages/Rum/RumApplications.tsx`,
  rumSideMenu: `${DASHBOARD}/Pages/Rum/SideMenu.tsx`,
  applicationSideMenu: `${DASHBOARD}/Pages/Rum/View/SideMenu.tsx`,
  applicationSettings: `${DASHBOARD}/Pages/Rum/View/Settings.tsx`,
  labelRules: `${DASHBOARD}/Pages/Rum/Settings/LabelRules.tsx`,
  ownerRules: `${DASHBOARD}/Pages/Rum/Settings/OwnerRules.tsx`,
  replayPolicy: `${DASHBOARD}/Pages/Rum/View/SessionReplaySettings.tsx`,
  replayDocumentation: `${DASHBOARD}/Pages/Rum/View/SessionReplayDocumentation.tsx`,
  overview: `${DASHBOARD}/Pages/Rum/View/Overview.tsx`,
  settingsSideMenu: `${DASHBOARD}/Pages/Settings/SideMenu.tsx`,
  resourceDetailsCard: `${DASHBOARD}/Components/TelemetryResource/ResourceDetailsCard.tsx`,
  archiveCard: `${DASHBOARD}/Components/TelemetryResource/ArchiveResourceCard.tsx`,
  retentionLeftover: `${DASHBOARD}/Components/TelemetryResource/RetentionOverrideLeftoverCopy.ts`,
  enterpriseEligibility: `${DASHBOARD}/Enterprise/EnterpriseEligibility.ts`,
  replayRetentionCard: `${DASHBOARD}/Components/SessionReplay/SessionReplayRetentionSettingsCard.tsx`,
  privacySummaryCard: `${DASHBOARD}/Components/SessionReplay/PrivacySummaryCard.tsx`,
  installSnippet: `${DASHBOARD}/Components/SessionReplay/SessionReplayInstallSnippet.tsx`,
  listFilters: `${DASHBOARD}/Components/SessionReplay/SessionReplayListFilters.ts`,
  listFacets: `${DASHBOARD}/Components/SessionReplay/SessionReplayFacets.tsx`,
  listSearchBar: `${DASHBOARD}/Components/SessionReplay/SessionReplaySearchBar.tsx`,
  listSearchQuery: `${DASHBOARD}/Components/SessionReplay/SessionReplaySearchQuery.ts`,
  listTable: `${DASHBOARD}/Components/SessionReplay/SessionReplayTable.tsx`,
  filterChip: `${DASHBOARD}/Components/ResourceOwners/FilterChipDropdown.tsx`,
  facetFilterBar: `${DASHBOARD}/Components/ResourceOwners/FacetFilterBar.tsx`,
  moreMenuItem: "packages/Common/UI/Components/MoreMenu/MoreMenuItem.tsx",
  tableHeaderControls:
    "packages/Common/UI/Components/Table/TableHeaderControls.tsx",
  ruleForm: `${DASHBOARD}/Utils/Form/ResourceRuleForm.ts`,
  ruleTable: "packages/Common/UI/Components/RuleRun/RuleTable.tsx",
  foldedSectionTitles:
    "packages/Common/UI/Components/FoldedSection/FoldedSectionTitles.ts",
  rumApplicationModel:
    "packages/Common/Models/DatabaseModels/RumApplication.ts",
  rumSessionModel: "packages/Common/Models/AnalyticsModels/RumSession.ts",
  rumApplicationService:
    "packages/Common/Server/Services/RumApplicationService.ts",
  otelIngestBase:
    "packages/App/FeatureSet/Telemetry/Services/OtelIngestBaseService.ts",
  otelIngest: "packages/App/FeatureSet/Telemetry/API/OTelIngest.ts",
  replayIngest: "packages/App/FeatureSet/Telemetry/API/SessionReplayIngest.ts",
  ingestMiddleware: "packages/Common/Server/Middleware/TelemetryIngest.ts",
  errorRecorder: "packages/App/FeatureSet/BrowserRecorder/src/ErrorRecorder.ts",
  permissions: "packages/Common/Types/Permission.ts",
  configExample: "config.example.env",
};

// Drawn by the Enterprise Edition, where it is checked out.
const ENTERPRISE_RETENTION: string =
  "ee/Dashboard/TelemetryRetention/TelemetryResourceRetentionSettings.tsx";

const INLINE_CODE: RegExp = /`([^`\n]+)`/g;
// A permission's code name in a table's first cell: `ReadRumSessionReplay`.
const PERMISSION_CODE: RegExp = /`((?:Create|Read|Edit|Delete)Rum[A-Za-z]+)`/g;
// A permission's code name with its title in italics: `X` (_Title_).
const PERMISSION_WITH_TITLE: RegExp = /`([A-Za-z]+)` \(_([^_]+)_\)/g;
// A form field's column, then its title: field: { x: true }, title: "X",
const FORM_FIELD: RegExp = /field: \{ (\w+): true \},\s*title: "([^"]+)"/g;
// The same, with the title in a constant: title: SAME_ORIGIN_TITLE,
const FORM_FIELD_CONSTANT: RegExp =
  /field: \{ (\w+): true \},\s*title: ([A-Z][A-Z_]+),/g;
// A Permission.ts entry: the enum member, then its title.
const PERMISSION_TITLE: RegExp =
  /permission: Permission\.(\w+),\s*title: "([^"]+)"/g;
// A path through the Dashboard's menus written in italics, as pages used to.
const ITALIC_UI_PATH: RegExp = /(^|[\s(])_[A-Z][^_\n]*→[^_\n]*_/;
const NUMBERED_ITEM: RegExp = /^\d\. /;

function source(name: string): string {
  return fs.readFileSync(path.join(REPO_DIR, SOURCES[name] as string), "utf8");
}

function englishPage(page: string): string {
  return readPage("en", page);
}

function section(page: string, heading: string): string {
  return sectionInLanguage("en", page, heading);
}

function allMatches(
  text: string,
  pattern: RegExp,
  group: number,
): Array<string> {
  return Array.from(text.matchAll(pattern)).map(
    (match: RegExpMatchArray): string => {
      return match[group] as string;
    },
  );
}

/*
 * Each form field's title, by its column: the first field of each column,
 * which is the form's (the read-only details card below it names some
 * columns differently).
 */
function formFieldTitles(text: string): Map<string, string> {
  const titles: Map<string, string> = new Map<string, string>();

  for (const match of Array.from(text.matchAll(FORM_FIELD))) {
    if (!titles.has(match[1] as string)) {
      titles.set(match[1] as string, match[2] as string);
    }
  }

  // A title the file keeps in a constant: title: SOME_TITLE,
  for (const match of Array.from(text.matchAll(FORM_FIELD_CONSTANT))) {
    const value: string | undefined = text.match(
      new RegExp(
        `export const ${escapeRegExp(match[2] as string)}: string =\\s*"([^"]+)"`,
      ),
    )?.[1];

    if (value && !titles.has(match[1] as string)) {
      titles.set(match[1] as string, value);
    }
  }

  return titles;
}

// The title Permission.ts gives each permission.
function permissionTitles(): Map<string, string> {
  return new Map<string, string>(
    Array.from(source("permissions").matchAll(PERMISSION_TITLE)).map(
      (match: RegExpMatchArray): [string, string] => {
        return [match[1] as string, match[2] as string];
      },
    ),
  );
}

/*
 * The default a RumApplication column's @TableColumn declares: the
 * decorator block right above the property.
 */
function columnDefault(column: string): string {
  const model: string = source("rumApplicationModel");
  const property: number = model.indexOf(`public ${column}?:`);

  expect([column, property >= 0]).toEqual([column, true]);

  const before: string = model.slice(0, property);
  const block: string = before.slice(before.lastIndexOf("@TableColumn({"));
  const value: string | undefined = block.match(
    /defaultValue: ([^,\n]+),/,
  )?.[1];

  expect([column, value !== undefined]).toEqual([column, true]);

  return (value as string).trim();
}

// The rows of a page's table whose header starts with this cell.
function tableStartingWith(
  markdown: string,
  firstHeader: string,
): Array<Array<string>> {
  const table: Array<Array<string>> | undefined = tables(markdown).find(
    (rows: Array<Array<string>>): boolean => {
      return rows[0]?.[0] === firstHeader;
    },
  );

  expect([firstHeader, table !== undefined]).toEqual([firstHeader, true]);

  return (table as Array<Array<string>>).slice(1);
}

function rumGroup(): NavGroup {
  const group: NavGroup | undefined = DocsNav.find(
    (candidate: NavGroup): boolean => {
      return candidate.title === "Real User Monitoring";
    },
  );

  expect(group).toBeDefined();

  return group as NavGroup;
}

describe("the four pages in the docs' nav", () => {
  it("close the Real User Monitoring group, in this order", () => {
    const urls: Array<string> = rumGroup().links.map(
      (link: NavLink): string => {
        return link.url;
      },
    );

    expect(urls.slice(-4)).toEqual(
      RUM_REPLAY_PAGES.map((entry: RumDocsPageEntry): string => {
        return `/docs/${entry.page}`;
      }),
    );
  });

  it.each(RUM_REPLAY_PAGES)(
    "$page is titled as its nav link",
    (entry: RumDocsPageEntry) => {
      expect(englishPage(entry.page).split("\n")[0]).toBe(
        `# ${entry.navTitle}`,
      );
    },
  );

  it.each(RUM_REPLAY_PAGES)(
    "$page opens with cards to its own sections, draws a titled diagram and ends on Next steps",
    (entry: RumDocsPageEntry) => {
      const markdown: string = englishPage(entry.page);
      const opening: Array<string> = cardLines(
        markdown.slice(0, markdown.indexOf("\n## ")),
      );
      const diagrams: Array<{ info: string }> = scanMarkdown(
        markdown,
      ).fences.filter((fence: { lang: string }): boolean => {
        return fence.lang === "mermaid";
      });

      expect(opening.length).toBeGreaterThanOrEqual(4);

      for (const line of opening) {
        expect(line).toMatch(/^- \[[^\]]+\]\(#[^)]+\): /);
      }

      expect(diagrams.length).toBeGreaterThan(0);

      for (const diagram of diagrams) {
        expect(diagram.info).toMatch(/title="[^"]+"/);
      }

      const headings: Array<string> = scanMarkdown(markdown).headings.map(
        (heading: { text: string }): string => {
          return heading.text;
        },
      );

      expect(headings[headings.length - 1]).toBe("Next steps");
      expect(
        cardLines(markdown.slice(markdown.lastIndexOf("\n## Next steps\n")))
          .length,
      ).toBeGreaterThanOrEqual(3);
    },
  );

  it.each(RUM_REPLAY_PAGES)(
    "$page names the Dashboard in bold, never as an italic path or the old RUM shorthand",
    (entry: RumDocsPageEntry) => {
      const markdown: string = englishPage(entry.page);
      const italicPaths: Array<string> = markdown
        .split("\n")
        .filter((line: string): boolean => {
          return ITALIC_UI_PATH.test(line);
        });

      expect(italicPaths).toEqual([]);
      expect(markdown).not.toContain("_Replay Policy_");
      expect(markdown).not.toMatch(/\bRUM → /);
      expect(markdown).not.toContain("your application →");
      expect(markdown).not.toMatch(/left nav/i);
    },
  );

  it.each(RUM_REPLAY_PAGES)(
    "$page names the identity switch as Edit Policy does",
    (entry: RumDocsPageEntry) => {
      expect(englishPage(entry.page)).not.toContain("Capture user identity");
    },
  );
});

describe("Managing Applications: how an application is created", () => {
  const created: string = section(
    RUM_APPLICATIONS,
    "## How an application is created",
  );

  it("finds the application by its service.name, ignoring case, and creates it when the project has none", () => {
    const service: string = source("rumApplicationService");

    expect(service).toContain(
      "appIdentifier: QueryHelper.findWithSameText(data.appIdentifier)",
    );
    expect(service).toContain("newApp.name = data.appIdentifier;");
    expect(created).toContain("compared without regard to case");
    expect(created).toContain(
      "creates the application when the project has none",
    );
  });

  it("runs the label and owner rules when an application is created, discovered ones included", () => {
    const service: string = source("rumApplicationService");
    const onCreate: string =
      service.split("protected override async onCreateSuccess(")[1] || "";

    expect(onCreate).toContain(
      "RumApplicationLabelRuleEngineService.applyRulesToRumApplication",
    );
    expect(onCreate).toContain(
      "RumApplicationOwnerRuleEngineService.applyRulesToRumApplication",
    );
    expect(created).toContain('rules["Label and owner<br/>rules run"]');
    expect(
      section(RUM_APPLICATIONS, "## Label rules and owner rules"),
    ).toContain(
      "Rules run when an application is created, discovered ones included.",
    );
  });

  it("renames on the Application Details card, where the app name is shown and never changes", () => {
    const settings: string = source("applicationSettings");
    const model: string = source("rumApplicationModel");
    const appIdentifier: string =
      model
        .split("public appIdentifier?:")[0]
        ?.split("@ColumnAccessControl({")
        .pop() || "";

    expect(settings).toContain('title="Application Details"');
    expect(settings).toContain('title: "Display Name",');
    expect(settings).toContain('title: "App Name (service.name)",');
    // Its column takes no updates, so the card shows it and never edits it.
    expect(appIdentifier).toContain("update: [],");
    expect(source("resourceDetailsCard")).toContain(
      'translationKey("Edit Details")',
    );

    const rename: string = section(
      RUM_APPLICATIONS,
      "### Rename an application",
    );

    for (const label of [
      "Display Name",
      "Settings",
      "Edit Details",
      "Application Details",
      "App Name (service.name)",
    ]) {
      expect(rename).toContain(`**${label}**`);
    }

    expect(rename).toContain("never changes, so renaming is safe");
  });

  it("asks only for the app name on the create form, with the display name under More fields", () => {
    const list: string = source("rumApplications");

    expect(list).toContain('title: "App Name (service.name)",');
    expect(list).toMatch(
      /getDisplayNameFormField<RumApplication>\(\{[\s\S]*?collapsibleSection: advancedSection,/,
    );
    expect(source("foldedSectionTitles")).toContain(
      'MORE_FIELDS_SECTION_TITLE: string = translationKey("More fields")',
    );
    // A table's create button: "Create " and the model's singular name.
    expect(source("rumApplicationModel")).toContain(
      'singularName: "RUM Application",',
    );

    const add: string = section(
      RUM_APPLICATIONS,
      "### Add an application yourself",
    );

    expect(stepCount(add)).toBe(3);

    for (const label of [
      "Products → Resources → Real User Monitoring",
      "Create RUM Application",
      "App Name (service.name)",
      "More fields",
      "Display Name",
    ]) {
      expect(add).toContain(`**${label}**`);
    }
  });

  it("opens the application's setup guide once the form has saved it, waiting for its first data", () => {
    const list: string = source("rumApplications");
    const added: string = fs.readFileSync(
      path.join(
        REPO_DIR,
        DASHBOARD,
        "Components/Rum/RumApplicationAddedModal.tsx",
      ),
      "utf8",
    );
    const onboarding: string = fs.readFileSync(
      path.join(
        REPO_DIR,
        DASHBOARD,
        "Components/ResourceOnboarding/ResourceOnboarding.ts",
      ),
      "utf8",
    );

    expect(list).toContain("<RumApplicationAddedModal");
    expect(added).toContain("appName={props.appIdentifier}");
    expect(onboarding).toMatch(
      /RESOURCE_CONNECTION_STEP_TITLE: string = translationKey\(\s*"Wait for it to connect",?\s*\);/,
    );

    const add: string = section(
      RUM_APPLICATIONS,
      "### Add an application yourself",
    );

    expect(add).toContain(
      "Its setup guide then opens on its own, with the app name as the snippet's `service.name`.",
    );
    expect(add).toContain("**Wait for it to connect**");
  });

  it("refuses an app name the project already has, archived ones included", () => {
    const service: string = source("rumApplicationService");
    const refusal: string = fs.readFileSync(
      path.join(
        REPO_DIR,
        "packages/Common/Server/Utils/Telemetry/DiscoveredResourceCreate.ts",
      ),
      "utf8",
    );

    expect(service).toContain("DiscoveredResourceCreate.refuseClash({");
    expect(refusal).toContain("isArchived: true,");
    expect(refusal).toContain("ARCHIVED_RESOURCE_HINT");
    expect(
      section(RUM_APPLICATIONS, "## How an application is created"),
    ).toContain(
      "whether discovered, added before or archived, the form says so instead of creating a second one",
    );
  });
});

describe("Managing Applications: connection status", () => {
  const status: string = section(RUM_APPLICATIONS, "## Connection status");

  it("turns Disconnected after 15 minutes of silence, counted only while OneUptime was receiving", () => {
    const service: string = source("rumApplicationService");

    expect(service).toContain("silenceInMinutes: 15,");
    expect(service).toContain("ReceivingCoverage.getSilenceCutoff({");
    expect(status).toContain("**Disconnected** after 15 minutes without any");
    expect(status).toContain(
      "Time when OneUptime itself was down or catching up on its ingest queue does not count",
    );
  });

  it("says Last Seen can trail by about five minutes, the OpenTelemetry ingest's maintenance window", () => {
    const ingest: string = source("otelIngestBase");
    const service: string = source("rumApplicationService");

    expect(ingest).toContain(
      "private static readonly MAINTENANCE_FENCE_TTL_SECONDS: number = 5 * 60;",
    );
    /*
     * Last Seen and label promotion run only inside that window: the RUM
     * application's heartbeat is the maintenance of its fence scope, which
     * maintainDiscoveredResource runs only once shouldRunMaintenance admits it.
     */
    expect(ingest).toMatch(
      /fenceScope: "rum-application",[\s\S]*?RumApplicationService\.updateLastSeen/,
    );
    expect(ingest).toMatch(
      /protected static async maintainDiscoveredResource\([\s\S]*?if \(!\(await this\.shouldRunMaintenance\(data\.fenceScope, id\)\)\) \{\s*return id;\s*\}[\s\S]*?await data\.heartbeat\(/,
    );
    expect(service).toContain("const LAST_SEEN_THROTTLE_SECONDS: number = 60;");
    expect(status).toContain("trail live traffic by up to about five minutes");
    expect(status).not.toContain("one write per minute");
  });

  it("counts Session Replay traffic as well as OpenTelemetry telemetry", () => {
    expect(source("replayIngest")).toContain(
      "markApplicationAlive(decision.policy.rumApplicationId);",
    );
    expect(status).toContain(
      "OpenTelemetry telemetry and Session Replay traffic both count.",
    );
  });
});

describe("Managing Applications: labels", () => {
  const labels: string = section(RUM_APPLICATIONS, "## Labels");

  it("promotes the example's oneuptime.label attributes to the labels it names", () => {
    const sample: string = (
      scanMarkdown(labels).fences.find((fence: { lang: string }): boolean => {
        return fence.lang === "ts";
      }) as { code: string }
    ).code;
    const attributes: JSONArray = Array.from(
      sample.matchAll(/"(oneuptime\.label\.[a-z]+)": "([^"]+)"/g),
    ).map((match: RegExpMatchArray) => {
      return {
        key: match[1] as string,
        value: { stringValue: match[2] as string },
      };
    });

    expect(attributes).toHaveLength(2);
    expect(extractOneuptimeLabelNames(attributes)).toEqual([
      "team:payments",
      "env:production",
    ]);
    expect(labels).toContain(
      "This adds the labels `team:payments` and `env:production`",
    );
  });

  it("keeps two dimensions with one value apart, cuts at 100 characters and skips empty or non-string values", () => {
    expect(
      extractOneuptimeLabelNames([
        { key: "oneuptime.label.team", value: { stringValue: "prod" } },
        { key: "oneuptime.label.env", value: { stringValue: "prod" } },
        { key: "oneuptime.label.empty", value: { stringValue: "  " } },
        { key: "oneuptime.label.count", value: { intValue: 3 } },
      ]),
    ).toEqual(["team:prod", "env:prod"]);

    const long: Array<string> = extractOneuptimeLabelNames([
      { key: "oneuptime.label.note", value: { stringValue: "x".repeat(200) } },
    ]);

    expect(long[0]).toHaveLength(100);
    expect(labels).toContain(
      "A label longer than 100 characters is cut to 100, and an empty or non-string value adds nothing.",
    );
  });

  it("builds the example from the resource of Browser Setup", () => {
    const browserSetup: string = englishPage("rum/browser-setup");

    for (const name of [
      "defaultResource()",
      "resourceFromAttributes({",
      "[ATTR_SERVICE_NAME]",
    ]) {
      expect(browserSetup).toContain(name);
      expect(labels).toContain(name);
    }

    // A browser reads no environment variables.
    expect(labels).not.toContain("OTEL_RESOURCE_ATTRIBUTES");
  });
});

describe("Managing Applications: label rules and owner rules", () => {
  const rules: string = section(
    RUM_APPLICATIONS,
    "## Label rules and owner rules",
  );

  it("names the criteria fields both rule forms match on", () => {
    for (const page of ["labelRules", "ownerRules"]) {
      const form: string = source(page);

      for (const title of [
        "Application Labels",
        "Application Name",
        "Application Description",
      ]) {
        expect({
          page,
          title,
          inForm: form.includes(`title: "${title}",`),
        }).toEqual({
          page,
          title,
          inForm: true,
        });
        expect(rules).toContain(`**${title}**`);
      }
    }
  });

  it("walks the two steps the shared rule form has", () => {
    const form: string = source("ruleForm");

    for (const step of [
      '{ title: "Match", id: "match-criteria" }',
      '{ title: "Labels", id: "labels" }',
      '{ title: "Owners", id: "owners" }',
    ]) {
      expect(form).toContain(step);
    }

    expect(
      rules.split("\n").filter((line: string): boolean => {
        return NUMBERED_ITEM.test(line);
      }),
    ).toHaveLength(2);
    expect(rules).toContain("1. On **Match**");
    expect(rules).toContain(
      "2. On **Labels**, or **Owners** for an owner rule",
    );
  });

  it("runs a rule over the applications you already have with Run Now", () => {
    expect(source("ruleTable")).toContain('title: "Run Now",');
    expect(rules).toContain("**Run Now**");
    expect(rules).toContain("(/docs/configuration/run-rules-now)");
    // The old advice: rules never reach existing applications, rediscover them.
    expect(englishPage(RUM_APPLICATIONS)).not.toContain("not retroactive");
    expect(englishPage(RUM_APPLICATIONS)).not.toContain("rediscovered");
  });

  it("adds owners through rules, the list's Bulk Actions or the API: no page edits one application's", () => {
    const dashboardFiles: Array<string> = [];
    const walk: (dir: string) => void = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full: string = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith(".tsx")) {
          dashboardFiles.push(full);
        }
      }
    };

    walk(path.join(REPO_DIR, DASHBOARD));

    const ownerPages: Array<string> = dashboardFiles
      .filter((file: string): boolean => {
        const text: string = fs.readFileSync(file, "utf8");

        return (
          text.includes("RumApplicationOwnerUser") ||
          text.includes("RumApplicationOwnerTeam")
        );
      })
      .map((file: string): string => {
        return path.relative(path.join(REPO_DIR, DASHBOARD), file);
      })
      .sort();

    /*
     * The two lists read them - the Owner chip filters by them and the
     * Owners column shows them, through useResourceOwners - and the live
     * list writes them for the applications selected, through the shared
     * bulk owner actions (Add Owner, Remove Owner). No page has an Owners
     * card, and the owner tables are mentioned only as the imports and the
     * two hooks' arguments.
     */
    expect(ownerPages).toEqual([
      "Pages/Rum/Archived.tsx",
      "Pages/Rum/RumApplications.tsx",
    ]);

    for (const page of ownerPages) {
      const text: string = fs.readFileSync(
        path.join(REPO_DIR, DASHBOARD, page),
        "utf8",
      );

      expect({
        page,
        readsThem: text.includes("useResourceOwners<RumApplication>({"),
        ownersCard: text.includes("OwnersCard"),
        bulkOwnerActions: text.includes("useBulkOwnerActions"),
      }).toEqual({
        page,
        readsThem: true,
        ownersCard: false,
        // The live list's Bulk Actions; the Archived page only unarchives.
        bulkOwnerActions: page === "Pages/Rum/RumApplications.tsx",
      });

      const ownerTable: RegExp = /RumApplicationOwner(User|Team)/;
      const ownerTableImport: RegExp =
        /^import RumApplicationOwner(User|Team) from "Common\/Models\/DatabaseModels\/RumApplicationOwner(User|Team)";$/;
      const hookArgument: RegExp =
        /^owner(User|Team)ModelType: RumApplicationOwner(User|Team),$/;

      const otherMentions: Array<string> = text
        .split("\n")
        .map((line: string): string => {
          return line.trim();
        })
        .filter((line: string): boolean => {
          return (
            ownerTable.test(line) &&
            !ownerTableImport.test(line) &&
            !hookArgument.test(line)
          );
        });

      expect({ page, otherMentions }).toEqual({ page, otherMentions: [] });
    }

    for (const model of [
      "RumApplicationOwnerUser",
      "RumApplicationOwnerTeam",
    ]) {
      const route: string | undefined = fs
        .readFileSync(
          path.join(
            REPO_DIR,
            `packages/Common/Models/DatabaseModels/${model}.ts`,
          ),
          "utf8",
        )
        .match(/@CrudApiEndpoint\(new Route\("([^"]+)"\)\)/)?.[1];

      expect(route).toBeDefined();
      expect(section(RUM_APPLICATIONS, "### Owners")).toContain(
        `\`${route as string}\``,
      );
    }

    // The page says where the bulk actions are, in the Dashboard's words.
    const owners: string = section(RUM_APPLICATIONS, "### Owners");

    expect(owners).toContain(
      "**Add Owner** or **Remove Owner** under **Bulk Actions**",
    );
    expect(owners).not.toContain("no page to add them by hand");
    expect(englishPage(RUM_APPLICATIONS)).toContain(
      "choose **Add Labels** under **Bulk Actions**",
    );
  });
});

describe("Managing Applications: retention", () => {
  const retention: string = section(RUM_APPLICATIONS, "## Retention");

  it("keeps recordings 7 days by default, with the other choices the policy offers", () => {
    expect(DEFAULT_SESSION_REPLAY_RETENTION_IN_DAYS).toBe(7);

    const others: Array<number> = SESSION_REPLAY_ALLOWED_RETENTION_DAYS.filter(
      (days: number): boolean => {
        return days !== DEFAULT_SESSION_REPLAY_RETENTION_IN_DAYS;
      },
    );

    expect(retention).toContain(
      `| 7 days by default, or ${others.slice(0, -1).join(", ")} or ${others[others.length - 1]} days |`,
    );
  });

  it("names the Session Replay Retention card and its button as the Settings page draws them", () => {
    const card: string = source("replayRetentionCard");

    expect(card).toContain('title="Session Replay Retention"');
    expect(card).toContain('title: "Edit on Replay Policy",');
    expect(card).toContain(
      'other: "Session replays are kept for {{count}} days."',
    );
    expect(source("applicationSettings")).toContain(
      "<SessionReplayRetentionSettingsCard",
    );
    expect(retention).toContain("**Session Replay Retention**");
    expect(retention).toContain("**Edit on Replay Policy**");
    expect(retention).toContain("(_Session replays are kept for 7 days._)");
  });

  it("sells retention overrides on the Scale plan, and removes a leftover one on every plan", () => {
    expect(source("enterpriseEligibility")).toContain(
      "TELEMETRY_RETENTION_REQUIRED_PLAN: EnterpriseRequiredPlan =\n  PlanType.Scale;",
    );

    const leftover: string = source("retentionLeftover");

    expect(leftover).toContain('title: translationKey("Retention Override")');
    expect(leftover).toContain(
      'removeButton: translationKey("Remove Override")',
    );
    expect(retention).toContain(
      "**Retention Override** card with a **Remove Override** button",
    );
    expect(retention).toContain("Scale plan and above on OneUptime Cloud");
  });

  it("finds the project's retention under Project Settings, Telemetry & APM, Data Retention", () => {
    const sideMenu: string = source("settingsSideMenu");

    expect(sideMenu).toContain('title: "Telemetry & APM",');
    expect(sideMenu).toContain('title: "Data Retention",');
    expect(retention).toContain(
      "**Project Settings → Telemetry & APM → Data Retention**",
    );
  });

  it("names the override cards as the Enterprise Edition draws them, where ee/ is checked out", () => {
    // Core CI runs without ee/: the page is held to it wherever ee/ is present.
    if (!fs.existsSync(EE_DIR)) {
      return;
    }

    const enterprise: string = fs.readFileSync(
      path.join(REPO_DIR, ENTERPRISE_RETENTION),
      "utf8",
    );

    for (const text of [
      'title: "Telemetry Data Retention",',
      'title: "Retain Telemetry Data For (Days)",',
      'title: "Retention by Telemetry Type",',
    ]) {
      expect({ text, drawn: enterprise.includes(text) }).toEqual({
        text,
        drawn: true,
      });
    }

    const form: string = fs.readFileSync(
      path.join(
        REPO_DIR,
        "ee/Dashboard/TelemetryRetention/TelemetryRetentionConfigForm.tsx",
      ),
      "utf8",
    );

    for (const kind of ["Logs", "Traces", "Metrics", "Profiles"]) {
      expect(form).toContain(`"${kind} default (days)"`);
    }

    expect(retention).toContain(
      "- **Telemetry Data Retention** holds **Retain Telemetry Data For (Days)**",
    );
    expect(retention).toContain(
      "- **Retention by Telemetry Type** holds a default for logs, traces, metrics and profiles each, and for logs by severity and traces by status.",
    );
  });
});

describe("Managing Applications: archiving, permissions and alerts", () => {
  it("archives from Settings and finds archived applications under Advanced", () => {
    const rumMenu: string = source("rumSideMenu");
    const advanced: string = rumMenu.split('title: "Advanced",')[1] || "";

    expect(advanced).toContain('title: "Archived",');
    expect(source("archiveCard")).toContain(
      'title: isArchived ? "Unarchive" : "Archive",',
    );
    expect(source("applicationSettings")).toContain(
      "<ArchiveResourceCard<RumApplication>",
    );

    const applicationMenu: string = source("applicationSideMenu");

    expect(
      applicationMenu.split('<SideMenuSection title="Advanced">')[1],
    ).toContain('title: "Delete Application",');

    const archiving: string = section(
      RUM_APPLICATIONS,
      "## Archiving and deleting",
    );

    expect(archiving).toContain(
      "**Real User Monitoring → Advanced → Archived**",
    );
    expect(archiving).toContain("**Delete Application**");
  });

  it("lists every RUM permission the table names under its own title", () => {
    const titles: Map<string, string> = permissionTitles();
    const permissions: string = section(RUM_APPLICATIONS, "## Permissions");
    const named: Array<string> = allMatches(permissions, PERMISSION_CODE, 1);

    expect(named.length).toBeGreaterThan(10);

    for (const code of named) {
      expect({
        code,
        exists: Object.values(Permission).includes(code as Permission),
      }).toEqual({
        code,
        exists: true,
      });
    }

    const withTitles: Array<RegExpMatchArray> = Array.from(
      permissions.matchAll(PERMISSION_WITH_TITLE),
    );

    expect(withTitles.length).toBeGreaterThanOrEqual(5);

    for (const match of withTitles) {
      expect({ code: match[1], title: match[2] }).toEqual({
        code: match[1],
        title: titles.get(match[1] as string),
      });
    }
  });

  it("lets the Viewer role read applications, but not recordings", () => {
    const application: string = source("rumApplicationModel");
    const session: string = source("rumSessionModel");
    const sessionReaders: string =
      session.split("Permission.ReadRumSessionReplay,")[0]?.split("[").pop() ||
      "";

    expect(application).toContain("Permission.Viewer,");
    expect(sessionReaders).not.toContain("Permission.Viewer");
    expect(section(RUM_APPLICATIONS, "## Permissions")).toContain(
      "Anyone with the project's Viewer role can see RUM applications and their telemetry.",
    );
  });

  it("lists every recommendation by its group, as the templates name them", () => {
    const rows: Array<Array<string>> = tableStartingWith(
      section(RUM_APPLICATIONS, "## Alerting on RUM data"),
      "Group",
    );
    const templates: Array<RumAlertTemplate> = getAllRumAlertTemplates();
    const categories: Array<string> = Array.from(
      new Set(
        templates.map((template: RumAlertTemplate): string => {
          return template.category;
        }),
      ),
    );

    expect(
      rows.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual(categories);

    for (const template of templates) {
      const row: Array<string> = rows.find(
        (candidate: Array<string>): boolean => {
          return candidate[0] === template.category;
        },
      ) as Array<string>;

      if (template.category === "Session Replay") {
        // The four budget alerts are named on the Session Replay page.
        expect(row[1]).toContain("The four [storage budget alerts]");
        continue;
      }

      expect({
        name: template.name,
        listed: (row[1] as string).includes(template.name),
      }).toEqual({
        name: template.name,
        listed: true,
      });
    }
  });
});

describe("Session Replay: the policy, as Edit Policy names it", () => {
  const policy: string = source("replayPolicy");
  const titles: Map<string, string> = formFieldTitles(policy);

  it("puts every privacy setting in the table under the title the form gives it, with the model's default", () => {
    const rows: Array<Array<string>> = tableStartingWith(
      section(SESSION_REPLAY, "## Privacy"),
      "Setting",
    );
    const expected: Array<[string, string]> = [
      ["isSessionReplayEnabled", "On"],
      ["sessionReplayMaskingMode", "_Mask sensitive inputs only_"],
      ["sessionReplayConsentMode", "_Not required_"],
      ["sessionReplayCaptureTrigger", "_Always_"],
      ["sessionReplaySamplePercentage", "100%"],
      ["sessionReplayAllowedOrigins", "Empty: any origin"],
      ["sessionReplayCaptureUserIdentity", "On"],
      ["sessionReplaySameOriginTracePropagation", "On"],
      ["sessionReplayCaptureGeo", "On"],
      ["sessionReplayRecordCanvas", "Off"],
      ["sessionReplayRetentionInDays", "7 days"],
      ["sessionReplayMonthlyBudgetInGB", "Blank"],
    ];

    expect(
      rows.map((row: Array<string>): Array<string> => {
        return [row[0] as string, row[1] as string];
      }),
    ).toEqual(
      expected.map(([column, value]: [string, string]): Array<string> => {
        return [`**${titles.get(column) as string}**`, value];
      }),
    );

    // The defaults the rows state, as the model declares them.
    expect(columnDefault("isSessionReplayEnabled")).toBe("true");
    expect(columnDefault("sessionReplayMaskingMode")).toBe(
      "SessionReplayMaskingMode.MaskSensitiveInputsOnly",
    );
    expect(columnDefault("sessionReplayConsentMode")).toBe(
      "SessionReplayConsentMode.NotRequired",
    );
    expect(columnDefault("sessionReplayCaptureTrigger")).toBe(
      "SessionReplayCaptureTrigger.Always",
    );
    expect(columnDefault("sessionReplaySamplePercentage")).toBe("100");
    expect(columnDefault("sessionReplayCaptureUserIdentity")).toBe("true");
    expect(columnDefault("sessionReplaySameOriginTracePropagation")).toBe(
      "true",
    );
    expect(columnDefault("sessionReplayCaptureGeo")).toBe("true");
    expect(columnDefault("sessionReplayRecordCanvas")).toBe("false");
  });

  it("names the steps of Edit Policy the page sends readers to", () => {
    for (const step of [
      "Recording",
      "Masking",
      "Consent & Identity",
      "Performance & Tracing",
      "Limits",
    ]) {
      expect(policy).toContain(`{ title: "${step}", id: "`);
    }

    const page: string = englishPage(SESSION_REPLAY);

    expect(page).toContain(
      "on the **Performance & Tracing** step of **Edit Policy**",
    );
    expect(page).toContain("on the **Recording** step of **Edit Policy**");
    expect(englishPage(RUM_APPLICATIONS)).toContain("**Edit Policy → Limits**");
  });

  it("names the performance budgets as the form titles them", () => {
    const triggers: string = section(
      SESSION_REPLAY,
      "## Performance capture triggers",
    );

    for (const column of [
      "sessionReplayLcpBudgetMs",
      "sessionReplayLongTaskBudgetMs",
      "sessionReplaySlowRequestBudgetMs",
    ]) {
      expect(triggers).toContain(`| **${titles.get(column) as string}** |`);
    }
  });

  it("documents ignored error patterns as the recorder applies them", () => {
    const recorder: string = source("errorRecorder");

    expect(titles.get("sessionReplayIgnoreErrorPatterns")).toBe(
      "Ignored error patterns",
    );
    expect(recorder).toContain(
      "export const MAX_IGNORE_PATTERNS: number = 20;",
    );
    expect(recorder).toContain(
      "export const MAX_IGNORE_PATTERN_LENGTH: number = 200;",
    );
    // Recorded, but never the reason an error-triggered session uploads.
    expect(recorder).toContain(
      "isTriggerWorthy is false for errors that are recorded",
    );
    expect(recorder).toContain('cross-origin "Script error." noise');

    const triggers: string = section(
      SESSION_REPLAY,
      "## Performance capture triggers",
    );

    expect(triggers).toContain("**Ignored error patterns**");
    expect(triggers).toContain(
      "up to 20 regular expressions, of up to 200 characters each",
    );
    expect(triggers).toContain(
      "A matching error is still recorded in the session",
    );
    expect(triggers).toContain("`Script error.`");
  });

  it("calls the privacy summary by its card's title", () => {
    expect(source("privacySummaryCard")).toContain(
      'title="What a recording contains"',
    );

    const page: string = englishPage(SESSION_REPLAY);

    expect(page).toContain("**What a recording contains**");
    expect(page).not.toContain("Privacy summary");
  });
});

describe("Session Replay: the session list's filters", () => {
  const list: string = section(SESSION_REPLAY, "### The session list");

  // The labels of one option table of SessionReplayListFilters.ts.
  const optionLabels: (declaration: string) => Array<string> = (
    declaration: string,
  ): Array<string> => {
    const table: string =
      source("listFilters").split(declaration)[1]?.split("];")[0] || "";

    return allMatches(table, /label: "([^"]+)"/g, 1);
  };

  it("offers the Signal chip's options, and the sort menu's, as RumDocsPages lists them", () => {
    const signals: Array<string> = optionLabels(
      "SESSION_REPLAY_SIGNAL_OPTIONS: Array<SessionReplaySignalOption> = [",
    );

    // "All" is the chip cleared; the facets row offers every other signal.
    expect(signals[0]).toBe("All");
    expect(source("listFacets")).toContain('return option.value !== "all";');
    expect(signals.slice(1)).toEqual([...SESSION_SIGNAL_OPTIONS]);
    expect(
      optionLabels(
        "SESSION_REPLAY_SORT_OPTIONS: Array<SessionReplaySortOption> = [",
      ),
    ).toEqual([...SESSION_SORT_OPTIONS]);
  });

  it("draws a chip's options as the table writes them, and looks the sort menu's up in the locale", () => {
    const chip: string = source("filterChip");
    const table: string = source("listTable");

    // The option list and the chosen value both show the option's own label.
    expect(chip).toContain("{option.label}");
    expect(chip).toContain("return selectedOptions[0]!.label;");
    expect(chip).not.toMatch(/translate\w*\(\s*option\.label/);
    // The order is a ticked item per option in the Sort section of the ⋯.
    expect(table).toContain('<MoreMenuSection key="sort" title="Sort">');
    expect(table).toContain("{SESSION_REPLAY_SORT_OPTIONS.map(");
    expect(table).toContain("text={option.label}");
    // A sort option is not something a person named, so it is looked up.
    expect(table).not.toContain("isUserContent");
    expect(source("moreMenuItem")).toContain(
      "{translateString(props.text) ?? props.text}",
    );
  });

  it("names the chips above the list as the facets row draws them, its Clear all, and the ⋯ item that opens the filter form", () => {
    const facets: string = source("listFacets");
    const chips: Array<string> = [
      ...(facets.includes('label="Signal"') ? ["Signal"] : []),
      ...allMatches(
        facets.split("export const SESSION_REPLAY_FACETS")[1]?.split("];")[0] ||
          "",
        /field: "\w+",\s*label: "([^"]+)"/g,
        1,
      ),
    ];

    expect(chips).toEqual([
      "Signal",
      "Browser",
      "OS",
      "Device",
      "Country",
      "Trigger",
      "Duration",
    ]);

    for (const chip of chips) {
      expect(list).toContain(`**${chip}**`);
    }

    // The list has no Quick filters: that is the player's rail.
    expect(list).not.toContain("Quick filters");
    // Clear all, at the end of the chips row, empties every chip.
    expect(source("facetFilterBar")).toContain(
      'translator.translateText("Clear all")',
    );
    expect(facets).toContain(
      "onClearAll={activeCount > 0 ? props.onClearAll : undefined}",
    );
    expect(list).toContain(
      "**Clear all** at the end of the row empties them all",
    );
    // The filter form opens from Filter in the ⋯ that ends the header.
    expect(source("listTable")).toMatch(
      /<MoreMenuItem\s+key="filter"\s+text="Filter"/,
    );
    expect(list).toContain(
      "**Filter** in the **⋯** menu opens the same fields as a form",
    );
    expect(list).not.toContain("Advanced filters");
  });

  it("names the header's search, the key that opens it, and the tokens the chips take over", () => {
    const lines: Array<string> = list.split("\n");
    const search: string =
      lines.find((line: string): boolean => {
        return line.startsWith("**Search.**");
      }) || "";
    const chipTokens: Array<string> = allMatches(
      source("listSearchQuery")
        .split("SEARCH_BOX_CHIP_TOKEN_KEYS: ReadonlyArray<string> = [")[1]
        ?.split("];")[0] || "",
      /"(\w+)"/g,
      1,
    ).map((key: string): string => {
      return `\`${key}:\``;
    });
    const tokensLine: string =
      lines.find((line: string): boolean => {
        return line.includes("`Enter` moves it into its chip");
      }) || "";

    // The search is the header's "Search…" pill until it is used; / opens it.
    expect(source("tableHeaderControls")).toContain('{tx("Search…")}');
    expect(source("listTable")).toContain("<TableHeaderSearchSlot");
    expect(source("listTable")).toContain(
      "useTableHeaderSearchShortcut(true, openSearch);",
    );
    expect(search).toContain(
      "The search box is the **Search…** field in the list's header; `/` opens it from anywhere on the page",
    );

    // Every token a chip holds narrows as typed and moves to its chip on Enter.
    expect(chipTokens).toHaveLength(6);
    expect(tokensLine).toContain(
      `a ${chipTokens.slice(0, -1).join(", ")} or ${chipTokens[chipTokens.length - 1]} token narrows the list as you type`,
    );
  });

  it("offers Show ID in a row's ⋯, Refresh in the header's, and no Users button over the list", () => {
    const table: string = source("listTable");
    const users: string =
      englishPage(SESSION_REPLAY)
        .split("\n")
        .find((line: string): boolean => {
          return line.includes("`.../session-replay-users`");
        }) || "";

    /*
     * Show ID is a row action placed in the row's ⋯: its placement follows
     * its title within the same few lines (read with indexOf).
     */
    const showId: number = table.indexOf('title: "Show ID",');

    expect(showId).toBeGreaterThan(-1);
    expect(
      table
        .slice(showId, showId + 300)
        .includes("placement: ActionButtonPlacement.MoreMenu,"),
    ).toBe(true);
    expect(list).toContain(
      "Its **⋯** menu has **Show ID**, the session's whole ID to copy",
    );
    // Refresh, after the 10 minutes of self-refreshing, is in the header's ⋯.
    expect(table).toMatch(/<MoreMenuItem\s+key="refresh"\s+text="Refresh"/);
    expect(list).toContain(
      "after that, **Refresh** in the **⋯** menu reads it again",
    );
    // The Users page is reached from the side menu and the identify() banner.
    expect(users).toContain("reachable from the `identify()` banner");
    expect(users).not.toContain("**Users** button");
  });

  it("orders the list by the sort menu's options, and names its page sizes", () => {
    const sentence: string =
      list.split("\n").find((line: string): boolean => {
        return line.includes("**Signal**");
      }) || "";

    expect(sentence).toContain(
      `orders the list by ${SESSION_SORT_OPTIONS.slice(0, -1).join(", ")} or ${SESSION_SORT_OPTIONS[SESSION_SORT_OPTIONS.length - 1]}.`,
    );
    expect(source("listFilters")).toMatch(
      /SESSION_REPLAY_ITEMS_ON_PAGE_OPTIONS: Array<number> = \[\s*20, 50, 100,\s*\]/,
    );
    expect(sentence).toContain("Page size is 20, 50 or 100.");
  });
});

describe("Session Replay: installing it", () => {
  const install: string = section(SESSION_REPLAY, "## Install");

  it("walks three steps, from a Browser key to a recorded session", () => {
    expect(stepCount(install)).toBe(3);
    expect(install).toContain("pick **Browser** as the **Key Type**");
    expect(install).toContain("marked **Recording now**");
  });

  it("sends readers to the setup guide on the Session Replay Documentation page, and names its variants", () => {
    const documentationPage: string = source("replayDocumentation");
    const snippet: string = source("installSnippet");
    const applicationMenu: string = source("applicationSideMenu");
    const replaySection: string =
      applicationMenu
        .split('<SideMenuSection title="Session Replay">')[1]
        ?.split("</SideMenuSection>")[0] || "";

    expect(documentationPage).toContain("<SessionReplaySetupGuide");
    expect(replaySection).toContain('title: "Documentation",');
    expect(snippet).toContain('nextjs: "Next.js / React",');
    expect(snippet).toContain('gtm: "Google Tag Manager",');
    expect(install).toContain(
      "The application's **Documentation** page, in the **Session Replay** section of its side menu, shows this snippet",
    );
    expect(install).toContain(
      "with Next.js / React and Google Tag Manager versions of it",
    );
  });

  it("installs React Native in two steps", () => {
    expect(
      stepCount(section(SESSION_REPLAY, "## Install in React Native")),
    ).toBe(2);
  });
});

describe("Session Replay Troubleshooting: the switches", () => {
  it("offers each diagnostics switch as a tab, the deployment's from config.example.env", () => {
    const diagnostics: string = section(
      SESSION_REPLAY_TROUBLESHOOTING,
      "## Turn on diagnostics",
    );

    expect(diagnostics.split("\n@tab ").length - 1).toBe(6);
    expect(source("configExample")).toContain("SESSION_REPLAY_DEBUG=false");
    expect(diagnostics).toContain("`SESSION_REPLAY_DEBUG=true`");
  });
});

describe("RUM Troubleshooting: the refusals, as OneUptime sends them", () => {
  const page: string = englishPage(RUM_TROUBLESHOOTING);

  it("reads the key check's answer the way the endpoint writes it", () => {
    const ingest: string = source("otelIngest");
    const validate: string =
      ingest
        .split('"/otlp/v1/validate",')[1]
        ?.split("// Queue stats endpoint")[0] || "";

    expect(validate).toContain("valid: true,");
    expect(validate).toContain("projectId: policy.projectId.toString(),");
    expect(validate).toContain("keyType: policy.keyType,");
    // Missing, unknown or revoked, switched off and expired keys are all 401.
    expect(validate.split("statusCode: new StatusCode(401)").length - 1).toBe(
      3,
    );

    const answers: Array<Array<string>> = tableStartingWith(
      section(RUM_TROUBLESHOOTING, "## Check the key"),
      "Answer",
    );

    expect(
      answers.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual(['`200` with `"valid": true`', '`401` with `"valid": false`']);
    expect(answers[0]?.[1]).toContain("`keyType`");
    expect(answers[0]?.[1]).toContain("`projectId`");
    expect(answers[1]?.[1]).toContain(
      "missing, unknown, revoked, switched off or expired",
    );
  });

  it("quotes the ingest's 422 and 429 refusals word for word", () => {
    const middleware: string = source("ingestMiddleware");

    for (const message of [
      "This telemetry ingestion key has been disabled.",
      "Too many telemetry requests for this ingestion key. Please retry later.",
    ]) {
      expect(middleware).toContain(`"${message}"`);
      expect(page).toContain(message);
    }

    expect(middleware).toContain("new TooManyRequestsException(");
    expect(DEFAULT_BROWSER_KEY_REQUESTS_PER_MINUTE).toBe(6000);
    expect(page).toContain(
      "A Browser key allows 6000 requests a minute for all your visitors together",
    );
  });

  it("opens each status with a bold lead the way the 413 check reads it", () => {
    for (const status of ["401", "404", "413", "422", "429"]) {
      expect(page).toContain(`\n**\`${status}\`.** `);
    }
  });

  it("says the overview opens on the past hour", () => {
    expect(source("overview")).toContain("range: TimeRange.PAST_ONE_HOUR,");
    expect(page).toContain("The overview shows the past hour by default");
  });

  it("files the telemetry by the attributes the classifier reads", () => {
    const ingest: string = source("otelIngestBase");
    const rows: Array<Array<string>> = tableStartingWith(
      section(RUM_TROUBLESHOOTING, "## Check where the telemetry lands"),
      "Kind",
    );
    const named: Array<string> = rows.flatMap(
      (row: Array<string>): Array<string> => {
        return allMatches(row[1] as string, INLINE_CODE, 1);
      },
    );

    for (const attribute of named) {
      expect({ attribute, read: ingest.includes(`"${attribute}"`) }).toEqual({
        attribute,
        read: true,
      });
    }

    expect(named).toEqual(
      expect.arrayContaining([
        "browser.platform",
        "browser.language",
        "browser.brands",
        "device.id",
        "device.model.identifier",
        "device.manufacturer",
        "host.name",
        "host.id",
        "k8s.node.name",
      ]),
    );
  });

  it("names the Clients page by what fills it", () => {
    const ingest: string = source("otelIngestBase");

    expect(ingest).toMatch(
      /this\.getStringAttribute\(data\.attributes, "browser\.platform"\) \|\|\s*this\.getStringAttribute\(data\.attributes, "device\.model\.identifier"\)/,
    );
    expect(
      section(RUM_TROUBLESHOOTING, "## The Clients page is empty"),
    ).toContain(
      "The **Clients** page lists `browser.platform` on the web and `device.model.identifier` on mobile.",
    );
  });
});

describe("the code samples", () => {
  it.each([RUM_APPLICATIONS, RUM_TROUBLESHOOTING])(
    "%s has only TypeScript samples that parse",
    (page: string) => {
      const samples: Array<{ code: string }> = scanMarkdown(
        englishPage(page),
      ).fences.filter((fence: { lang: string }): boolean => {
        return fence.lang === "ts";
      });

      expect(samples.length).toBeGreaterThan(0);

      for (const sample of samples) {
        const output: ts.TranspileOutput = ts.transpileModule(sample.code, {
          reportDiagnostics: true,
          compilerOptions: { target: ts.ScriptTarget.ES2020 },
        });

        expect(output.diagnostics || []).toEqual([]);
      }
    },
  );
});
