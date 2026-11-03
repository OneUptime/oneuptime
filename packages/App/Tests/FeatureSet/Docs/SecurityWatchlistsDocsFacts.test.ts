import { SECURITY_EVENTS } from "./AiObservabilityDocsPages";
import { DocsHeading, readPage, scanMarkdown } from "./DocsContentSupport";
import { tables } from "./DocsPageShape";
import { RUN_ON_PAST_EVENTS } from "../../../FeatureSet/Dashboard/src/Components/SecurityEvents/Retrohunt/RetrohuntCopy";
import {
  SecurityEventSearchFilters,
  parseSecurityEventSearch,
} from "../../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsSearchQuery";
import { getWatchlistCreateFields } from "../../../FeatureSet/Dashboard/src/Components/SecurityEvents/Watchlists/WatchlistFormFields";
import {
  EXPIRES_FIELD_TITLE,
  EXPORT_VALUES,
  IMPORT_MODE_ADD_TITLE,
  IMPORT_MODE_REPLACE_TITLE,
  IMPORT_VALUES,
  READ_BY_COLUMN_TITLE,
  SOURCE_URL_TITLE,
  STARTERS_TITLE,
  URL_CARD_TITLE,
  URL_READ_NOW,
  USE_IN_RULE_TITLE,
  VALUE_SINGULAR,
  WATCHLISTS_TABLE_TITLE,
  WATCHLIST_FILTERS_TITLE,
  WATCHLIST_SINGULAR,
} from "../../../FeatureSet/Dashboard/src/Components/SecurityEvents/Watchlists/WatchlistsCopy";
import { getWatchlistHoldsKey } from "../../../FeatureSet/Dashboard/src/Components/SecurityEvents/Watchlists/WatchlistsModel";
import {
  SECURITY_EVENTS_MENU,
  SecurityEventsMenuItem,
  SecurityEventsMenuSection,
} from "../../../FeatureSet/Dashboard/src/Utils/SecurityEventsNavigation";
import DetectionRule from "Common/Models/DatabaseModels/DetectionRule";
import SecurityWatchlist from "Common/Models/DatabaseModels/SecurityWatchlist";
import SecurityWatchlistItem from "Common/Models/DatabaseModels/SecurityWatchlistItem";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import SigmaClickhouseCompiler from "Common/Server/Utils/SecurityEvent/Sigma/SigmaClickhouseCompiler";
import SecurityWatchlistUrlImport, {
  SecurityWatchlistUrlReadError,
} from "Common/Server/Utils/SecurityEvent/Watchlists/SecurityWatchlistUrlImport";
import NotOnWatchlist from "Common/Types/BaseDatabase/NotOnWatchlist";
import OnWatchlist from "Common/Types/BaseDatabase/OnWatchlist";
import Permission from "Common/Types/Permission";
import { SecurityEntityType } from "Common/Types/SecurityCase/SecurityEntity";
import {
  SECURITY_WATCHLISTS_PER_PROJECT_MAX,
  SECURITY_WATCHLIST_ENTITY_TYPES,
  SECURITY_WATCHLIST_EXPORT_HEADER,
  SECURITY_WATCHLIST_FEED_ENTITY_TYPES,
  SECURITY_WATCHLIST_IMPORT_MAX_CHARACTERS,
  SECURITY_WATCHLIST_IMPORT_SCHEDULES,
  SECURITY_WATCHLIST_MESSAGES,
  SECURITY_WATCHLIST_PATTERN_VALUES_MAX,
  SECURITY_WATCHLIST_RANGE_VALUES_MAX,
  SECURITY_WATCHLIST_VALUES_MAX,
  SecurityWatchlistImportMode,
  SecurityWatchlistImportResult,
  SecurityWatchlistImportSchedule,
  SecurityWatchlistSource,
  SecurityWatchlistValueMatch,
  SigmaWatchlists,
  getMissingSecurityWatchlistsMessage,
  getSecurityWatchlistImportUrlProblem,
  getSecurityWatchlistSearchSnippet,
  getSecurityWatchlistValueMatch,
  getSecurityWatchlistValueProblem,
  hasSecurityWatchlistValueExpired,
  matchesSecurityWatchlistPattern,
  parseSecurityWatchlistImport,
  writeSecurityWatchlistCsv,
} from "Common/Types/SecurityEvent/SecurityWatchlist";
import {
  WatchlistReaderKind,
  describeWatchlistReaders,
} from "Common/Types/SecurityEvent/SecurityWatchlistFilter";
import { DetectionRuleDefinition } from "Common/Types/SecurityEvent/SigmaCorrelation";
import SigmaRule from "Common/Types/SecurityEvent/SigmaRule";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/FoldedSection/FoldedSectionTitles";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { createTranslator } from "Common/UI/Utils/TranslateTemplate";
import SigmaRuleSetParser, {
  sigmaRulesOf,
} from "Common/Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import {
  SigmaWatchlistReference,
  bindSigmaWatchlists,
  getDetectionRuleWatchlistReferences,
} from "Common/Utils/SecurityEvent/Sigma/SigmaWatchlists";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the Security Events page says about watchlists, held to the code
 * that does it: where the lists are and what each page and button is
 * called, how a rule reads one, what a list holds and how a value matches,
 * importing, a value's expiry, exporting, a list read from an address,
 * following a threat intel feed, monitors and searches that read lists, the
 * rules, monitors and hunts a save refuses and the lists that cannot be
 * renamed, the limits, who may change them, and the Troubleshooting entries. Every bold name is the Dashboard's own word (the
 * copy modules), so a renamed label fails here until the page follows.
 *
 * Its other languages are held line for line to this page by
 * AiToolingAndSecurityDocsTranslations.
 */

const REPO_DIR: string = path.resolve(__dirname, "..", "..", "..", "..");
const SECURITY: string = "Common/Server/Utils/SecurityEvent";

const SOURCES: Record<string, string> = {
  evaluator: `${SECURITY}/DetectionRuleEvaluator.ts`,
  retrohunt: `${SECURITY}/DetectionRuleRetrohunt.ts`,
  watchlistView:
    "App/FeatureSet/Dashboard/src/Pages/SecurityEvents/WatchlistView.tsx",
  importModal:
    "App/FeatureSet/Dashboard/src/Components/SecurityEvents/Watchlists/WatchlistImportModal.tsx",
  watchlistsJob:
    "App/FeatureSet/Workers/Jobs/SecurityEvents/SecurityWatchlists.ts",
  watchlistsReader: `${SECURITY}/Watchlists/SecurityWatchlists.ts`,
  urlImport: `${SECURITY}/Watchlists/SecurityWatchlistUrlImport.ts`,
  monitorValidator:
    "Common/Server/Utils/Monitor/MonitorStepsProjectValidator.ts",
  huntService: "Common/Server/Services/SecurityHuntService.ts",
  watchlistService: "Common/Server/Services/SecurityWatchlistService.ts",
};

const LINE_BREAK: RegExp = /\n/;
const HEADING: string = "Watchlists";
const EXAMPLE_TITLE: string = "admin-sign-in-from-outside.yml";

function source(name: string): string {
  return fs
    .readFileSync(path.join(REPO_DIR, SOURCES[name] as string), "utf8")
    .replace(/\s+/g, " ");
}

function englishPage(): string {
  return readPage("en", SECURITY_EVENTS);
}

// A section of the page, from its heading to the next heading of its level or above.
function section(markdown: string, heading: string): string {
  const headings: Array<DocsHeading> = scanMarkdown(markdown).headings;
  const index: number = headings.findIndex((entry: DocsHeading): boolean => {
    return entry.text === heading;
  });

  expect({ heading, found: index >= 0 }).toEqual({ heading, found: true });

  const start: DocsHeading = headings[index] as DocsHeading;
  const next: DocsHeading | undefined = headings
    .slice(index + 1)
    .find((entry: DocsHeading): boolean => {
      return entry.level <= start.level;
    });
  const lines: Array<string> = markdown.split(LINE_BREAK);

  return lines
    .slice(start.line, next ? next.line - 1 : lines.length)
    .join("\n");
}

// The one line of a section that starts with these words.
function lineStarting(
  markdown: string,
  heading: string,
  start: string,
): string {
  const found: Array<string> = section(markdown, heading)
    .split(LINE_BREAK)
    .filter((candidate: string): boolean => {
      return candidate.startsWith(start);
    });

  expect({ start, found: found.length }).toEqual({ start, found: 1 });

  return found[0] as string;
}

// A Troubleshooting entry's text, by its title.
function troubleshooting(markdown: string, title: string): string {
  const lines: Array<string> = section(markdown, "Troubleshooting").split(
    LINE_BREAK,
  );
  const index: number = lines.indexOf(`:::details ${title}`);

  expect({ title, found: index >= 0 }).toEqual({ title, found: true });
  expect(lines[index + 2]).toBe(":::");

  return lines[index + 1] as string;
}

// The code block of the section with this title.
function codeBlockTitled(markdown: string, title: string): string {
  const lines: Array<string> = markdown.split(LINE_BREAK);
  const start: number = lines.indexOf(`\`\`\`yaml title="${title}"`);

  expect({ title, found: start >= 0 }).toEqual({ title, found: true });

  const end: number = lines.indexOf("```", start + 1);

  return lines.slice(start + 1, end).join("\n");
}

function permissionSet(permissions: Array<Permission>): Array<string> {
  return [...new Set(permissions.map(String))].sort();
}

// What a list holds, as the page writes it in a sentence: "IP addresses", "other values".
function holdsInProse(type: SecurityEntityType): string {
  const words: string = getWatchlistHoldsKey(type);

  return words === "URLs" || words.startsWith("IP ")
    ? words
    : words.toLowerCase();
}

function joinedWithOr(words: Array<string>): string {
  return `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`;
}

// The lists a rule names, bound as a project that keeps them binds them.
function boundAsSaved(yaml: string): Array<SigmaRule> {
  const definition: DetectionRuleDefinition = SigmaRuleSetParser.parse(yaml);
  const watchlists: SigmaWatchlists = {};

  for (const reference of getDetectionRuleWatchlistReferences(definition)) {
    watchlists[reference.key] = {
      name: reference.name,
      entityType: SecurityEntityType.User,
      exactValues: ["alice@example.com"],
      patterns: [],
      ranges: [],
    };
  }

  return sigmaRulesOf(bindSigmaWatchlists(definition, watchlists));
}

describe("the Security Events page on watchlists", () => {
  const page: string = englishPage();

  it("lists Watchlists under Detections, right after Rule Exceptions, as the menu does", () => {
    const detections: SecurityEventsMenuSection | undefined =
      SECURITY_EVENTS_MENU.find((entry: SecurityEventsMenuSection): boolean => {
        return entry.title === "Detections";
      });

    expect(
      detections?.items.map((item: SecurityEventsMenuItem): string => {
        return item.title;
      }),
    ).toEqual(
      expect.arrayContaining(["Rule Exceptions", WATCHLISTS_TABLE_TITLE]),
    );

    const rows: Array<Array<string>> = tables(section(page, "How it works"))
      .flat()
      .filter((row: Array<string>): boolean => {
        return row[0] === "**Rule Exceptions**" || row[0] === `**${HEADING}**`;
      });

    expect(rows).toEqual([
      expect.arrayContaining(["**Rule Exceptions**", "Detections"]),
      [
        `**${WATCHLISTS_TABLE_TITLE}**`,
        "Detections",
        "The lists your rules match against, such as VIP users, critical hosts, known-bad file hashes and the addresses admins may sign in from",
      ],
    ]);
  });

  it("names expand among the field modifiers, linking to the section", () => {
    expect(
      lineStarting(page, "What a rule can say", "- Field modifiers:"),
    ).toContain(
      "`exists`, `windash` and `expand`, which reads a [watchlist](#watchlists).",
    );
  });

  it("finds the lists where the menu has them, and names each page, button and card as the Dashboard draws it", () => {
    expect(
      lineStarting(page, HEADING, "A watchlist is a list your team keeps"),
    ).toBe(
      `A watchlist is a list your team keeps once and any rule can read, such as VIP users, critical hosts, known-bad file hashes or the addresses admins may sign in from. Every list is under **Products → Security Events → Detections → ${WATCHLISTS_TABLE_TITLE}**: create one there with **Create ${WATCHLIST_SINGULAR}**, which asks for its name and what it holds, or add a common one from **${STARTERS_TITLE}**. A list's page shows its values, and **${USE_IN_RULE_TITLE}** gives a selection that reads the list, to copy into a rule, and the search that reads it on **Events** or in a hunt.`,
    );
    expect([STARTERS_TITLE, USE_IN_RULE_TITLE]).toEqual([
      "Start with a common list",
      "Use This List",
    ]);

    // Events is the menu's own page, where the search runs.
    expect(
      SECURITY_EVENTS_MENU.flatMap(
        (entry: SecurityEventsMenuSection): Array<string> => {
          return entry.items.map((item: SecurityEventsMenuItem): string => {
            return item.title;
          });
        },
      ),
    ).toContain("Events");

    // The search the card gives reads the list as the search bar does, whatever its kind.
    for (const entityType of SECURITY_WATCHLIST_ENTITY_TYPES) {
      const search: string = getSecurityWatchlistSearchSnippet({
        name: "vip_users",
        entityType,
      });
      const filters: SecurityEventSearchFilters =
        parseSecurityEventSearch(search);

      expect({ entityType, attributes: filters.attributes }).toEqual({
        entityType,
        attributes: {},
      });
      expect(Object.values(filters.fields)).toEqual([
        new OnWatchlist("vip_users"),
      ]);
    }

    expect(
      getSecurityWatchlistSearchSnippet({
        name: "vip_users",
        entityType: SecurityEntityType.User,
      }),
    ).toBe("principalUser:%vip_users%");
  });

  it("reads a list with expand and its name between % signs, as the example does", () => {
    expect(
      lineStarting(page, HEADING, "A rule reads a list with `expand`"),
    ).toBe(
      "A rule reads a list with `expand` and the list's name between `%` signs. This rule fires when an admin signs in from an address that is not on the allowed list:",
    );

    const yaml: string = codeBlockTitled(page, EXAMPLE_TITLE);
    const references: Array<SigmaWatchlistReference> =
      getDetectionRuleWatchlistReferences(SigmaRuleSetParser.parse(yaml));

    expect(
      references.map((reference: SigmaWatchlistReference): string => {
        return reference.name;
      }),
    ).toEqual(["admins", "admin_addresses"]);
    expect(yaml).toContain("condition: admin_sign_in and not allowed");

    // Its lists bound, as a save binds them: one rule, the allowed list negated.
    const statements: Array<Statement> = boundAsSaved(yaml).map(
      (rule: SigmaRule): Statement => {
        return SigmaClickhouseCompiler.compile(rule);
      },
    );

    expect(statements).toHaveLength(1);
    expect(statements[0]!.query).toContain("principalUser");
    expect(statements[0]!.query).toContain("principalIp");
    expect(statements[0]!.query).toContain("NOT (");

    // A project without the lists has its save refused, naming the first.
    expect(() => {
      SigmaClickhouseCompiler.compileYaml(yaml);
    }).toThrow(getMissingSecurityWatchlistsMessage(["admins"]));
  });

  it("names what a list can hold, and how a value matches", () => {
    expect(lineStarting(page, HEADING, "- A list holds users, hosts")).toBe(
      `- A list holds ${joinedWithOr(SECURITY_WATCHLIST_ENTITY_TYPES.map(holdsInProse))}, chosen when it is created. A value matches whatever its case, and \`*\` stands for any run of characters: \`svc-*\` matches every service account. An IP address list also takes ranges, such as \`10.20.0.0/16\`, and a file hash list takes MD5, SHA-1, SHA-256 and SHA-512 hashes.`,
    );

    // Whatever the case, and * for any run of characters.
    expect(matchesSecurityWatchlistPattern("svc-*", "SVC-Backup")).toBe(true);
    expect(matchesSecurityWatchlistPattern("svc-*", "backup-svc")).toBe(false);

    // A range in an IP address list is a range; elsewhere, a value as written.
    expect(
      getSecurityWatchlistValueMatch({
        value: "10.20.0.0/16",
        entityType: SecurityEntityType.IpAddress,
      }),
    ).toBe(SecurityWatchlistValueMatch.Range);
    expect(
      getSecurityWatchlistValueMatch({
        value: "10.20.0.0/16",
        entityType: SecurityEntityType.Other,
      }),
    ).toBe(SecurityWatchlistValueMatch.Exact);

    // A file hash list takes MD5, SHA-1, SHA-256 and SHA-512 digests, and nothing else.
    for (const length of [32, 40, 64, 128]) {
      expect(
        getSecurityWatchlistValueProblem({
          value: "a".repeat(length),
          entityType: SecurityEntityType.FileHash,
        }),
      ).toBeNull();
    }

    expect(
      getSecurityWatchlistValueProblem({
        value: "a".repeat(48),
        entityType: SecurityEntityType.FileHash,
      }),
    ).not.toBeNull();
  });

  it("adds values one at a time or imports them, a note after a comma, adding or replacing", () => {
    expect(lineStarting(page, HEADING, "- Add values one at a time")).toBe(
      `- Add values one at a time with **Add ${VALUE_SINGULAR}**, or many at once with **${IMPORT_VALUES}**: paste them, or choose a \`.txt\` or \`.csv\` file, one value a line, with an optional note after a comma. **${IMPORT_MODE_ADD_TITLE}** keeps the values already on it, and **${IMPORT_MODE_REPLACE_TITLE}** removes the ones the import does not have.`,
    );

    // The values table adds with Add, and the dialog takes these files.
    expect(source("watchlistView")).toContain('createVerb="Add"');
    expect(source("importModal")).toContain(
      'accept=".txt,.csv,text/plain,text/csv"',
    );

    const parsed: SecurityWatchlistImportResult = parseSecurityWatchlistImport({
      text: "alice@example.com, CFO\nbob@example.com",
      entityType: SecurityEntityType.User,
    });

    expect(parsed.values).toEqual([
      { value: "alice@example.com", note: "CFO" },
      { value: "bob@example.com", note: "" },
    ]);
    expect(Object.values(SecurityWatchlistImportMode)).toEqual([
      "add",
      "replace",
    ]);
  });

  it("keeps a value until its Expires At: no read sees it from then on, and it leaves the list within a minute", () => {
    expect(lineStarting(page, HEADING, "- A value can have an")).toBe(
      `- A value can have an **${EXPIRES_FIELD_TITLE}**: from then on no rule, monitor, hunt or search reads it, and OneUptime removes it from the list within a minute. Left empty, it stays until someone removes it.`,
    );

    const now: Date = new Date("2026-11-03T12:00:00.000Z");

    // From the moment on, not a moment before; and never without one.
    expect(
      hasSecurityWatchlistValueExpired(new Date("2026-11-03T12:00:00Z"), now),
    ).toBe(true);
    expect(
      hasSecurityWatchlistValueExpired(new Date("2026-11-03T12:00:01Z"), now),
    ).toBe(false);
    expect(hasSecurityWatchlistValueExpired(null, now)).toBe(false);

    // Every read of a list's values leaves out the ones whose moment has come.
    expect(source("watchlistsReader")).toContain(
      "expiresAt: QueryHelper.greaterThanOrNull( data.now || OneUptimeDate.getCurrentDate(), ),",
    );

    // The sweep that deletes them runs every minute.
    const job: string = source("watchlistsJob");

    expect(job).toContain(
      'RunCron( "SecurityWatchlists:RemoveExpiredValues", { schedule: EVERY_MINUTE,',
    );
    expect(job).toContain(
      "await SecurityWatchlistExpiry.removeExpiredValues();",
    );
  });

  it("exports a list as a CSV of value, note and expires, which Import Values reads back with each value's note and expiry", () => {
    expect(lineStarting(page, HEADING, "- **Export Values** downloads")).toBe(
      `- **${EXPORT_VALUES}** downloads a list's values as a CSV file with the columns \`value\`, \`note\` and \`expires\`, which **${IMPORT_VALUES}** reads back. A file whose first line names these columns gives each value its note and when it expires: a date such as \`2026-12-31\`, or a date and time in UTC.`,
    );
    expect(SECURITY_WATCHLIST_EXPORT_HEADER).toEqual([
      "value",
      "note",
      "expires",
    ]);

    // The view's toolbar names the export as the page does.
    expect(source("watchlistView")).toContain("EXPORT_VALUES");

    const now: Date = new Date("2026-11-03T12:00:00.000Z");
    const exported: string = writeSecurityWatchlistCsv([
      {
        value: "alice@example.com",
        note: "CFO",
        expiresAt: new Date("2026-12-31T18:00:00.000Z"),
      },
      { value: "bob@example.com", note: "" },
    ]);

    expect(exported.split("\r\n")[0]).toBe("value,note,expires");

    // Read back: each value with its note and when it leaves the list.
    expect(
      parseSecurityWatchlistImport({
        text: exported,
        entityType: SecurityEntityType.User,
        now,
      }).values,
    ).toEqual([
      {
        value: "alice@example.com",
        note: "CFO",
        expiresAt: new Date("2026-12-31T18:00:00.000Z"),
      },
      { value: "bob@example.com", note: "" },
    ]);

    // A date alone is that day, from its start in UTC.
    expect(
      parseSecurityWatchlistImport({
        text: "value,note,expires\nalice@example.com,CFO,2026-12-31",
        entityType: SecurityEntityType.User,
        now,
      }).values,
    ).toEqual([
      {
        value: "alice@example.com",
        note: "CFO",
        expiresAt: new Date("2026-12-31T00:00:00.000Z"),
      },
    ]);
  });

  it("reads a list from a file at an https address on its schedule, chosen under More fields, as an import reads a file", () => {
    expect(
      lineStarting(page, HEADING, "- A list can be read from a file"),
    ).toBe(
      `- A list can be read from a file at an https address instead, again **${SecurityWatchlistImportSchedule.EveryHour}**, **${SecurityWatchlistImportSchedule.EverySixHours}** or **${SecurityWatchlistImportSchedule.EveryDay}**: choose **${SOURCE_URL_TITLE}** under **${MORE_FIELDS_SECTION_TITLE}** when you create it. Each read makes the list what the file holds, read as an import reads it. A read that fails changes no value and the list's page says why, and **${URL_READ_NOW}** reads it at once.`,
    );
    // The schedules the form offers, every one of them named.
    expect(SECURITY_WATCHLIST_IMPORT_SCHEDULES).toEqual([
      SecurityWatchlistImportSchedule.EveryHour,
      SecurityWatchlistImportSchedule.EverySixHours,
      SecurityWatchlistImportSchedule.EveryDay,
    ]);

    // Create Watchlist offers the address, and asks for it, under More fields.
    const fields: Array<ModelField<SecurityWatchlist>> =
      getWatchlistCreateFields({
        translator: createTranslator(undefined, "en"),
        // Only the fields' folds are read here: nothing is drawn.
        renderSourceChoice: (): never => {
          throw new Error("Create Watchlist is not drawn in App's tests.");
        },
      });

    for (const name of ["source", "importUrl", "importSchedule"]) {
      const field: ModelField<SecurityWatchlist> | undefined = fields.find(
        (candidate: ModelField<SecurityWatchlist>): boolean => {
          return Object.keys(candidate.field || {})[0] === name;
        },
      );

      expect({ name, fold: field?.collapsibleSection?.title }).toEqual({
        name,
        fold: MORE_FIELDS_SECTION_TITLE,
      });
    }

    expect(SecurityWatchlistSource.Url).toBe("URL");

    // Only https, and a whole address.
    expect(
      getSecurityWatchlistImportUrlProblem("https://example.com/vip.csv"),
    ).toBeNull();
    expect(
      getSecurityWatchlistImportUrlProblem("http://example.com/vip.csv"),
    ).toBe(SECURITY_WATCHLIST_MESSAGES.urlNotHttps.message);

    // Each read is an import's read of the file, and replaces the list.
    const read: string = source("urlImport");

    expect(read).toContain(
      "const parsed: SecurityWatchlistImportResult = parseSecurityWatchlistImport({",
    );
    expect(read).toContain("mode: SecurityWatchlistImportMode.Replace,");

    // A file that is no list is refused before any value changes.
    expect(() => {
      SecurityWatchlistUrlImport.readFile({
        text: "<!doctype html><html><body>Sign in</body></html>",
        entityType: SecurityEntityType.User,
        now: new Date(),
      });
    }).toThrow(SecurityWatchlistUrlReadError);
  });

  it("follows a threat intel feed only for the kinds a feed carries", () => {
    expect(lineStarting(page, HEADING, "- Instead of keeping values")).toBe(
      `- Instead of keeping values, a list of ${joinedWithOr(SECURITY_WATCHLIST_FEED_ENTITY_TYPES.map(holdsInProse))} can follow a threat intel feed: its values are the feed's active indicators of the list's kind, kept up to date as the feed is read.`,
    );
  });

  it("uses expand alone, matches a list field by any of its values, and names who reads each list", () => {
    expect(lineStarting(page, HEADING, "- `expand` is used alone")).toBe(
      `- \`expand\` is used alone, since the list's values say how they match. A field that holds several values, such as \`observables\`, matches when any of them is on the list. **${READ_BY_COLUMN_TITLE}** names the rules, Security Events monitors and hunts that read each list, and under a rule's YAML its form names the lists the rule reads.`,
    );

    // What reads a list: rules, monitors and hunts, each a monitor or a hunt said so.
    expect(Object.values(WatchlistReaderKind)).toEqual([
      "Detection Rule",
      "Monitor",
      "Hunt",
    ]);
    expect(
      describeWatchlistReaders([
        {
          kind: WatchlistReaderKind.DetectionRule,
          id: "1",
          name: "VIP sign-in",
        },
        { kind: WatchlistReaderKind.Monitor, id: "2", name: "VIP logons" },
        { kind: WatchlistReaderKind.Hunt, id: "3", name: "Admin hunt" },
      ]),
    ).toBe("VIP sign-in (rule), VIP logons (monitor), Admin hunt (hunt)");
    expect(source("watchlistsReader")).toContain(
      "MonitorStepsReferenceExtractor.extractWatchlistNames(",
    );
    expect(source("watchlistsReader")).toContain(
      "getSecurityHuntWatchlistNames(",
    );

    // expand with another modifier is refused when the rule is saved.
    expect(() => {
      SigmaRuleSetParser.parse(
        "title: t\ndetection:\n  selection:\n    principalUser|expand|contains: '%vip_users%'\n  condition: selection\n",
      );
    }).toThrow();
  });

  it("reaches a rule at its next run, correlations and Run on Past Events included", () => {
    expect(lineStarting(page, HEADING, "- A change to a list")).toBe(
      `- A change to a list reaches every rule that reads it at the rule's next run. Correlation rules and **${RUN_ON_PAST_EVENTS}** read lists too.`,
    );

    // Each turn reads the lists afresh; Run on Past Events binds them as runs do.
    expect(source("evaluator")).toContain(
      "const watchlists: SecurityWatchlistReader = SecurityWatchlists.readerFor(projectId);",
    );
    expect(source("retrohunt")).toContain(
      "definition = await SecurityWatchlists.readerFor(data.projectId).bind(",
    );
  });

  it("reads lists in a Security Events monitor's Filter by Watchlists, and in a search as user:%vip_users%, a minus keeping what is not on the list", () => {
    expect(
      lineStarting(page, HEADING, "- A Security Events monitor reads lists"),
    ).toBe(
      `- A Security Events monitor reads lists in its **${WATCHLIST_FILTERS_TITLE}**, and a search on **Events** or in a hunt reads one as \`user:%vip_users%\`. A minus in front, as in \`-ip:%admin_addresses%\`, keeps the events whose field is not on the list.`,
    );

    const onList: SecurityEventSearchFilters =
      parseSecurityEventSearch("user:%vip_users%");
    const notOnList: SecurityEventSearchFilters = parseSecurityEventSearch(
      "-ip:%admin_addresses%",
    );

    expect(onList.fields).toEqual({
      principalUser: new OnWatchlist("vip_users"),
    });
    expect(notOnList.fields).toEqual({
      principalIp: new NotOnWatchlist("admin_addresses"),
    });
    expect(notOnList.fields["principalIp"]).toBeInstanceOf(NotOnWatchlist);
  });

  it("keeps a list to its limits; lists change as detection rules do, values as a rule's edit, every Security role reads both, and every change is audited", () => {
    expect(lineStarting(page, HEADING, "- A list holds at most")).toBe(
      `- A list holds at most ${SECURITY_WATCHLIST_VALUES_MAX.toLocaleString("en-US")} values, at most ${SECURITY_WATCHLIST_PATTERN_VALUES_MAX} of them with \`*\` and ${SECURITY_WATCHLIST_RANGE_VALUES_MAX} of them ranges, and a project has at most ${SECURITY_WATCHLISTS_PER_PROJECT_MAX} lists: for a longer list, follow a threat intel feed. Whoever may create, edit or delete detection rules may do the same to lists, and whoever may edit detection rules adds, changes and removes their values. Every Security role can read them, and each change is kept in the project's audit log.`,
    );

    const rule: DetectionRule = new DetectionRule();
    const list: SecurityWatchlist = new SecurityWatchlist();
    const value: SecurityWatchlistItem = new SecurityWatchlistItem();

    // A list: each action as a detection rule's own.
    expect(permissionSet(list.getCreatePermissions())).toEqual(
      permissionSet(rule.getCreatePermissions()),
    );
    expect(permissionSet(list.getUpdatePermissions())).toEqual(
      permissionSet(rule.getUpdatePermissions()),
    );
    expect(permissionSet(list.getDeletePermissions())).toEqual(
      permissionSet(rule.getDeletePermissions()),
    );

    // Its values: added, changed and removed by whoever may edit detection rules.
    for (const permissions of [
      value.getCreatePermissions(),
      value.getUpdatePermissions(),
      value.getDeletePermissions(),
    ]) {
      expect(permissionSet(permissions)).toEqual(
        permissionSet(rule.getUpdatePermissions()),
      );
    }

    for (const model of [list, value]) {
      for (const role of [
        Permission.SecurityAdmin,
        Permission.SecurityMember,
        Permission.SecurityViewer,
      ]) {
        expect(model.getReadPermissions()).toContain(role);
      }

      expect(model.enableAuditLogOn).toMatchObject({
        create: true,
        update: true,
        delete: true,
      });
    }
  });

  it("refuses a rule, a monitor or a hunt that names no list of the project, and keeps a list that one of them reads", () => {
    expect(lineStarting(page, HEADING, "- A rule names a list")).toBe(
      "- A rule names a list whatever the case. A rule, a monitor or a hunt that names a list the project does not have is refused when you save it, and a list that one of them reads cannot be renamed or deleted until nothing reads it.",
    );

    // A monitor's save and a hunt's ask the project for the lists they name.
    expect(source("monitorValidator")).toContain(
      "await SecurityWatchlists.assertProjectHas({ projectId: data.projectId, names: introduced, });",
    );
    expect(source("huntService")).toContain(
      "names: getSecurityHuntWatchlistNames(createBy.data.searchQuery),",
    );
    expect(source("huntService")).toContain(
      "names: getSecurityHuntWatchlistNames(searchQuery),",
    );

    // A rename or a delete asks what reads the list: rules, monitors and hunts.
    expect(
      source("watchlistService").split("SecurityWatchlists.findReaders(")
        .length - 1,
    ).toBeGreaterThanOrEqual(2);

    // Whatever the case: a rule's '%VIP_Users%' is the list vip_users.
    expect(
      getDetectionRuleWatchlistReferences(
        SigmaRuleSetParser.parse(
          "title: t\ndetection:\n  selection:\n    principalUser|expand: '%VIP_Users%'\n  condition: selection\n",
        ),
      ),
    ).toEqual([{ name: "VIP_Users", key: "vip_users" }]);
  });

  it("answers a rule that does not match, a list that cannot be renamed, and a list whose read fails, in Troubleshooting", () => {
    expect(
      troubleshooting(page, "A rule that reads a watchlist doesn't match"),
    ).toBe(
      `Open the list and check its values: a value without \`*\` must equal the whole field, whatever its case, and a list that follows a threat intel feed holds only the feed's active indicators of its kind. Check that the rule reads the field your events fill: **${USE_IN_RULE_TITLE}** starts with the field a list of its kind is usually in. A change to a list reaches a rule at the rule's next run.`,
    );
    expect(
      troubleshooting(page, "A watchlist can't be renamed or deleted"),
    ).toBe(
      "Rules, monitors or hunts still read it by its name, and the message names them. Change the name in them, or take the list out of them, then rename or delete it.",
    );
    expect(
      troubleshooting(page, "A list read from an address shows an error"),
    ).toBe(
      `Its page says why under **${URL_CARD_TITLE}**, with what the address answered, and the list keeps the values of its last read that worked. The address must start with \`https\`, answer from the internet without a sign-in, and download a text or CSV file of at most 4 MB, not a web page. Fix it in **Edit**, then choose **${URL_READ_NOW}**.`,
    );

    // At most 4 MB: a larger file is refused, and the list keeps its values.
    expect(SECURITY_WATCHLIST_IMPORT_MAX_CHARACTERS).toBe(4 * 1024 * 1024);
    expect(() => {
      SecurityWatchlistUrlImport.readFile({
        text: "a".repeat(SECURITY_WATCHLIST_IMPORT_MAX_CHARACTERS + 1),
        entityType: SecurityEntityType.Other,
        now: new Date(),
      });
    }).toThrow(SECURITY_WATCHLIST_MESSAGES.urlFileTooLarge.message);

    // The page keeps the last read's error, and what the address said.
    expect(source("urlImport")).toContain("lastImportError: outcome.error,");
    expect(source("urlImport")).toContain(
      "lastImportErrorDetail: outcome.errorDetail",
    );
  });
});
