import AlertFeedService from "../../../Services/AlertFeedService";
import IncidentFeedService from "../../../Services/IncidentFeedService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AlertFeed, {
  AlertFeedEventType,
} from "../../../../Models/DatabaseModels/AlertFeed";
import IncidentFeed, {
  IncidentFeedEventType,
} from "../../../../Models/DatabaseModels/IncidentFeed";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import ObjectID from "../../../../Types/ObjectID";
import {
  ParsedInvestigationReport,
  getCitationMarkerRegex,
  parseInvestigationReport,
} from "../../../../Utils/AI/InvestigationReport";
import InvestigationTldr from "./InvestigationTldr";

/*
 * What a completed investigation found, in one or two plain sentences, when
 * it has no TL;DR — and the first step its report suggests.
 *
 * The TL;DR (AIRun.analysisTldr) is a separate, best-effort LLM call made
 * after the report is written — one attempt, a 60 s timeout, a 300-token
 * cap, inside the daily autonomous budget (InvestigationTldr). Whenever it
 * fails (a slow or self-hosted model, a provider error, an answer its token
 * cap cut off, a spent budget) the run keeps its full report and simply has
 * no TL;DR; runs from before the TL;DR existed have none either. The run's
 * LlmLog row ("AI Investigation TLDR") says why.
 *
 * The report itself still says what was found: the investigation persona
 * asks for a **Summary** section of one or two sentences, and the
 * dashboard's AI Logs and AI Insights pages read that instead of telling the
 * reader "No summary was recorded." about an investigation that published
 * one. It also asks for **Suggested next steps** — concrete actions for the
 * on-call engineer — and the AI Insights page leads a problem that keeps
 * coming back with the first of them: what OneUptime AI would do about it.
 * Nothing here calls a model: the text is the report's own, flattened to
 * plain text and capped exactly like a TL;DR (InvestigationTldr
 * .sanitizeTldr), so it is safe to render as text.
 *
 * Not used by the incident and alert investigation panel, which shows the
 * whole report under its TL;DR: the same sentence there twice would only
 * repeat the report's first line.
 */

// One run whose posted report may be summarised.
export interface InvestigationReportSummaryRun {
  aiRunId: ObjectID;
  incidentId?: ObjectID | undefined;
  alertId?: ObjectID | undefined;
}

// What one run's posted report concluded, as plain text.
export interface InvestigationReportConclusion {
  // The report's Summary (else its root cause, else its body).
  summary?: string | undefined;
  // The first step its Suggested next steps section names.
  nextStep?: string | undefined;
}

// A list item's marker: "- ", "* ", "+ ", "1. ", "2) ".
const LIST_ITEM_MARKER_REGEX: RegExp = /^[ \t]{0,3}(?:[-*+]|\d{1,3}[.)])[ \t]+/;
const BLANK_LINE_REGEX: RegExp = /^[ \t]*$/;
const LINE_ENDING_REGEX: RegExp = /\r\n?/g;
// "dry [C1]." leaves "dry ." behind once the citation is gone.
const SPACE_BEFORE_PUNCTUATION_REGEX: RegExp = /[ \t]+([.,;:!?])/g;

function withoutCitations(text: string): string {
  return text
    .replace(getCitationMarkerRegex(), "")
    .replace(SPACE_BEFORE_PUNCTUATION_REGEX, "$1");
}

export default class InvestigationReportSummary {
  /*
   * The report's own summary as plain text: its Summary section, else its
   * "Most likely root cause" section, else — for a report that follows no
   * section format at all — its body. Citation markers ([C3]) are dropped;
   * they only mean something next to the report's evidence list. Null when
   * nothing usable is left (InvestigationTldr's floor and cap apply).
   */
  public static fromReport(
    analysisMarkdown: string | null | undefined,
  ): string | null {
    if (!analysisMarkdown || !analysisMarkdown.trim()) {
      return null;
    }

    const report: ParsedInvestigationReport =
      parseInvestigationReport(analysisMarkdown);

    const section: string | undefined =
      report.summary ||
      report.rootCause ||
      (report.isStructured ? undefined : report.bodyMarkdown);

    if (!section) {
      return null;
    }

    return InvestigationTldr.sanitizeTldr(withoutCitations(section));
  }

  /*
   * The first step the report's Suggested next steps section names, as plain
   * text: its first list item (with the lines that continue it), or — for a
   * section written as prose — its first paragraph. Citation markers are
   * dropped and the text is capped like a TL;DR. Null for a report without
   * that section, or with nothing usable in it.
   */
  public static nextStepFromReport(
    analysisMarkdown: string | null | undefined,
  ): string | null {
    if (!analysisMarkdown || !analysisMarkdown.trim()) {
      return null;
    }

    const report: ParsedInvestigationReport =
      parseInvestigationReport(analysisMarkdown);

    if (!report.nextSteps || !report.nextSteps.trim()) {
      return null;
    }

    return InvestigationTldr.sanitizeTldr(
      withoutCitations(this.getFirstStep(report.nextSteps)),
    );
  }

  /*
   * The first item of a markdown list, or the first paragraph of prose:
   * the text of one step, marker removed, its continuation lines kept.
   */
  public static getFirstStep(markdown: string): string {
    const lines: Array<string> = markdown
      .replace(LINE_ENDING_REGEX, "\n")
      .split("\n");

    const firstItemAt: number = lines.findIndex((line: string): boolean => {
      return LIST_ITEM_MARKER_REGEX.test(line);
    });

    // Prose: the first paragraph.
    if (firstItemAt < 0) {
      const paragraph: Array<string> = [];

      for (const line of lines) {
        if (BLANK_LINE_REGEX.test(line)) {
          if (paragraph.length > 0) {
            break;
          }

          continue;
        }

        paragraph.push(line);
      }

      return paragraph.join(" ");
    }

    // A list: its first item, up to the next item or a blank line.
    const item: Array<string> = [
      lines[firstItemAt]!.replace(LIST_ITEM_MARKER_REGEX, ""),
    ];

    for (const line of lines.slice(firstItemAt + 1)) {
      if (BLANK_LINE_REGEX.test(line) || LIST_ITEM_MARKER_REGEX.test(line)) {
        break;
      }

      item.push(line.trim());
    }

    return item.join(" ");
  }

  /*
   * The runs whose finding has to come from their report: completed, with
   * no TL;DR, and with the incident or alert they posted it on.
   */
  public static getRunsWithoutTldr(
    runs: Array<AIRun>,
  ): Array<InvestigationReportSummaryRun> {
    const missing: Array<InvestigationReportSummaryRun> = [];

    for (const run of runs) {
      if (
        !run.id ||
        run.status !== AIRunStatus.Completed ||
        (run.analysisTldr || "").trim() ||
        !(run.triggeredByIncidentId || run.triggeredByAlertId)
      ) {
        continue;
      }

      missing.push({
        aiRunId: run.id,
        incidentId: run.triggeredByIncidentId || undefined,
        alertId: run.triggeredByAlertId || undefined,
      });
    }

    return missing;
  }

  /*
   * The summaries of these runs' posted reports, by AI run id. Only a run's
   * own RootCause feed item counts — the one its investigation posted with
   * its aiRunId, on its own incident or alert — and a run without either
   * has no report to read. Read as root: callers decide who may see a run's
   * finding (the subject's readers, as for its TL;DR) before they ask.
   */
  public static async getForRuns(data: {
    projectId: ObjectID;
    runs: Array<InvestigationReportSummaryRun>;
  }): Promise<Map<string, string>> {
    const summaries: Map<string, string> = new Map<string, string>();

    for (const [aiRunId, reports] of await this.readReports(data)) {
      // The first report that says something wins.
      for (const markdown of reports) {
        const summary: string | null = this.fromReport(markdown);

        if (summary) {
          summaries.set(aiRunId, summary);
          break;
        }
      }
    }

    return summaries;
  }

  /*
   * What these runs' posted reports concluded — the summary and the first
   * suggested step — by AI run id, read the way getForRuns reads them (the
   * run's own report on its own subject, as root, for callers that decided
   * the caller may see the run's finding). A run whose report says neither
   * is left out.
   */
  public static async getConclusionsForRuns(data: {
    projectId: ObjectID;
    runs: Array<InvestigationReportSummaryRun>;
  }): Promise<Map<string, InvestigationReportConclusion>> {
    const conclusions: Map<string, InvestigationReportConclusion> = new Map<
      string,
      InvestigationReportConclusion
    >();

    for (const [aiRunId, reports] of await this.readReports(data)) {
      let summary: string | null = null;
      let nextStep: string | null = null;

      // Each part from the first report that says it.
      for (const markdown of reports) {
        summary = summary || this.fromReport(markdown);
        nextStep = nextStep || this.nextStepFromReport(markdown);
      }

      if (summary || nextStep) {
        conclusions.set(aiRunId, {
          ...(summary ? { summary } : {}),
          ...(nextStep ? { nextStep } : {}),
        });
      }
    }

    return conclusions;
  }

  /*
   * Each run's own posted reports, by AI run id, in the order they were
   * read: one in practice, and the first that says something wins.
   */
  private static async readReports(data: {
    projectId: ObjectID;
    runs: Array<InvestigationReportSummaryRun>;
  }): Promise<Map<string, Array<string>>> {
    const reports: Map<string, Array<string>> = new Map<
      string,
      Array<string>
    >();

    const incidentRuns: Array<InvestigationReportSummaryRun> = data.runs.filter(
      (run: InvestigationReportSummaryRun): boolean => {
        return Boolean(run.incidentId);
      },
    );
    const alertRuns: Array<InvestigationReportSummaryRun> = data.runs.filter(
      (run: InvestigationReportSummaryRun): boolean => {
        return !run.incidentId && Boolean(run.alertId);
      },
    );

    const [incidentReports, alertReports]: [
      Array<IncidentFeed>,
      Array<AlertFeed>,
    ] = await Promise.all([
      incidentRuns.length > 0
        ? IncidentFeedService.findBy({
            query: {
              projectId: data.projectId,
              incidentFeedEventType: IncidentFeedEventType.RootCause,
              aiRunId: QueryHelper.any(getRunIds(incidentRuns)),
              incidentId: QueryHelper.any(
                getUniqueIds(
                  incidentRuns.map(
                    (run: InvestigationReportSummaryRun): ObjectID => {
                      return run.incidentId!;
                    },
                  ),
                ),
              ),
            },
            select: {
              aiRunId: true,
              incidentId: true,
              feedInfoInMarkdown: true,
            },
            limit: incidentRuns.length,
            skip: 0,
            props: { isRoot: true },
          })
        : Promise.resolve([]),
      alertRuns.length > 0
        ? AlertFeedService.findBy({
            query: {
              projectId: data.projectId,
              alertFeedEventType: AlertFeedEventType.RootCause,
              aiRunId: QueryHelper.any(getRunIds(alertRuns)),
              alertId: QueryHelper.any(
                getUniqueIds(
                  alertRuns.map(
                    (run: InvestigationReportSummaryRun): ObjectID => {
                      return run.alertId!;
                    },
                  ),
                ),
              ),
            },
            select: { aiRunId: true, alertId: true, feedInfoInMarkdown: true },
            limit: alertRuns.length,
            skip: 0,
            props: { isRoot: true },
          })
        : Promise.resolve([]),
    ]);

    const subjectOfRun: Map<string, string> = new Map<string, string>();

    for (const run of data.runs) {
      const subjectId: ObjectID | undefined = run.incidentId || run.alertId;

      if (subjectId) {
        subjectOfRun.set(run.aiRunId.toString(), subjectId.toString());
      }
    }

    const posted: Array<{
      aiRunId?: ObjectID | undefined;
      subjectId?: ObjectID | undefined;
      markdown?: string | undefined;
    }> = [
      ...incidentReports.map((item: IncidentFeed) => {
        return {
          aiRunId: item.aiRunId,
          subjectId: item.incidentId,
          markdown: item.feedInfoInMarkdown,
        };
      }),
      ...alertReports.map((item: AlertFeed) => {
        return {
          aiRunId: item.aiRunId,
          subjectId: item.alertId,
          markdown: item.feedInfoInMarkdown,
        };
      }),
    ];

    for (const report of posted) {
      const aiRunId: string | undefined = report.aiRunId?.toString();

      /*
       * Belt and braces over the query: a report counts only for the run
       * that posted it, on that run's own subject.
       */
      if (
        !aiRunId ||
        !report.subjectId ||
        subjectOfRun.get(aiRunId) !== report.subjectId.toString() ||
        !report.markdown
      ) {
        continue;
      }

      reports.set(aiRunId, [...(reports.get(aiRunId) || []), report.markdown]);
    }

    return reports;
  }
}

function getUniqueIds(ids: Array<ObjectID>): Array<ObjectID> {
  const byId: Map<string, ObjectID> = new Map<string, ObjectID>();

  for (const id of ids) {
    byId.set(id.toString(), id);
  }

  return Array.from(byId.values());
}

function getRunIds(
  runs: Array<InvestigationReportSummaryRun>,
): Array<ObjectID> {
  return getUniqueIds(
    runs.map((run: InvestigationReportSummaryRun): ObjectID => {
      return run.aiRunId;
    }),
  );
}
