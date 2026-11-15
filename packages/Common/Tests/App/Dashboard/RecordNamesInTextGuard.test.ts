// UX rule: Docs/ux/README.md#in-every-language
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  REPOSITORY_ROOT,
  RecordNameTextKind,
  RecordNameTextSite,
  readAllRecordNameTextSites,
  readRecordNameTextSites,
} from "../../RecordNameTexts";

/*
 * A STATE'S, A SEVERITY'S OR A STATUS'S NAME IN A SENTENCE OR AS TEXT READS
 * BY ITS LIST (#8064, #7894).
 *
 * A record of the lists a new project starts with is named by OneUptime
 * ("Resolved", "Critical Incident") or by the project ("Open", "Sev 1"), and
 * the one rule for them (Common/Utils/DefaultRecordNames) reads OneUptime's
 * names in the reader's language and the project's as written. Two ways of
 * drawing a name broke it:
 *
 *   - looked up: handed to translatableTerm(), translateText() or
 *     translateTerm(), which look up any text, so a state a project named
 *     "Open" read the verb "Abrir" in Spanish in the incident page's tiles
 *     ("Abrir en"), Mark as, the Change state dialogs and the postmortem
 *     cards (#8064);
 *   - drawn as stored: a sentence's value or a line of text as it is, so a
 *     new project's "Critical Incident" and "Resolved" read English on a
 *     German page - Home's Needs attention, a chart's incident markers, the
 *     Incident List widget, the monitor's Who is told card - beside badges
 *     that say "Kritischer Vorfall" and "Behoben" (#7894).
 *
 * This reads the front ends (RecordNameTexts) and fails on a state's name
 * drawn either way, outside the calls that read it by its list:
 * translateRecordName for text, recordNameInSentence for a sentence's value.
 * The render tests (RecordNamesInSentencesInSpanish, RecordNamesAsTextInGerman)
 * draw the places themselves.
 */

const FILE: string =
  "packages/App/FeatureSet/Dashboard/src/Components/Snippet/Snippet.tsx";

function sitesOf(body: string): Array<RecordNameTextSite> {
  return readRecordNameTextSites(FILE, body);
}

function kindsOf(body: string): Array<RecordNameTextKind> {
  return sitesOf(body).map((site: RecordNameTextSite): RecordNameTextKind => {
    return site.kind;
  });
}

describe("the reader finds a state's name looked up", () => {
  test.each([
    ["translatableTerm(state.name)"],
    ['translatableTerm(acknowledgeState?.name || "Acknowledged")'],
    [
      'translatableTerm(selectedIncidentState?.name || "", { inSentence: true })',
    ],
    ["translatableTerm(timing.resolvedStateName)"],
    ["translator.translateText(status.name)"],
    ["translator.translateTerm(change.statusName)"],
    ['translateText(priority["name"])'],
    ['translateText(state.getColumnValue("name") as string)'],
  ])("%s", (call: string) => {
    expect(kindsOf(`const x = ${call};`)).toEqual([
      RecordNameTextKind.LookedUp,
    ]);
  });
});

describe("the reader finds a state's name drawn as stored", () => {
  test("in a sentence's values", () => {
    expect(
      kindsOf(`
        const a = translator.translateTemplate("Incident · {{severity}}", {
          severity: incident.incidentSeverity.name,
        });
        const b = translator.translatePlural(TEMPLATE, 2, { status: row.statusName });
        const c = (<TranslatedSentence template={T} values={{ state: props.nextStateName }} />);
      `),
    ).toEqual([
      RecordNameTextKind.InSentenceAsStored,
      RecordNameTextKind.InSentenceAsStored,
      RecordNameTextKind.InSentenceAsStored,
    ]);
  });

  test("as a JSX text, read through a variable to what it is set to", () => {
    expect(
      kindsOf(`
        function Row(): ReactElement {
          const stateName: string = incident.currentIncidentState?.name || "—";
          return (<span>{stateName}</span>);
        }
      `),
    ).toEqual([RecordNameTextKind.DrawnAsStored]);
  });

  test("through the calls that only reshape it", () => {
    expect(
      kindsOf(`
        const a = (<span>{state.name.trim()}</span>);
        const b = (<span>{String(status.name)}</span>);
        const c = (<span>{[number, alert.alertSeverity?.name].join(" · ")}</span>);
      `),
    ).toHaveLength(3);
  });
});

describe("the reader passes a name its list decides", () => {
  test.each([
    [
      "recordNameInSentence in a sentence",
      `const x = translator.translateTemplate("Mark as {{state}}", {
        state: recordNameInSentence(StateListType.IncidentState, state.name),
      });`,
    ],
    [
      "translateRecordName as text",
      `const x = (<span>{translateRecordName(translator, StateListType.MonitorStatus, status.name)}</span>);`,
    ],
    [
      "a variable set by one",
      `function Row(): ReactElement {
        const selectedStateName: TemplateValue = recordNameInSentence(StateListType.AlertState, picked?.name);
        return translator.translateTemplate("Mark as {{state}}", { state: selectedStateName });
      }`,
    ],
    [
      "a helper handed the name's list",
      `const x = (<span>{getSeverityOrNothingPicked(StateListType.AlertSeverity, rule.alertSeverityName, translator)}</span>);`,
    ],
    [
      "a name as a condition, drawing a badge that decides",
      `const x = (<span>{state.name && (<Pill text={state.name} isUserContent={isRecordNameAsWritten(StateListType.IncidentState, state.name)} />)}</span>);`,
    ],
    [
      "a comparison",
      `const x = (<span>{state.name === "Resolved" ? "Done" : "Open"}</span>);`,
    ],
    [
      "a product word called a status",
      `const x = translatableTerm(span.statusLabel);`,
    ],
    [
      "a model's own name in a sentence",
      `const x = translator.translateTemplate("No {{items}} yet.", {
        items: translatableTerm(model.pluralName, { inSentence: true }),
      });`,
    ],
  ])("%s", (_case: string, body: string) => {
    expect(sitesOf(body)).toEqual([]);
  });
});

/*
 * The places the reader cannot tell from a state's name, each with why it is
 * not one: by file, then the text the reader stops at.
 */
const NOT_A_PROJECT_STATE_NAME: ReadonlyArray<{
  file: string;
  text: string;
  why: string;
}> = [
  {
    file: "ee/Dashboard/TeamCompliance/ComplianceRulesCard.tsx",
    text: "severity.name || severity.id",
    why: "Team Compliance is not translated yet: every word on the page is English, so a severity's name reads as stored beside them.",
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardSecurityEventsListComponent.tsx",
    text: "severity",
    why: "A security event's severity is OCSF's word for it (Critical, High), not a record of a project's list.",
  },
  {
    file: "packages/App/FeatureSet/StatusPage/src/Pages/Overview/Overview.tsx",
    text: "meta.statusName",
    why: "Read by its list where it is built: translateStatusName(StateListType.MonitorStatus, ...).",
  },
];

describe("the front ends", () => {
  const sites: Array<RecordNameTextSite> = readAllRecordNameTextSites();

  const isListed: (site: RecordNameTextSite) => boolean = (
    site: RecordNameTextSite,
  ): boolean => {
    return NOT_A_PROJECT_STATE_NAME.some(
      (entry: { file: string; text: string }): boolean => {
        return entry.file === site.file && entry.text === site.text;
      },
    );
  };

  test("draw every state's, severity's and status's name by its list", () => {
    expect(
      sites
        .filter((site: RecordNameTextSite): boolean => {
          return !isListed(site);
        })
        .map((site: RecordNameTextSite): string => {
          return `${site.file}:${site.line} (${site.kind}) ${site.text}`;
        }),
    ).toEqual([]);
  });

  /*
   * ee's screens are read where ee/ is checked out. Common Test deletes it
   * before it runs (test.common.yaml: core is the Community Edition), so a
   * place listed in ee/ is held to being there only where ee/ is.
   */
  const enterprisePresent: boolean = fs.existsSync(
    path.join(REPOSITORY_ROOT, "ee"),
  );

  test("list no place that is not there any more", () => {
    expect(
      NOT_A_PROJECT_STATE_NAME.filter(
        (entry: { file: string; text: string }): boolean => {
          return enterprisePresent || !entry.file.startsWith("ee/");
        },
      ).filter((entry: { file: string; text: string }): boolean => {
        return !sites.some((site: RecordNameTextSite): boolean => {
          return site.file === entry.file && site.text === entry.text;
        });
      }),
    ).toEqual([]);
  });

  test("each listed place says why", () => {
    for (const entry of NOT_A_PROJECT_STATE_NAME) {
      expect(entry.why.length).toBeGreaterThan(20);
    }
  });
});
