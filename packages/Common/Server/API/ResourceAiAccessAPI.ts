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
import Permission from "../../Types/Permission";
import RunnerJobOrigin from "../../Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "../../Types/Runbook/RunnerJobStatus";
import RunbookStepType from "../../Types/Runbook/RunbookStepType";
import AIRunType from "../../Types/AI/AIRunType";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import {
  RESOURCE_AI_ACCESS_INSIGHTS_PATH,
  RESOURCE_AI_ACCESS_RESET_AGENT_PATH,
  RESOURCE_AI_ACCESS_STATUS_PATH,
  RESOURCE_AI_ACCESS_TEST_PATH,
  RESOURCE_AI_INSIGHTS_COMMAND_WINDOW_IN_DAYS,
  RESOURCE_AI_INSIGHTS_LIMIT,
  RESOURCE_AI_INSIGHTS_RATIONALE_MAX_LENGTH,
  ResourceAiAccessTestCommandResult,
  ResourceAiInsightFix,
  ResourceAiInsightInvestigation,
  ResourceAiInsights,
} from "../../Types/AI/ResourceAiAccessApi";
import {
  RESOURCE_AI_ACCESS_ADMIN_PERMISSIONS,
  getResourceAgentName,
  getResourceAiAgentResetRefusal,
  getResourceSentenceName,
} from "../../Types/AI/ResourceAiAccessPermissions";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
  parseAiResourceType,
} from "../../Types/ResourceAiAgent/AiResourceType";
import {
  DEFAULT_RESOURCE_COMMAND_TIMEOUT_MS,
  ResourceAiAccessGap,
  ResourceAiAccessGapCode,
  ResourceAiAccessStatus,
} from "../../Types/ResourceAiAgent/ResourceAiAccess";
import AIRun from "../../Models/DatabaseModels/AIRun";
import Alert from "../../Models/DatabaseModels/Alert";
import AutoRemediationSuggestion from "../../Models/DatabaseModels/AutoRemediationSuggestion";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../Models/DatabaseModels/Incident";
import ResourceAiAgent from "../../Models/DatabaseModels/ResourceAiAgent";
import RunnerJob from "../../Models/DatabaseModels/RunnerJob";
import GlobalCache from "../Infrastructure/GlobalCache";
import Semaphore, { SemaphoreMutex } from "../Infrastructure/Semaphore";
import AIRunService from "../Services/AIRunService";
import AlertService from "../Services/AlertService";
import AutoRemediationSuggestionService from "../Services/AutoRemediationSuggestionService";
import CephClusterService from "../Services/CephClusterService";
import DatabaseServerService from "../Services/DatabaseServerService";
import DatabaseService from "../Services/DatabaseService";
import DockerHostService from "../Services/DockerHostService";
import DockerSwarmClusterService from "../Services/DockerSwarmClusterService";
import HostService from "../Services/HostService";
import IncidentService from "../Services/IncidentService";
import PodmanHostService from "../Services/PodmanHostService";
import ProxmoxClusterService from "../Services/ProxmoxClusterService";
import ResourceAiAccessService from "../Services/ResourceAiAccessService";
import ResourceAiAgentService from "../Services/ResourceAiAgentService";
import RunnerJobService from "../Services/RunnerJobService";
import VMwareVCenterService from "../Services/VMwareVCenterService";
import QueryHelper from "../Types/Database/QueryHelper";
import logger from "../Utils/Logger";
import { holdsAnyUnblockedPermission } from "../Utils/Runbook/RunbookExecutePermission";
import ResourceCommandJobRunner, {
  RESOURCE_COMMAND_CLAIM_TIMEOUT_MS,
  ResourceCommandJobOutcome,
} from "../Utils/AI/ResourceAccess/ResourceCommandJobRunner";

const router: ExpressRouter = Express.getRouter();

/*
 * The custom calls behind the AI pages (AI → AI agent and AI → Insights) of
 * every infrastructure resource a resource AI agent serves: Docker, Podman
 * and Docker Swarm hosts, Proxmox clusters, VMware vCenters, Ceph clusters,
 * database servers and hosts. The resource-agnostic sibling of
 * KubernetesClusterAiAccessAPI, shaped like it. Everything else on those
 * pages is ordinary CRUD on the resource model (the investigation switch,
 * the remediation mode, the command allowlist — policed by
 * ResourceAiAccessSettings in each resource's service).
 *
 * Every route takes { resourceType, resourceId } and first reads the
 * resource through ITS service under the caller's own props, so the
 * resource's read ACL (and any label-scoped block) applies exactly as on a
 * CRUD read. That check is what guards the agent data too: the
 * ResourceAiAgent table is readable by anyone who may read ANY of the eight
 * resource types, so nothing here returns an agent without it.
 *
 *   POST /resource-ai-access/status       { resourceType, resourceId }
 *     The readiness checklist (ResourceAiAccessStatus): can OneUptime AI
 *     reach this resource through its AI agent, what may it do, and what is
 *     missing. Requires read access to the resource.
 *
 *   POST /resource-ai-access/test         { resourceType, resourceId }
 *     Runs the type's read-only test commands
 *     (AI_RESOURCE_TYPE_INFO[type].testCommands) through the resource's AI
 *     agent and returns their output, so an operator can see the access
 *     work before an incident does. Read-only, but it spends the agent's
 *     time, so it requires edit access to THIS resource (decided for the
 *     row, labels included, as a CRUD update of it would be) and has its own
 *     limits instead of spending the project's investigation budget: one
 *     test at a time per resource (an atomic reservation), a few per minute
 *     and a cumulative ceiling per hour per resource, and a few per minute
 *     per user.
 *
 *   POST /resource-ai-access/reset-agent  { resourceType, resourceId }
 *     Forgets the key of the resource's AI agent, so whatever holds it is
 *     locked out and the real agent registers afresh within a few minutes.
 *     For the people who may loosen AI access
 *     (RESOURCE_AI_ACCESS_ADMIN_PERMISSIONS).
 *
 *   POST /resource-ai-access/insights     { resourceType, resourceId }
 *     What AI investigated and changed on the resource, as summaries. Same
 *     read gate as the status; what it says about incidents, alerts, AI runs
 *     and suggestions follows the caller's own read access to those (see
 *     getResourceAiInsights).
 */

/*
 * How each resource type is read: its table's service (under the caller's
 * props — that is the access check) and the Incident/Alert relation that
 * links it to a subject.
 */
interface ResourceAiAccessKind {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service: DatabaseService<any>;
  subjectRelation: string;
}

export const RESOURCE_AI_ACCESS_KINDS: Readonly<
  Record<AiResourceType, ResourceAiAccessKind>
> = {
  [AiResourceType.DockerHost]: {
    service: DockerHostService,
    subjectRelation: "dockerHosts",
  },
  [AiResourceType.PodmanHost]: {
    service: PodmanHostService,
    subjectRelation: "podmanHosts",
  },
  [AiResourceType.DockerSwarmCluster]: {
    service: DockerSwarmClusterService,
    subjectRelation: "dockerSwarmClusters",
  },
  [AiResourceType.ProxmoxCluster]: {
    service: ProxmoxClusterService,
    subjectRelation: "proxmoxClusters",
  },
  [AiResourceType.VMwareVCenter]: {
    service: VMwareVCenterService,
    subjectRelation: "vmwareVCenters",
  },
  [AiResourceType.CephCluster]: {
    service: CephClusterService,
    subjectRelation: "cephClusters",
  },
  [AiResourceType.DatabaseServer]: {
    service: DatabaseServerService,
    subjectRelation: "databaseServers",
  },
  [AiResourceType.Host]: {
    service: HostService,
    subjectRelation: "hosts",
  },
};

// The resource a route acts on, once the caller may read it.
export interface AccessibleResource {
  resourceType: AiResourceType;
  id: ObjectID;
  name: string;
}

async function getLoggedInProps(
  req: ExpressRequest,
): Promise<DatabaseCommonInteractionProps> {
  const props: DatabaseCommonInteractionProps =
    await CommonAPI.getDatabaseCommonInteractionProps(req);

  CommonAPI.assertAuthenticatedUser(props);

  return { ...props, isMultiTenantRequest: false };
}

/*
 * The resource type a request names: an AiResourceType value (any case) or
 * an agent alias ("docker", "db", ...). Anything else is refused before any
 * lookup.
 */
export function readResourceType(value: unknown): AiResourceType {
  const resourceType: AiResourceType | null = parseAiResourceType(value);

  if (!resourceType) {
    throw new BadDataException(
      `resourceType is required and must be one of ${Object.values(
        AiResourceType,
      ).join(", ")}.`,
    );
  }

  return resourceType;
}

/*
 * Access check under the USER's permissions inside the tenant. Null is
 * "does not exist OR not yours", reported identically so the route never
 * leaks whether an id exists in another project.
 */
async function findAccessibleResource(data: {
  req: ExpressRequest;
  props: DatabaseCommonInteractionProps;
  tenantId: ObjectID;
}): Promise<AccessibleResource> {
  const body: JSONObject = (data.req.body || {}) as JSONObject;

  const resourceType: AiResourceType = readResourceType(body["resourceType"]);

  const resourceIdString: string | undefined = body["resourceId"] as
    | string
    | undefined;

  if (
    !resourceIdString ||
    typeof resourceIdString !== "string" ||
    !ObjectID.isValidUUID(resourceIdString)
  ) {
    throw new BadDataException("resourceId is required.");
  }

  /*
   * Read under the user's own props — so the resource's read ACL (and any
   * label-scoped block) applies exactly as on a CRUD read — and scoped to
   * the tenant in the query itself.
   */
  const resource: BaseModel | null = (await RESOURCE_AI_ACCESS_KINDS[
    resourceType
  ].service.findOneBy({
    query: {
      _id: resourceIdString,
      projectId: data.tenantId,
    },
    select: { _id: true, projectId: true, name: true },
    props: data.props,
  })) as BaseModel | null;

  const record: Record<string, unknown> | null = resource as unknown as Record<
    string,
    unknown
  > | null;
  const projectId: unknown = record ? record["projectId"] : undefined;

  /*
   * A row from another project is reported exactly like a missing one
   * (belt and braces: the query is already tenant-scoped), so the route
   * never confirms that an id exists somewhere else.
   */
  if (
    !resource ||
    !resource.id ||
    !projectId ||
    String(projectId) !== data.tenantId.toString()
  ) {
    throw new BadDataException(
      `${AI_RESOURCE_TYPE_INFO[resourceType].displayName} not found (or you do not have access to it).`,
    );
  }

  return {
    resourceType,
    id: resource.id,
    name:
      typeof record!["name"] === "string" && record!["name"]
        ? (record!["name"] as string)
        : resource.id.toString(),
  };
}

/*
 * The access test is read-only, but it spends the agent's time and prints
 * what the agent can see, so it is for the people who may EDIT this
 * resource — decided for this row exactly as a CRUD update of it would be
 * (ResourceAiAccessService.assertCallerMayChangeResource): the update ACL,
 * label-scoped allow and block rows against the row's own labels, a
 * table-wide block row, and the caller's Owned scope. Holding an edit
 * permission somewhere in the project is not enough: an edit grant limited
 * to "staging" does not reach the "prod" host, and a block row for "prod"
 * refuses it. Master admins are not gated.
 */
async function assertCanEditResource(data: {
  props: DatabaseCommonInteractionProps;
  projectId: ObjectID;
  resource: AccessibleResource;
}): Promise<void> {
  try {
    await ResourceAiAccessService.assertCallerMayChangeResource({
      props: data.props,
      projectId: data.projectId,
      resourceType: data.resource.resourceType,
      resourceId: data.resource.id,
    });
  } catch (error) {
    if (error instanceof NotAuthorizedException) {
      throw new NotAuthorizedException(
        `You need permission to edit this ${getResourceSentenceName(
          data.resource.resourceType,
        )} to run its AI access test.`,
      );
    }

    throw error;
  }
}

/*
 * Resetting the agent locks out whatever holds its key, and the real agent
 * registers afresh: the same people who may loosen AI access may do it.
 */
function assertCanResetAiAgent(data: {
  props: DatabaseCommonInteractionProps;
  projectId: ObjectID;
  resourceType: AiResourceType;
}): void {
  if (
    !holdsAnyUnblockedPermission({
      props: data.props,
      projectId: data.projectId,
      allowed: RESOURCE_AI_ACCESS_ADMIN_PERMISSIONS,
    })
  ) {
    throw new NotAuthorizedException(
      getResourceAiAgentResetRefusal(data.resourceType),
    );
  }
}

async function getStatus(data: {
  projectId: ObjectID;
  resource: AccessibleResource;
}): Promise<ResourceAiAccessStatus> {
  const status: ResourceAiAccessStatus | null =
    await ResourceAiAccessService.getStatusForResource({
      projectId: data.projectId,
      resourceType: data.resource.resourceType,
      resourceId: data.resource.id,
    });

  if (!status) {
    throw new BadDataException(
      `${AI_RESOURCE_TYPE_INFO[data.resource.resourceType].displayName} not found.`,
    );
  }

  return status;
}

/*
 * The access test's own limits. It enqueues real agent jobs and holds the
 * request open while they run, so it is bounded where it is triggered and
 * never counted against the project-wide investigation brake, so no amount
 * of testing can starve real incident investigations:
 *
 * - one test at a time per resource: an atomic reservation (Redis SET NX,
 *   released when the test ends and expiring on its own after the longest
 *   a test can run), so concurrent requests cannot all read "nothing
 *   running" and all start. The per-resource counts below are read inside
 *   it, so they are exact;
 * - a few per minute and a cumulative ceiling per hour per resource, and a
 *   few per minute per user across resources — the per-user count is read
 *   and the test's first command run under a per-user lock, so a user's
 *   concurrent requests on different resources are counted one after the
 *   other. Counted on the RunnerJob rows the test creates, which every API
 *   node shares.
 *
 * The numbers are a Kubernetes cluster's; the step ids, the reservation
 * and the lock are this route's own, so testing a resource never counts
 * against a cluster's tests or the other way round.
 */
export const MAX_RESOURCE_AI_ACCESS_TESTS_PER_RESOURCE_PER_MINUTE: number = 3;
export const MAX_RESOURCE_AI_ACCESS_TESTS_PER_RESOURCE_PER_HOUR: number = 30;
export const MAX_RESOURCE_AI_ACCESS_TESTS_PER_USER_PER_MINUTE: number = 6;

/*
 * A test job older than this is past both of its windows (claim plus
 * execution, twice over), so a row a crashed request left Pending never
 * blocks the next test for good — and neither does a reservation a crashed
 * request never released.
 */
const RESOURCE_AI_ACCESS_TEST_MAX_DURATION_MINUTES: number = 4;

export const RESOURCE_AI_ACCESS_TEST_RESERVATION_NAMESPACE: string =
  "resource-ai-access-test";
export const RESOURCE_AI_ACCESS_TEST_USER_LOCK_NAMESPACE: string =
  "resource-ai-access-test-user";

/*
 * Held from the per-user count until the test's first command has finished.
 * The lock refreshes itself while it is held; the timeout is how long it
 * outlives a request that died holding it.
 */
const RESOURCE_AI_ACCESS_TEST_USER_LOCK_TIMEOUT_MS: number = 30_000;
const RESOURCE_AI_ACCESS_TEST_USER_LOCK_ACQUIRE_TIMEOUT_MS: number = 15_000;

/*
 * Gaps that block both capabilities but not the access test's transport:
 * they are about the project's AI (switched off, no provider, no credits),
 * and the test runs the agent's commands, never a model. An agent that is
 * online but could not reach its resource at its last probe is tested too:
 * the test's own output is exactly what says why, and a success clears it.
 */
const NON_TRANSPORT_GAP_CODES: Array<ResourceAiAccessGapCode> = [
  "ai_disabled_for_project",
  "llm_provider_missing",
  "ai_balance_insufficient",
  "ai_agent_unreachable_resource",
];

/*
 * Every access-test job's stepId starts with this; the first command's
 * with the "-1-" form plus the user who ran it, so a test (not a command)
 * can be counted per resource and per user from the rows alone. Distinct
 * from a Kubernetes cluster's "ai-access-test-" prefix, which the cluster
 * route counts with startsWith.
 */
export const RESOURCE_AI_ACCESS_TEST_STEP_ID_PREFIX: string =
  "resource-ai-access-test-";

export function getResourceAiAccessTestStepId(data: {
  commandNumber: number;
  userId: ObjectID;
}): string {
  return `${RESOURCE_AI_ACCESS_TEST_STEP_ID_PREFIX}${data.commandNumber}-${data.userId.toString()}`;
}

function getReservationKey(resource: AccessibleResource): string {
  return `${resource.resourceType}:${resource.id.toString()}`;
}

function getAlreadyRunningMessage(resourceType: AiResourceType): string {
  return `An AI access test is already running for this ${getResourceSentenceName(
    resourceType,
  )}. Wait for it to finish, then run it again.`;
}

/*
 * Take this resource's one access-test slot, atomically, and return the
 * token that releases it — or refuse: 429 while another test holds it, 503
 * when the reservation cannot be checked at all (failing closed: the
 * reservation is what makes "one at a time" true under concurrency).
 */
async function reserveResourceForAccessTest(
  resource: AccessibleResource,
): Promise<string> {
  const token: string = ObjectID.generate().toString();
  let isReserved: boolean = false;

  try {
    isReserved = await GlobalCache.setStringIfNotExists(
      RESOURCE_AI_ACCESS_TEST_RESERVATION_NAMESPACE,
      getReservationKey(resource),
      token,
      { expiresInSeconds: RESOURCE_AI_ACCESS_TEST_MAX_DURATION_MINUTES * 60 },
    );
  } catch (error) {
    logger.error(
      `ResourceAiAccessAPI: could not reserve the AI access test of ${getReservationKey(
        resource,
      )}: ${error}`,
    );
    throw new ServiceUnavailableException(
      "The AI access test could not start right now. Try again in a moment.",
    );
  }

  if (!isReserved) {
    throw new TooManyRequestsException(
      getAlreadyRunningMessage(resource.resourceType),
    );
  }

  return token;
}

// Best effort: the reservation expires on its own if this fails.
async function releaseResourceReservation(data: {
  resource: AccessibleResource;
  token: string;
}): Promise<void> {
  try {
    await GlobalCache.deleteKeyIfValue(
      RESOURCE_AI_ACCESS_TEST_RESERVATION_NAMESPACE,
      getReservationKey(data.resource),
      data.token,
    );
  } catch (error) {
    logger.error(
      `ResourceAiAccessAPI: could not release the AI access test reservation of ${getReservationKey(
        data.resource,
      )}; it expires on its own: ${error}`,
    );
  }
}

/*
 * The per-resource limits, read while this request holds the resource's
 * reservation — so no other test of this resource can be counting (or
 * creating rows) at the same time.
 */
async function assertResourceAccessTestMayRun(data: {
  projectId: ObjectID;
  resource: AccessibleResource;
}): Promise<void> {
  const resourceQuery: Record<string, unknown> = {
    projectId: data.projectId,
    resourceType: data.resource.resourceType,
    resourceId: data.resource.id,
  };
  const sentenceName: string = getResourceSentenceName(
    data.resource.resourceType,
  );

  const inFlight: number = (
    await RunnerJobService.countBy({
      query: {
        ...resourceQuery,
        stepId: QueryHelper.startsWith(RESOURCE_AI_ACCESS_TEST_STEP_ID_PREFIX),
        status: QueryHelper.any([
          RunnerJobStatus.Pending,
          RunnerJobStatus.Claimed,
          RunnerJobStatus.Running,
        ]),
        createdAt: QueryHelper.greaterThan(
          OneUptimeDate.getSomeMinutesAgo(
            RESOURCE_AI_ACCESS_TEST_MAX_DURATION_MINUTES,
          ),
        ),
      } as never,
      props: { isRoot: true },
    })
  ).toNumber();

  if (inFlight > 0) {
    throw new TooManyRequestsException(
      getAlreadyRunningMessage(data.resource.resourceType),
    );
  }

  const testsForResource: number = (
    await RunnerJobService.countBy({
      query: {
        ...resourceQuery,
        stepId: QueryHelper.startsWith(
          `${RESOURCE_AI_ACCESS_TEST_STEP_ID_PREFIX}1-`,
        ),
        createdAt: QueryHelper.greaterThan(OneUptimeDate.getSomeMinutesAgo(1)),
      } as never,
      props: { isRoot: true },
    })
  ).toNumber();

  if (
    testsForResource >= MAX_RESOURCE_AI_ACCESS_TESTS_PER_RESOURCE_PER_MINUTE
  ) {
    throw new TooManyRequestsException(
      `This ${sentenceName}'s AI access was tested ${testsForResource} times in the last minute, which is its limit (${MAX_RESOURCE_AI_ACCESS_TESTS_PER_RESOURCE_PER_MINUTE}). Try again in a minute.`,
    );
  }

  /*
   * The cumulative ceiling: access-test jobs are kept out of the project's
   * investigation brake, so without this nothing would bound them over an
   * hour.
   */
  const testsForResourceThisHour: number = (
    await RunnerJobService.countBy({
      query: {
        ...resourceQuery,
        stepId: QueryHelper.startsWith(
          `${RESOURCE_AI_ACCESS_TEST_STEP_ID_PREFIX}1-`,
        ),
        createdAt: QueryHelper.greaterThan(OneUptimeDate.getSomeHoursAgo(1)),
      } as never,
      props: { isRoot: true },
    })
  ).toNumber();

  if (
    testsForResourceThisHour >=
    MAX_RESOURCE_AI_ACCESS_TESTS_PER_RESOURCE_PER_HOUR
  ) {
    throw new TooManyRequestsException(
      `This ${sentenceName}'s AI access was tested ${testsForResourceThisHour} times in the last hour, which is its limit (${MAX_RESOURCE_AI_ACCESS_TESTS_PER_RESOURCE_PER_HOUR}). Try again later.`,
    );
  }
}

/*
 * The per-user limit spans resources, so the resource reservation does not
 * serialize it: the count is read and the test's first command run under a
 * per-user lock, so a user's concurrent tests on different resources cannot
 * all read the same count. The lock is held until that first command has
 * finished, because ResourceCommandJobRunner.run enqueues and waits in one
 * call and the job it creates is what the next count must see.
 */
async function lockUserForAccessTestStart(
  userId: ObjectID,
): Promise<SemaphoreMutex> {
  try {
    return await Semaphore.lock({
      key: userId.toString(),
      namespace: RESOURCE_AI_ACCESS_TEST_USER_LOCK_NAMESPACE,
      lockTimeout: RESOURCE_AI_ACCESS_TEST_USER_LOCK_TIMEOUT_MS,
      acquireTimeout: RESOURCE_AI_ACCESS_TEST_USER_LOCK_ACQUIRE_TIMEOUT_MS,
    });
  } catch (error) {
    logger.error(
      `ResourceAiAccessAPI: could not take the AI access test lock of user ${userId.toString()}: ${error}`,
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
      `ResourceAiAccessAPI: could not release an AI access test user lock; it expires on its own: ${error}`,
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
          getResourceAiAccessTestStepId({
            commandNumber: 1,
            userId: data.userId,
          }),
        ),
        createdAt: QueryHelper.greaterThan(OneUptimeDate.getSomeMinutesAgo(1)),
      },
      props: { isRoot: true },
    })
  ).toNumber();

  if (testsByUser >= MAX_RESOURCE_AI_ACCESS_TESTS_PER_USER_PER_MINUTE) {
    throw new TooManyRequestsException(
      `You ran ${testsByUser} AI access tests in the last minute, which is the limit (${MAX_RESOURCE_AI_ACCESS_TESTS_PER_USER_PER_MINUTE}). Try again in a minute.`,
    );
  }
}

/*
 * One access-test command, run the way every AI resource command is
 * (ResourceCommandJobRunner.run): enqueued through the resource-command
 * chokepoint as an access test — the policy, the read-only rule and the
 * resource's current agent still apply; the investigation switch and the
 * project's investigation brake do not — then waited on, read and recorded
 * exactly like an investigation's command (only a success or an ACCESS
 * failure becomes the resource's "Last verified" / "Last error").
 *
 * Origin AiInvestigation with no AI run: an access test has none to keep
 * alive.
 */
async function runAccessTestCommand(data: {
  projectId: ObjectID;
  resource: AccessibleResource;
  agentId: ObjectID;
  command: string;
  stepId: string;
}): Promise<ResourceCommandJobOutcome> {
  return ResourceCommandJobRunner.run({
    projectId: data.projectId,
    origin: RunnerJobOrigin.AiInvestigation,
    resourceType: data.resource.resourceType,
    resourceId: data.resource.id,
    targetResourceAiAgentId: data.agentId,
    command: data.command,
    stepId: data.stepId,
    timeoutInMs: DEFAULT_RESOURCE_COMMAND_TIMEOUT_MS,
    claimTimeoutInMs: RESOURCE_COMMAND_CLAIM_TIMEOUT_MS,
    isAccessTest: true,
  });
}

/*
 * Start the test: under this user's lock, check the per-user limit and run
 * the first command, so the next concurrent test of this user counts its
 * job (see lockUserForAccessTestStart). The limit refusal is thrown (the
 * route answers 429); a refusal from the chokepoint, or a wait that broke,
 * is returned as the first command's failure.
 */
async function startAccessTest(data: {
  projectId: ObjectID;
  resource: AccessibleResource;
  userId: ObjectID;
  agentId: ObjectID;
  command: string;
}): Promise<{
  outcome?: ResourceCommandJobOutcome | undefined;
  error?: unknown;
}> {
  const userLock: SemaphoreMutex = await lockUserForAccessTestStart(
    data.userId,
  );

  try {
    await assertUserMayStartAccessTest({
      projectId: data.projectId,
      userId: data.userId,
    });

    try {
      const outcome: ResourceCommandJobOutcome = await runAccessTestCommand({
        projectId: data.projectId,
        resource: data.resource,
        agentId: data.agentId,
        command: data.command,
        stepId: getResourceAiAccessTestStepId({
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

/*
 * The gap that stops the access test before anything is enqueued: one that
 * blocks both capabilities and is about the transport — no agent, or an
 * offline one — never one about the project's AI.
 */
export function getAccessTestTransportGap(
  status: ResourceAiAccessStatus,
): ResourceAiAccessGap | undefined {
  return status.gaps.find((gap: ResourceAiAccessGap): boolean => {
    return (
      gap.blocksInvestigation &&
      gap.blocksRemediation &&
      !NON_TRANSPORT_GAP_CODES.includes(gap.code)
    );
  });
}

router.post(
  RESOURCE_AI_ACCESS_STATUS_PATH,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);
      const tenantId: ObjectID = CommonAPI.assertTenantScoped(props);

      const resource: AccessibleResource = await findAccessibleResource({
        req,
        props,
        tenantId,
      });

      const status: ResourceAiAccessStatus = await getStatus({
        projectId: tenantId,
        resource,
      });

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
  RESOURCE_AI_ACCESS_TEST_PATH,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);
      const tenantId: ObjectID = CommonAPI.assertTenantScoped(props);

      const resource: AccessibleResource = await findAccessibleResource({
        req,
        props,
        tenantId,
      });

      await assertCanEditResource({
        props,
        projectId: tenantId,
        resource,
      });

      const agentName: string = getResourceAgentName(resource.resourceType);

      // One test at a time per resource: an atomic reservation, held to the end.
      const reservation: string = await reserveResourceForAccessTest(resource);

      try {
        await assertResourceAccessTestMayRun({
          projectId: tenantId,
          resource,
        });

        const status: ResourceAiAccessStatus = await getStatus({
          projectId: tenantId,
          resource,
        });

        /*
         * The test needs a reachable agent, not the investigation switch:
         * an operator checks access BEFORE turning AI on. Only gaps that
         * block the transport itself stop it — never one about the
         * project's AI (the test runs the agent's commands, not a model).
         */
        const transportGap: ResourceAiAccessGap | undefined =
          getAccessTestTransportGap(status);

        if (transportGap || !status.agent || !status.agent.isOnline) {
          Response.sendJsonObjectResponse(req, res, {
            ok: false,
            message: transportGap
              ? `${transportGap.title}. ${transportGap.nextStep}`
              : status.agent
                ? `The ${agentName} is offline. Check that its container is running and can reach your OneUptime URL.`
                : `Nothing can reach this ${getResourceSentenceName(
                    resource.resourceType,
                  )} yet: install the ${agentName}.`,
            results: [],
            status: status as unknown as JSONObject,
          });
          return;
        }

        const agentId: ObjectID = new ObjectID(status.agent.agentId);
        const commands: ReadonlyArray<string> =
          AI_RESOURCE_TYPE_INFO[resource.resourceType].testCommands;
        const results: Array<ResourceAiAccessTestCommandResult> = [];
        let allSucceeded: boolean = true;

        const start: {
          outcome?: ResourceCommandJobOutcome | undefined;
          error?: unknown;
        } = await startAccessTest({
          projectId: tenantId,
          resource,
          userId: props.userId!,
          agentId,
          command: commands[0]!,
        });

        for (let index: number = 0; index < commands.length; index++) {
          const command: string = commands[index]!;
          let failure: unknown = undefined;
          let outcome: ResourceCommandJobOutcome | undefined = undefined;

          if (index === 0) {
            outcome = start.outcome;
            failure = start.error;
          } else {
            try {
              outcome = await runAccessTestCommand({
                projectId: tenantId,
                resource,
                agentId,
                command,
                stepId: getResourceAiAccessTestStepId({
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
            command: outcome.displayCommand || command,
            succeeded: outcome.succeeded,
            exitCode: outcome.exitCode ?? null,
            output: outcome.output,
            errorMessage: outcome.errorMessage ?? null,
          });

          if (!outcome.succeeded) {
            break;
          }
        }

        const refreshed: ResourceAiAccessStatus | null =
          await ResourceAiAccessService.getStatusForResource({
            projectId: tenantId,
            resourceType: resource.resourceType,
            resourceId: resource.id,
          });

        Response.sendJsonObjectResponse(req, res, {
          ok: allSucceeded,
          message: allSucceeded
            ? `OneUptime AI can run commands on "${resource.name}" through the ${agentName}.`
            : `The ${agentName} could not run the test commands successfully — see the command output below.`,
          results: results as unknown as Array<JSONObject>,
          status: (refreshed || status) as unknown as JSONObject,
        });
        return;
      } finally {
        await releaseResourceReservation({
          resource,
          token: reservation,
        });
      }
    } catch (err) {
      next(err);
      return;
    }
  },
);

router.post(
  RESOURCE_AI_ACCESS_RESET_AGENT_PATH,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);
      const tenantId: ObjectID = CommonAPI.assertTenantScoped(props);

      const resource: AccessibleResource = await findAccessibleResource({
        req,
        props,
        tenantId,
      });

      assertCanResetAiAgent({
        props,
        projectId: tenantId,
        resourceType: resource.resourceType,
      });

      const agentName: string = getResourceAgentName(resource.resourceType);

      const agent: ResourceAiAgent | null =
        await ResourceAiAgentService.findAgentForResource({
          projectId: tenantId,
          resourceType: resource.resourceType,
          resourceId: resource.id,
        });

      if (!agent) {
        throw new BadDataException(
          `This ${getResourceSentenceName(
            resource.resourceType,
          )} has no ${agentName} to reset.`,
        );
      }

      await ResourceAiAgentService.resetAgent({
        projectId: tenantId,
        resourceType: resource.resourceType,
        resourceId: resource.id,
        userId: props.userId,
      });

      const status: ResourceAiAccessStatus | null =
        await ResourceAiAccessService.getStatusForResource({
          projectId: tenantId,
          resourceType: resource.resourceType,
          resourceId: resource.id,
        });

      Response.sendJsonObjectResponse(req, res, {
        ok: true,
        message: `The ${agentName} was reset. It reconnects on its own within a few minutes.`,
        ...(status ? { status: status as unknown as JSONObject } : {}),
      });
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

/*
 * How many of the resource's newest agent jobs the insights read to find
 * the AI runs and suggestions that ran commands on it. Each AI run runs at
 * most a handful, so this reaches well past the newest 25 of either.
 */
const INSIGHTS_JOB_SCAN_LIMIT: number = 500;

// How many incidents and alerts linked to the resource the insights read.
const INSIGHTS_LINKED_SUBJECT_LIMIT: number = 200;

// What the insights' merge reads off every row it unions.
interface BaseRow {
  id?: ObjectID | null | undefined;
  createdAt?: Date | undefined;
}

function toIsoString(date: Date | undefined): string | undefined {
  return date ? OneUptimeDate.toString(date) : undefined;
}

function newestFirst<T extends { createdAt?: Date | undefined }>(
  rows: Array<T>,
): Array<T> {
  return rows.sort((a: T, b: T): number => {
    return (
      (b.createdAt ? new Date(b.createdAt).getTime() : 0) -
      (a.createdAt ? new Date(a.createdAt).getTime() : 0)
    );
  });
}

/*
 * The union of several newest-first reads: one row per id, newest first,
 * at most `limit` of them (all of them without one).
 */
function mergeNewest<T extends BaseRow>(
  groups: Array<Array<T>>,
  limit?: number | undefined,
): Array<T> {
  const byId: Map<string, T> = new Map<string, T>();

  for (const rows of groups) {
    for (const row of rows) {
      const id: string | undefined = row.id?.toString();

      if (id && !byId.has(id)) {
        byId.set(id, row);
      }
    }
  }

  return newestFirst(Array.from(byId.values())).slice(0, limit);
}

function getIds(
  rows: Array<{ id?: ObjectID | null | undefined }>,
): Array<ObjectID> {
  return rows
    .map((row: { id?: ObjectID | null | undefined }): ObjectID | undefined => {
      return row.id || undefined;
    })
    .filter((id: ObjectID | undefined): id is ObjectID => {
      return Boolean(id);
    });
}

function getUniqueIds(ids: Array<ObjectID | undefined>): Array<ObjectID> {
  const byId: Map<string, ObjectID> = new Map<string, ObjectID>();

  for (const id of ids) {
    if (id) {
      byId.set(id.toString(), id);
    }
  }

  return Array.from(byId.values());
}

/*
 * A read made under the caller's own props, which the permission layer
 * refuses outright for a role that cannot read the table at all (a
 * ReadDockerHost-only role reading Incident): that caller gets nothing from
 * it, the same as a caller whose labels or private-incident membership
 * leave no row readable.
 */
async function readIfPermitted<T>(
  read: () => Promise<Array<T>>,
): Promise<Array<T>> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof NotAuthorizedException) {
      return [];
    }

    throw error;
  }
}

/*
 * What OneUptime AI investigated and changed on one resource, as summaries
 * (ResourceAiInsights). The caller has already been checked for read
 * access to the resource (findAccessibleResource), which is a wider
 * audience than the incidents, alerts, AI runs and suggestions summarised
 * here, so what is said about THOSE follows the caller's own read access to
 * them:
 *
 * - incidents and alerts are read under the caller's props (tenant, labels,
 *   private incidents), both to find the ones linked to the resource and to
 *   name a run's subject; an investigation whose incident or alert the
 *   caller cannot read is left out altogether;
 * - an investigation's TL;DR is shown with its readable incident or alert —
 *   the incident's and alert's own AI investigation panel shows the whole
 *   analysis to anyone who may read the subject — and, for a run with
 *   neither (an AI insight's triage), only to a caller who may read AIRun;
 * - a fix's rationale is read under the caller's props, so only a caller who
 *   may read that AutoRemediationSuggestion (its ACL and its incident's or
 *   alert's privacy) gets it.
 *
 * The rest — which AI runs and suggestions touched the resource, their
 * status and dates, the command counts — is about the resource itself and
 * is read as root: AI runs, suggestions and agent jobs have narrower read
 * ACLs of their own (an investigation run is private to its author), so
 * reading them under the caller's props would empty the page for exactly
 * the people it is for. Nothing here returns command output, prompts or
 * command plans.
 *
 * - investigations: AI investigations that ran a command on this resource
 *   (their RunnerJob rows name it), UNION investigations of incidents and
 *   alerts linked to it — which also covers one whose access was not set
 *   up, so it never ran a command. Newest first, at most
 *   RESOURCE_AI_INSIGHTS_LIMIT.
 * - fixes: suggestions the resource's own AI remediation setting produced
 *   (AutoRemediationSuggestion.resourceType / resourceId), UNION any
 *   suggestion whose commands ran on this resource (a rule's round, too).
 *   Newest first, same limit.
 * - commandCounts: commands in the last
 *   RESOURCE_AI_INSIGHTS_COMMAND_WINDOW_IN_DAYS days. The AI agent page's
 *   connection tests have no AI run behind them and are not counted.
 */
export async function getResourceAiInsights(data: {
  projectId: ObjectID;
  resourceType: AiResourceType;
  resourceId: ObjectID;
  // The caller's own (tenant-pinned) props.
  props: DatabaseCommonInteractionProps;
}): Promise<ResourceAiInsights> {
  const { projectId, resourceType, resourceId, props } = data;
  const limit: number = RESOURCE_AI_INSIGHTS_LIMIT;
  const subjectRelation: string =
    RESOURCE_AI_ACCESS_KINDS[resourceType].subjectRelation;

  const jobs: Array<RunnerJob> = await RunnerJobService.findBy({
    query: {
      projectId,
      resourceType,
      resourceId,
      stepType: RunbookStepType.ResourceCommand,
    },
    select: { _id: true, aiRunId: true, autoRemediationSuggestionId: true },
    sort: { createdAt: SortOrder.Descending },
    limit: INSIGHTS_JOB_SCAN_LIMIT,
    skip: 0,
    props: { isRoot: true },
  });

  const runIdsFromJobs: Map<string, ObjectID> = new Map<string, ObjectID>();
  const suggestionIdsFromJobs: Map<string, ObjectID> = new Map<
    string,
    ObjectID
  >();

  for (const job of jobs) {
    if (job.aiRunId) {
      runIdsFromJobs.set(job.aiRunId.toString(), job.aiRunId);
    }

    if (job.autoRemediationSuggestionId) {
      suggestionIdsFromJobs.set(
        job.autoRemediationSuggestionId.toString(),
        job.autoRemediationSuggestionId,
      );
    }
  }

  // Only the incidents and alerts the caller may read (see above).
  const [linkedIncidents, linkedAlerts]: [Array<Incident>, Array<Alert>] =
    await Promise.all([
      readIfPermitted<Incident>(() => {
        return IncidentService.findBy({
          query: {
            projectId,
            [subjectRelation]: QueryHelper.inRelationArray([resourceId]),
          } as never,
          select: { _id: true },
          sort: { createdAt: SortOrder.Descending },
          limit: INSIGHTS_LINKED_SUBJECT_LIMIT,
          skip: 0,
          props,
        });
      }),
      readIfPermitted<Alert>(() => {
        return AlertService.findBy({
          query: {
            projectId,
            [subjectRelation]: QueryHelper.inRelationArray([resourceId]),
          } as never,
          select: { _id: true },
          sort: { createdAt: SortOrder.Descending },
          limit: INSIGHTS_LINKED_SUBJECT_LIMIT,
          skip: 0,
          props,
        });
      }),
    ]);

  const investigations: Array<ResourceAiInsightInvestigation> =
    await getInsightInvestigations({
      projectId,
      props,
      runIds: Array.from(runIdsFromJobs.values()),
      incidentIds: getIds(linkedIncidents),
      alertIds: getIds(linkedAlerts),
      limit,
    });

  const fixes: Array<ResourceAiInsightFix> = await getInsightFixes({
    projectId,
    props,
    resourceType,
    resourceId,
    suggestionIds: Array.from(suggestionIdsFromJobs.values()),
    limit,
  });

  const since: Date = OneUptimeDate.getSomeDaysAgo(
    RESOURCE_AI_INSIGHTS_COMMAND_WINDOW_IN_DAYS,
  );

  const countCommands: (
    query: Record<string, unknown>,
  ) => Promise<number> = async (
    query: Record<string, unknown>,
  ): Promise<number> => {
    return (
      await RunnerJobService.countBy({
        query: {
          ...query,
          projectId,
          resourceType,
          resourceId,
          stepType: RunbookStepType.ResourceCommand,
          createdAt: QueryHelper.greaterThan(since),
        } as never,
        props: { isRoot: true },
      })
    ).toNumber();
  };

  const [investigationCommands, remediationCommands]: [number, number] =
    await Promise.all([
      countCommands({
        origin: RunnerJobOrigin.AiInvestigation,
        // Connection tests have no AI run; every investigation command does.
        aiRunId: QueryHelper.notNull(),
      }),
      countCommands({ origin: RunnerJobOrigin.AiRemediation }),
    ]);

  return {
    resourceType,
    resourceId: resourceId.toString(),
    investigations,
    fixes,
    commandCounts: {
      investigation: investigationCommands,
      remediation: remediationCommands,
    },
  };
}

const INSIGHT_RUN_SELECT: Record<string, boolean> = {
  _id: true,
  status: true,
  analysisTldr: true,
  createdAt: true,
  completedAt: true,
  triggeredByIncidentId: true,
  triggeredByAlertId: true,
};

/*
 * Who may read the TL;DR of a run that has no incident or alert to decide
 * it: the people who may read that column of AIRun.
 */
function getSubjectlessRunTldrReadPermissions(): Array<Permission> {
  return new AIRun().getColumnAccessControlFor("analysisTldr")?.read || [];
}

async function getInsightInvestigations(data: {
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
  runIds: Array<ObjectID>;
  incidentIds: Array<ObjectID>;
  alertIds: Array<ObjectID>;
  limit: number;
}): Promise<Array<ResourceAiInsightInvestigation>> {
  const reads: Array<Promise<Array<AIRun>>> = [];

  const readRuns: (query: Record<string, unknown>) => Promise<Array<AIRun>> = (
    query: Record<string, unknown>,
  ): Promise<Array<AIRun>> => {
    return AIRunService.findBy({
      query: {
        ...query,
        projectId: data.projectId,
        runType: AIRunType.Investigation,
      } as never,
      select: INSIGHT_RUN_SELECT,
      sort: { createdAt: SortOrder.Descending },
      limit: data.limit,
      skip: 0,
      props: { isRoot: true },
    });
  };

  if (data.runIds.length > 0) {
    reads.push(readRuns({ _id: QueryHelper.any(data.runIds) }));
  }

  if (data.incidentIds.length > 0) {
    reads.push(
      readRuns({ triggeredByIncidentId: QueryHelper.any(data.incidentIds) }),
    );
  }

  if (data.alertIds.length > 0) {
    reads.push(
      readRuns({ triggeredByAlertId: QueryHelper.any(data.alertIds) }),
    );
  }

  if (reads.length === 0) {
    return [];
  }

  // Every candidate, newest first: the limit applies after the subject check.
  const candidates: Array<AIRun> = mergeNewest(await Promise.all(reads));

  const incidentIds: Array<ObjectID> = getUniqueIds(
    candidates.map((run: AIRun): ObjectID | undefined => {
      return run.triggeredByIncidentId;
    }),
  );
  const alertIds: Array<ObjectID> = getUniqueIds(
    candidates.map((run: AIRun): ObjectID | undefined => {
      return run.triggeredByAlertId;
    }),
  );

  /*
   * The subjects under the CALLER's props: tenant, labels and private
   * incidents apply exactly as on a CRUD read, and a role that may not read
   * incidents (or alerts) at all reads none.
   */
  const [incidents, alerts]: [Array<Incident>, Array<Alert>] =
    await Promise.all([
      incidentIds.length > 0
        ? readIfPermitted<Incident>(() => {
            return IncidentService.findBy({
              query: {
                projectId: data.projectId,
                _id: QueryHelper.any(incidentIds),
              },
              select: { _id: true, title: true, incidentNumber: true },
              limit: incidentIds.length,
              skip: 0,
              props: data.props,
            });
          })
        : Promise.resolve([]),
      alertIds.length > 0
        ? readIfPermitted<Alert>(() => {
            return AlertService.findBy({
              query: {
                projectId: data.projectId,
                _id: QueryHelper.any(alertIds),
              },
              select: { _id: true, title: true },
              limit: alertIds.length,
              skip: 0,
              props: data.props,
            });
          })
        : Promise.resolve([]),
    ]);

  const incidentsById: Map<string, Incident> = new Map<string, Incident>(
    incidents.map((incident: Incident): [string, Incident] => {
      return [incident.id?.toString() || "", incident];
    }),
  );
  const alertsById: Map<string, Alert> = new Map<string, Alert>(
    alerts.map((alert: Alert): [string, Alert] => {
      return [alert.id?.toString() || "", alert];
    }),
  );

  // A run whose incident or alert the caller cannot read is left out.
  const runs: Array<AIRun> = candidates
    .filter((run: AIRun): boolean => {
      if (
        run.triggeredByIncidentId &&
        !incidentsById.has(run.triggeredByIncidentId.toString())
      ) {
        return false;
      }

      if (
        run.triggeredByAlertId &&
        !alertsById.has(run.triggeredByAlertId.toString())
      ) {
        return false;
      }

      return true;
    })
    .slice(0, data.limit);

  const mayReadSubjectlessTldr: boolean = holdsAnyUnblockedPermission({
    props: data.props,
    projectId: data.projectId,
    allowed: getSubjectlessRunTldrReadPermissions(),
  });

  return runs.map((run: AIRun): ResourceAiInsightInvestigation => {
    const incident: Incident | undefined = run.triggeredByIncidentId
      ? incidentsById.get(run.triggeredByIncidentId.toString())
      : undefined;
    const alert: Alert | undefined = run.triggeredByAlertId
      ? alertsById.get(run.triggeredByAlertId.toString())
      : undefined;

    /*
     * Every run left here with a subject has a subject the caller may read,
     * and the subject's own AI panel shows its analysis to them.
     */
    const mayReadTldr: boolean =
      Boolean(run.triggeredByIncidentId || run.triggeredByAlertId) ||
      mayReadSubjectlessTldr;

    return {
      aiRunId: run.id!.toString(),
      status: run.status,
      analysisTldr: mayReadTldr ? run.analysisTldr || undefined : undefined,
      createdAt: toIsoString(run.createdAt),
      completedAt: toIsoString(run.completedAt),
      incident: run.triggeredByIncidentId
        ? {
            id: run.triggeredByIncidentId.toString(),
            title: incident?.title,
            number: incident?.incidentNumber,
          }
        : undefined,
      alert: run.triggeredByAlertId
        ? {
            id: run.triggeredByAlertId.toString(),
            title: alert?.title,
          }
        : undefined,
    };
  });
}

/*
 * Read as root, so never the rationale: that is read under the caller's
 * props (getInsightFixes).
 */
const INSIGHT_FIX_SELECT: Record<string, boolean> = {
  _id: true,
  status: true,
  executionMode: true,
  suggestionType: true,
  createdAt: true,
  approvedAt: true,
  incidentId: true,
  alertId: true,
};

async function getInsightFixes(data: {
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
  resourceType: AiResourceType;
  resourceId: ObjectID;
  suggestionIds: Array<ObjectID>;
  limit: number;
}): Promise<Array<ResourceAiInsightFix>> {
  const readSuggestions: (
    query: Record<string, unknown>,
  ) => Promise<Array<AutoRemediationSuggestion>> = (
    query: Record<string, unknown>,
  ): Promise<Array<AutoRemediationSuggestion>> => {
    return AutoRemediationSuggestionService.findBy({
      query: { ...query, projectId: data.projectId } as never,
      select: INSIGHT_FIX_SELECT,
      sort: { createdAt: SortOrder.Descending },
      limit: data.limit,
      skip: 0,
      props: { isRoot: true },
    });
  };

  const reads: Array<Promise<Array<AutoRemediationSuggestion>>> = [
    readSuggestions({
      resourceType: data.resourceType,
      resourceId: data.resourceId,
    }),
  ];

  if (data.suggestionIds.length > 0) {
    reads.push(readSuggestions({ _id: QueryHelper.any(data.suggestionIds) }));
  }

  const suggestions: Array<AutoRemediationSuggestion> = mergeNewest(
    await Promise.all(reads),
    data.limit,
  );
  const ids: Array<ObjectID> = getIds(suggestions);

  /*
   * The rationale quotes the AI's analysis of the incident or alert, so it
   * is read under the CALLER's props: the suggestion's read ACL and its
   * subject's privacy decide it, as on a CRUD read.
   */
  const readable: Array<AutoRemediationSuggestion> =
    ids.length > 0
      ? await readIfPermitted<AutoRemediationSuggestion>(() => {
          return AutoRemediationSuggestionService.findBy({
            query: {
              projectId: data.projectId,
              _id: QueryHelper.any(ids),
            } as never,
            select: { _id: true, rationaleMarkdown: true },
            limit: ids.length,
            skip: 0,
            props: data.props,
          });
        })
      : [];

  const rationaleById: Map<string, string> = new Map<string, string>();

  for (const suggestion of readable) {
    if (suggestion.id && suggestion.rationaleMarkdown) {
      rationaleById.set(suggestion.id.toString(), suggestion.rationaleMarkdown);
    }
  }

  return suggestions.map(
    (suggestion: AutoRemediationSuggestion): ResourceAiInsightFix => {
      const rationale: string | undefined = rationaleById.get(
        suggestion.id!.toString(),
      );

      return {
        id: suggestion.id!.toString(),
        status: suggestion.status,
        executionMode: suggestion.executionMode,
        suggestionType: suggestion.suggestionType,
        rationale: rationale
          ? rationale.slice(0, RESOURCE_AI_INSIGHTS_RATIONALE_MAX_LENGTH)
          : undefined,
        createdAt: toIsoString(suggestion.createdAt),
        approvedAt: toIsoString(suggestion.approvedAt),
        incidentId: suggestion.incidentId?.toString(),
        alertId: suggestion.alertId?.toString(),
      };
    },
  );
}

router.post(
  RESOURCE_AI_ACCESS_INSIGHTS_PATH,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);
      const tenantId: ObjectID = CommonAPI.assertTenantScoped(props);

      const resource: AccessibleResource = await findAccessibleResource({
        req,
        props,
        tenantId,
      });

      const insights: ResourceAiInsights = await getResourceAiInsights({
        projectId: tenantId,
        resourceType: resource.resourceType,
        resourceId: resource.id,
        props,
      });

      Response.sendJsonObjectResponse(
        req,
        res,
        insights as unknown as JSONObject,
      );
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

export default router;
