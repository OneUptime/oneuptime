import {
  ENABLE_CODE_FIXES_OVERRIDE,
  IS_KUBERNETES_AGENT_MODE,
  KUBERNETES_AGENT_CLUSTER_NAME,
  ONEUPTIME_BASE_URL,
  POLL_INTERVAL_MS,
  PORT,
  RUNNER_VERSION,
} from "./Config";
import startHeartbeat, { HeartbeatHandle, signOff } from "./Jobs/Heartbeat";
import startRunbookPolling from "./Jobs/PollRunbookWork";
import startCodeFixPolling from "./Jobs/PollCodeFixWork";
import Register from "./Services/RegisterRunner";
import KubectlExecutor from "./Services/KubectlExecutor";
import RunnerIdentity from "./Utils/RunnerIdentity";
import WorkspaceManager from "./Utils/WorkspaceManager";
import GitCredentials from "./Utils/GitCredentials";
import RunnerCapabilities, {
  RunnerCapabilitySet,
} from "./Utils/RunnerCapabilities";
import GlobalRunnerMode from "./Utils/GlobalRunnerMode";
import MetricsAPI from "./API/Metrics";
import {
  getTaskHandlerRegistry,
  FixExceptionTaskHandler,
  WriteRegressionTestTaskHandler,
  ImproveExceptionHandlingTaskHandler,
  ImproveInstrumentationTaskHandler,
  ImproveLoggingTaskHandler,
  ImproveTracingTaskHandler,
  FixFromIncidentTaskHandler,
  FixPerformanceTaskHandler,
  GitHubIssueFixTaskHandler,
  GitHubPullRequestRevisionTaskHandler,
  GitHubPullRequestReviewTaskHandler,
  CodeRequestTaskHandler,
} from "./TaskHandlers/Index";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import logger, { LogAttributes } from "Common/Server/Utils/Logger";
import App from "Common/Server/Utils/StartServer";
import GracefulShutdown, {
  ShutdownPriority,
} from "Common/Server/Utils/GracefulShutdown";
import Telemetry from "Common/Server/Utils/Telemetry";
import Profiling from "Common/Server/Utils/Profiling";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import "ejs";

const APP_NAME: string = "runner";

/*
 * OneUptime Runner — one agent, two kinds of work.
 *
 * Runbook capability: claims Bash/JavaScript runbook steps and executes
 * them here, in the customer's own infrastructure, so the credentials for
 * the systems being operated on never leave their network.
 *
 * Code-fix capability: claims AI code-fix runs, works in the project's code
 * repositories that pick this Runner (their Runner setting in Code) and
 * opens pull requests for review. A Runner no repository picks takes none.
 * A global Runner - one OneUptime runs for every project - takes those of
 * every repository on the Global Runner, and runs none of a repository's
 * own commands.
 *
 * Both loops share one registration, one credential and one heartbeat.
 */
const init: PromiseVoidFunction = async (): Promise<void> => {
  try {
    Telemetry.init({ serviceName: APP_NAME });
    Profiling.init({ serviceName: APP_NAME });

    logger.info(
      `OneUptime Runner ${RUNNER_VERSION} starting | server=${ONEUPTIME_BASE_URL.toString()} | scope=${
        IS_KUBERNETES_AGENT_MODE
          ? `kubernetes-agent (cluster "${KUBERNETES_AGENT_CLUSTER_NAME}")`
          : "project or global, as the server says"
      } | poll=${POLL_INTERVAL_MS}ms`,
      { serviceName: APP_NAME } as LogAttributes,
    );

    await App.init({
      appName: APP_NAME,
      port: PORT,
      isFrontendApp: false,
      /*
       * The Runner never holds ENCRYPTION_SECRET (no Runner's deployment
       * gives it one), so the boot warning about it is not this process's to
       * say.
       */
      usesEncryptionSecret: false,
      statusOptions: {
        liveCheck: async () => {},
        readyCheck: async () => {},
      },
    });

    // Queue-depth metrics for KEDA autoscaling of the code-fix lane.
    const app: ExpressApplication = Express.getExpressApp();
    app.use("/metrics", MetricsAPI);

    await App.addDefaultRoutes();

    /*
     * Reap the kubeconfigs a previous life of this container left on disk.
     * A kubectl command for an external Runner writes the cluster's bearer
     * token to a private temporary kubeconfig and removes it in a finally
     * block — which never runs when the process is killed mid-command (an
     * OOM, a node drain, a SIGKILL after the termination grace period).
     * Done here, before registration and in every mode, so a token never
     * outlives the process that wrote it by more than one restart; the same
     * call arranges for in-flight kubeconfigs to go on SIGTERM/SIGINT.
     */
    const reapedKubeconfigs: number = KubectlExecutor.initialize();

    if (reapedKubeconfigs > 0) {
      logger.info(
        `Reclaimed ${reapedKubeconfigs} abandoned kubectl credential director${
          reapedKubeconfigs === 1 ? "y" : "ies"
        } from a previous run.`,
        { serviceName: APP_NAME } as LogAttributes,
      );
    }

    /*
     * Registration resolves this Runner's identity: it validates the id and
     * key it was started with (in kubernetes-agent mode the server issues
     * them), and learns whether it is global. Retries forever — a
     * temporarily unreachable server must never kill the container.
     */
    await Register.registerRunner();

    /*
     * Registration is what tells a project-scoped Runner which capabilities
     * its project granted it, so this can only be resolved afterwards.
     */
    const capabilities: RunnerCapabilitySet = RunnerCapabilities.resolve();

    logger.info(
      `Runner registered | runnerId=${RunnerIdentity.getRunnerId().toString()} | runbooks=${
        capabilities.canRunRunbooks ? "on" : "off"
      } | codeFixes=${capabilities.canRunCodeFixTasks ? "on" : "off"} | aiCommands=${
        capabilities.canRunAiCommands ? "on" : "off"
      }`,
      { serviceName: APP_NAME } as LogAttributes,
    );

    /*
     * No capability is a misconfiguration, not a crash: the container stays
     * up and keeps heartbeating so the dashboard still shows the Runner
     * connected and an operator can grant it a capability there. Exiting
     * would restart-loop it into looking permanently offline, which is the
     * opposite of the signal they need.
     */
    if (
      !capabilities.canRunRunbooks &&
      !capabilities.canRunCodeFixTasks &&
      !capabilities.canRunAiCommands
    ) {
      logger.error(
        "No capability is enabled — this Runner has nothing to do. Turn on 'Runs Runbooks' on this Runner in your OneUptime dashboard, or pick it as a code repository's Runner in the repository's settings in Code — it is picked up on the next heartbeat, no restart needed.",
        { serviceName: APP_NAME } as LogAttributes,
      );
    }

    /*
     * A local override that contradicts what the server granted is worth
     * saying out loud: the server counts this Runner as able to take code-fix
     * work, so runs will be queued for it and nothing here will claim them.
     */
    if (
      ENABLE_CODE_FIXES_OVERRIDE === false &&
      RunnerCapabilities.wasGrantedCodeFixesByServer()
    ) {
      logger.warn(
        GlobalRunnerMode.isActive()
          ? "This is a global Runner, so it is to take the AI code-fix work of every repository on the Global Runner, but ONEUPTIME_RUNNER_ENABLE_CODE_FIXES=false on this host refuses it. Code-fix runs will sit queued while no other global Runner takes them. Remove the override."
          : "A code repository of this project picks this Runner, so it is to take AI code-fix work, but ONEUPTIME_RUNNER_ENABLE_CODE_FIXES=false on this host refuses it. Code-fix runs will sit queued. Remove the override, or pick another Runner in the repository's settings in Code.",
        { serviceName: APP_NAME } as LogAttributes,
      );
    }

    /*
     * The heartbeat keeps the Runner's row Connected, and that row's
     * lastAlive is also how the server knows a Runner is there to take
     * code-fix work - a project's for its repositories, a global one for
     * every repository on the Global Runner.
     */
    const heartbeat: HeartbeatHandle = startHeartbeat();

    /*
     * Sign off on SIGTERM/SIGINT so the dashboard shows this Runner offline
     * at once — and, for the kubernetes-agent Runner, so the replacement pod
     * can register immediately after a rolling restart instead of waiting
     * for this instance's last heartbeat to age out. The heartbeat stops
     * first (see signOff): one sent after the sign-off would mark this
     * Runner online again. GracefulShutdown bounds the call and exits
     * afterwards.
     */
    GracefulShutdown.registerHandler(
      "Runner.disconnect",
      ShutdownPriority.Workers,
      async (): Promise<void> => {
        await signOff(heartbeat);
      },
    );

    /*
     * Both loops start whenever they are possible AT ALL for this Runner,
     * and each one checks the live capability on every tick. That is what
     * lets a dashboard toggle take effect within a heartbeat: there is no
     * loop to start or stop, only a flag to read. A loop whose capability is
     * off does not contact the server.
     */
    startRunbookPolling();

    if (capabilities.canRunRunbooks) {
      logger.info("Runbook capability enabled — polling for runbook steps.", {
        serviceName: APP_NAME,
      } as LogAttributes);
    }

    /*
     * The code-fix loop always starts and self-gates - except on the
     * Kubernetes agent's Runner, which exists to run kubectl for OneUptime
     * AI. It never clones repositories (its root filesystem is read-only),
     * so the code-fix loop is not started at all.
     */
    const startCodeFixLoop: boolean = !IS_KUBERNETES_AGENT_MODE;

    if (startCodeFixLoop) {
      /*
       * Reap what a previous life of this container left on disk. A fix run
       * clones whole repositories into its workspace and deletes them in a
       * finally block — which never runs when the container is killed
       * mid-run (an OOM, a node drain, a deploy). Without this sweep those
       * clones accumulate for the life of the volume until the Runner
       * cannot clone at all, and the failure surfaces as unexplained fix
       * runs failing rather than as a full disk.
       */
      await WorkspaceManager.initialize();

      const reapedWorkspaces: number =
        await WorkspaceManager.cleanupOldWorkspaces();
      const reapedHelpers: number = await GitCredentials.cleanupOrphans();

      if (reapedWorkspaces > 0 || reapedHelpers > 0) {
        logger.info(
          `Reclaimed ${reapedWorkspaces} abandoned workspace(s) and ${reapedHelpers} orphaned git helper(s) from a previous run.`,
          { serviceName: APP_NAME } as LogAttributes,
        );
      }

      const registry: ReturnType<typeof getTaskHandlerRegistry> =
        getTaskHandlerRegistry();
      registry.register(new FixExceptionTaskHandler());
      registry.register(new WriteRegressionTestTaskHandler());
      registry.register(new ImproveExceptionHandlingTaskHandler());
      registry.register(new ImproveInstrumentationTaskHandler());
      registry.register(new ImproveLoggingTaskHandler());
      registry.register(new ImproveTracingTaskHandler());
      registry.register(new FixFromIncidentTaskHandler());
      registry.register(new FixPerformanceTaskHandler());
      registry.register(new GitHubIssueFixTaskHandler());
      registry.register(new GitHubPullRequestRevisionTaskHandler());
      registry.register(new GitHubPullRequestReviewTaskHandler());
      registry.register(new CodeRequestTaskHandler());

      if (capabilities.canRunCodeFixTasks) {
        logger.info(
          `Code-fix capability enabled — ${registry.getHandlerCount()} task handler(s) registered: ${registry
            .getRegisteredTaskTypes()
            .join(", ")}`,
          { serviceName: APP_NAME } as LogAttributes,
        );
      }

      // Runs in the background for the life of the process.
      startCodeFixPolling().catch((err: Error) => {
        logger.error("Code-fix task loop failed:", {
          serviceName: APP_NAME,
        } as LogAttributes);
        logger.error(err, { serviceName: APP_NAME } as LogAttributes);
      });
    }

    logger.info("OneUptime Runner ready.", {
      serviceName: APP_NAME,
    } as LogAttributes);
  } catch (err) {
    logger.error("Runner init failed:", {
      serviceName: APP_NAME,
    } as LogAttributes);
    logger.error(err, { serviceName: APP_NAME } as LogAttributes);
    throw err;
  }
};

init().catch((err: Error) => {
  logger.error(err, { serviceName: APP_NAME } as LogAttributes);
  process.exit(1);
});
