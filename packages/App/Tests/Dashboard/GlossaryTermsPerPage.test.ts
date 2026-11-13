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
 * full of dotted lines is worse than none. So:
 *
 *   - no file marks more than three terms, counting the terms of the
 *     Dashboard components it draws (one level of imports): a form and the
 *     note it draws are one page;
 *   - no file marks the same term twice;
 *   - the twenty-one words the audits found people trip on are each marked
 *     where a core flow first meets them;
 *   - the five hard forms each link the docs page that explains them.
 *
 * A term is marked by a form field's `glossaryTerm`, a card's or a table's
 * `titleGlossaryTerm`, or a DefinedTerm drawn directly. The marks are read
 * from the source, so this guard sees a mark however a page is reached.
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

const FILES: Array<string> = sourceFiles(DASHBOARD_SRC);

const SOURCES: Map<string, string> = new Map(
  FILES.map((file: string): [string, string] => {
    return [file, fs.readFileSync(file, "utf8")];
  }),
);

const DIRECT_MARKS: Map<string, Array<string>> = new Map(
  FILES.map((file: string): [string, Array<string>] => {
    return [file, marksIn(SOURCES.get(file)!)];
  }),
);

// The Dashboard files a file imports by a relative path.
const RELATIVE_IMPORT: RegExp = /from\s+"(\.{1,2}\/[^"]+)"/g;

/*
 * The components a file draws: what it imports from Components/. A page it
 * imports is a page of its own - a route table imports every page it routes
 * to, and draws one at a time.
 */
const COMPONENTS_DIR: string = path.join(DASHBOARD_SRC, "Components");

const importedFiles: (file: string) => Array<string> = (
  file: string,
): Array<string> => {
  const imported: Array<string> = [];

  for (const match of SOURCES.get(file)!.matchAll(RELATIVE_IMPORT)) {
    const base: string = path.resolve(path.dirname(file), match[1]!);

    if (!base.startsWith(COMPONENTS_DIR + path.sep)) {
      continue;
    }

    for (const candidate of [`${base}.tsx`, `${base}.ts`]) {
      if (SOURCES.has(candidate)) {
        imported.push(candidate);
        break;
      }
    }
  }

  return imported;
};

// A file's marks and those of the components it draws, one level down.
const PAGE_MARKS: Map<string, Array<string>> = new Map(
  FILES.map((file: string): [string, Array<string>] => {
    return [
      file,
      [
        ...DIRECT_MARKS.get(file)!,
        ...importedFiles(file).flatMap((imported: string): Array<string> => {
          return DIRECT_MARKS.get(imported) || [];
        }),
      ],
    ];
  }),
);

const relative: (file: string) => string = (file: string): string => {
  return path.relative(DASHBOARD_SRC, file).split(path.sep).join("/");
};

const read: (file: string) => string = (file: string): string => {
  return SOURCES.get(path.join(DASHBOARD_SRC, ...file.split("/")))!;
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
    const total: number = Array.from(DIRECT_MARKS.values()).reduce(
      (sum: number, marks: Array<string>): number => {
        return sum + marks.length;
      },
      0,
    );

    expect(total).toBeGreaterThanOrEqual(21);
  });

  test("counts the marks of a component a file draws", () => {
    expect(
      PAGE_MARKS.get(
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

describe("marked words on a page", () => {
  test(`no page marks more than ${MAX_MARKED_TERMS_PER_PAGE} terms`, () => {
    const crowded: Array<string> = [];

    for (const [file, marks] of PAGE_MARKS) {
      const distinct: Set<string> = new Set(marks);

      if (distinct.size > MAX_MARKED_TERMS_PER_PAGE) {
        crowded.push(`${relative(file)}: ${Array.from(distinct).join(", ")}`);
      }
    }

    expect(crowded).toEqual([]);
  });

  test("no file marks the same term twice: only where the page first uses it", () => {
    const twice: Array<string> = [];

    for (const [file, marks] of DIRECT_MARKS) {
      const seen: Set<string> = new Set();

      for (const term of marks) {
        if (seen.has(term)) {
          twice.push(`${relative(file)}: ${term}`);
        }
        seen.add(term);
      }
    }

    expect(twice).toEqual([]);
  });
});

/*
 * The words the audits found people trip on (#6819), and where each is
 * first met in a core flow. "On-call rules" names two things; its one
 * definition says both, and both pages mark it.
 */
const TERMS_WHERE_FIRST_MET: ReadonlyArray<[string, Array<string>]> = [
  ["Criteria", ["Components/Form/Monitor/MonitorStep.tsx"]],
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
  ["Owner", ["Components/Owners/OwnersCard.tsx"]],
  ["Label", ["Pages/Settings/Labels.tsx"]],
  ["MonitorGroup", ["Pages/MonitorGroup/MonitorGroups.tsx"]],
  ["Service", ["Pages/Service/Services.tsx"]],
  ["IngestionKey", ["Pages/Settings/TelemetryIngestionKeys.tsx"]],
  ["SLO", ["Pages/Slo/Slos.tsx"]],
  ["ErrorBudget", ["Components/Slo/SloBudgetBurnDownCard.tsx"]],
  ["Runbook", ["Pages/Runbook/Runbooks.tsx"]],
  ["Workflow", ["Pages/Workflow/Workflows.tsx"]],
];

describe("the words people trip on", () => {
  test("are twenty-one, each its own term", () => {
    expect(TERMS_WHERE_FIRST_MET.length).toBe(21);
    expect(
      new Set(
        TERMS_WHERE_FIRST_MET.map((entry: [string, Array<string>]): string => {
          return entry[0];
        }),
      ).size,
    ).toBe(21);
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
