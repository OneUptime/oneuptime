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
import ServiceUnavailableException from "../../Types/Exception/ServiceUnavailableException";
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
import { KUBERNETES_AI_ACCESS_CREDENTIAL_PERMISSIONS } from "../../Types/Kubernetes/KubernetesClusterAiAccessPermissions";
import KubernetesCluster from "../../Models/DatabaseModels/KubernetesCluster";
import GlobalCache from "../Infrastructure/GlobalCache";
import Semaphore, { SemaphoreMutex } from "../Infrastructure/Semaphore";
import KubernetesClusterService from "../Services/KubernetesClusterService";
import KubernetesClusterAiAccessService from "../Services/KubernetesClusterAiAccessService";
import RunnerJobService from "../Services/RunnerJobService";
import QueryHelper from "../Types/Database/QueryHelper";
import logger from "../Utils/Logger";
import { holdsAnyUnblockedPermission } from "../Utils/Runbook/RunbookExecutePermission";
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
 *     may it do, and what is missing. Requires read access to the cluster;
 *     the credential's name (and descriptions that name it) additionally
 *     need permission to read credentials.
 *
 *   POST /kubernetes-cluster/ai-access/test    { clusterId }
 *     Runs `kubectl version` and `kubectl auth can-i --list` through the
 *     bound Runner and returns their output, so an operator can see the
 *     access work (and the RBAC the Runner actually has) before an incident
 *     does. Read-only, but it spends Runner time, so it requires edit access
 *     to the cluster and has its own limits instead of spending the
 *     project's investigation budget: one test at a time per cluster (an
 *     atomic reservation), a few per minute and a cumulative ceiling per
 *     hour per cluster, and a few per minute per user.
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
 * request open while they run, so it is bounded where it is triggered and
 * never counted against the project-wide investigation brake (the
 * chokepoint keeps access-test jobs out of it), so no amount of testing can
 * starve real incident investigations:
 *
 * - one test at a time per cluster: an atomic reservation (Redis SET NX,
 *   released when the test ends and expiring on its own after the longest
 *   a test can run), so concurrent requests cannot all read "nothing
 *   running" and all start. The per-cluster counts below are read inside
 *   it, so they are exact;
 * - a few per minute and a cumulative ceiling per hour per cluster, and a
 *   few per minute per user across clusters — the per-user count is read
 *   and the test's first command run under a per-user lock, so a user's
 *   concurrent requests on different clusters are counted one after the
 *   other. Counted on the RunnerJob rows the test creates, which every API
 *   node shares.
 */
export const MAX_AI_ACCESS_TESTS_PER_CLUSTER_PER_MINUTE: number = 3;
export const MAX_AI_ACCESS_TESTS_PER_CLUSTER_PER_HOUR: number = 30;
export const MAX_AI_ACCESS_TESTS_PER_USER_PER_MINUTE: number = 6;

/*
 * A test job older than this is past both of its windows (claim plus
 * execution, twice over), so a row a crashed request left Pending never
 * blocks the next test for good — and neither does a reservation a crashed
 * request never released.
 */
const AI_ACCESS_TEST_MAX_DURATION_MINUTES: number = 4;

export const AI_ACCESS_TEST_RESERVATION_NAMESPACE: string =
  "kubernetes-ai-access-test";
export const AI_ACCESS_TEST_USER_LOCK_NAMESPACE: string =
  "kubernetes-ai-access-test-user";

/*
 * Held from the per-user count until the test's first command has finished.
 * The lock refreshes itself while it is held; the timeout is how long it
 * outlives a request that died holding it.
 */
const AI_ACCESS_TEST_USER_LOCK_TIMEOUT_MS: number = 30_000;
const AI_ACCESS_TEST_USER_LOCK_ACQUIRE_TIMEOUT_MS: number = 15_000;

const ALREADY_RUNNING_MESSAGE: string =
  "An AI access test is already running for this cluster. Wait for it to finish, then run it again.";

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

/*
 * Take this cluster's one access-test slot, atomically, and return the
 * token that releases it — or refuse: 429 while another test holds it, 503
 * when the reservation cannot be checked at all (failing closed: the
 * reservation is what makes "one at a time" true under concurrency).
 */
async function reserveClusterForAccessTest(
  clusterId: ObjectID,
): Promise<string> {
  const token: string = ObjectID.generate().toString();
  let isReserved: boolean = false;

  try {
    isReserved = await GlobalCache.setStringIfNotExists(
      AI_ACCESS_TEST_RESERVATION_NAMESPACE,
      clusterId.toString(),
      token,
      { expiresInSeconds: AI_ACCESS_TEST_MAX_DURATION_MINUTES * 60 },
    );
  } catch (error) {
    logger.error(
      `KubernetesClusterAiAccessAPI: could not reserve the AI access test of cluster ${clusterId.toString()}: ${error}`,
    );
    throw new ServiceUnavailableException(
      "The AI access test could not start right now. Try again in a moment.",
    );
  }

  if (!isReserved) {
    throw new TooManyRequestsException(ALREADY_RUNNING_MESSAGE);
  }

  return token;
}

// Best effort: the reservation expires on its own if this fails.
async function releaseClusterReservation(data: {
  clusterId: ObjectID;
  token: string;
}): Promise<void> {
  try {
    await GlobalCache.deleteKeyIfValue(
      AI_ACCESS_TEST_RESERVATION_NAMESPACE,
      data.clusterId.toString(),
      data.token,
    );
  } catch (error) {
    logger.error(
      `KubernetesClusterAiAccessAPI: could not release the AI access test reservation of cluster ${data.clusterId.toString()}; it expires on its own: ${error}`,
    );
  }
}

/*
 * The per-cluster limits, read while this request holds the cluster's
 * reservation — so no other test of this cluster can be counting (or
 * creating rows) at the same time.
 */
async function assertClusterAccessTestMayRun(data: {
  projectId: ObjectID;
  clusterId: ObjectID;
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
    throw new TooManyRequestsException(ALREADY_RUNNING_MESSAGE);
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

  /*
   * The cumulative ceiling: access-test jobs are kept out of the project's
   * investigation brake, so without this nothing would bound them over an
   * hour.
   */
  const testsForClusterThisHour: number = (
    await RunnerJobService.countBy({
      query: {
        projectId: data.projectId,
        kubernetesClusterId: data.clusterId,
        stepId: QueryHelper.startsWith(`${AI_ACCESS_TEST_STEP_ID_PREFIX}1-`),
        createdAt: QueryHelper.greaterThan(OneUptimeDate.getSomeHoursAgo(1)),
      },
      props: { isRoot: true },
    })
  ).toNumber();

  if (testsForClusterThisHour >= MAX_AI_ACCESS_TESTS_PER_CLUSTER_PER_HOUR) {
    throw new TooManyRequestsException(
      `This cluster's AI access was tested ${testsForClusterThisHour} times in the last hour, which is its limit (${MAX_AI_ACCESS_TESTS_PER_CLUSTER_PER_HOUR}). Try again later.`,
    );
  }
}

/*
 * The per-user limit spans clusters, so the cluster reservation does not
 * serialize it: the count is read and the test's first command run under a
 * per-user lock, so a user's concurrent tests on different clusters cannot
 * all read the same count. The lock is held until that first command has
 * finished, because KubectlJobRunner.run enqueues and waits in one call and
 * the job it creates is what the next count must see. That is seconds for
 * a Runner that is online (the test refuses to start for one that is not);
 * a second test of the same user started meanwhile waits up to the acquire
 * timeout and is then told one of theirs is still starting.
 */
async function lockUserForAccessTestStart(
  userId: ObjectID,
): Promise<SemaphoreMutex> {
  try {
    return await Semaphore.lock({
      key: userId.toString(),
      namespace: AI_ACCESS_TEST_USER_LOCK_NAMESPACE,
      lockTimeout: AI_ACCESS_TEST_USER_LOCK_TIMEOUT_MS,
      acquireTimeout: AI_ACCESS_TEST_USER_LOCK_ACQUIRE_TIMEOUT_MS,
    });
  } catch (error) {
    logger.error(
      `KubernetesClusterAiAccessAPI: could not take the AI access test lock of user ${userId.toString()}: ${error}`,
    );
    throw new TooManyRequestsException(
      "Another AI access test of yours is starting right now. Try again in a moment.",
    );
  }
}

async function releaseUserLock(mutex: SemaphoreMutex): Promise<void> {
  try {
    await Semaphore.release(mutex);
  } catch (error) {
    logger.error(
      `KubernetesClusterAiAccessAPI: could not release an AI access test user lock; it expires on its own: ${error}`,
    );
  }
}

async function assertUserMayStartAccessTest(data: {
  projectId: ObjectID;
  userId: ObjectID;
}): Promise<void> {
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
 * One access-test command, run the way every AI kubectl command is
 * (KubectlJobRunner.run): enqueued through the kubectl chokepoint as an
 * access test — policy, the read-only rule and the current binding still
 * apply; the investigation switch and the project's investigation brake do
 * not — then waited on, read and recorded exactly like an investigation's
 * command:
 *
 * - whether kubectl ran is read from the row (never ran, ran, or unknown for
 *   a job a Runner took and went silent on), and a timeout is worded in
 *   kubectl's terms ("did not pick up … Nothing was run", "what the command
 *   did is unknown"), never a runbook step's;
 * - the output and the error get the shared kubectl redaction and cap;
 * - only a success or an ACCESS failure (never claimed, refused, timed out,
 *   could not reach, authenticate to or was not authorized by the API
 *   server) becomes the cluster's "Last verified" / "Last error". A command
 *   that ran and failed for any other reason says nothing about the access
 *   and must neither set nor clear it.
 *
 * No AI run: an access test has none to keep alive.
 */
async function runAccessTestCommand(data: {
  projectId: ObjectID;
  clusterId: ObjectID;
  runnerId: ObjectID;
  credentialId?: string | undefined;
  command: string;
  stepId: string;
}): Promise<KubectlJobOutcome> {
  return KubectlJobRunner.run({
    projectId: data.projectId,
    origin: RunnerJobOrigin.AiInvestigation,
    kubernetesClusterId: data.clusterId,
    targetRunnerId: data.runnerId,
    credentialId: data.credentialId,
    command: data.command,
    stepId: data.stepId,
    timeoutInMs: DEFAULT_KUBECTL_TIMEOUT_MS,
    claimTimeoutInMs: KUBECTL_CLAIM_TIMEOUT_MS,
    isAccessTest: true,
  });
}

/*
 * Stands in for a gap description that names the Kubernetes credential,
 * for a caller who may read the cluster but not credentials.
 */
export const RESTRICTED_CREDENTIAL_GAP_DESCRIPTION: string =
  "The Kubernetes credential this cluster's Runner needs is missing or cannot be used. Someone who can view Runner credentials can see which one on this page.";

/*
 * The status as this caller may see it. Reading the cluster shows its
 * readiness; the credential's name — and gap descriptions that name it —
 * additionally need permission to read credentials, the rule the AI page's
 * credential picker and the investigation panel apply. The credential id is
 * left out with it. Everything the route itself does uses the full status.
 */
export function toViewerStatus(data: {
  status: KubernetesClusterAiAccessStatus;
  canReadCredentials: boolean;
}): KubernetesClusterAiAccessStatus {
  if (data.canReadCredentials) {
    return data.status;
  }

  const viewerStatus: KubernetesClusterAiAccessStatus = {
    ...data.status,
    gaps: data.status.gaps.map(
      (gap: KubernetesAiAccessGap): KubernetesAiAccessGap => {
        return gap.code === "credential_missing"
          ? { ...gap, description: RESTRICTED_CREDENTIAL_GAP_DESCRIPTION }
          : gap;
      },
    ),
  };

  delete viewerStatus.credentialId;
  delete viewerStatus.credentialName;

  return viewerStatus;
}

function canReadCredentials(
  props: DatabaseCommonInteractionProps,
  projectId: ObjectID,
): boolean {
  return holdsAnyUnblockedPermission({
    props,
    projectId,
    allowed: KUBERNETES_AI_ACCESS_CREDENTIAL_PERMISSIONS,
  });
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
        toViewerStatus({
          status,
          canReadCredentials: canReadCredentials(props, tenantId),
        }) as unknown as JSONObject,
      );
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

/*
 * Start the test: under this user's lock, check the per-user limit and run
 * the first command, so the next concurrent test of this user counts its
 * job (see lockUserForAccessTestStart). The limit refusal is thrown (the
 * route answers 429); a refusal from the chokepoint, or a wait that broke,
 * is returned as the first command's failure.
 */
async function startAccessTest(data: {
  projectId: ObjectID;
  clusterId: ObjectID;
  userId: ObjectID;
  runnerId: ObjectID;
  credentialId?: string | undefined;
  command: string;
}): Promise<{ outcome?: KubectlJobOutcome | undefined; error?: unknown }> {
  const userLock: SemaphoreMutex = await lockUserForAccessTestStart(
    data.userId,
  );

  try {
    await assertUserMayStartAccessTest({
      projectId: data.projectId,
      userId: data.userId,
    });

    try {
      const outcome: KubectlJobOutcome = await runAccessTestCommand({
        projectId: data.projectId,
        clusterId: data.clusterId,
        runnerId: data.runnerId,
        credentialId: data.credentialId,
        command: data.command,
        stepId: getAiAccessTestStepId({
          commandNumber: 1,
          userId: data.userId,
        }),
      });

      return { outcome };
    } catch (error) {
      return { error };
    }
  } finally {
    await releaseUserLock(userLock);
  }
}

function describeFailure(error: unknown): string {
  if (error === undefined || error === null) {
    return "The command could not be started.";
  }

  return error instanceof Error ? error.message : String(error);
}

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

      const viewerCanReadCredentials: boolean = canReadCredentials(
        props,
        tenantId,
      );

      // One test at a time per cluster: an atomic reservation, held to the end.
      const reservation: string = await reserveClusterForAccessTest(
        cluster.id!,
      );

      try {
        await assertClusterAccessTestMayRun({
          projectId: tenantId,
          clusterId: cluster.id!,
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
        const transportGap: KubernetesAiAccessGap | undefined =
          status.gaps.find((gap: KubernetesAiAccessGap) => {
            return (
              gap.blocks === "both" &&
              gap.code !== "project_ai_disabled" &&
              gap.code !== "llm_provider_missing"
            );
          });

        if (transportGap || !status.runner) {
          Response.sendJsonObjectResponse(req, res, {
            ok: false,
            message: transportGap
              ? `${transportGap.title}. ${transportGap.nextStep}`
              : "No Runner is bound to this cluster.",
            results: [],
            status: toViewerStatus({
              status,
              canReadCredentials: viewerCanReadCredentials,
            }) as unknown as JSONObject,
          });
          return;
        }

        const runnerId: ObjectID = new ObjectID(status.runner.id);
        const results: Array<JSONObject> = [];
        let allSucceeded: boolean = true;

        const start: {
          outcome?: KubectlJobOutcome | undefined;
          error?: unknown;
        } = await startAccessTest({
          projectId: tenantId,
          clusterId: cluster.id!,
          userId: props.userId!,
          runnerId,
          credentialId: status.credentialId,
          command: AI_ACCESS_TEST_COMMANDS[0]!,
        });

        for (
          let index: number = 0;
          index < AI_ACCESS_TEST_COMMANDS.length;
          index++
        ) {
          const command: string = AI_ACCESS_TEST_COMMANDS[index]!;
          let failure: unknown = undefined;
          let outcome: KubectlJobOutcome | undefined = undefined;

          if (index === 0) {
            outcome = start.outcome;
            failure = start.error;
          } else {
            try {
              outcome = await runAccessTestCommand({
                projectId: tenantId,
                clusterId: cluster.id!,
                runnerId,
                credentialId: status.credentialId,
                command,
                stepId: getAiAccessTestStepId({
                  commandNumber: index + 1,
                  userId: props.userId!,
                }),
              });
            } catch (error) {
              failure = error;
            }
          }

          if (!outcome) {
            allSucceeded = false;
            results.push({
              command,
              succeeded: false,
              exitCode: null,
              output: "",
              errorMessage: describeFailure(failure),
            });
            break;
          }

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
          status: toViewerStatus({
            status: refreshed || status,
            canReadCredentials: viewerCanReadCredentials,
          }) as unknown as JSONObject,
        });
        return;
      } finally {
        await releaseClusterReservation({
          clusterId: cluster.id!,
          token: reservation,
        });
      }
    } catch (err) {
      next(err);
      return;
    }
  },
);

export default router;
