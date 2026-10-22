import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../../../Models/DatabaseModels/AIRunEvent";
import Project from "../../../../Models/DatabaseModels/Project";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import AIRunEventType from "../../../../Types/AI/AIRunEventType";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import { InvestigationEvidenceItem } from "../../../../Types/AI/InvestigationEvidence";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import AIRunEventService from "../../../Services/AIRunEventService";
import ProjectService from "../../../Services/ProjectService";
import SecurityCaseService from "../../../Services/SecurityCaseService";
import logger from "../../Logger";
import { buildInvestigationEvidence } from "../SRE/InvestigationEvidence";
import SecurityCaseTriage, {
  SECURITY_CASE_TRIAGE_NOT_STARTED_MESSAGES,
  SecurityCaseTriageNotStartedCode,
} from "./SecurityCaseTriage";

/*
 * What the case's AI card is told (POST /security-case/:caseId/ai-triage):
 *
 *   - run: the case's latest triage run - its status, when it started and
 *     finished, how many checks it made, and why it failed, if it did;
 *   - steps: while the run is on its way (queued, running, or finished
 *     but its report not yet written), the checks it has made, tool by
 *     tool (name, how many rows, whether it failed), so the card can say
 *     what OneUptime AI is doing;
 *   - isReportPending: the run finished, and its report is still being
 *     written onto the case. A run finishes before its report is posted -
 *     the engine first weighs how confident the report is - so the card
 *     keeps saying "Triaging" until the run settles (its RunCompleted or
 *     RunFailed event, or ANALYSIS_SETTLEMENT_TIMEOUT_MS after it
 *     finished), never "Not triaged yet" for a beat;
 *   - finishedWithoutReport: the latest run settled and wrote no report
 *     (the model had nothing to say, or posting failed): the card says the
 *     triage did not finish;
 *   - evidence: for the report on the case, when it is the latest run's,
 *     every check the report may cite ([C#]) - the tool, what it asked,
 *     how many rows, and where the data lives - rebuilt from the run's own
 *     recorded tool calls (buildInvestigationEvidence), as an incident's AI
 *     card lists its evidence. The model's prose never decides what a row
 *     queries or links to;
 *   - usage: how many checks the run made and the tokens it spent;
 *   - notStartedReason: what stops OneUptime AI triaging the case now, or
 *     null when "Triage with AI" would start a run - code and English
 *     message; the card words it in the reader's language from the code;
 *   - isAutomaticTriageOn: whether the project triages new cases.
 *
 * The triage's result itself - the verdict, the suggestions, the report -
 * is on the case (its ai* columns), which the page reads with the case.
 * Nothing here is the model's own text: steps carry tool names and counts,
 * evidence the server-minted labels and the arguments it recorded.
 */

export const MAX_TRIAGE_EVENTS: number = 500;

/*
 * How long after a run finished its report may still be on its way. Past
 * it, a run that never said it settled is taken as settled.
 */
export const ANALYSIS_SETTLEMENT_TIMEOUT_MS: number = 10 * 60 * 1000;

// A report written a little before the run's own finish time is still its.
export const REPORT_CLOCK_SKEW_MS: number = 60 * 1000;

const STEP_EVENT_TYPES: Array<AIRunEventType> = [
  AIRunEventType.ToolCallCompleted,
  AIRunEventType.ToolCallFailed,
];

const SETTLED_EVENT_TYPES: Array<AIRunEventType> = [
  AIRunEventType.RunCompleted,
  AIRunEventType.RunFailed,
];

export interface SecurityCaseTriageStep {
  toolName: string;
  failed: boolean;
  rowCount?: number | undefined;
}

export interface SecurityCaseTriageSettlement {
  isActive: boolean;
  isReportPending: boolean;
  finishedWithoutReport: boolean;
  // Whether the report on the case is the latest run's.
  isReportFromLatestRun: boolean;
}

/*
 * Where the latest run stands against the report on the case. Pure: the
 * run, whether its events say it settled, and when the case's report was
 * written.
 */
export function getSecurityCaseTriageSettlement(data: {
  run: Pick<AIRun, "status" | "completedAt"> | null;
  hasSettledEvent: boolean;
  aiTriagedAt?: Date | undefined | null;
  now: Date;
}): SecurityCaseTriageSettlement {
  const run: Pick<AIRun, "status" | "completedAt"> | null = data.run;

  if (!run) {
    return {
      isActive: false,
      isReportPending: false,
      finishedWithoutReport: false,
      isReportFromLatestRun: false,
    };
  }

  const isActive: boolean =
    run.status === AIRunStatus.Queued || run.status === AIRunStatus.Running;

  if (isActive || run.status !== AIRunStatus.Completed) {
    return {
      isActive,
      isReportPending: false,
      finishedWithoutReport: false,
      isReportFromLatestRun: false,
    };
  }

  const completedAt: Date | null = run.completedAt
    ? new Date(run.completedAt)
    : null;

  const triagedAt: Date | null = data.aiTriagedAt
    ? new Date(data.aiTriagedAt)
    : null;

  const isReportFromLatestRun: boolean = Boolean(
    triagedAt &&
      (!completedAt ||
        triagedAt.getTime() >= completedAt.getTime() - REPORT_CLOCK_SKEW_MS),
  );

  const isPastSettlement: boolean = Boolean(
    completedAt &&
      data.now.getTime() - completedAt.getTime() >
        ANALYSIS_SETTLEMENT_TIMEOUT_MS,
  );

  const isSettled: boolean = data.hasSettledEvent || isPastSettlement;

  return {
    isActive: false,
    isReportPending: !isReportFromLatestRun && !isSettled,
    finishedWithoutReport: !isReportFromLatestRun && isSettled,
    isReportFromLatestRun,
  };
}

export default class SecurityCaseTriageStatus {
  public static async read(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
  }): Promise<JSONObject> {
    const run: AIRun | null = await SecurityCaseTriage.findLatestRun(data);

    const securityCase: SecurityCase | null = run
      ? await SecurityCaseService.findOneBy({
          query: { _id: data.securityCaseId, projectId: data.projectId },
          select: { aiTriagedAt: true, aiTriageReport: true },
          props: { isRoot: true },
        })
      : null;

    const isCompleted: boolean = run?.status === AIRunStatus.Completed;

    const events: Array<AIRunEvent> = run
      ? await this.readEvents({
          projectId: data.projectId,
          aiRunId: run.id!,
          // The tool arguments are read only to build a finished run's evidence.
          withArguments: isCompleted,
        })
      : [];

    const settlement: SecurityCaseTriageSettlement =
      getSecurityCaseTriageSettlement({
        run,
        hasSettledEvent: events.some((event: AIRunEvent): boolean => {
          return Boolean(
            event.eventType && SETTLED_EVENT_TYPES.includes(event.eventType),
          );
        }),
        aiTriagedAt: securityCase?.aiTriagedAt,
        now: OneUptimeDate.getCurrentDate(),
      });

    const isOnItsWay: boolean =
      settlement.isActive || settlement.isReportPending;

    const steps: Array<SecurityCaseTriageStep> = isOnItsWay
      ? this.toSteps(events)
      : [];

    const evidence: Array<InvestigationEvidenceItem> =
      settlement.isReportFromLatestRun && securityCase?.aiTriageReport
        ? this.buildEvidence({
            events,
            analysisMarkdown: securityCase.aiTriageReport,
          })
        : [];

    const notStartedCode: SecurityCaseTriageNotStartedCode | null = isOnItsWay
      ? null
      : await SecurityCaseTriage.getNotStartedReason({
          projectId: data.projectId,
          automatic: false,
        });

    const project: Project | null = await ProjectService.findOneById({
      id: data.projectId,
      select: { enableAutomaticSecurityCaseTriage: true },
      props: { isRoot: true },
    });

    return {
      run: run
        ? {
            _id: run.id?.toString() || null,
            status: run.status || null,
            createdAt: run.createdAt ? run.createdAt.toISOString() : null,
            startedAt: run.startedAt
              ? new Date(run.startedAt).toISOString()
              : null,
            completedAt: run.completedAt
              ? new Date(run.completedAt).toISOString()
              : null,
            toolCallCount: run.toolCallCount || 0,
            totalTokens: run.totalTokens || 0,
            errorMessage:
              run.status === AIRunStatus.Error ||
              run.status === AIRunStatus.Cancelled ||
              run.status === AIRunStatus.Stale
                ? run.errorMessage || null
                : null,
          }
        : null,
      steps: steps as unknown as JSONArray,
      isReportPending: settlement.isReportPending,
      finishedWithoutReport: settlement.finishedWithoutReport,
      evidence: evidence as unknown as JSONArray,
      notStartedReason: notStartedCode
        ? {
            code: notStartedCode,
            message: SECURITY_CASE_TRIAGE_NOT_STARTED_MESSAGES[notStartedCode],
          }
        : null,
      isAutomaticTriageOn: project?.enableAutomaticSecurityCaseTriage === true,
    };
  }

  private static async readEvents(data: {
    projectId: ObjectID;
    aiRunId: ObjectID;
    withArguments: boolean;
  }): Promise<Array<AIRunEvent>> {
    return await AIRunEventService.findBy({
      query: { projectId: data.projectId, aiRunId: data.aiRunId },
      select: {
        _id: true,
        sequence: true,
        eventType: true,
        toolName: true,
        resultSummary: true,
        createdAt: true,
        ...(data.withArguments
          ? { citationId: true, toolArguments: true }
          : {}),
      },
      sort: { sequence: SortOrder.Ascending },
      limit: MAX_TRIAGE_EVENTS,
      skip: 0,
      props: { isRoot: true },
    });
  }

  // The checks made so far, tool by tool.
  public static toSteps(
    events: Array<AIRunEvent>,
  ): Array<SecurityCaseTriageStep> {
    return events
      .filter((event: AIRunEvent): boolean => {
        return Boolean(
          event.toolName &&
            event.eventType &&
            STEP_EVENT_TYPES.includes(event.eventType),
        );
      })
      .map((event: AIRunEvent): SecurityCaseTriageStep => {
        const rowCount: unknown = event.resultSummary?.rowCount;

        return {
          toolName: event.toolName || "",
          failed: event.eventType === AIRunEventType.ToolCallFailed,
          ...(typeof rowCount === "number" ? { rowCount } : {}),
        };
      });
  }

  /*
   * The report's evidence, guarded: evidence enriches the card and never
   * fails the answer that carries the triage's state.
   */
  private static buildEvidence(data: {
    events: Array<AIRunEvent>;
    analysisMarkdown: string;
  }): Array<InvestigationEvidenceItem> {
    try {
      return buildInvestigationEvidence(data);
    } catch (error) {
      logger.error(
        `AI: could not build a security case triage's evidence for the card: ${error}`,
      );
      return [];
    }
  }
}
