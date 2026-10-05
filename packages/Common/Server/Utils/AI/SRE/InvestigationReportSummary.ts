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
 * it has no TL;DR.
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
 * one. Nothing here calls a model: the text is the report's own, flattened
 * to plain text and capped exactly like a TL;DR (InvestigationTldr
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

    const withoutCitations: string = section
      .replace(getCitationMarkerRegex(), "")
      // "dry [C1]." leaves "dry ." behind.
      .replace(/[ \t]+([.,;:!?])/g, "$1");

    return InvestigationTldr.sanitizeTldr(withoutCitations);
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

    const reports: Array<{
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

    for (const report of reports) {
      const aiRunId: string | undefined = report.aiRunId?.toString();

      /*
       * Belt and braces over the query: a report counts only for the run
       * that posted it, on that run's own subject.
       */
      if (
        !aiRunId ||
        summaries.has(aiRunId) ||
        !report.subjectId ||
        subjectOfRun.get(aiRunId) !== report.subjectId.toString()
      ) {
        continue;
      }

      const summary: string | null = this.fromReport(report.markdown);

      if (summary) {
        summaries.set(aiRunId, summary);
      }
    }

    return summaries;
  }
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

function getUniqueIds(ids: Array<ObjectID>): Array<ObjectID> {
  const byId: Map<string, ObjectID> = new Map<string, ObjectID>();

  for (const id of ids) {
    byId.set(id.toString(), id);
  }

  return Array.from(byId.values());
}
