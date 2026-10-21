import PrepareGuard, { GuardResult, refusalPrefix } from "./PrepareGuard";
import {
  ExecutorOptions,
  PrepareResult,
  ResourceCommandRequest,
  ResourceExecutor,
  ResourcePostureProbe,
} from "./ResourceExecutor";
import SpawnSandbox from "./SpawnSandbox";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
  isAiResourceType,
} from "../Common/Types/ResourceAiAgent/AiResourceType";

/*
 * An executor that runs nothing. Two uses:
 *
 *   - the agent has no (known) resource type configured — it is
 *     misconfigured and never claims a job, but the rest of the agent still
 *     needs an executor to sweep its job directories;
 *   - a resource type whose executor this build does not carry yet: the
 *     per-tool executor files (DockerExecutor, ProxmoxExecutor, ...) extend
 *     this class until their kit replaces them.
 *
 * It still runs PrepareGuard first, so a command it would never have been
 * allowed to run is refused for that reason, and only a command every
 * shared check allowed is refused as "not available". Its posture says the
 * resource is unreachable, with the same reason.
 */
export default class UnavailableExecutor implements ResourceExecutor {
  protected readonly sandbox: SpawnSandbox;

  public constructor(protected readonly options: ExecutorOptions) {
    this.sandbox = new SpawnSandbox({
      tmpDir: options.tmpDir,
      spawnImpl: options.spawnImpl,
      logger: options.logger,
    });
  }

  // Why nothing runs, in words for an operator.
  public getUnavailableReason(): string {
    const resourceType: AiResourceType | null =
      this.options.config.resourceType;

    if (!resourceType || !isAiResourceType(resourceType)) {
      return "This agent has no resource type configured (ONEUPTIME_AI_AGENT_RESOURCE_TYPE), so it runs nothing.";
    }

    return `The ${AI_RESOURCE_TYPE_INFO[resourceType].agentDisplayName} executor is not available in this build.`;
  }

  public prepare(request: ResourceCommandRequest): PrepareResult {
    const guarded: GuardResult = PrepareGuard.check({
      config: this.options.config,
      request,
      policy: this.options.guardPolicy,
    });

    if (guarded.refusal !== null) {
      return { refusal: guarded.refusal };
    }

    return {
      refusal: `${refusalPrefix(this.options.config.resourceType)}: ${this.getUnavailableReason()}`,
    };
  }

  public probePosture(): Promise<ResourcePostureProbe> {
    return Promise.resolve({
      toolVersion: null,
      reachable: false,
      reachError: this.getUnavailableReason(),
      details: {},
      protectedTargets: [],
    });
  }

  public sweepOrphanedJobDirs(): Promise<void> {
    const removed: number = this.sandbox.sweepOrphanedJobDirs();

    if (removed > 0) {
      this.options.logger.info(
        "Removed job directories a previous run left behind",
        { removed },
      );
    }

    return Promise.resolve();
  }

  public removeAllJobDirs(): Promise<void> {
    this.sandbox.removeAllJobDirs();
    return Promise.resolve();
  }
}
