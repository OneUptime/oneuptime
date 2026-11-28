// UX rule: Docs/ux/README.md#names
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * AT MOST THREE MARKED WORDS ON A PAGE, EACH THE FIRST TIME IT IS MET.
 *
 * A defined term (Common/UI/Components/Glossary/DefinedTerm) draws a word
 * with a dotted line and shows its Glossary definition on hover, focus or
 * tap (#6819). One marked word where a page first uses it helps; a page
 * full of dotted lines is worse than none (Docs/ux/README.md#names). So:
 *
 *   - no file marks more than three terms, counting the terms of the
 *     Dashboard components it draws (one level of imports): a form and the
 *     note it draws are one page;
 *   - no file marks the same term twice, nor do the components it draws
 *     mark a term it or another of them marks (#7020): two components of
 *     one page marked the same word;
 *   - the twenty-eight words the audits found people trip on are each
 *     marked where a core flow first meets them;
 *   - the hard forms each link the docs page that explains them.
 *
 * A term is marked by a form field's `glossaryTerm`, a card's or a table's
 * `titleGlossaryTerm`, or a DefinedTerm drawn directly. The marks are read
 * from the source, so this guard sees a mark however a page is reached.
 * What it cannot see - a page put together from components several imports
 * apart - the page counts as it draws (GlossaryMarks, held by
 * Common's GlossaryMarksPerPageGuard): the first word of each term marked,
 * three terms at most, the rest drawn as plain words. This guard says so
 * where the code is written, before a mark someone added is quietly drawn
 * plain.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const MAX_MARKED_TERMS_PER_PAGE: number = 3;

// Every way the Dashboard marks a term, each naming it as GlossaryTerm.<Name>.
const MARK_PATTERNS: ReadonlyArray<RegExp> = [
  /\bglossaryTerm:\s*GlossaryTerm\.(\w+)/g,
  /\bglossaryTerm=\{\s*GlossaryTerm\.(\w+)\s*\}/g,
  /\btitleGlossaryTerm:\s*GlossaryTerm\.(\w+)/g,
  /\btitleGlossaryTerm=\{\s*GlossaryTerm\.(\w+)\s*\}/g,
  /<DefinedTerm\s+term=\{\s*GlossaryTerm\.(\w+)\s*\}/g,
];

// Comments say how a term is marked without marking one.
const withoutComments: (source: string) => string = (
  source: string,
): string => {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
};

const marksIn: (source: string) => Array<string> = (
  source: string,
): Array<string> => {
  const code: string = withoutComments(source);
  const found: Array<{ index: number; term: string }> = [];

  for (const pattern of MARK_PATTERNS) {
    for (const match of code.matchAll(pattern)) {
      found.push({ index: match.index || 0, term: match[1]! });
    }
  }

  return found
    .sort((a: { index: number }, b: { index: number }): number => {
      return a.index - b.index;
    })
    .map((mark: { term: string }): string => {
      return mark.term;
    });
};

/*
 * A Dashboard's source, as the checks below read it: its files by full
 * path, and where it keeps its components. Read from the checkout, or
 * planted by the tests that show each check fails.
 */
interface DashboardSources {
  root: string;
  files: Map<string, string>;
}

const SOURCE_FILE: RegExp = /\.tsx?$/;

const sourceFiles: (directory: string) => Array<string> = (
  directory: string,
): Array<string> => {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...sourceFiles(full));
    } else if (SOURCE_FILE.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
};

const DASHBOARD: DashboardSources = {
  root: DASHBOARD_SRC,
  files: new Map(
    sourceFiles(DASHBOARD_SRC).map((file: string): [string, string] => {
      return [file, fs.readFileSync(file, "utf8")];
    }),
  ),
};

// The Dashboard files a file imports by a relative path.
const RELATIVE_IMPORT: RegExp = /from\s+"(\.{1,2}\/[^"]+)"/g;

/*
 * The components a file draws: what it imports from Components/. A page it
 * imports is a page of its own - a route table imports every page it routes
 * to, and draws one at a time.
 */
const importedComponents: (
  sources: DashboardSources,
  file: string,
) => Array<string> = (
  sources: DashboardSources,
  file: string,
): Array<string> => {
  const componentsDir: string = path.join(sources.root, "Components");
  const imported: Array<string> = [];

  for (const match of sources.files.get(file)!.matchAll(RELATIVE_IMPORT)) {
    const base: string = path.resolve(path.dirname(file), match[1]!);

    if (!base.startsWith(componentsDir + path.sep)) {
      continue;
    }

    for (const candidate of [`${base}.tsx`, `${base}.ts`]) {
      if (sources.files.has(candidate)) {
        imported.push(candidate);
        break;
      }
    }
  }

  return imported;
};

// A file's marks and those of the components it draws, one level down.
const pageMarksOf: (sources: DashboardSources, file: string) => Array<string> = (
  sources: DashboardSources,
  file: string,
): Array<string> => {
  return [
    ...marksIn(sources.files.get(file)!),
    ...importedComponents(sources, file).flatMap(
      (imported: string): Array<string> => {
        return marksIn(sources.files.get(imported)!);
      },
    ),
  ];
};

const relativeTo: (sources: DashboardSources, file: string) => string = (
  sources: DashboardSources,
  file: string,
): string => {
  return path.relative(sources.root, file).split(path.sep).join("/");
};

// Pages that mark more than three terms: "Pages/X.tsx: A, B, C, D".
const crowdedPages: (sources: DashboardSources) => Array<string> = (
  sources: DashboardSources,
): Array<string> => {
  const crowded: Array<string> = [];

  for (const file of Array.from(sources.files.keys())) {
    const distinct: Set<string> = new Set(pageMarksOf(sources, file));

    if (distinct.size > MAX_MARKED_TERMS_PER_PAGE) {
      crowded.push(
        `${relativeTo(sources, file)}: ${Array.from(distinct).join(", ")}`,
      );
    }
  }

  return crowded;
};

// Files that mark one term twice themselves: "Pages/X.tsx: Probe".
const filesMarkingTwice: (sources: DashboardSources) => Array<string> = (
  sources: DashboardSources,
): Array<string> => {
  const twice: Array<string> = [];

  for (const [file, source] of Array.from(sources.files.entries())) {
    const seen: Set<string> = new Set();

    for (const term of marksIn(source)) {
      if (seen.has(term)) {
        twice.push(`${relativeTo(sources, file)}: ${term}`);
      }
      seen.add(term);
    }
  }

  return twice;
};

/*
 * Pages whose components mark a term the page, or another of them, marks
 * too (#7020): "Pages/X.tsx: Probe". One file marking a term twice is
 * filesMarkingTwice's.
 */
const pagesMarkingTwice: (sources: DashboardSources) => Array<string> = (
  sources: DashboardSources,
): Array<string> => {
  const twice: Array<string> = [];

  for (const file of Array.from(sources.files.keys())) {
    const byFile: Array<Set<string>> = [
      new Set(marksIn(sources.files.get(file)!)),
      ...importedComponents(sources, file).map(
        (imported: string): Set<string> => {
          return new Set(marksIn(sources.files.get(imported)!));
        },
      ),
    ];
    const seen: Set<string> = new Set();
    const repeated: Set<string> = new Set();

    for (const terms of byFile) {
      for (const term of Array.from(terms)) {
        if (seen.has(term)) {
          repeated.add(term);
        }
        seen.add(term);
      }
    }

    for (const term of Array.from(repeated)) {
      twice.push(`${relativeTo(sources, file)}: ${term}`);
    }
  }

  return twice.sort();
};

/*
 * A page whose two parts that mark one term are never drawn together, each
 * with why. The page counts what it draws (GlossaryMarks) either way; an
 * entry here says the two marks were meant.
 */
const MARKED_TWICE_NEVER_TOGETHER: Readonly<Record<string, string>> = {
  "Components/GuidedSetup/WebsiteDown/WebsiteDownGuidedSetup.tsx: OnCallPolicy":
    "Step 2 says the on-call policy it will make (its note marks the word), or shows the existing policy's When this goes down (whose row marks it): one or the other, never both.",
  "Components/Form/Monitor/MonitorStep.tsx: Criteria":
    "Its Criteria card for most monitor types, or the telemetry rule editor's When to alert for a Logs, Traces, Metrics or Exceptions monitor (#6935): one or the other, never both.",
};

const read: (file: string) => string = (file: string): string => {
  return DASHBOARD.files.get(path.join(DASHBOARD_SRC, ...file.split("/")))!;
};

// A planted Dashboard: files by their path under its src, as written.
const planted: (files: Record<string, string>) => DashboardSources = (
  files: Record<string, string>,
): DashboardSources => {
  const root: string = path.join(path.sep, "planted", "src");

  return {
    root: root,
    files: new Map(
      Object.entries(files).map(
        (entry: [string, string]): [string, string] => {
          return [path.join(root, ...entry[0].split("/")), entry[1]];
        },
      ),
    ),
  };
};

describe("the guard's reading of the source", () => {
  test("finds every way a term is marked, in order, and none in a comment", () => {
    const sample: string = [
      "/* glossaryTerm: GlossaryTerm.Rule in a comment */",
      "// <DefinedTerm term={GlossaryTerm.Role}>",
      '{ title: "Probes", glossaryTerm: GlossaryTerm.Probe }',
      "<Card titleGlossaryTerm={GlossaryTerm.Criteria} />",
      "{ titleGlossaryTerm: GlossaryTerm.SLO }",
      "<DefinedTerm term={GlossaryTerm.Layer}>",
      "<FieldLabelElement glossaryTerm={GlossaryTerm.State} />",
    ].join("\n");

    expect(marksIn(sample)).toEqual([
      "Probe",
      "Criteria",
      "SLO",
      "Layer",
      "State",
    ]);
  });

  test("finds the marks the Dashboard makes", () => {
    const total: number = Array.from(DASHBOARD.files.values()).reduce(
      (sum: number, source: string): number => {
        return sum + marksIn(source).length;
      },
      0,
    );

    expect(total).toBeGreaterThanOrEqual(28);
  });

  test("counts the marks of a component a file draws", () => {
    expect(
      pageMarksOf(
        DASHBOARD,
        path.join(
          DASHBOARD_SRC,
          "Components",
          "Form",
          "Monitor",
          "MonitorCriteriaInstance.tsx",
        ),
      ),
    ).toEqual(["Incident", "Alert"]);
  });
});

/*
 * Each check fails on a Dashboard planted with what it forbids, so a check
 * that stopped finding anything could not pass for one that found nothing
 * wrong.
 */
describe("the checks fail on a planted page", () => {
  const PLANTED: DashboardSources = planted({
    // Four terms between a page and the components it draws.
    "Pages/Crowded.tsx": [
      'import Note from "../Components/Note";',
      "<Card titleGlossaryTerm={GlossaryTerm.Probe} />",
      "<DefinedTerm term={GlossaryTerm.Criteria}>criteria</DefinedTerm>",
    ].join("\n"),
    "Components/Note.tsx": [
      "<DefinedTerm term={GlossaryTerm.Incident}>incident</DefinedTerm>",
      "<DefinedTerm term={GlossaryTerm.Alert}>alert</DefinedTerm>",
    ].join("\n"),
    // Two components of one page that each mark the same word (#7020).
    "Pages/Twice.tsx": [
      'import First from "../Components/First";',
      'import Second from "../Components/Second";',
    ].join("\n"),
    "Components/First.tsx": "{ glossaryTerm: GlossaryTerm.Probe }",
    "Components/Second.tsx":
      "<DefinedTerm term={GlossaryTerm.Probe}>probes</DefinedTerm>",
    // A page that marks a word its own component marks too.
    "Pages/Again.tsx": [
      'import First from "../Components/First";',
      "<Card titleGlossaryTerm={GlossaryTerm.Probe} />",
    ].join("\n"),
    // One file marking one word twice.
    "Pages/Repeats.tsx": [
      "<Card titleGlossaryTerm={GlossaryTerm.Label} />",
      "{ glossaryTerm: GlossaryTerm.Label }",
    ].join("\n"),
    // As it should be: three terms, each once, across the page.
    "Pages/Fine.tsx": [
      'import Note from "../Components/Note";',
      "<Card titleGlossaryTerm={GlossaryTerm.Probe} />",
    ].join("\n"),
  });

  test("more than three terms on a page", () => {
    expect(crowdedPages(PLANTED)).toEqual([
      "Pages/Crowded.tsx: Probe, Criteria, Incident, Alert",
    ]);
  });

  test("a term two components of one page mark, or a page and its component", () => {
    expect(pagesMarkingTwice(PLANTED)).toEqual([
      "Pages/Again.tsx: Probe",
      "Pages/Twice.tsx: Probe",
    ]);
  });

  test("a term one file marks twice", () => {
    expect(filesMarkingTwice(PLANTED)).toEqual(["Pages/Repeats.tsx: Label"]);
  });
});

describe("marked words on a page", () => {
  test(`no page marks more than ${MAX_MARKED_TERMS_PER_PAGE} terms`, () => {
    expect(crowdedPages(DASHBOARD)).toEqual([]);
  });

  test("no file marks the same term twice: only where the page first uses it", () => {
    expect(filesMarkingTwice(DASHBOARD)).toEqual([]);
  });

  test("no two components of a page mark the same term, nor a page and a component it draws (#7020)", () => {
    const twice: Array<string> = pagesMarkingTwice(DASHBOARD).filter(
      (entry: string): boolean => {
        return !MARKED_TWICE_NEVER_TOGETHER[entry];
      },
    );

    expect(twice).toEqual([]);
  });

  test("every page listed as marking a term twice still does, with its reason", () => {
    const found: Set<string> = new Set(pagesMarkingTwice(DASHBOARD));

    for (const [entry, reason] of Object.entries(MARKED_TWICE_NEVER_TOGETHER)) {
      expect({ entry: entry, stillMarksTwice: found.has(entry) }).toEqual({
        entry: entry,
        stillMarksTwice: true,
      });
      expect(reason.length).toBeGreaterThan(40);
    }
  });
});

/*
 * The words the audits found people trip on (#6819, #9133, #6935), and where
 * each is first met in a core flow. "On-call rules" names two things; its
 * one definition says both, and both pages mark it.
 */
const TERMS_WHERE_FIRST_MET: ReadonlyArray<[string, Array<string>]> = [
  /*
   * A Logs, Traces, Metrics or Exceptions monitor meets its criteria as the
   * telemetry rule editor's When to alert (#6935); every other monitor
   * type as MonitorStep's Criteria card.
   */
  [
    "Criteria",
    [
      "Components/Form/Monitor/MonitorStep.tsx",
      "Components/Form/Monitor/TelemetryRule/TelemetryRuleEditor.tsx",
    ],
  ],
  // The project's monitor statuses, under Monitors > Settings (#6935).
  ["MonitorStatus", ["Pages/Monitor/Settings/MonitorStatus.tsx"]],
  ["Probe", ["Pages/Monitor/Create.tsx", "Pages/Monitor/View/Probes.tsx"]],
  ["Incident", ["Components/Form/Monitor/IncidentOrAlertNote.tsx"]],
  ["Alert", ["Components/Form/Monitor/IncidentOrAlertNote.tsx"]],
  [
    "Episode",
    [
      "Components/IncidentEpisode/IncidentEpisodesTable.tsx",
      "Components/AlertEpisode/AlertEpisodesTable.tsx",
    ],
  ],
  ["Severity", ["Pages/Incidents/Create.tsx"]],
  ["State", ["Pages/Incidents/Create.tsx"]],
  [
    "OnCallPolicy",
    ["Pages/OnCallDuty/OnCallDutyPolicies.tsx", "Pages/Incidents/Create.tsx"],
  ],
  [
    "EscalationRule",
    ["Components/OnCallPolicy/EscalationRule/EscalationRules.tsx"],
  ],
  ["OnCallSchedule", ["Pages/OnCallDuty/OnCallDutySchedules.tsx"]],
  ["Layer", ["Components/OnCallPolicy/OnCallScheduleLayer/Layers.tsx"]],
  /*
   * Where a person decides how they are paged, How to Reach Me's line over
   * its rules (OnCallRulesTabs). The Notification Methods page under User
   * Settings marks nothing: its first line says what a method is (#8887),
   * and nothing on it names the word but its title.
   */
  ["NotificationMethod", ["Components/NotificationRule/OnCallRulesTabs.tsx"]],
  /*
   * The project's on-call rules. A person's own were "on-call rules" too,
   * until #6817 named them How to Reach Me: its grid of rules
   * (OnCallRulesTabs) defines the notification method it turns on instead.
   */
  [
    "OnCallRules",
    [
      "Pages/Incidents/Settings/IncidentOnCallRules.tsx",
      "Pages/Alerts/Settings/AlertOnCallRules.tsx",
    ],
  ],
  // The Status Pages list, and the Subscribers page of each (#6935).
  ["StatusPage", ["Pages/StatusPages/StatusPages.tsx"]],
  ["Subscriber", ["Components/StatusPage/StatusPageSubscriberList.tsx"]],
  // All Maintenance Events, not every tab that lists a record's (#6935).
  [
    "ScheduledMaintenance",
    ["Pages/ScheduledMaintenanceEvents/ScheduledMaintenanceEvents.tsx"],
  ],
  // Settings > Teams (#6935).
  ["Team", ["Pages/Teams/Index.tsx"]],
  ["Owner", ["Components/Owners/OwnersCard.tsx"]],
  ["Label", ["Pages/Settings/Labels.tsx"]],
  ["MonitorGroup", ["Pages/MonitorGroup/MonitorGroups.tsx"]],
  ["Service", ["Pages/Service/Services.tsx"]],
  ["IngestionKey", ["Pages/Settings/TelemetryIngestionKeys.tsx"]],
  ["SLO", ["Pages/Slo/Slos.tsx"]],
  ["ErrorBudget", ["Components/Slo/SloBudgetBurnDownCard.tsx"]],
  ["Runbook", ["Pages/Runbook/Runbooks.tsx"]],
  ["Workflow", ["Pages/Workflow/Workflows.tsx"]],
  /*
   * About 180 Traces strings say span, and nothing said what one is
   * (#9133): the explorer's Span Type facet and a trace's Spans count.
   */
  [
    "Span",
    [
      "Components/Traces/TracesViewer.tsx",
      "Components/Traces/TraceDetail/TraceHeader.tsx",
    ],
  ],
];

describe("the words people trip on", () => {
  test("are twenty-eight, each its own term", () => {
    expect(TERMS_WHERE_FIRST_MET.length).toBe(28);
    expect(
      new Set(
        TERMS_WHERE_FIRST_MET.map((entry: [string, Array<string>]): string => {
          return entry[0];
        }),
      ).size,
    ).toBe(28);
  });

  test.each(TERMS_WHERE_FIRST_MET)(
    "%s is marked where a core flow first meets it",
    (term: string, files: Array<string>) => {
      for (const file of files) {
        expect([file, marksIn(read(file))]).toEqual([
          file,
          expect.arrayContaining([term]),
        ]);
      }
    },
  );
});

/*
 * One link from each hard form to the docs page that explains it: a
 * LearnMoreLink, or a table's documentationLink. Written as the docs
 * address the page, so DocsLinksResolve fails when the page or heading goes.
 */
const HARD_FORMS: ReadonlyArray<[string, string, string]> = [
  [
    "monitor criteria",
    "Components/Form/Monitor/MonitorStep.tsx",
    'docsPath="/docs/monitor/criteria-and-statuses"',
  ],
  [
    "a telemetry monitor's criteria",
    "Components/Form/Monitor/TelemetryRule/TelemetryRuleEditor.tsx",
    'docsPath="/docs/monitor/criteria-and-statuses"',
  ],
  [
    "escalation rules",
    "Components/OnCallPolicy/EscalationRule/EscalationRules.tsx",
    'docsPath="/docs/on-call/escalation-rules"',
  ],
  [
    "schedule layers",
    "Components/OnCallPolicy/OnCallScheduleLayer/Layers.tsx",
    'docsPath="/docs/on-call/schedules#layers"',
  ],
  [
    "notification methods",
    "Components/NotificationMethods/Email.tsx",
    '"/docs/notifications/notification-methods"',
  ],
  [
    "personal on-call rules",
    "Components/NotificationRule/OnCallRulesTabs.tsx",
    'docsPath="/docs/notifications/on-call-rules"',
  ],
  [
    "incident on-call rules",
    "Pages/Incidents/Settings/IncidentOnCallRules.tsx",
    '"/docs/incidents/settings#incident-on-call-rules"',
  ],
  [
    "alert on-call rules",
    "Pages/Alerts/Settings/AlertOnCallRules.tsx",
    '"/docs/alerts/settings#on-call-rules"',
  ],
];

describe("the hard forms", () => {
  test.each(HARD_FORMS)(
    "%s link the docs page that explains them",
    (_name: string, file: string, link: string) => {
      const source: string = withoutComments(read(file));

      expect(source).toContain(link);
      expect(
        source.includes("<LearnMoreLink") ||
          source.includes("documentationLink={"),
      ).toBe(true);
    },
  );
});

describe("Learn more is never inside a paragraph", () => {
  /*
   * Its icon is drawn in a block (Icon's <div>), which a <p> cannot hold:
   * React warns, and on the escalation rules page the dialog the page opens
   * next never drew its form.
   */
  const insideParagraph: (source: string, at: number) => boolean = (
    source: string,
    at: number,
  ): boolean => {
    const opened: number = Math.max(
      source.lastIndexOf("<p ", at),
      source.lastIndexOf("<p>", at),
      source.lastIndexOf("<p\n", at),
    );

    return opened > source.lastIndexOf("</p>", at);
  };

  test.each(
    HARD_FORMS.filter((form: [string, string, string]): boolean => {
      return read(form[1]).includes("LearnMoreLink");
    }),
  )("on %s", (_name: string, file: string) => {
    const source: string = withoutComments(read(file));
    const places: Array<number> = [];

    for (const pattern of [/<LearnMoreLink\b/g, /\{\w*LearnMore\}/g]) {
      for (const match of source.matchAll(pattern)) {
        places.push(match.index || 0);
      }
    }

    expect(places.length).toBeGreaterThan(0);

    for (const place of places) {
      expect({
        file: file,
        place: place,
        insideParagraph: insideParagraph(source, place),
      }).toEqual({
        file: file,
        place: place,
        insideParagraph: false,
      });
    }
  });
});

describe("incident or alert, where the choice is made", () => {
  test("a criteria's actions say the difference, and mark the words on the first criteria only", () => {
    const instance: string = withoutComments(
      read("Components/Form/Monitor/MonitorCriteriaInstance.tsx"),
    );
    const list: string = withoutComments(
      read("Components/Form/Monitor/MonitorCriteria.tsx"),
    );

    expect(instance).toContain("<IncidentOrAlertNote");
    expect(instance).toContain("marksTerms={props.isFirstCriteria}");
    expect(list).toContain("isFirstCriteria={index === 0}");
    // The line comes before the two switches it explains.
    expect(instance.indexOf("<IncidentOrAlertNote")).toBeLessThan(
      instance.indexOf('title="When filters match, create an alert."'),
    );
  });

  test("a telemetry rule's What happens says it beside its choice", () => {
    const actions: string = withoutComments(
      read("Components/Form/Monitor/TelemetryRule/TelemetryRuleActions.tsx"),
    );

    expect(actions).toContain("<IncidentOrAlertNote");
    expect(actions.indexOf("<IncidentOrAlertNote")).toBeLessThan(
      actions.indexOf("<Radio"),
    );
  });
});
