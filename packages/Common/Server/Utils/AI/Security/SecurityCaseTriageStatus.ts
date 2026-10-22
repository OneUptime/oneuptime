import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../../../Models/DatabaseModels/AIRunEvent";
import Project from "../../../../Models/DatabaseModels/Project";
import AIRunEventType from "../../../../Types/AI/AIRunEventType";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import AIRunEventService from "../../../Services/AIRunEventService";
import ProjectService from "../../../Services/ProjectService";
import SecurityCaseTriage, {
  SECURITY_CASE_TRIAGE_NOT_STARTED_MESSAGES,
  SecurityCaseTriageNotStartedCode,
} from "./SecurityCaseTriage";

/*
 * What the case's AI card is told (POST /security-case/:caseId/ai-triage):
 *
 *   - run: the case's latest triage run - its status, when it started and
 *     finished, how many checks it made, and why it failed, if it did;
 *   - steps: while the run is queued or running, the checks it has made,
 *     tool by tool (name, how many rows, whether it failed), so the card
 *     can say what OneUptime AI is doing;
 *   - notStartedReason: what stops OneUptime AI triaging the case now, or
 *     null when "Triage with AI" would start a run - code and English
 *     message; the card words it in the reader's language from the code;
 *   - isAutomaticTriageOn: whether the project triages new cases.
 *
 * The triage's result itself - the verdict, the suggestions, the report -
 * is on the case (its ai* columns), which the page reads with the case.
 * Nothing here is the model's text: steps carry tool names and counts only.
 */

export const MAX_TRIAGE_STEPS: number = 200;

const STEP_EVENT_TYPES: Array<AIRunEventType> = [
  AIRunEventType.ToolCallCompleted,
  AIRunEventType.ToolCallFailed,
];

export interface SecurityCaseTriageStep {
  toolName: string;
  failed: boolean;
  rowCount?: number | undefined;
}

export default class SecurityCaseTriageStatus {
  public static async read(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
  }): Promise<JSONObject> {
    const run: AIRun | null = await SecurityCaseTriage.findLatestRun(data);

    const isActive: boolean = Boolean(
      run &&
        (run.status === AIRunStatus.Queued ||
          run.status === AIRunStatus.Running),
    );

    const steps: Array<SecurityCaseTriageStep> =
      run && isActive ? await this.readSteps(data.projectId, run.id!) : [];

    const notStartedCode: SecurityCaseTriageNotStartedCode | null = isActive
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
            errorMessage:
              run.status === AIRunStatus.Error ||
              run.status === AIRunStatus.Cancelled ||
              run.status === AIRunStatus.Stale
                ? run.errorMessage || null
                : null,
          }
        : null,
      steps: steps as unknown as JSONArray,
      notStartedReason: notStartedCode
        ? {
            code: notStartedCode,
            message: SECURITY_CASE_TRIAGE_NOT_STARTED_MESSAGES[notStartedCode],
          }
        : null,
      isAutomaticTriageOn: project?.enableAutomaticSecurityCaseTriage === true,
    };
  }

  private static async readSteps(
    projectId: ObjectID,
    aiRunId: ObjectID,
  ): Promise<Array<SecurityCaseTriageStep>> {
    const events: Array<AIRunEvent> = await AIRunEventService.findBy({
      query: { projectId, aiRunId },
      select: { eventType: true, toolName: true, resultSummary: true },
      sort: { sequence: SortOrder.Ascending },
      limit: MAX_TRIAGE_STEPS,
      skip: 0,
      props: { isRoot: true },
    });

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
}
