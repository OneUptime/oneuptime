import DatabaseService from "./DatabaseService";
import KubernetesClusterLabelRuleEngineService from "./KubernetesClusterLabelRuleEngineService";
import KubernetesClusterOwnerRuleEngineService from "./KubernetesClusterOwnerRuleEngineService";
import RunbookCredentialService from "./RunbookCredentialService";
import RunnerService from "./RunnerService";
import UserService from "./UserService";
import Model from "../../Models/DatabaseModels/KubernetesCluster";
import Label from "../../Models/DatabaseModels/Label";
import RunbookCredential from "../../Models/DatabaseModels/RunbookCredential";
import Runner from "../../Models/DatabaseModels/Runner";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import { holdsAnyPermission } from "../Utils/Runbook/RunbookExecutePermission";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import {
  KubernetesAiRemediationMode,
  isUnattendedRemediationMode,
} from "../../Types/Kubernetes/KubernetesClusterAiAccess";
import {
  KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS,
  KUBERNETES_AI_ACCESS_CREDENTIAL_PERMISSIONS,
} from "../../Types/Kubernetes/KubernetesClusterAiAccessPermissions";
import { PermissionHelper } from "../../Types/Permission";
import RunbookCredentialType from "../../Types/Runbook/RunbookCredentialType";
import KubernetesClusterFeedService from "./KubernetesClusterFeedService";
import { KubernetesClusterFeedEventType } from "../../Models/DatabaseModels/KubernetesClusterFeed";
import ResourceFeedUtil from "../Utils/ResourceFeed/ResourceFeedUtil";
import { Blue500, Gray500, Green500, Yellow500 } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import { JSONObject } from "../../Types/JSON";
import URL from "../../Types/API/URL";
import DatabaseConfig from "../DatabaseConfig";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ResourceHeartbeat from "../Utils/Telemetry/ResourceHeartbeat";
import ObjectID from "../../Types/ObjectID";
import QueryHelper from "../Types/Database/QueryHelper";
import OneUptimeDate from "../../Types/Date";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import GlobalCache from "../Infrastructure/GlobalCache";
import logger, { LogAttributes } from "../Utils/Logger";
import crypto from "crypto";

const LAST_SEEN_CACHE_NAMESPACE: string = "k8s-cluster-last-seen";
const LAST_SEEN_THROTTLE_SECONDS: number = 60;

const LABELS_APPLIED_CACHE_NAMESPACE: string = "k8s-cluster-labels-applied";
const LABELS_APPLIED_CACHE_TTL_SECONDS: number = 60;

/*
 * The two spellings each AI-access relation can arrive under: the FK column
 * server-side callers write, and the relation object the dashboard's forms
 * post. See RelationIdUtil for why a hook must read both.
 */
const AI_ACCESS_RUNNER_KEYS: Array<string> = [
  "aiAccessRunnerId",
  "aiAccessRunner",
];
const AI_ACCESS_CREDENTIAL_KEYS: Array<string> = [
  "aiAccessCredentialId",
  "aiAccessCredential",
];

/*
 * Every AI access setting an operator can write — on the cluster's AI page,
 * through the API or through Terraform. A non-root write of any of them is
 * checked against who may loosen AI access, marks the cluster as
 * AI-configured (aiAccessConfiguredAt) and is recorded on the cluster feed.
 */
export const AI_ACCESS_SETTING_KEYS: Array<string> = [
  ...AI_ACCESS_RUNNER_KEYS,
  ...AI_ACCESS_CREDENTIAL_KEYS,
  "isAiInvestigationEnabled",
  "aiRemediationMode",
  "aiKubectlCommandAllowlist",
];

/*
 * Bounds on the cluster's kubectl allowlist. CommandPolicy.matchesAllowlist
 * silently ignores every pattern past the 100th and every pattern longer
 * than 500 characters, so a longer list would be stored and then never take
 * effect. The allowlist tests pin these against the matcher's behavior.
 */
export const MAX_KUBECTL_ALLOWLIST_PATTERNS: number = 100;
export const MAX_KUBECTL_ALLOWLIST_PATTERN_LENGTH: number = 500;

const KUBECTL_ALLOWLIST_SHAPE_HINT: string =
  'The kubectl allowlist must be a JSON array of kubectl command patterns, for example ["kubectl set image deployment/web * -n web"].';

/*
 * How much each remediation mode lets OneUptime AI do without a human,
 * least first. Automatic runs a strict subset of what Bypass approval runs
 * (safe changes and allowlisted shapes, never an unlisted riskier change),
 * so moving from Bypass approval to Automatic is a tightening.
 */
const REMEDIATION_MODES_BY_AUTONOMY: Array<KubernetesAiRemediationMode> = [
  KubernetesAiRemediationMode.Disabled,
  KubernetesAiRemediationMode.RequireApproval,
  KubernetesAiRemediationMode.Automatic,
  KubernetesAiRemediationMode.BypassApproval,
];

// The AI page's short name for each mode, used on the cluster feed.
const REMEDIATION_MODE_FEED_LABELS: Record<
  KubernetesAiRemediationMode,
  string
> = {
  [KubernetesAiRemediationMode.Disabled]: "Off",
  [KubernetesAiRemediationMode.RequireApproval]: "Ask for approval",
  [KubernetesAiRemediationMode.Automatic]: "Automatic",
  [KubernetesAiRemediationMode.BypassApproval]: "Bypass approval",
};

/*
 * One answer for "no such credential in this project" and "not a Kubernetes
 * credential": a caller who may not read credentials must not be able to
 * tell the two apart and so learn which ids exist and what type they are.
 */
export const AI_ACCESS_CREDENTIAL_REFUSAL: string =
  "Credential not found, or it is not a Kubernetes credential in this project. The AI access credential must be a Kubernetes credential (API server URL and ServiceAccount token) that belongs to this project.";

export function getAiAccessAdminRefusal(): string {
  return `You need one of these permissions to let OneUptime AI do more on a Kubernetes cluster (switch AI remediation to Automatic or Bypass approval, add kubectl allowlist patterns, or bind a Runner or credential): ${PermissionHelper.getPermissionTitles(
    KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS,
  ).join(
    ", ",
  )}. Anyone who may edit the cluster can still turn AI remediation off or back to Ask for approval, remove allowlist patterns, and clear the Runner or credential.`;
}

export function getAiAccessCredentialRefusal(): string {
  return `Binding a Kubernetes credential to a cluster also needs permission to read credentials. You need one of these permissions: ${PermissionHelper.getPermissionTitles(
    KUBERNETES_AI_ACCESS_CREDENTIAL_PERMISSIONS,
  ).join(", ")}.`;
}

/*
 * A cluster's AI access settings as they stood before an operator's write:
 * the baseline "does this write loosen anything?" is decided against, and
 * the "before" half of the feed item that records the change. Normalized
 * the way the readers normalize them (an unknown mode is Disabled, an
 * unusable allowlist is empty), because that is what was in effect.
 */
export interface AiAccessSettingsSnapshot {
  projectId?: ObjectID | undefined;
  isAiInvestigationEnabled: boolean;
  aiRemediationMode: KubernetesAiRemediationMode;
  aiKubectlCommandAllowlist: Array<string>;
  aiAccessRunnerId: string | null;
  aiAccessCredentialId: string | null;
}

// What a cluster that was never AI-configured has: the column defaults.
const NEVER_CONFIGURED_AI_ACCESS: AiAccessSettingsSnapshot = {
  isAiInvestigationEnabled: false,
  aiRemediationMode: KubernetesAiRemediationMode.Disabled,
  aiKubectlCommandAllowlist: [],
  aiAccessRunnerId: null,
  aiAccessCredentialId: null,
};

/*
 * Handed from onBeforeUpdate to onUpdateSuccess for an operator's write of
 * an AI access setting, keyed by cluster id. Its presence is the signal that
 * the write must mark the cluster configured and be recorded on the feed —
 * both happen only after the update succeeded.
 */
export interface AiAccessWriteCarryForward {
  previousAiAccessSettings: Record<string, AiAccessSettingsSnapshot>;
}

// What loosening an operator's write would do to one cluster.
interface AiAccessLoosening {
  loosens: boolean;
  bindsCredential: boolean;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const projectId: ObjectID | undefined =
      createBy.data.projectId ||
      createBy.data.project?.id ||
      createBy.props.tenantId ||
      undefined;

    const data: JSONObject = createBy.data as unknown as JSONObject;

    this.validateAiRemediationSettings(data);

    /*
     * The AI columns' create ACLs are empty, so a user's create cannot carry
     * them today and this is defence in depth: were one ever opened, a new
     * cluster starts from the never-configured defaults, and anything above
     * them is a loosening like any other.
     */
    if (!createBy.props.isRoot && !createBy.props.isMasterAdmin) {
      this.assertMayChangeAiAccess({
        data,
        props: createBy.props,
        current: [{ ...NEVER_CONFIGURED_AI_ACCESS, projectId }],
      });
    }

    await this.validateAiAccessBindingsBelongToProject({
      data,
      projectId,
    });

    return {
      createBy,
      carryForward: {
        writesAiAccessSettings:
          !createBy.props.isRoot && this.isAiAccessSettingWritten(data),
      },
    };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const data: JSONObject = (updateBy.data || {}) as unknown as JSONObject;

    this.validateAiRemediationSettings(data);

    /*
     * An operator's write of an AI access setting is gated, marked and
     * recorded. Root writes are the server's own — the in-cluster Runner's
     * registration (which writes its own feed item and marker) and the
     * outcome bookkeeping after each kubectl command — and are none of the
     * three.
     */
    let carryForward: AiAccessWriteCarryForward | null = null;

    if (!updateBy.props.isRoot && this.isAiAccessSettingWritten(data)) {
      const previousAiAccessSettings: Record<string, AiAccessSettingsSnapshot> =
        await this.getAiAccessSettingsForUpdateQuery(updateBy);

      if (!updateBy.props.isMasterAdmin) {
        this.assertMayChangeAiAccess({
          data,
          props: updateBy.props,
          current: Object.values(previousAiAccessSettings),
        });
      }

      carryForward = { previousAiAccessSettings };
    }

    if (
      RelationIdUtil.isWritten(Object.keys(data), [
        ...AI_ACCESS_RUNNER_KEYS,
        ...AI_ACCESS_CREDENTIAL_KEYS,
      ])
    ) {
      /*
       * Root/API updates do not always carry a tenantId, so fall back to
       * the project of each cluster the query actually matches — a Runner
       * must belong to every one of them.
       */
      const projectIds: Array<ObjectID> = updateBy.props.tenantId
        ? [updateBy.props.tenantId]
        : await this.getProjectIdsForUpdateQuery(updateBy);

      for (const projectId of projectIds) {
        await this.validateAiAccessBindingsBelongToProject({
          data,
          projectId,
        });
      }

      /*
       * Nothing matched: there is no project to check against, and the
       * update will write nothing — unless the query was empty, which
       * would never happen through updateOneById. Fail closed on a
       * binding that cannot be checked.
       */
      if (projectIds.length === 0) {
        await this.validateAiAccessBindingsBelongToProject({
          data,
          projectId: undefined,
        });
      }
    }

    return { updateBy, carryForward };
  }

  private isAiAccessSettingWritten(data: JSONObject): boolean {
    return isAnyKeyWritten(data, AI_ACCESS_SETTING_KEYS);
  }

  /*
   * aiRemediationMode is a plain text column and aiKubectlCommandAllowlist
   * untyped JSON, and both of their readers fail safe: an unknown mode reads
   * as Disabled and an unusable pattern as no pattern. Accepting such a value
   * would answer an API or Terraform write with success for a setting that
   * never takes effect (and shows no drift), so refuse it here — and store
   * the allowlist in the one shape its readers expect.
   */
  private validateAiRemediationSettings(data: JSONObject): void {
    const mode: unknown = data["aiRemediationMode"];

    if (
      mode !== undefined &&
      !Object.values(KubernetesAiRemediationMode).includes(
        mode as KubernetesAiRemediationMode,
      )
    ) {
      throw new BadDataException(
        `AI remediation mode must be one of ${Object.values(
          KubernetesAiRemediationMode,
        ).join(", ")} (got ${JSON.stringify(mode)}).`,
      );
    }

    if (data["aiKubectlCommandAllowlist"] !== undefined) {
      data["aiKubectlCommandAllowlist"] = normalizeKubectlAllowlistForWrite(
        data["aiKubectlCommandAllowlist"],
      );
    }
  }

  /*
   * A cluster's AI mode does the job of a FullAuto AutoRemediationRule with
   * no rule row, so making AI do MORE on a cluster takes the same
   * permissions as authoring such a rule (KUBERNETES_AI_ACCESS_ADMIN_
   * PERMISSIONS), and binding a credential additionally takes the right to
   * read credentials — the rule the dashboard's picker applies, now enforced
   * where it cannot be skipped. The column ACLs stay open to every cluster
   * editor on purpose: a column ACL cannot say "tightening is free", and
   * turning AI remediation off must never need more than editing the
   * cluster.
   *
   * `current` holds the settings of every cluster the write reaches. When it
   * matched none, the write is judged against the never-configured defaults
   * in the caller's tenant, so the answer does not depend on whether the id
   * exists; with no project to check against at all it fails closed.
   */
  private assertMayChangeAiAccess(data: {
    data: JSONObject;
    props: DatabaseCommonInteractionProps;
    current: Array<AiAccessSettingsSnapshot>;
  }): void {
    const baselines: Array<AiAccessSettingsSnapshot> =
      data.current.length > 0
        ? data.current
        : [{ ...NEVER_CONFIGURED_AI_ACCESS, projectId: data.props.tenantId }];

    for (const baseline of baselines) {
      const loosening: AiAccessLoosening = this.getAiAccessLoosening(
        data.data,
        baseline,
      );

      if (!loosening.loosens) {
        continue;
      }

      if (
        !baseline.projectId ||
        !holdsAnyPermission({
          props: data.props,
          projectId: baseline.projectId,
          allowed: KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS,
        })
      ) {
        throw new NotAuthorizedException(getAiAccessAdminRefusal());
      }

      if (
        loosening.bindsCredential &&
        !holdsAnyPermission({
          props: data.props,
          projectId: baseline.projectId,
          allowed: KUBERNETES_AI_ACCESS_CREDENTIAL_PERMISSIONS,
        })
      ) {
        throw new NotAuthorizedException(getAiAccessCredentialRefusal());
      }
    }
  }

  /*
   * Does this write let AI do more on a cluster whose settings are
   * `current`? Only a real change counts: the AI page posts every field of
   * its form, so an editor who only flips the investigation switch re-posts
   * an unchanged mode, allowlist and binding, and must not be refused for
   * settings someone else chose.
   *
   * - mode: moving UP to Automatic or Bypass approval (Bypass approval ->
   *   Automatic is a tightening);
   * - allowlist: adding a pattern the cluster did not already have
   *   (removing patterns, or clearing the list, tightens);
   * - Runner or credential: binding one other than the current one
   *   (clearing tightens).
   *
   * `data` has been through validateAiRemediationSettings, so the mode is a
   * known value and the allowlist a trimmed array or null.
   */
  private getAiAccessLoosening(
    data: JSONObject,
    current: AiAccessSettingsSnapshot,
  ): AiAccessLoosening {
    let loosens: boolean = false;
    let bindsCredential: boolean = false;

    const mode: KubernetesAiRemediationMode | undefined = data[
      "aiRemediationMode"
    ] as KubernetesAiRemediationMode | undefined;

    if (
      mode !== undefined &&
      isUnattendedRemediationMode(mode) &&
      REMEDIATION_MODES_BY_AUTONOMY.indexOf(mode) >
        REMEDIATION_MODES_BY_AUTONOMY.indexOf(current.aiRemediationMode)
    ) {
      loosens = true;
    }

    if (data["aiKubectlCommandAllowlist"] !== undefined) {
      const patterns: Array<string> =
        (data["aiKubectlCommandAllowlist"] as Array<string> | null) || [];

      if (
        patterns.some((pattern: string) => {
          return !current.aiKubectlCommandAllowlist.includes(pattern);
        })
      ) {
        loosens = true;
      }
    }

    const runnerId: ObjectID | null = RelationIdUtil.readConsistent(
      data,
      AI_ACCESS_RUNNER_KEYS,
      "AI access Runner",
    );

    if (runnerId && runnerId.toString() !== current.aiAccessRunnerId) {
      loosens = true;
    }

    const credentialId: ObjectID | null = RelationIdUtil.readConsistent(
      data,
      AI_ACCESS_CREDENTIAL_KEYS,
      "AI access credential",
    );

    if (
      credentialId &&
      credentialId.toString() !== current.aiAccessCredentialId
    ) {
      loosens = true;
      bindsCredential = true;
    }

    return { loosens, bindsCredential };
  }

  /*
   * The AI access settings of every cluster an operator's update reaches,
   * read before the write. onBeforeUpdate runs before the framework scopes
   * the query to the caller's project, so scope it here: a caller must
   * never learn anything about, or be judged against, another project's
   * cluster.
   */
  @CaptureSpan()
  private async getAiAccessSettingsForUpdateQuery(
    updateBy: UpdateBy<Model>,
  ): Promise<Record<string, AiAccessSettingsSnapshot>> {
    const clusters: Array<Model> = await this.findBy({
      query: {
        ...updateBy.query,
        ...(updateBy.props.tenantId
          ? { projectId: updateBy.props.tenantId }
          : {}),
      },
      select: {
        _id: true,
        projectId: true,
        isAiInvestigationEnabled: true,
        aiRemediationMode: true,
        aiKubectlCommandAllowlist: true,
        aiAccessRunnerId: true,
        aiAccessCredentialId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const settings: Record<string, AiAccessSettingsSnapshot> = {};

    for (const cluster of clusters) {
      const clusterId: string | undefined =
        cluster.id?.toString() || cluster._id?.toString();

      if (!clusterId) {
        continue;
      }

      settings[clusterId] = {
        projectId: cluster.projectId,
        isAiInvestigationEnabled: cluster.isAiInvestigationEnabled === true,
        aiRemediationMode: readStoredRemediationMode(cluster.aiRemediationMode),
        aiKubectlCommandAllowlist: readStoredKubectlAllowlist(
          cluster.aiKubectlCommandAllowlist,
        ),
        aiAccessRunnerId: cluster.aiAccessRunnerId?.toString() || null,
        aiAccessCredentialId: cluster.aiAccessCredentialId?.toString() || null,
      };
    }

    return settings;
  }

  /*
   * aiAccessRunnerId / aiAccessCredentialId are editable through ordinary
   * CRUD by every member who may edit a cluster, and nothing in the
   * framework checks that a ManyToOne target belongs to the row's own
   * project (only the tenant relation itself is checked). Unchecked, a
   * member of project A could point a cluster at project B's Runner or
   * credential — and then read that Runner's name, liveness and status,
   * or that credential's name and type, through the relation join, and use
   * the FK as an existence oracle for foreign ids. Same class of guard as
   * MonitorProbeService ("Probe not found or it does not belong to this
   * project.") and IoTDeviceCredentialService.
   *
   * WHO may bind is decided before this runs (assertMayChangeAiAccess); this
   * only decides WHAT may be bound. Clearing a binding (null) is always
   * allowed.
   */
  @CaptureSpan()
  private async validateAiAccessBindingsBelongToProject(data: {
    data: JSONObject;
    projectId: ObjectID | undefined;
  }): Promise<void> {
    const runnerId: ObjectID | null = RelationIdUtil.readConsistent(
      data.data,
      AI_ACCESS_RUNNER_KEYS,
      "AI access Runner",
    );

    const credentialId: ObjectID | null = RelationIdUtil.readConsistent(
      data.data,
      AI_ACCESS_CREDENTIAL_KEYS,
      "AI access credential",
    );

    if (!runnerId && !credentialId) {
      return;
    }

    if (!data.projectId) {
      throw new BadDataException(
        "The project of this Kubernetes cluster could not be resolved, so its AI access Runner or credential cannot be checked.",
      );
    }

    if (runnerId) {
      const runner: Runner | null = await RunnerService.findOneBy({
        query: {
          _id: runnerId.toString(),
          projectId: data.projectId,
        },
        select: { _id: true },
        props: { isRoot: true },
      });

      if (!runner) {
        throw new BadDataException(
          "Runner not found or it does not belong to this project.",
        );
      }
    }

    if (credentialId) {
      const credential: RunbookCredential | null =
        await RunbookCredentialService.findOneBy({
          query: {
            _id: credentialId.toString(),
            projectId: data.projectId,
          },
          select: { _id: true, credentialType: true },
          props: { isRoot: true },
        });

      if (
        !credential ||
        credential.credentialType !== RunbookCredentialType.Kubernetes
      ) {
        throw new BadDataException(AI_ACCESS_CREDENTIAL_REFUSAL);
      }
    }
  }

  @CaptureSpan()
  private async getProjectIdsForUpdateQuery(
    updateBy: UpdateBy<Model>,
  ): Promise<Array<ObjectID>> {
    const clusters: Array<Model> = await this.findBy({
      query: updateBy.query,
      select: {
        projectId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const projectIds: Record<string, ObjectID> = {};

    for (const cluster of clusters) {
      if (cluster.projectId) {
        projectIds[cluster.projectId.toString()] = cluster.projectId;
      }
    }

    return Object.values(projectIds);
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    /*
     * Decided in onBeforeCreate, from the payload as the caller sent it: by
     * now the saved row carries the column defaults, which would read as an
     * AI access setting on every create.
     */
    if (
      createdItem.id &&
      (onCreate.carryForward as { writesAiAccessSettings?: boolean } | null)
        ?.writesAiAccessSettings === true
    ) {
      await this.markAiAccessConfigured([createdItem.id]);
    }

    if (createdItem.projectId && createdItem.id) {
      Promise.resolve()
        .then(async () => {
          await KubernetesClusterLabelRuleEngineService.applyRulesToKubernetesCluster(
            createdItem,
          );
        })
        .then(async () => {
          await KubernetesClusterOwnerRuleEngineService.applyRulesToKubernetesCluster(
            createdItem,
          );
        })
        .catch((error: Error) => {
          logger.error(
            `Error applying kubernetes cluster rules in KubernetesClusterService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              kubernetesClusterId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        });
    }
    /*
     * The overview page can say what this Kubernetes cluster looks like now; only
     * the feed can say why it exists at all - whether a person added it or
     * ingest registered it the first time telemetry named it. Fire and
     * forget: a feed write must never fail the create it describes.
     */
    this.writeKubernetesClusterCreatedFeed(createdItem, onCreate).catch(
      (error: Error) => {
        logger.error(error);
      },
    );

    return createdItem;
  }

  @CaptureSpan()
  public async findOrCreateByClusterIdentifier(data: {
    projectId: ObjectID;
    clusterIdentifier: string;
  }): Promise<Model> {
    /*
     * Look up case-insensitively. The unique guard on name/clusterIdentifier
     * (checkUniqueColumnBy -> findWithSameText) compares case-insensitively,
     * so a case-sensitive lookup would miss an existing row on casing drift
     * (k8s.cluster.name), then fail to create it ("KubernetesCluster with the
     * same name already exists") and wedge ingest. Mirrors
     * LabelService.findOrCreateLabelByName. Unlike HostService we keep the
     * stored casing as-is: k8s.cluster.name is not normalized at ingest, so
     * lowering the identifier here would desync it from the raw-cased
     * resource.k8s.cluster.name attribute the detail page filters on.
     */
    const existingCluster: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        clusterIdentifier: QueryHelper.findWithSameText(data.clusterIdentifier),
      },
      select: {
        _id: true,
        projectId: true,
        clusterIdentifier: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (existingCluster) {
      return existingCluster;
    }

    try {
      // Create new cluster
      const newCluster: Model = new Model();
      newCluster.projectId = data.projectId;
      newCluster.name = data.clusterIdentifier;
      newCluster.clusterIdentifier = data.clusterIdentifier;
      newCluster.otelCollectorStatus = "connected";
      newCluster.lastSeenAt = OneUptimeDate.getCurrentDate();

      const createdCluster: Model = await this.create({
        data: newCluster,
        props: {
          isRoot: true,
        },
      });

      return createdCluster;
    } catch {
      /*
       * Race condition: another request created the cluster concurrently.
       * Re-fetch the existing cluster.
       */
      const reFetchedCluster: Model | null = await this.findOneBy({
        query: {
          projectId: data.projectId,
          clusterIdentifier: QueryHelper.findWithSameText(
            data.clusterIdentifier,
          ),
        },
        select: {
          _id: true,
          projectId: true,
          clusterIdentifier: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (reFetchedCluster) {
        return reFetchedCluster;
      }

      throw new Error(
        "Failed to create or find cluster: " + data.clusterIdentifier,
      );
    }
  }

  @CaptureSpan()
  public async updateLastSeen(
    clusterId: ObjectID,
    extra?: {
      agentVersion?: string | undefined;
    },
  ): Promise<void> {
    const extrasFingerprint: string = crypto
      .createHash("sha1")
      .update(
        JSON.stringify({
          agentVersion: extra?.agentVersion ?? null,
        }),
      )
      .digest("hex");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const liveness: any = {
      lastSeenAt: OneUptimeDate.getCurrentDate(),
      otelCollectorStatus: "connected",
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metadata: any = {};

    if (extra?.agentVersion) {
      metadata.agentVersion = extra.agentVersion;
    }

    /*
     * One gated, non-blocking heartbeat write. The gates, the fail-open /
     * fail-closed split and the liveness-only fallback all live in
     * ResourceHeartbeat — see there for why this row's throttle used to
     * provide no throttling at all.
     */
    await ResourceHeartbeat.write({
      service: this,
      id: clusterId,
      cacheNamespace: LAST_SEEN_CACHE_NAMESPACE,
      throttleInSeconds: LAST_SEEN_THROTTLE_SECONDS,
      liveness: liveness,
      metadata: metadata,
      fingerprint: extrasFingerprint,
      describe: `kubernetes cluster ${clusterId.toString()}`,
    });
  }

  /**
   * Additively attach labels to a Kubernetes cluster. Existing labels
   * are never removed — manual labels set via the UI survive ingest.
   * The set of labelIds passed in is fingerprinted and cached for 60s
   * so the common case (steady-state collector pushing the same label
   * set every batch) costs one in-memory lookup, not a join-table
   * scan.
   */
  @CaptureSpan()
  public async attachLabels(data: {
    kubernetesClusterId: ObjectID;
    labelIds: Array<ObjectID>;
  }): Promise<void> {
    if (!data.labelIds || data.labelIds.length === 0) {
      return;
    }

    const cacheKey: string = data.kubernetesClusterId.toString();
    const fingerprint: string = fingerprintLabelIds(data.labelIds);
    const cached: string | null = await GlobalCache.getString(
      LABELS_APPLIED_CACHE_NAMESPACE,
      cacheKey,
    );
    if (cached === fingerprint) {
      return;
    }

    try {
      const clusterIdStr: string = data.kubernetesClusterId.toString();
      const existingLabels: Array<Label> = await this.getRepository()
        .createQueryBuilder()
        .relation(Model, "labels")
        .of(clusterIdStr)
        .loadMany();

      const existingIds: Set<string> = new Set();
      for (const lbl of existingLabels) {
        const idStr: string | undefined = lbl._id?.toString();
        if (idStr) {
          existingIds.add(idStr);
        }
      }

      const toAddIds: Array<string> = [];
      const seen: Set<string> = new Set();
      for (const id of data.labelIds) {
        const idStr: string = id.toString();
        if (existingIds.has(idStr) || seen.has(idStr)) {
          continue;
        }
        seen.add(idStr);
        toAddIds.push(idStr);
      }

      if (toAddIds.length > 0) {
        await this.getRepository()
          .createQueryBuilder()
          .relation(Model, "labels")
          .of(clusterIdStr)
          .add(toAddIds);
      }

      await GlobalCache.setString(
        LABELS_APPLIED_CACHE_NAMESPACE,
        cacheKey,
        fingerprint,
        { expiresInSeconds: LABELS_APPLIED_CACHE_TTL_SECONDS },
      );
    } catch (err) {
      logger.warn(
        `KubernetesClusterService.attachLabels failed for cluster ${data.kubernetesClusterId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  @CaptureSpan()
  public async markDisconnectedClusters(): Promise<void> {
    /*
     * Threshold must stay well above the 5-minute OTel ingest
     * maintenance fence (MAINTENANCE_FENCE_TTL_SECONDS in
     * OtelIngestBaseService) — lastSeenAt is legitimately up to
     * ~5 minutes stale during continuous telemetry, so a threshold
     * equal to the fence TTL flaps healthy resources. 15 minutes
     * gives 3x headroom.
     */
    const fifteenMinutesAgo: Date = OneUptimeDate.addRemoveMinutes(
      OneUptimeDate.getCurrentDate(),
      -15,
    );

    const connectedClusters: Array<Model> = await this.findBy({
      query: {
        otelCollectorStatus: "connected",
        lastSeenAt: QueryHelper.lessThan(fifteenMinutesAgo),
      },
      select: {
        _id: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const cluster of connectedClusters) {
      if (cluster._id) {
        await this.updateOneById({
          id: new ObjectID(cluster._id.toString()),
          data: {
            otelCollectorStatus: "disconnected",
          },
          props: {
            isRoot: true,
          },
        });
      }
    }
  }

  /**
   * Display name for this Kubernetes cluster, or an empty string when the row is
   * gone. Feed writers call this on a best-effort basis, so a missing row must
   * not throw and take the surrounding write down with it.
   */
  @CaptureSpan()
  public async getKubernetesClusterName(data: {
    kubernetesClusterId: ObjectID;
  }): Promise<string> {
    const kubernetesCluster: Model | null = await this.findOneById({
      id: data.kubernetesClusterId,
      select: {
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    return kubernetesCluster?.name || "";
  }

  @CaptureSpan()
  public async getKubernetesClusterLinkInDashboard(
    projectId: ObjectID,
    kubernetesClusterId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/kubernetes/${kubernetesClusterId.toString()}`,
    );
  }

  /**
   * "[Kubernetes Cluster prod-1](https://…)" - the form every feed item uses to
   * name the resource it is about.
   */
  @CaptureSpan()
  public async getKubernetesClusterMarkdownLink(
    projectId: ObjectID,
    kubernetesClusterId: ObjectID,
  ): Promise<string> {
    const name: string = await this.getKubernetesClusterName({
      kubernetesClusterId: kubernetesClusterId,
    });
    const link: URL = await this.getKubernetesClusterLinkInDashboard(
      projectId,
      kubernetesClusterId,
    );

    return `[Kubernetes Cluster ${name}](${link.toString()})`;
  }

  private async writeKubernetesClusterCreatedFeed(
    createdItem: Model,
    onCreate: OnCreate<Model>,
  ): Promise<void> {
    const projectId: ObjectID | undefined = createdItem.projectId;
    const kubernetesClusterId: ObjectID | undefined =
      createdItem.id || undefined;

    if (!projectId || !kubernetesClusterId) {
      return;
    }

    /*
     * Ingest creates these rows with root props and no acting user; every
     * dashboard, API and Terraform create carries one. That is the whole
     * signal for "was this discovered automatically or added by a person".
     */
    const createdByUserId: ObjectID | undefined =
      createdItem.createdByUserId ||
      onCreate.createBy.props.userId ||
      undefined;

    const markdown: {
      feedInfoInMarkdown: string;
      moreInformationInMarkdown: string;
    } = await ResourceFeedUtil.getCreatedFeedMarkdown({
      resourceTypeName: "Kubernetes cluster",
      resourceMarkdownLink: await this.getKubernetesClusterMarkdownLink(
        projectId,
        kubernetesClusterId,
      ),
      projectId: projectId,
      createdByUserId: createdByUserId,
      identifierName: "Cluster identifier",
      identifierValue: createdItem.clusterIdentifier,
      description: createdItem.description,
    });

    await KubernetesClusterFeedService.createKubernetesClusterFeedItem({
      kubernetesClusterId: kubernetesClusterId,
      projectId: projectId,
      kubernetesClusterFeedEventType:
        KubernetesClusterFeedEventType.KubernetesClusterCreated,
      displayColor: Green500,
      feedInfoInMarkdown: markdown.feedInfoInMarkdown,
      moreInformationInMarkdown: markdown.moreInformationInMarkdown,
      userId: createdByUserId,
    });
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const aiAccessWrite: AiAccessWriteCarryForward | null =
      getAiAccessWriteCarryForward(onUpdate.carryForward);

    /*
     * Awaited, unlike the feed: registration reads the marker to tell an
     * operator's "off" from a cluster nobody ever configured, so a save that
     * could not record it must not look like one that did.
     */
    if (aiAccessWrite && updatedItemIds.length > 0) {
      await this.markAiAccessConfigured(updatedItemIds);
    }

    this.writeKubernetesClusterUpdatedFeed(onUpdate, updatedItemIds).catch(
      (error: Error) => {
        logger.error(error);
      },
    );

    if (aiAccessWrite) {
      this.writeAiAccessSettingsChangedFeed({
        onUpdate,
        updatedItemIds,
        previousAiAccessSettings: aiAccessWrite.previousAiAccessSettings,
      }).catch((error: Error) => {
        logger.error(error);
      });
    }

    return onUpdate;
  }

  /*
   * Set aiAccessConfiguredAt on each cluster that does not have it yet, and
   * never touch one that does: the marker records when AI access was FIRST
   * configured. A server-only column (its update ACL is empty), so it is
   * written here, as root, after the operator's own write succeeded, rather
   * than slipped into that write.
   */
  @CaptureSpan()
  private async markAiAccessConfigured(
    clusterIds: Array<ObjectID>,
  ): Promise<void> {
    await this.updateBy({
      query: {
        _id: QueryHelper.any(clusterIds),
        aiAccessConfiguredAt: QueryHelper.isNull(),
      },
      data: {
        aiAccessConfiguredAt: OneUptimeDate.getCurrentDate(),
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * Who changed what OneUptime AI may do on a cluster, and when. The generic
   * "was updated" item only covers MEANINGFUL_UPDATE_COLUMNS (shared by ten
   * resource types and deliberately left alone), and the registration path
   * records only its own binds, so without this an operator switching a
   * production cluster to Bypass approval - or back off - left no trace.
   *
   * One item per cluster that actually changed; a save that re-posts
   * unchanged values (the AI page posts its whole form) records nothing.
   * API-key and Terraform writes carry no user and are attributed to an API
   * key rather than dropped.
   */
  private async writeAiAccessSettingsChangedFeed(data: {
    onUpdate: OnUpdate<Model>;
    updatedItemIds: Array<ObjectID>;
    previousAiAccessSettings: Record<string, AiAccessSettingsSnapshot>;
  }): Promise<void> {
    const updateData: JSONObject = (data.onUpdate.updateBy.data ||
      {}) as unknown as JSONObject;
    const updatedByUserId: ObjectID | undefined =
      data.onUpdate.updateBy.props.userId || undefined;

    for (const kubernetesClusterId of data.updatedItemIds) {
      const previous: AiAccessSettingsSnapshot | undefined =
        data.previousAiAccessSettings[kubernetesClusterId.toString()];

      const changes: Array<string> = await this.describeAiAccessChanges(
        updateData,
        previous,
      );

      if (changes.length === 0) {
        continue;
      }

      const projectId: ObjectID | undefined =
        previous?.projectId ||
        (
          await this.findOneById({
            id: kubernetesClusterId,
            select: { projectId: true },
            props: { isRoot: true },
          })
        )?.projectId;

      if (!projectId) {
        continue;
      }

      const userMarkdown: string = updatedByUserId
        ? (await UserService.getUserMarkdownString({
            userId: updatedByUserId,
            projectId,
          })) || "A user"
        : "";

      const actor: string = userMarkdown ? `**${userMarkdown}**` : "An API key";

      /*
       * Yellow when the change lets AI do more (the same test the permission
       * check applies), grey when it tightens or only flips investigation.
       */
      const displayColor: Color = this.getAiAccessLoosening(
        updateData,
        previous || NEVER_CONFIGURED_AI_ACCESS,
      ).loosens
        ? Yellow500
        : Gray500;

      const moreInformation: Array<string> = [
        `**Changed by**: ${userMarkdown || "An API key (no user)"}`,
      ];

      const allowlist: unknown = updateData["aiKubectlCommandAllowlist"];

      if (Array.isArray(allowlist) && allowlist.length > 0) {
        moreInformation.push(
          `**kubectl allowlist**:\n\n${allowlist
            .map((pattern: string) => {
              return `- \`${pattern.replace(/`/g, "'")}\``;
            })
            .join("\n")}`,
        );
      }

      await KubernetesClusterFeedService.createKubernetesClusterFeedItem({
        kubernetesClusterId,
        projectId,
        kubernetesClusterFeedEventType:
          KubernetesClusterFeedEventType.KubernetesClusterUpdated,
        displayColor,
        feedInfoInMarkdown: `🤖 ${actor} changed what OneUptime AI may do on ${await this.getKubernetesClusterMarkdownLink(
          projectId,
          kubernetesClusterId,
        )}:\n\n${changes
          .map((change: string) => {
            return `- ${change}`;
          })
          .join("\n")}`,
        moreInformationInMarkdown: moreInformation.join("\n\n"),
        userId: updatedByUserId,
      });
    }
  }

  /*
   * One line per AI access setting this write actually changed, old -> new.
   * With no `previous` (the cluster was not among those read before the
   * write) every written setting is reported as set, without a "from".
   *
   * A credential is reported without its name: the feed is readable by
   * everyone who may read the cluster, credentials only by those who may
   * read credentials.
   */
  private async describeAiAccessChanges(
    updateData: JSONObject,
    previous: AiAccessSettingsSnapshot | undefined,
  ): Promise<Array<string>> {
    const changes: Array<string> = [];

    if (updateData["isAiInvestigationEnabled"] !== undefined) {
      const isEnabled: boolean =
        updateData["isAiInvestigationEnabled"] === true;

      if (!previous || previous.isAiInvestigationEnabled !== isEnabled) {
        changes.push(
          `AI investigation with kubectl turned **${isEnabled ? "on" : "off"}**`,
        );
      }
    }

    if (updateData["aiRemediationMode"] !== undefined) {
      const mode: KubernetesAiRemediationMode = readStoredRemediationMode(
        updateData["aiRemediationMode"],
      );

      if (!previous) {
        changes.push(
          `AI remediation set to **${REMEDIATION_MODE_FEED_LABELS[mode]}**`,
        );
      } else if (previous.aiRemediationMode !== mode) {
        changes.push(
          `AI remediation changed from **${
            REMEDIATION_MODE_FEED_LABELS[previous.aiRemediationMode]
          }** to **${REMEDIATION_MODE_FEED_LABELS[mode]}**`,
        );
      }
    }

    if (updateData["aiKubectlCommandAllowlist"] !== undefined) {
      const patterns: Array<string> = readStoredKubectlAllowlist(
        updateData["aiKubectlCommandAllowlist"],
      );

      if (
        !previous ||
        !isSameKubectlAllowlist(previous.aiKubectlCommandAllowlist, patterns)
      ) {
        changes.push(
          patterns.length === 0
            ? "kubectl allowlist cleared"
            : `kubectl allowlist changed to ${describePatternCount(
                patterns.length,
              )}${
                previous
                  ? ` (was ${describePatternCount(
                      previous.aiKubectlCommandAllowlist.length,
                    )})`
                  : ""
              }`,
        );
      }
    }

    if (isAnyKeyWritten(updateData, AI_ACCESS_RUNNER_KEYS)) {
      const runnerId: ObjectID | null = RelationIdUtil.readConsistent(
        updateData,
        AI_ACCESS_RUNNER_KEYS,
        "AI access Runner",
      );

      if (
        !previous ||
        previous.aiAccessRunnerId !== (runnerId?.toString() || null)
      ) {
        if (runnerId) {
          const runner: Runner | null = await RunnerService.findOneById({
            id: runnerId,
            select: { name: true },
            props: { isRoot: true },
          });

          changes.push(
            `Runner **${runner?.name || runnerId.toString()}** bound to run kubectl`,
          );
        } else {
          changes.push("Runner cleared, so AI runs no kubectl on this cluster");
        }
      }
    }

    if (isAnyKeyWritten(updateData, AI_ACCESS_CREDENTIAL_KEYS)) {
      const credentialId: ObjectID | null = RelationIdUtil.readConsistent(
        updateData,
        AI_ACCESS_CREDENTIAL_KEYS,
        "AI access credential",
      );

      if (
        !previous ||
        previous.aiAccessCredentialId !== (credentialId?.toString() || null)
      ) {
        changes.push(
          credentialId
            ? previous?.aiAccessCredentialId
              ? "Kubernetes credential changed"
              : "Kubernetes credential bound"
            : "Kubernetes credential cleared",
        );
      }
    }

    return changes;
  }

  private async writeKubernetesClusterUpdatedFeed(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<void> {
    const updateData: JSONObject = onUpdate.updateBy
      .data as unknown as JSONObject;

    /*
     * Heartbeats update lastSeenAt / otelCollectorStatus / agentVersion and the
     * rollup counters constantly. Only the columns a person would recognise as
     * a change earn a feed item - see MEANINGFUL_UPDATE_COLUMNS.
     */
    const changedColumns: Array<string> =
      ResourceFeedUtil.getUpdatedColumnsWorthRecording(updateData);

    if (changedColumns.length === 0 || updatedItemIds.length === 0) {
      return;
    }

    const isArchiveChange: boolean =
      ResourceFeedUtil.isArchiveChange(updateData);
    const isArchived: boolean = Boolean(updateData["isArchived"]);
    const otherColumns: Array<string> = changedColumns.filter(
      (column: string) => {
        return column !== "isArchived";
      },
    );

    const updatedByUserId: ObjectID | undefined =
      onUpdate.updateBy.props.userId || undefined;

    for (const kubernetesClusterId of updatedItemIds) {
      const kubernetesCluster: Model | null = await this.findOneById({
        id: kubernetesClusterId,
        select: {
          projectId: true,
        },
        props: {
          isRoot: true,
        },
      });

      const projectId: ObjectID | undefined = kubernetesCluster?.projectId;

      if (!projectId) {
        continue;
      }

      const resourceMarkdownLink: string =
        await this.getKubernetesClusterMarkdownLink(
          projectId,
          kubernetesClusterId,
        );

      if (isArchiveChange) {
        await KubernetesClusterFeedService.createKubernetesClusterFeedItem({
          kubernetesClusterId: kubernetesClusterId,
          projectId: projectId,
          kubernetesClusterFeedEventType: isArchived
            ? KubernetesClusterFeedEventType.KubernetesClusterArchived
            : KubernetesClusterFeedEventType.KubernetesClusterRestored,
          displayColor: isArchived ? Yellow500 : Blue500,
          feedInfoInMarkdown: isArchived
            ? `🗄️ ${resourceMarkdownLink} was archived.`
            : `♻️ ${resourceMarkdownLink} was restored from the archive.`,
          userId: updatedByUserId,
        });
      }

      if (otherColumns.length > 0) {
        const markdown: {
          feedInfoInMarkdown: string;
          moreInformationInMarkdown: string;
        } = ResourceFeedUtil.getUpdatedFeedMarkdown({
          resourceMarkdownLink: resourceMarkdownLink,
          columns: otherColumns,
        });

        await KubernetesClusterFeedService.createKubernetesClusterFeedItem({
          kubernetesClusterId: kubernetesClusterId,
          projectId: projectId,
          kubernetesClusterFeedEventType:
            KubernetesClusterFeedEventType.KubernetesClusterUpdated,
          displayColor: Gray500,
          feedInfoInMarkdown: markdown.feedInfoInMarkdown,
          moreInformationInMarkdown: markdown.moreInformationInMarkdown,
          userId: updatedByUserId,
        });
      }
    }
  }
}

function fingerprintLabelIds(labelIds: Array<ObjectID>): string {
  const sorted: Array<string> = labelIds
    .map((id: ObjectID) => {
      return id.toString();
    })
    .sort();
  return crypto.createHash("sha1").update(sorted.join(",")).digest("hex");
}

// Undefined is an omitted property; null is an explicit clear, so a write.
function isAnyKeyWritten(data: JSONObject, keys: Array<string>): boolean {
  return keys.some((key: string) => {
    return data[key] !== undefined;
  });
}

function getAiAccessWriteCarryForward(
  carryForward: unknown,
): AiAccessWriteCarryForward | null {
  if (
    carryForward &&
    typeof carryForward === "object" &&
    "previousAiAccessSettings" in carryForward
  ) {
    return carryForward as AiAccessWriteCarryForward;
  }

  return null;
}

// A stored mode as the readers see it: anything unknown is Disabled.
function readStoredRemediationMode(
  value: unknown,
): KubernetesAiRemediationMode {
  return Object.values(KubernetesAiRemediationMode).includes(
    value as KubernetesAiRemediationMode,
  )
    ? (value as KubernetesAiRemediationMode)
    : KubernetesAiRemediationMode.Disabled;
}

/*
 * A stored allowlist as the readers see it (KubernetesClusterAiAccessService
 * .normalizeAllowlist, which this module cannot import without a cycle):
 * trimmed non-empty strings, a JSON-encoded array accepted, anything else
 * empty. Rows written before the write-side validation existed may hold any
 * of those shapes.
 */
function readStoredKubectlAllowlist(value: unknown): Array<string> {
  let raw: unknown = value;

  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = [value];
    }
  }

  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter((pattern: unknown) => {
      return typeof pattern === "string" && pattern.trim().length > 0;
    })
    .map((pattern: string) => {
      return pattern.trim();
    });
}

/*
 * What an operator's allowlist write stores: null (no allowlist) or an array
 * of trimmed patterns the matcher can actually use. Refused, with the entry
 * and the rule it broke:
 *
 * - anything but an array (a JSON-encoded array in a string is accepted, the
 *   form the readers already understand, and stored as the array);
 * - an entry that is not text, or is empty once trimmed;
 * - more than MAX_KUBECTL_ALLOWLIST_PATTERNS entries, or an entry longer than
 *   MAX_KUBECTL_ALLOWLIST_PATTERN_LENGTH — the matcher skips those silently;
 * - an entry that cannot match any command: the matcher compares against
 *   the full rendered command, which always starts with "kubectl", so a
 *   pattern must start with "kubectl " or with a "*" wildcard.
 */
export function normalizeKubectlAllowlistForWrite(
  value: unknown,
): Array<string> | null {
  let raw: unknown = value;

  if (raw === null) {
    return null;
  }

  if (typeof raw === "string") {
    if (raw.trim().length === 0) {
      return null;
    }

    try {
      raw = JSON.parse(raw);
    } catch {
      throw new BadDataException(KUBECTL_ALLOWLIST_SHAPE_HINT);
    }
  }

  if (!Array.isArray(raw)) {
    throw new BadDataException(KUBECTL_ALLOWLIST_SHAPE_HINT);
  }

  if (raw.length > MAX_KUBECTL_ALLOWLIST_PATTERNS) {
    throw new BadDataException(
      `The kubectl allowlist can hold at most ${MAX_KUBECTL_ALLOWLIST_PATTERNS} patterns (got ${raw.length}).`,
    );
  }

  return raw.map((entry: unknown, index: number): string => {
    const position: string = `Pattern ${index + 1} of the kubectl allowlist`;

    if (typeof entry !== "string") {
      throw new BadDataException(
        `${position} must be text (got ${entry === null ? "null" : typeof entry}). ${KUBECTL_ALLOWLIST_SHAPE_HINT}`,
      );
    }

    const pattern: string = entry.trim();

    if (pattern.length === 0) {
      throw new BadDataException(`${position} is empty.`);
    }

    if (pattern.length > MAX_KUBECTL_ALLOWLIST_PATTERN_LENGTH) {
      throw new BadDataException(
        `${position} is ${pattern.length} characters long; the most is ${MAX_KUBECTL_ALLOWLIST_PATTERN_LENGTH}.`,
      );
    }

    const collapsed: string = pattern.replace(/\s+/g, " ");

    if (!collapsed.startsWith("kubectl ") && !collapsed.startsWith("*")) {
      throw new BadDataException(
        `${position} ("${pattern}") must start with "kubectl " or with a * wildcard: patterns are matched against the whole command, which always starts with kubectl.`,
      );
    }

    return pattern;
  });
}

function isSameKubectlAllowlist(
  left: Array<string>,
  right: Array<string>,
): boolean {
  return (
    left.length === right.length &&
    left.every((pattern: string, index: number) => {
      return pattern === right[index];
    })
  );
}

function describePatternCount(count: number): string {
  if (count === 0) {
    return "none";
  }

  return `${count} pattern${count === 1 ? "" : "s"}`;
}

export default new Service();
