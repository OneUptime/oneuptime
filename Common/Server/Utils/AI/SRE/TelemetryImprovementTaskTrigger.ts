import ObjectID from "../../../../Types/ObjectID";
import CodeFixTaskType from "../../../../Types/AI/CodeFixTaskType";
import CodeFixTaskContext from "../../../../Types/AI/CodeFixTaskContext";
import BadDataException from "../../../../Types/Exception/BadDataException";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Service from "../../../../Models/DatabaseModels/Service";
import ServiceService from "../../../Services/ServiceService";
import SubjectCodeFixRun from "./SubjectCodeFixRun";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * AI SRE — the service-scoped instrumentation-improvement triggers:
 * ImproveLogging and ImproveTracing. One click on a service's Logs or
 * Traces page opens a draft PR that improves that service's logging or
 * tracing hygiene — parameterized log messages, correct severities, spans
 * on uninstrumented paths, proper exception recording — WITHOUT changing
 * behavior.
 *
 * Like FixFromIncident and FixPerformance these are human-triggered from a
 * user-facing endpoint (POST /ai-investigation/
 * create-telemetry-improvement-task), so there is no project opt-in flag —
 * the human in the loop IS the gate — and every unmet gate FAILS EARLY
 * with a clear message. The recipe's grounding is the SERVICE: repository
 * resolution at task-details time uses the service name (name-match /
 * only-repository), the same path the incident-subject recipes use.
 */
export default class TelemetryImprovementTaskTrigger {
  /*
   * Gate and enqueue an ImproveLogging / ImproveTracing CodeFix run for a
   * telemetry service. The caller must already have loaded the service
   * under the USER's permissions (the access check) — this method reads
   * and writes as root.
   *
   * Throws BadDataException naming the failed gate: unsupported recipe, no
   * GitHub-App repository, a duplicate active run for the same service, or
   * (via enqueueSubjectCodeFixRun) the daily fix-run budget.
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
      await SubjectCodeFixRun.hasGitHubAppConnectedRepository(data.projectId);

    if (!hasConnectedRepository) {
      throw new BadDataException(
        "No GitHub-App-connected repository exists for this project, so the agent has nowhere to open the pull request. Connect one under AI > Code Repositories.",
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
        } task is already queued or running for this service. Track its progress on the AI > Tasks page.`,
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
