import ObjectID from "../../../../Types/ObjectID";
import CodeFixTaskType from "../../../../Types/AI/CodeFixTaskType";
import CodeFixTaskContext from "../../../../Types/AI/CodeFixTaskContext";
import BadDataException from "../../../../Types/Exception/BadDataException";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Service from "../../../../Models/DatabaseModels/Service";
import ServiceService from "../../../Services/ServiceService";
import AIService from "../../../Services/AIService";
import SubjectCodeFixRun from "./SubjectCodeFixRun";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import {
  getTelemetryImprovementOffer,
  NO_TELEMETRY_IMPROVEMENT_SUGGESTION,
  TelemetryImprovementSuggestion,
} from "../../../../Utils/Suggestions/TelemetryImprovementSuggestion";
import SuggestionOffer from "../../../../Utils/Suggestions/SuggestionOffer";

/*
 * AI SRE — the service-scoped instrumentation-improvement triggers:
 * ImproveLogging and ImproveTracing. One click on a service's Logs or
 * Traces page opens a PR that improves that service's logging or
 * tracing hygiene — parameterized log messages, correct severities, spans
 * on uninstrumented paths, proper exception recording — WITHOUT changing
 * behavior.
 *
 * Like FixFromIncident and FixPerformance these are human-triggered from a
 * user-facing endpoint (POST /ai-investigation/
 * create-telemetry-improvement-task), so there is no per-feature opt-in —
 * the human in the loop IS the gate, under the project's one AI switch —
 * and every unmet gate FAILS EARLY with a clear message. The recipe's
 * grounding is the SERVICE: repository resolution at task-details time
 * uses the service name (name-match / only-repository), the same path the
 * incident-subject recipes use.
 *
 * The service's page asks first (getSuggestion, POST /ai-investigation/
 * telemetry-improvement-suggestion) and draws the card only when these same
 * gates would let the click through.
 */
export default class TelemetryImprovementTaskTrigger {
  /*
   * What a service's Logs or Traces page offers: the card (Act), a link to
   * the improvement already on its way (InProgress), or nothing (None) -
   * decided by the gates createTelemetryImprovementTask enforces: AI on, a
   * repository, no run of the same recipe in flight for the service. The
   * caller has already checked the person may read the service.
   */
  @CaptureSpan()
  public static async getSuggestion(data: {
    projectId: ObjectID;
    telemetryServiceId: ObjectID;
    taskType: CodeFixTaskType;
  }): Promise<TelemetryImprovementSuggestion> {
    if (
      data.taskType !== CodeFixTaskType.ImproveLogging &&
      data.taskType !== CodeFixTaskType.ImproveTracing
    ) {
      return NO_TELEMETRY_IMPROVEMENT_SUGGESTION;
    }

    const isAiEnabled: boolean = await AIService.isProjectAIEnabled(
      data.projectId,
    );

    if (!isAiEnabled) {
      return NO_TELEMETRY_IMPROVEMENT_SUGGESTION;
    }

    const activeRun: AIRun | null =
      await SubjectCodeFixRun.findNonTerminalRunForTelemetryService({
        projectId: data.projectId,
        taskType: data.taskType,
        telemetryServiceId: data.telemetryServiceId.toString(),
      });

    const hasConnectedRepository: boolean = activeRun
      ? true
      : await SubjectCodeFixRun.hasConnectedRepository(data.projectId);

    const offer: SuggestionOffer = getTelemetryImprovementOffer({
      isAiEnabled: true,
      hasActiveFix: Boolean(activeRun),
      hasConnectedRepository,
    });

    return {
      offer,
      aiRunId:
        offer === SuggestionOffer.InProgress
          ? activeRun?.id?.toString() || null
          : null,
    };
  }

  /*
   * Gate and enqueue an ImproveLogging / ImproveTracing CodeFix run for a
   * telemetry service. The caller must already have loaded the service
   * under the USER's permissions (the access check) — this method reads
   * and writes as root.
   *
   * Throws naming the failed gate: unsupported recipe, AI switched off for
   * the project, no GitHub-App repository, a duplicate active run for the
   * same service, or (via enqueueSubjectCodeFixRun) the daily fix-run
   * budget.
   */
  @CaptureSpan()
  public static async createTelemetryImprovementTask(data: {
    projectId: ObjectID;
    telemetryServiceId: ObjectID;
    taskType: CodeFixTaskType;
    userId: ObjectID;
  }): Promise<AIRun> {
    if (
      data.taskType !== CodeFixTaskType.ImproveLogging &&
      data.taskType !== CodeFixTaskType.ImproveTracing
    ) {
      throw new BadDataException(
        `Task type "${data.taskType}" is not a telemetry-improvement recipe. Supported: ${CodeFixTaskType.ImproveLogging}, ${CodeFixTaskType.ImproveTracing}.`,
      );
    }

    // The project's one AI switch, before anything else is read.
    await AIService.assertProjectAIEnabled(data.projectId);

    const service: Service | null = await ServiceService.findOneById({
      id: data.telemetryServiceId,
      select: {
        _id: true,
        name: true,
        projectId: true,
      },
      props: { isRoot: true },
    });

    if (
      !service ||
      service.projectId?.toString() !== data.projectId.toString()
    ) {
      throw new BadDataException("Telemetry service not found.");
    }

    // Gate — a repository the agent can actually open a PR against.
    const hasConnectedRepository: boolean =
      await SubjectCodeFixRun.hasConnectedRepository(data.projectId);

    if (!hasConnectedRepository) {
      throw new BadDataException(
        "No connected repository exists for this project, so the agent has nowhere to open the pull request. Connect one in Code.",
      );
    }

    /*
     * Gate — per-(service, recipe) dedupe: repeated clicks must not fan
     * out into duplicate PRs.
     */
    const existingRun: AIRun | null =
      await SubjectCodeFixRun.findNonTerminalRunForTelemetryService({
        projectId: data.projectId,
        taskType: data.taskType,
        telemetryServiceId: data.telemetryServiceId.toString(),
      });

    if (existingRun) {
      throw new BadDataException(
        `An ${
          data.taskType === CodeFixTaskType.ImproveLogging
            ? "improve-logging"
            : "improve-tracing"
        } task is already queued or running for this service. Track its progress in Code.`,
      );
    }

    const taskContext: CodeFixTaskContext = {
      telemetryServiceId: data.telemetryServiceId.toString(),
      serviceName: service.name || undefined,
    };

    return SubjectCodeFixRun.enqueueSubjectCodeFixRun({
      projectId: data.projectId,
      taskType: data.taskType,
      userId: data.userId,
      taskContext,
    });
  }
}
