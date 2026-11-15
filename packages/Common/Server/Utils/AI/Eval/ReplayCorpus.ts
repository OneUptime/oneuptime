import ObjectID from "../../../../Types/ObjectID";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import AIRunType from "../../../../Types/AI/AIRunType";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunHumanVerdict from "../../../../Types/AI/AIRunHumanVerdict";
import AIRunAutoGrade from "../../../../Types/AI/AIRunAutoGrade";
import { InvestigationRecording } from "../../../../Types/AI/InvestigationRecording";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIRunRecording from "../../../../Models/DatabaseModels/AIRunRecording";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Alert from "../../../../Models/DatabaseModels/Alert";
import QueryHelper from "../../../Types/Database/QueryHelper";
import AIRunService from "../../../Services/AIRunService";
import AIRunRecordingService from "../../../Services/AIRunRecordingService";
import IncidentService from "../../../Services/IncidentService";
import AlertService from "../../../Services/AlertService";
import PostedRootCause from "../SRE/PostedRootCause";
import { GoldenCaseSubjectType } from "./EvalCorpus";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * The investigations a replay can run again (Eval/ReplayInvestigation):
 * completed incident and alert investigations that kept a recording
 * (AIRunRecording), newest first, with what a replay is graded against -
 * the root cause people wrote for the incident or alert - and what the
 * original run was graded. Read as the system, from the command line
 * (npm run ai-eval -- --replay); nothing here is reachable from the API.
 */

// How many recorded runs a replay takes when the caller does not say: each costs model calls.
export const DEFAULT_REPLAY_LIMIT: number = 20;

export interface ReplayCase {
  runId: string;
  projectId: string;
  subjectType: GoldenCaseSubjectType;
  subjectId: string;
  completedAt?: string | undefined;
  // The root cause people wrote for the incident or alert; null: none yet.
  rootCause: string | null;
  original: {
    autoGrade?: AIRunAutoGrade | undefined;
    humanVerdict?: AIRunHumanVerdict | undefined;
    llmCallCount?: number | undefined;
    toolCallCount?: number | undefined;
    totalTokens?: number | undefined;
  };
}

export default class ReplayCorpus {
  @CaptureSpan()
  public static async listCases(options: {
    projectId?: ObjectID | undefined;
    limit?: number | undefined;
  }): Promise<Array<ReplayCase>> {
    const limit: number = Math.min(
      Math.max(1, options.limit || DEFAULT_REPLAY_LIMIT),
      LIMIT_MAX,
    );

    const recordings: Array<AIRunRecording> =
      await AIRunRecordingService.findBy({
        query: options.projectId ? { projectId: options.projectId } : {},
        select: { aiRunId: true, projectId: true },
        sort: { createdAt: SortOrder.Descending },
        limit,
        skip: 0,
        props: { isRoot: true },
      });

    const runIds: Array<ObjectID> = [];
    const seen: Set<string> = new Set();

    for (const recording of recordings) {
      const runId: string | undefined = recording.aiRunId?.toString();

      if (runId && !seen.has(runId)) {
        seen.add(runId);
        runIds.push(recording.aiRunId!);
      }
    }

    if (runIds.length === 0) {
      return [];
    }

    const runs: Array<AIRun> = await AIRunService.findBy({
      query: {
        _id: QueryHelper.any(runIds),
        runType: AIRunType.Investigation,
        status: AIRunStatus.Completed,
      },
      select: {
        _id: true,
        projectId: true,
        completedAt: true,
        humanVerdict: true,
        autoGrade: true,
        triggeredByIncidentId: true,
        triggeredByAlertId: true,
        llmCallCount: true,
        toolCallCount: true,
        totalTokens: true,
      },
      sort: { completedAt: SortOrder.Descending },
      limit: runIds.length,
      skip: 0,
      props: { isRoot: true },
    });

    const cases: Array<ReplayCase> = [];

    for (const run of runs) {
      const subjectType: GoldenCaseSubjectType | null =
        run.triggeredByIncidentId
          ? "Incident"
          : run.triggeredByAlertId
            ? "Alert"
            : null;

      if (!subjectType || !run.id || !run.projectId) {
        continue;
      }

      const subjectId: ObjectID =
        subjectType === "Incident"
          ? run.triggeredByIncidentId!
          : run.triggeredByAlertId!;

      cases.push({
        runId: run.id.toString(),
        projectId: run.projectId.toString(),
        subjectType,
        subjectId: subjectId.toString(),
        ...(run.completedAt
          ? { completedAt: new Date(run.completedAt).toISOString() }
          : {}),
        rootCause: await this.getRootCause(subjectType, subjectId),
        original: {
          autoGrade: run.autoGrade,
          humanVerdict: run.humanVerdict,
          llmCallCount: run.llmCallCount,
          toolCallCount: run.toolCallCount,
          totalTokens: run.totalTokens,
        },
      });
    }

    return cases;
  }

  public static async getRecording(
    replayCase: ReplayCase,
  ): Promise<InvestigationRecording | null> {
    return AIRunRecordingService.getForRun({
      projectId: new ObjectID(replayCase.projectId),
      aiRunId: new ObjectID(replayCase.runId),
    });
  }

  // The analysis the original run posted, to grade beside the replay's.
  public static async getOriginalAnalysis(
    replayCase: ReplayCase,
  ): Promise<string | null> {
    return PostedRootCause.getForInvestigation({
      ...(replayCase.subjectType === "Incident"
        ? { incidentId: new ObjectID(replayCase.subjectId) }
        : { alertId: new ObjectID(replayCase.subjectId) }),
      aiRunId: new ObjectID(replayCase.runId),
      runCompletedAt: replayCase.completedAt
        ? new Date(replayCase.completedAt)
        : undefined,
    });
  }

  private static async getRootCause(
    subjectType: GoldenCaseSubjectType,
    subjectId: ObjectID,
  ): Promise<string | null> {
    if (subjectType === "Incident") {
      const incident: Incident | null = await IncidentService.findOneById({
        id: subjectId,
        select: { rootCause: true },
        props: { isRoot: true },
      });

      return incident?.rootCause?.trim() || null;
    }

    const alert: Alert | null = await AlertService.findOneById({
      id: subjectId,
      select: { rootCause: true },
      props: { isRoot: true },
    });

    return alert?.rootCause?.trim() || null;
  }
}
