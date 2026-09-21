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
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../Types/ObjectID";
import { JSONObject } from "../../Types/JSON";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../Types/Permission";
import RunnerJobOrigin from "../../Types/Runbook/RunnerJobOrigin";
import {
  DEFAULT_KUBECTL_TIMEOUT_MS,
  KubernetesAiAccessGap,
  KubernetesClusterAiAccessStatus,
} from "../../Types/Kubernetes/KubernetesClusterAiAccess";
import KubernetesCluster from "../../Models/DatabaseModels/KubernetesCluster";
import KubernetesClusterService from "../Services/KubernetesClusterService";
import KubernetesClusterAiAccessService from "../Services/KubernetesClusterAiAccessService";
import KubectlJobRunner, {
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
 *     to the cluster.
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

  const cluster: KubernetesCluster | null =
    await KubernetesClusterService.findOneById({
      id: new ObjectID(clusterIdString),
      select: { _id: true, projectId: true, name: true },
      props: data.props,
    });

  if (!cluster || !cluster.id || !cluster.projectId) {
    throw new BadDataException(
      "Kubernetes cluster not found (or you do not have access to it).",
    );
  }

  CommonAPI.assertResourceBelongsToProject({
    resourceProjectId: cluster.projectId,
    projectId: data.tenantId,
  });

  return cluster;
}

// Mirrors KubernetesCluster's update ACL; a block row is a denial, not a grant.
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
      "You do not have permission to change this cluster's AI access.",
    );
  }
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

      const commands: Array<string> = [
        "kubectl version",
        "kubectl auth can-i --list",
      ];

      const results: Array<JSONObject> = [];
      let allSucceeded: boolean = true;

      for (const command of commands) {
        try {
          const outcome: KubectlJobOutcome = await KubectlJobRunner.run({
            projectId: tenantId,
            origin: RunnerJobOrigin.AiInvestigation,
            kubernetesClusterId: cluster.id!,
            targetRunnerId: new ObjectID(status.runner.id),
            credentialId: status.credentialId,
            command,
            stepId: `ai-access-test-${results.length + 1}`,
            timeoutInMs: DEFAULT_KUBECTL_TIMEOUT_MS,
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
