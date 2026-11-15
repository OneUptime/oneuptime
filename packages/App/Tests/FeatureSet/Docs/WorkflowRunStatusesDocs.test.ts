import WorkflowStatus, {
  getWorkflowStatusLabel,
} from "Common/Types/Workflow/WorkflowStatus";
import {
  DOCS_LANGUAGES,
  TRANSLATED_LANGUAGES,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import { cardLines, prose } from "./DocsTranslationChecks";
import { describe, expect, it } from "@jest/globals";

/*
 * A WORKFLOW RUN'S STATUSES, AS EACH LANGUAGE'S DASHBOARD DRAWS THEM (#8079).
 *
 * The runs page (workflows/runs-and-logs) names a run's statuses three
 * times: in the card that leads to them, in a state diagram of the statuses
 * a run goes through (`state "<name>" as <Status>`), and in a table of what
 * each one means. #7781 made every status a key of the Dashboard's locales,
 * and the table followed, but the diagram kept "Timeout" in English in all
 * sixteen translations and "Executed" in twelve, and so did the card: a
 * Spanish reader saw "Tiempo de espera agotado" in the table and on the
 * Dashboard, and "Timeout" in the diagram between them.
 *
 * Every name is held here to the word its language's Dashboard draws on the
 * run's pill: the locale's wording of the status's label
 * (WorkflowStatus's getWorkflowStatusLabel), or the English where the
 * locale has none (drawnDashboardLabel).
 *
 * The longer names keep the diagrams inside the docs' 590px column:
 * mermaid in Chromium lays the German one out at 596px and the widest, the
 * Russian, at 671px, under the 786px a diagram fits the column whole at
 * (DocsDiagramSize; E2E's DocsDiagramSizes checks English and German).
 */

const RUNS_PAGE: string = "workflows/runs-and-logs";

// Each state of the diagram, by its id, and the status it stands for.
const DIAGRAM_STATES: ReadonlyArray<{ id: string; status: WorkflowStatus }> = [
  { id: "Scheduled", status: WorkflowStatus.Scheduled },
  { id: "Running", status: WorkflowStatus.Running },
  { id: "Waiting", status: WorkflowStatus.Waiting },
  { id: "Executed", status: WorkflowStatus.Success },
  { id: "Failed", status: WorkflowStatus.Error },
  { id: "TimedOut", status: WorkflowStatus.Timeout },
];

// The statuses the card names: "What Scheduled, Waiting, Executed and the other statuses mean."
const CARD_STATUSES: ReadonlyArray<WorkflowStatus> = [
  WorkflowStatus.Scheduled,
  WorkflowStatus.Waiting,
  WorkflowStatus.Success,
];

const STATE_LINE: RegExp = /^\s*state "([^"]*)" as (\w+)\s*$/;
const TABLE_STATUS: RegExp = /^\| \*\*([^*]+)\*\* +\|/;

// The word a language's Dashboard draws a status in: the run's pill.
function drawnStatus(language: string, status: WorkflowStatus): string {
  return drawnDashboardLabel(language, getWorkflowStatusLabel(status));
}

// The page's state diagrams: the source of each.
function stateDiagramsOf(markdown: string): Array<string> {
  return scanMarkdown(markdown)
    .fences.filter((fence: { lang: string; code: string }): boolean => {
      return (
        fence.lang === "mermaid" &&
        fence.code.trimStart().startsWith("stateDiagram")
      );
    })
    .map((fence: { code: string }): string => {
      return fence.code;
    });
}

// A diagram's states: each id, and the name it is drawn under.
function stateNamesOf(diagram: string): Record<string, string> {
  const names: Record<string, string> = {};

  for (const line of diagram.split("\n")) {
    const match: RegExpMatchArray | null = line.match(STATE_LINE);

    if (match) {
      names[match[2] as string] = match[1] as string;
    }
  }

  return names;
}

// What every state of a language's diagram should be drawn under.
function expectedStateNames(language: string): Record<string, string> {
  const names: Record<string, string> = {};

  for (const state of DIAGRAM_STATES) {
    names[state.id] = drawnStatus(language, state.status);
  }

  return names;
}

/*
 * The status table's first column - the table right under the state
 * diagram - each status's name, in order.
 */
function tableStatusesOf(markdown: string): Array<string> {
  const lines: Array<string> = markdown.split("\n");
  const diagram: number = lines.findIndex((line: string): boolean => {
    return line.trim() === "stateDiagram-v2";
  });
  const fenceEnd: number = lines.findIndex((line: string, at: number) => {
    return at > diagram && line.trim() === "```";
  });

  if (diagram < 0 || fenceEnd < 0) {
    return [];
  }

  const names: Array<string> = [];
  let inTable: boolean = false;

  for (const line of prose(lines.slice(fenceEnd + 1).join("\n")).split("\n")) {
    if (line.startsWith("|")) {
      inTable = true;
      const name: string | undefined = line.match(TABLE_STATUS)?.[1];

      if (name !== undefined) {
        names.push(name);
      }

      continue;
    }

    // The table ends at its first line that is no row.
    if (inTable) {
      break;
    }
  }

  return names;
}

// The card that leads to the run statuses: the page's first.
function statusCardOf(markdown: string): string {
  return cardLines(markdown)[0] || "";
}

describe("the suite's readers, on a page shaped like the runs page", () => {
  const PAGE: string = [
    "# Runs",
    "",
    ":::cards",
    "- [Run statuses](#run-statuses): What Scheduled, Waiting, Executed and the other statuses mean.",
    ":::",
    "",
    '```mermaid title="The statuses a run goes through"',
    "stateDiagram-v2",
    '    state "Scheduled" as Scheduled',
    '    state "Error" as Failed',
    "    [*] --> Scheduled: the trigger fires",
    "```",
    "",
    "| Status | What it means |",
    "| --- | --- |",
    "| **Scheduled** | Queued. |",
    "| **Error**     | Stopped. |",
  ].join("\n");

  it("read a diagram's states by id, never its transitions", () => {
    const diagrams: Array<string> = stateDiagramsOf(PAGE);

    expect(diagrams).toHaveLength(1);
    expect(stateNamesOf(diagrams[0] as string)).toEqual({
      Scheduled: "Scheduled",
      Failed: "Error",
    });
  });

  it("read the status table's names and the card's line", () => {
    expect(tableStatusesOf(PAGE)).toEqual(["Scheduled", "Error"]);
    expect(statusCardOf(PAGE)).toContain("What Scheduled, Waiting, Executed");
  });

  it("draw a status as the Dashboard's pill does: a run that worked is Executed, one out of time Timeout", () => {
    expect(drawnStatus("en", WorkflowStatus.Success)).toBe("Executed");
    expect(drawnStatus("en", WorkflowStatus.Timeout)).toBe("Timeout");
    expect(drawnStatus("en", WorkflowStatus.Error)).toBe("Error");
    // In the reader's words wherever the locale has them.
    expect(drawnStatus("de", WorkflowStatus.Timeout)).toBe(
      "Zeitüberschreitung",
    );
    expect(drawnStatus("es", WorkflowStatus.Timeout)).toBe(
      "Tiempo de espera agotado",
    );
    expect(drawnStatus("it", WorkflowStatus.Success)).toBe("Eseguito");
    expect(drawnStatus("fa", WorkflowStatus.Timeout)).toBe("پایان مهلت");
  });

  it("find a state named in English where the Dashboard draws it otherwise (negative control)", () => {
    const stale: string = [
      "stateDiagram-v2",
      '    state "Programado" as Scheduled',
      '    state "En ejecución" as Running',
      '    state "Esperando" as Waiting',
      '    state "Ejecutado" as Executed',
      '    state "Error" as Failed',
      '    state "Timeout" as TimedOut',
    ].join("\n");

    expect(stateNamesOf(stale)).not.toEqual(expectedStateNames("es"));
    expect(stateNamesOf(stale)["TimedOut"]).not.toBe(
      expectedStateNames("es")["TimedOut"],
    );
  });
});

describe("the runs page's state diagram", () => {
  it("is drawn in every docs language, with the six states the English one has", () => {
    expect(DOCS_LANGUAGES.length).toBeGreaterThanOrEqual(17);

    for (const language of DOCS_LANGUAGES) {
      const diagrams: Array<string> = stateDiagramsOf(
        readPage(language, RUNS_PAGE),
      );

      expect({ language, diagrams: diagrams.length }).toEqual({
        language,
        diagrams: 1,
      });
      expect({
        language,
        states: Object.keys(stateNamesOf(diagrams[0] as string)).sort(),
      }).toEqual({
        language,
        states: DIAGRAM_STATES.map((state: { id: string }): string => {
          return state.id;
        }).sort(),
      });
    }
  });

  it.each(DOCS_LANGUAGES)(
    "in %s names every state as that language's Dashboard draws the status",
    (language: string) => {
      const diagram: string = stateDiagramsOf(
        readPage(language, RUNS_PAGE),
      )[0] as string;

      expect(stateNamesOf(diagram)).toEqual(expectedStateNames(language));
    },
  );

  it.each(TRANSLATED_LANGUAGES)(
    "in %s never names a run out of time Timeout, nor one that worked Executed, where its Dashboard does not",
    (language: string) => {
      const names: Record<string, string> = stateNamesOf(
        stateDiagramsOf(readPage(language, RUNS_PAGE))[0] as string,
      );

      if (drawnStatus(language, WorkflowStatus.Timeout) !== "Timeout") {
        expect({ language, timedOut: names["TimedOut"] }).not.toEqual({
          language,
          timedOut: "Timeout",
        });
      }

      if (drawnStatus(language, WorkflowStatus.Success) !== "Executed") {
        expect({ language, executed: names["Executed"] }).not.toEqual({
          language,
          executed: "Executed",
        });
      }
    },
  );

  /*
   * What the two checks above lean on: every translation's Dashboard words
   * both statuses, so none of its diagrams may keep the English.
   */
  it("is drawn in each translation's own words: no translation's Dashboard draws Timeout or Executed in English", () => {
    for (const language of TRANSLATED_LANGUAGES) {
      expect({
        language,
        timeout: drawnStatus(language, WorkflowStatus.Timeout) === "Timeout",
        executed: drawnStatus(language, WorkflowStatus.Success) === "Executed",
      }).toEqual({ language, timeout: false, executed: false });
    }
  });
});

describe("the runs page's other names for the statuses", () => {
  it.each(DOCS_LANGUAGES)(
    "in %s: the card that leads to them names Scheduled, Waiting and Executed as the Dashboard draws them",
    (language: string) => {
      const card: string = statusCardOf(readPage(language, RUNS_PAGE));

      for (const status of CARD_STATUSES) {
        expect({
          language,
          status: drawnStatus(language, status),
          named: card.includes(drawnStatus(language, status)),
        }).toEqual({
          language,
          status: drawnStatus(language, status),
          named: true,
        });
      }

      if (language !== "en") {
        expect({ language, card: card.includes("Executed") }).toEqual({
          language,
          card: false,
        });
      }
    },
  );

  it.each(DOCS_LANGUAGES)(
    "in %s: the status table names every status, in order, as the Dashboard draws it",
    (language: string) => {
      expect(tableStatusesOf(readPage(language, RUNS_PAGE))).toEqual(
        Object.values(WorkflowStatus).map((status: WorkflowStatus): string => {
          return drawnStatus(language, status);
        }),
      );
    },
  );
});
