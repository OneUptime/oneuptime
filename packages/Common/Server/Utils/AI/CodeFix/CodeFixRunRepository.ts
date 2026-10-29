import AlertService from "../../../Services/AlertService";
import CodeRepositoryService from "../../../Services/CodeRepositoryService";
import IncidentService from "../../../Services/IncidentService";
import { RepoResolution } from "../../CodeRepository/StackTraceRepoResolver";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import CodeFixTaskContext, {
  PerformanceCodeLocation,
} from "../../../../Types/AI/CodeFixTaskContext";
import CodeFixTaskType, {
  CodeFixContextKind,
  CodeFixTaskTypeHelper,
} from "../../../../Types/AI/CodeFixTaskType";
import ObjectID from "../../../../Types/ObjectID";
import {
  CodeRepositoryAllowance,
  fromStoredCodeRepositoryIds,
} from "../../../../Types/CodeRepository/CodeRepositoryAllowance";

/*
 * The repository a code-fix run that finds its repository as it works will
 * work in, decided when the run is queued - so the run is queued on that
 * repository, and the Runner the repository picks (its Runner setting in
 * Code) is the one that takes it (CodeFixClaimQuery).
 *
 * It is decided from the same facts the run's details route
 * (AIAgentDataAPI, get-instrumentation-task-details) resolves it from when
 * the run starts, through the same resolver
 * (CodeRepositoryService.resolveRepositoryForException), and the helpers
 * below are what both read the facts with:
 *
 *   - ImproveLogging / ImproveTracing: the service's name;
 *   - FixPerformance: the implicated spans' code locations as a stack trace,
 *     and the service's name;
 *   - ImproveInstrumentation / FixFromIncident: the incident's first
 *     monitor's name, or the alert's monitor's name.
 *
 * Exception recipes are decided where their readiness already resolves the
 * repository (TelemetryExceptionService.createCodeFixRunForException), and
 * Code's requests and GitHub commands name theirs.
 *
 * A run the auto remediation rules opened is held to the repositories they
 * allow (CodeFixTaskContext.allowedCodeRepositoryIds): it resolves among
 * those only, here and when it starts.
 */

/*
 * The implicated spans' code.* attributes as a stack trace the path matcher
 * reads (each line shaped so extractCandidatePathsFromStackTrace parses
 * it), or null when the instrumentation stamped none.
 */
export function getPerformanceStackTrace(
  codeLocations: Array<PerformanceCodeLocation> | undefined,
): string | null {
  if (!codeLocations || codeLocations.length === 0) {
    return null;
  }

  return codeLocations
    .map((location: PerformanceCodeLocation): string => {
      return `    at ${
        location.functionName ? `${location.functionName} ` : ""
      }(${location.filePath}:${location.lineNumber ?? 1})`;
    })
    .join("\n");
}

/*
 * The repositories a run may be made in: the one the person who asked for it
 * picked (CodeFixTaskContext.pickedCodeRepositoryId), when they picked one;
 * otherwise the ones the auto remediation rules that opened it allow
 * (allowedCodeRepositoryIds), or every connected one. Read when the run is
 * queued (resolveForNewRun) and again when it starts (AIAgentDataAPI), so
 * both resolve the same repository: a pick is the only candidate, and the
 * resolver's only-repository rule takes it.
 */
export function getRunRepositoryAllowance(
  taskContext: CodeFixTaskContext | null | undefined,
): CodeRepositoryAllowance {
  const picked: unknown = taskContext?.pickedCodeRepositoryId;

  if (typeof picked === "string" && ObjectID.isValidUUID(picked)) {
    return {
      isEveryRepository: false,
      repositoryIds: [picked.toLowerCase()],
    };
  }

  return fromStoredCodeRepositoryIds(taskContext?.allowedCodeRepositoryIds);
}

// The first named monitor of a subject: what names its service, if anything.
export function getFirstMonitorName(
  monitors: Array<{ name?: string | undefined }> | undefined,
): string | null {
  return (
    (monitors || [])
      .map((monitor: { name?: string | undefined }): string => {
        return monitor.name || "";
      })
      .filter(Boolean)[0] || null
  );
}

export default class CodeFixRunRepository {
  /*
   * The repository a new run of this recipe will work in, or null when no
   * connected repository resolves (the run is then queued without one, and
   * says so when it starts) or the lookup fails: a queued run is never held
   * back for it.
   */
  @CaptureSpan()
  public static async resolveForNewRun(data: {
    projectId: ObjectID;
    taskType: CodeFixTaskType;
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
    taskContext?: CodeFixTaskContext | undefined;
  }): Promise<ObjectID | null> {
    try {
      const facts: { stackTrace: string | null; serviceName: string | null } =
        await CodeFixRunRepository.getResolutionFacts(data);

      const resolution: RepoResolution | null =
        await CodeRepositoryService.resolveRepositoryForException({
          projectId: data.projectId,
          stackTrace: facts.stackTrace,
          serviceName: facts.serviceName,
          allowance: getRunRepositoryAllowance(data.taskContext),
        });

      return resolution ? new ObjectID(resolution.codeRepositoryId) : null;
    } catch (error) {
      logger.error(
        `Could not decide the repository of a new ${data.taskType} run in project ${data.projectId.toString()}; it is queued without one: ${error}`,
      );

      return null;
    }
  }

  // What the resolver is given for the recipe (see the module comment).
  public static async getResolutionFacts(data: {
    taskType: CodeFixTaskType;
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
    taskContext?: CodeFixTaskContext | undefined;
  }): Promise<{ stackTrace: string | null; serviceName: string | null }> {
    if (
      data.taskType === CodeFixTaskType.ImproveLogging ||
      data.taskType === CodeFixTaskType.ImproveTracing
    ) {
      return {
        stackTrace: null,
        serviceName: data.taskContext?.serviceName || null,
      };
    }

    if (
      CodeFixTaskTypeHelper.getContextKind(data.taskType) ===
      CodeFixContextKind.TaskContext
    ) {
      return {
        stackTrace: getPerformanceStackTrace(data.taskContext?.codeLocations),
        serviceName: data.taskContext?.serviceName || null,
      };
    }

    if (data.incidentId) {
      const incident: Incident | null = await IncidentService.findOneById({
        id: data.incidentId,
        select: {
          monitors: {
            name: true,
          },
        },
        props: { isRoot: true },
      });

      return {
        stackTrace: null,
        serviceName: getFirstMonitorName(incident?.monitors),
      };
    }

    if (data.alertId) {
      const alert: Alert | null = await AlertService.findOneById({
        id: data.alertId,
        select: {
          monitor: {
            name: true,
          },
        },
        props: { isRoot: true },
      });

      return {
        stackTrace: null,
        serviceName: alert?.monitor?.name || null,
      };
    }

    return { stackTrace: null, serviceName: null };
  }
}
