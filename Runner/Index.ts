import {
  ENABLE_CODE_FIXES_OVERRIDE,
  IS_CLUSTER_SCOPED,
  ONEUPTIME_BASE_URL,
  POLL_INTERVAL_MS,
  PORT,
  RUNNER_VERSION,
} from "./Config";
import startHeartbeat from "./Jobs/Heartbeat";
import startRunbookPolling from "./Jobs/PollRunbookWork";
import startCodeFixPolling from "./Jobs/PollCodeFixWork";
import startCodeFixAlive from "./Jobs/CodeFixAlive";
import Register from "./Services/RegisterRunner";
import RunnerIdentity from "./Utils/RunnerIdentity";
import WorkspaceManager from "./Utils/WorkspaceManager";
import GitCredentials from "./Utils/GitCredentials";
import RunnerCapabilities, {
  RunnerCapabilitySet,
} from "./Utils/RunnerCapabilities";
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
} from "./TaskHandlers/Index";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import logger, { LogAttributes } from "Common/Server/Utils/Logger";
import App from "Common/Server/Utils/StartServer";
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
 * repository and opens pull requests for review. Opt-in, because it needs a
 * connected repository and writes to it.
 *
 * Both loops share one registration, one credential and one heartbeat.
 */
const init: PromiseVoidFunction = async (): Promise<void> => {
  try {
    Telemetry.init({ serviceName: APP_NAME });
    Profiling.init({ serviceName: APP_NAME });

    logger.info(
      `OneUptime Runner ${RUNNER_VERSION} starting | server=${ONEUPTIME_BASE_URL.toString()} | scope=${
        IS_CLUSTER_SCOPED ? "cluster" : "project"
      } | poll=${POLL_INTERVAL_MS}ms`,
      { serviceName: APP_NAME } as LogAttributes,
    );

    await App.init({
      appName: APP_NAME,
      port: PORT,
      isFrontendApp: false,
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
     * Registration resolves this Runner's identity: in project mode it
     * validates the dashboard-issued id + key; in cluster mode the server
     * assigns an id. Retries forever — a temporarily unreachable server
     * must never kill the container.
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
        IS_CLUSTER_SCOPED
          ? "No capability is enabled — this cluster-scoped Runner has nothing to do. Set ONEUPTIME_RUNNER_ENABLE_CODE_FIXES=true, or install a project-scoped Runner to execute runbooks."
          : "No capability is enabled — this Runner has nothing to do. Enable 'Runs Runbooks' or 'Runs AI Code Fixes' on this Runner in your OneUptime dashboard — it is picked up on the next heartbeat, no restart needed.",
        { serviceName: APP_NAME } as LogAttributes,
      );
    }

    /*
     * A local override that contradicts what the project granted is worth
     * saying out loud: the server counts this Runner as able to take code-fix
     * work, so runs will be queued for it and nothing here will claim them.
     */
    if (
      !IS_CLUSTER_SCOPED &&
      ENABLE_CODE_FIXES_OVERRIDE === false &&
      RunnerCapabilities.wasGrantedCodeFixesByServer()
    ) {
      logger.warn(
        "This project granted this Runner the AI code-fix capability, but ONEUPTIME_RUNNER_ENABLE_CODE_FIXES=false on this host refuses it. Code-fix runs will sit queued. Remove the override, or turn 'Runs AI Code Fixes' off in the dashboard.",
        { serviceName: APP_NAME } as LogAttributes,
      );
    }

    /*
     * The heartbeat keeps the dashboard's Runner row Connected, and that row's
     * lastAlive is also how the server knows a project has an agent able to
     * take code-fix work. It authenticates against that row, so it only
     * applies to a project-scoped Runner; the cluster-scoped one reports its
     * liveness on the code-fix identity instead (startCodeFixAlive below).
     */
    if (!IS_CLUSTER_SCOPED) {
      startHeartbeat();
    }

    /*
     * Both loops start whenever they are possible AT ALL for this scope, and
     * each one checks the live capability on every tick. That is what lets a
     * dashboard toggle take effect within a heartbeat: there is no loop to
     * start or stop, only a flag to read. A loop whose capability is off does
     * not contact the server.
     */
    if (!IS_CLUSTER_SCOPED) {
      startRunbookPolling();
    }

    if (capabilities.canRunRunbooks) {
      logger.info("Runbook capability enabled — polling for runbook steps.", {
        serviceName: APP_NAME,
      } as LogAttributes);
    }

    /*
     * Cluster scope has no dashboard row and so no live capability channel —
     * its env decision at boot is final. Project scope always starts the loop
     * and lets it self-gate.
     */
    const startCodeFixLoop: boolean = IS_CLUSTER_SCOPED
      ? capabilities.canRunCodeFixTasks
      : true;

    if (startCodeFixLoop) {
      if (IS_CLUSTER_SCOPED) {
        startCodeFixAlive();
      }

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
