import UserMiddleware from "../Middleware/UserAuthorization";
import CommonAPI from "./CommonAPI";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import TooManyRequestsException from "../../Types/Exception/TooManyRequestsException";
import ObjectID from "../../Types/ObjectID";
import { JSONObject } from "../../Types/JSON";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../Types/Permission";
import RunnerJobOrigin from "../../Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "../../Types/Runbook/RunnerJobStatus";
import {
  DEFAULT_KUBECTL_TIMEOUT_MS,
  KubernetesAiAccessGap,
  KubernetesClusterAiAccessStatus,
} from "../../Types/Kubernetes/KubernetesClusterAiAccess";
import KubernetesCluster from "../../Models/DatabaseModels/KubernetesCluster";
import RunnerJob from "../../Models/DatabaseModels/RunnerJob";
import KubernetesClusterService from "../Services/KubernetesClusterService";
import KubernetesClusterAiAccessService from "../Services/KubernetesClusterAiAccessService";
import RunnerJobService, {
  Service as RunnerJobServiceClass,
} from "../Services/RunnerJobService";
import QueryHelper from "../Types/Database/QueryHelper";
import KubectlJobRunner, {
  KUBECTL_CLAIM_TIMEOUT_MS,
  KubectlJobOutcome,
} from "../Utils/AI/ClusterAccess/KubectlJobRunner";

const router: ExpressRouter = Express.getRouter();

/*
 * The cluster AI page's two custom calls. Everything else on that page is
 * ordinary CRUD on KubernetesCluster (the bound Runner, the credential, the
 * two switches, the allowlist).
 *
 *   POST /kubernetes-cluster/ai-access/status  { clusterId }
 *     The readiness checklist: can OneUptime AI reach this cluster, what
 *     may it do, and what is missing. Requires read access to the cluster.
 *
 *   POST /kubernetes-cluster/ai-access/test    { clusterId }
 *     Runs `kubectl version` and `kubectl auth can-i --list` through the
 *     bound Runner and returns their output, so an operator can see the
 *     access work (and the RBAC the Runner actually has) before an incident
 *     does. Read-only, but it spends Runner time, so it requires edit access
 *     to the cluster and has its own limits (one at a time per cluster, a
 *     few per minute per cluster and per user) instead of spending the
 *     project's investigation budget.
 */

async function getLoggedInProps(
  req: ExpressRequest,
): Promise<DatabaseCommonInteractionProps> {
  const props: DatabaseCommonInteractionProps =
    await CommonAPI.getDatabaseCommonInteractionProps(req);

  CommonAPI.assertAuthenticatedUser(props);

  return { ...props, isMultiTenantRequest: false };
}

/*
 * Access check under the USER's permissions inside the tenant. Null is
 * "does not exist OR not yours", reported identically so the route never
 * leaks whether an id exists in another project.
 */
async function findAccessibleCluster(data: {
  req: ExpressRequest;
  props: DatabaseCommonInteractionProps;
  tenantId: ObjectID;
}): Promise<KubernetesCluster> {
  const clusterIdString: string | undefined = data.req.body["clusterId"] as
    | string
    | undefined;

  if (!clusterIdString || !ObjectID.isValidUUID(clusterIdString)) {
    throw new BadDataException("clusterId is required.");
  }

  /*
   * Read under the user's own props — so the cluster's read ACL (and any
   * label-scoped block) applies exactly as on a CRUD read — and scoped to
   * the tenant in the query itself.
   */
  const cluster: KubernetesCluster | null =
    await KubernetesClusterService.findOneBy({
      query: {
        _id: clusterIdString,
        projectId: data.tenantId,
      },
      select: { _id: true, projectId: true, name: true },
      props: data.props,
    });

  /*
   * A row from another project is reported exactly like a missing one
   * (belt and braces: the query is already tenant-scoped), so the route
   * never confirms that an id exists somewhere else.
   */
  if (
    !cluster ||
    !cluster.id ||
    !cluster.projectId ||
    cluster.projectId.toString() !== data.tenantId.toString()
  ) {
    throw new BadDataException(
      "Kubernetes cluster not found (or you do not have access to it).",
    );
  }

  return cluster;
}

/*
 * Mirrors KubernetesCluster's update ACL; a block row is a denial, not a
 * grant. The access test is read-only, but it spends the bound Runner's
 * time and prints the RBAC the Runner holds, so it is for the people who
 * may edit the cluster.
 */
function assertCanEditCluster(
  props: DatabaseCommonInteractionProps,
  projectId: ObjectID,
): void {
  if (props.isMasterAdmin) {
    return;
  }

  const allowed: Array<Permission> =
    new KubernetesCluster().getUpdatePermissions();

  const tenantPermission: UserTenantAccessPermission | undefined =
    props.userTenantAccessPermission?.[projectId.toString()];

  const hasPermission: boolean = Boolean(
    tenantPermission?.permissions?.some((p: UserPermission): boolean => {
      return !p.isBlockPermission && allowed.includes(p.permission);
    }),
  );

  if (!hasPermission) {
    throw new NotAuthorizedException(
      "You need permission to edit this Kubernetes cluster to run its AI access test.",
    );
  }
}

/*
 * The access test's own limits. It enqueues real Runner jobs and holds the
 * request open while they run, so it is bounded where it is triggered —
 * one test at a time per cluster, a few per minute per cluster and per
 * user — and never counted against the project-wide investigation brake
 * (the chokepoint keeps access-test jobs out of it), so no amount of
 * testing can starve real incident investigations. Counted on the RunnerJob
 * rows the test creates, which every API node shares.
 */
export const MAX_AI_ACCESS_TESTS_PER_CLUSTER_PER_MINUTE: number = 3;
export const MAX_AI_ACCESS_TESTS_PER_USER_PER_MINUTE: number = 6;

/*
 * A test job older than this is past both of its windows (claim plus
 * execution, twice over), so a row a crashed request left Pending never
 * blocks the next test for good.
 */
const AI_ACCESS_TEST_MAX_DURATION_MINUTES: number = 4;

const AI_ACCESS_TEST_COMMANDS: Array<string> = [
  "kubectl version",
  "kubectl auth can-i --list",
];

/*
 * Every access-test job's stepId starts with this; the first command's
 * with the "-1-" form plus the user who ran it, so a test (not a command)
 * can be counted per cluster and per user from the rows alone.
 */
export const AI_ACCESS_TEST_STEP_ID_PREFIX: string = "ai-access-test-";

export function getAiAccessTestStepId(data: {
  commandNumber: number;
  userId: ObjectID;
}): string {
  return `${AI_ACCESS_TEST_STEP_ID_PREFIX}${data.commandNumber}-${data.userId.toString()}`;
}

async function assertAccessTestMayRun(data: {
  projectId: ObjectID;
  clusterId: ObjectID;
  userId: ObjectID;
}): Promise<void> {
  const inFlight: number = (
    await RunnerJobService.countBy({
      query: {
        projectId: data.projectId,
        kubernetesClusterId: data.clusterId,
        stepId: QueryHelper.startsWith(AI_ACCESS_TEST_STEP_ID_PREFIX),
        status: QueryHelper.any([
          RunnerJobStatus.Pending,
          RunnerJobStatus.Claimed,
          RunnerJobStatus.Running,
        ]),
        createdAt: QueryHelper.greaterThan(
          OneUptimeDate.getSomeMinutesAgo(AI_ACCESS_TEST_MAX_DURATION_MINUTES),
        ),
      },
      props: { isRoot: true },
    })
  ).toNumber();

  if (inFlight > 0) {
    throw new TooManyRequestsException(
      "An AI access test is already running for this cluster. Wait for it to finish, then run it again.",
    );
  }

  const testsForCluster: number = (
    await RunnerJobService.countBy({
      query: {
        projectId: data.projectId,
        kubernetesClusterId: data.clusterId,
        stepId: QueryHelper.startsWith(`${AI_ACCESS_TEST_STEP_ID_PREFIX}1-`),
        createdAt: QueryHelper.greaterThan(OneUptimeDate.getSomeMinutesAgo(1)),
      },
      props: { isRoot: true },
    })
  ).toNumber();

  if (testsForCluster >= MAX_AI_ACCESS_TESTS_PER_CLUSTER_PER_MINUTE) {
    throw new TooManyRequestsException(
      `This cluster's AI access was tested ${testsForCluster} times in the last minute, which is its limit (${MAX_AI_ACCESS_TESTS_PER_CLUSTER_PER_MINUTE}). Try again in a minute.`,
    );
  }

  const testsByUser: number = (
    await RunnerJobService.countBy({
      query: {
        projectId: data.projectId,
        stepId: QueryHelper.startsWith(
          getAiAccessTestStepId({ commandNumber: 1, userId: data.userId }),
        ),
        createdAt: QueryHelper.greaterThan(OneUptimeDate.getSomeMinutesAgo(1)),
      },
      props: { isRoot: true },
    })
  ).toNumber();

  if (testsByUser >= MAX_AI_ACCESS_TESTS_PER_USER_PER_MINUTE) {
    throw new TooManyRequestsException(
      `You ran ${testsByUser} AI access tests in the last minute, which is the limit (${MAX_AI_ACCESS_TESTS_PER_USER_PER_MINUTE}). Try again in a minute.`,
    );
  }
}

/*
 * One access-test command: enqueued through the kubectl chokepoint as an
 * access test (policy, read-only rule and current binding still apply; the
 * investigation switch and the project's investigation brake do not),
 * waited on, and shaped with the same redaction every kubectl output gets
 * before anyone sees it. Enqueue and wait are two steps here, like the
 * remediation toolkit, because KubectlJobRunner.run has no access-test mode.
 */
async function runAccessTestCommand(data: {
  projectId: ObjectID;
  clusterId: ObjectID;
  runnerId: ObjectID;
  credentialId?: string | undefined;
  command: string;
  stepId: string;
}): Promise<KubectlJobOutcome> {
  const job: RunnerJob = await RunnerJobService.enqueueAiKubectlCommand({
    projectId: data.projectId,
    origin: RunnerJobOrigin.AiInvestigation,
    kubernetesClusterId: data.clusterId,
    stepId: data.stepId,
    targetAgentId: data.runnerId,
    credentialId: data.credentialId,
    command: data.command,
    timeoutInMs: DEFAULT_KUBECTL_TIMEOUT_MS,
    claimTimeoutInMs: KUBECTL_CLAIM_TIMEOUT_MS,
    isAccessTest: true,
  });

  const terminalJob: RunnerJob = await RunnerJobService.pollUntilTerminal({
    jobId: job.id!,
    claimTimeoutInMs: KUBECTL_CLAIM_TIMEOUT_MS,
    executionTimeoutInMs: DEFAULT_KUBECTL_TIMEOUT_MS,
  });

  const succeeded: boolean = terminalJob.status === RunnerJobStatus.Succeeded;

  const errorMessage: string | undefined = succeeded
    ? undefined
    : RunnerJobServiceClass.redactAiJobText(
        terminalJob.errorMessage ||
          `Command ended with status ${terminalJob.status}.`,
      );

  // Best-effort bookkeeping for the cluster's AI page; never throws.
  await KubernetesClusterAiAccessService.recordCommandOutcome({
    clusterId: data.clusterId,
    succeeded,
    errorMessage,
  });

  return {
    jobId: job.id!.toString(),
    succeeded,
    exitCode: terminalJob.exitCode,
    output: KubectlJobRunner.redactAndCap(terminalJob.output || "").text,
    errorMessage,
    displayCommand: String(
      (job.payload as { displayCommand?: string } | undefined)
        ?.displayCommand || data.command,
    ),
  };
}

router.post(
  "/kubernetes-cluster/ai-access/status",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);
      const tenantId: ObjectID = CommonAPI.assertTenantScoped(props);

      const cluster: KubernetesCluster = await findAccessibleCluster({
        req,
        props,
        tenantId,
      });

      const status: KubernetesClusterAiAccessStatus | null =
        await KubernetesClusterAiAccessService.getStatusForCluster({
          clusterId: cluster.id!,
          projectId: tenantId,
        });

      if (!status) {
        throw new BadDataException("Kubernetes cluster not found.");
      }

      Response.sendJsonObjectResponse(
        req,
        res,
        status as unknown as JSONObject,
      );
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

router.post(
  "/kubernetes-cluster/ai-access/test",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);
      const tenantId: ObjectID = CommonAPI.assertTenantScoped(props);

      const cluster: KubernetesCluster = await findAccessibleCluster({
        req,
        props,
        tenantId,
      });

      assertCanEditCluster(props, tenantId);

      await assertAccessTestMayRun({
        projectId: tenantId,
        clusterId: cluster.id!,
        userId: props.userId!,
      });

      const status: KubernetesClusterAiAccessStatus | null =
        await KubernetesClusterAiAccessService.getStatusForCluster({
          clusterId: cluster.id!,
          projectId: tenantId,
        });

      if (!status) {
        throw new BadDataException("Kubernetes cluster not found.");
      }

      /*
       * The test needs a reachable Runner, not the investigation switch:
       * an operator checks access BEFORE turning AI on. Only gaps that
       * block the transport itself stop it.
       */
      const transportGap: KubernetesAiAccessGap | undefined = status.gaps.find(
        (gap: KubernetesAiAccessGap) => {
          return (
            gap.blocks === "both" &&
            gap.code !== "project_ai_disabled" &&
            gap.code !== "llm_provider_missing"
          );
        },
      );

      if (transportGap || !status.runner) {
        Response.sendJsonObjectResponse(req, res, {
          ok: false,
          message: transportGap
            ? `${transportGap.title}. ${transportGap.nextStep}`
            : "No Runner is bound to this cluster.",
          results: [],
          status: status as unknown as JSONObject,
        });
        return;
      }

      const results: Array<JSONObject> = [];
      let allSucceeded: boolean = true;

      for (const command of AI_ACCESS_TEST_COMMANDS) {
        try {
          const outcome: KubectlJobOutcome = await runAccessTestCommand({
            projectId: tenantId,
            clusterId: cluster.id!,
            runnerId: new ObjectID(status.runner.id),
            credentialId: status.credentialId,
            command,
            stepId: getAiAccessTestStepId({
              commandNumber: results.length + 1,
              userId: props.userId!,
            }),
          });

          allSucceeded = allSucceeded && outcome.succeeded;

          results.push({
            command: outcome.displayCommand,
            succeeded: outcome.succeeded,
            exitCode: outcome.exitCode ?? null,
            output: outcome.output,
            errorMessage: outcome.errorMessage ?? null,
          });

          if (!outcome.succeeded) {
            break;
          }
        } catch (error) {
          allSucceeded = false;
          results.push({
            command,
            succeeded: false,
            exitCode: null,
            output: "",
            errorMessage:
              error instanceof Error ? error.message : String(error),
          });
          break;
        }
      }

      const refreshed: KubernetesClusterAiAccessStatus | null =
        await KubernetesClusterAiAccessService.getStatusForCluster({
          clusterId: cluster.id!,
          projectId: tenantId,
        });

      Response.sendJsonObjectResponse(req, res, {
        ok: allSucceeded,
        message: allSucceeded
          ? `OneUptime AI can run kubectl on "${cluster.name}" through Runner "${status.runner.name}".`
          : "kubectl could not run successfully — see the command output below.",
        results,
        status: (refreshed || status) as unknown as JSONObject,
      });
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

export default router;
