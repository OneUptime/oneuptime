import DatabaseService from "../../../Services/DatabaseService";
import ResourceAiAgentService from "../../../Services/ResourceAiAgentService";
import UserService from "../../../Services/UserService";
import CreateBy from "../../../Types/Database/CreateBy";
import { OnUpdate } from "../../../Types/Database/Hooks";
import QueryHelper from "../../../Types/Database/QueryHelper";
import UpdateBy from "../../../Types/Database/UpdateBy";
import logger from "../../Logger";
import { holdsAnyPermission } from "../../Runbook/RunbookExecutePermission";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  RESOURCE_AI_ACCESS_ADMIN_PERMISSIONS,
  RESOURCE_AI_ALLOWLIST_EXAMPLES,
  RESOURCE_AI_REMEDIATION_MODE_LABELS,
  getResourceAiAccessAdminRefusal,
  getResourceSentenceName,
} from "../../../../Types/AI/ResourceAiAccessPermissions";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { Gray500, Yellow500 } from "../../../../Types/BrandColors";
import Color from "../../../../Types/Color";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../../Types/Date";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
} from "../../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceAiRemediationMode } from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import ResourceCommandPolicy, {
  RESOURCE_ALLOWLIST_MAX_PATTERNS,
} from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicy";
import {
  AI_FIXES_ENV,
  AI_INVESTIGATION_ENV,
  AgentAiSettingsSource,
  isAgentAiSettingsSourceAgent,
} from "../../../../Types/AI/AgentAiSettings";

/*
 * The rules for an operator's write of a resource's OneUptime AI access
 * settings — shared by every resource a resource AI agent serves (Docker,
 * Podman and Docker Swarm hosts, Proxmox clusters, VMware vCenters, Ceph
 * clusters, database servers and hosts), whose services call it from their
 * create and update hooks. The same rules KubernetesClusterService applies
 * to a cluster (getAiAccessLoosening and friends), minus the Runner and
 * credential bindings a resource AI agent never has:
 *
 * - validation: the remediation mode must be a ResourceAiRemediationMode
 *   value, and the command allowlist a list of at most
 *   RESOURCE_ALLOWLIST_MAX_PATTERNS entries that
 *   ResourceCommandPolicy.describeAllowlistPatternProblem accepts for the
 *   resource's type (the ONE definition of a valid entry, which the matcher
 *   and the dashboard share). Refused rather than stored: every reader fails
 *   safe on an unusable value, so storing one would answer an API or
 *   Terraform write with success for a setting that never takes effect;
 * - who may make AI do MORE (any move of the mode up — Off to anything, up to
 *   Automatic or Bypass approval — or adding an allowlist pattern): the
 *   holders of RESOURCE_AI_ACCESS_ADMIN_PERMISSIONS, the people who may
 *   author a FullAuto auto-remediation rule. Making AI do less, and the
 *   investigation switch, stay open to every editor of the resource;
 * - the aiAccess* columns (aiAccessConfiguredAt, aiAccessLastVerifiedAt,
 *   aiAccessLastError) are the server's own and refused on every write but
 *   the server's (root);
 * - after an operator's write of any AI setting succeeded: the resource is
 *   marked AI-configured (aiAccessConfiguredAt, never cleared — a resource
 *   AI agent registering later then leaves every setting as chosen) and the
 *   change is recorded on the resource's feed.
 *
 * Root writes — an agent's first-connection defaults, the outcome
 * bookkeeping after each command — are the server's own and are validated
 * but never gated, marked or recorded here.
 */

// Every AI access setting an operator can write (dashboard, API, Terraform).
export const RESOURCE_AI_ACCESS_SETTING_KEYS: ReadonlyArray<string> = [
  "isAiInvestigationEnabled",
  "aiRemediationMode",
  "aiCommandAllowlist",
];

// Written only by the server: refused on every write that is not root.
export const RESOURCE_AI_ACCESS_SERVER_ONLY_KEYS: ReadonlyArray<string> = [
  "aiAccessConfiguredAt",
  "aiAccessLastVerifiedAt",
  "aiAccessLastError",
];

/*
 * How much each remediation mode lets OneUptime AI do without a human,
 * least first. Automatic runs a strict subset of what Bypass approval runs
 * (safe changes and allowlisted shapes, never an unlisted riskier change),
 * so moving from Bypass approval to Automatic is a tightening.
 */
export const RESOURCE_REMEDIATION_MODES_BY_AUTONOMY: ReadonlyArray<ResourceAiRemediationMode> =
  [
    ResourceAiRemediationMode.Disabled,
    ResourceAiRemediationMode.RequireApproval,
    ResourceAiRemediationMode.Automatic,
    ResourceAiRemediationMode.BypassApproval,
  ];

/*
 * A resource's AI access settings as they stood before an operator's
 * write: the baseline "does this write loosen anything?" is decided
 * against, and the "before" half of the feed item that records the change.
 * Normalized the way the readers normalize them (an unknown mode is
 * Disabled, an unusable allowlist is empty), because that is what was in
 * effect.
 */
export interface ResourceAiAccessSettingsSnapshot {
  projectId?: ObjectID | undefined;
  isAiInvestigationEnabled: boolean;
  aiRemediationMode: ResourceAiRemediationMode;
  aiCommandAllowlist: Array<string>;
  /*
   * When an operator first chose AI settings for the resource (null:
   * never). The agent's defaults decide only while it is null.
   */
  aiAccessConfiguredAt?: Date | null | undefined;
  /*
   * Where investigation and fixes are set, as the write found it: while the
   * agent sets them, an operator's change to either is refused, and the
   * write marks nothing configured (it chose neither).
   */
  aiSettingsSource?: AgentAiSettingsSource | undefined;
}

/*
 * The two settings a resource's AI agent sets once its configuration (or,
 * on a resource nobody configured, its defaults) decides them. The
 * allowlist stays OneUptime's.
 */
export const AGENT_SET_RESOURCE_AI_ACCESS_KEYS: ReadonlyArray<string> = [
  "isAiInvestigationEnabled",
  "aiRemediationMode",
];

/*
 * The refusal for a change to a setting a resource's AI agent sets: where
 * it is set instead, and where the instructions are.
 */
export function getAgentSetResourceAiAccessRefusal(data: {
  resourceType: AiResourceType;
  source: AgentAiSettingsSource;
}): string {
  const name: string = getResourceSentenceName(data.resourceType);
  const agentName: string =
    AI_RESOURCE_TYPE_INFO[data.resourceType]?.agentDisplayName || "AI agent";

  return `What OneUptime AI may do on this ${name} is set by its ${agentName}${
    data.source === "agent_defaults"
      ? ` (its defaults: neither ${AI_INVESTIGATION_ENV} nor ${AI_FIXES_ENV} is set where it runs)`
      : "'s configuration"
  }, so AI investigation and fixes cannot be changed here. Set ${AI_INVESTIGATION_ENV} and ${AI_FIXES_ENV} where the agent runs instead; the ${name}'s AI agent page shows how for each option.`;
}

/*
 * What a resource that was never AI-configured has: the column defaults
 * (investigation on, remediation Disabled, no allowlist), the same as a
 * Kubernetes cluster's.
 */
export const NEVER_CONFIGURED_RESOURCE_AI_ACCESS: Readonly<ResourceAiAccessSettingsSnapshot> =
  {
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.Disabled,
    aiCommandAllowlist: [],
  };

/*
 * Handed from a resource service's onBeforeUpdate to its onUpdateSuccess
 * for an operator's write of an AI access setting, keyed by resource id.
 * Its presence is the signal that the write must mark the resource
 * configured and be recorded on its feed — both happen only after the
 * update succeeded.
 */
export interface ResourceAiAccessWriteCarryForward {
  resourceType: AiResourceType;
  previousResourceAiAccessSettings: Record<
    string,
    ResourceAiAccessSettingsSnapshot
  >;
}

// What an operator's write would do to one resource's AI access.
export interface ResourceAiAccessLoosening {
  loosens: boolean;
}

// One "AI access settings changed" item for a resource's feed.
export interface ResourceAiAccessFeedItem {
  resourceId: ObjectID;
  projectId: ObjectID;
  displayColor: Color;
  feedInfoInMarkdown: string;
  moreInformationInMarkdown: string;
  userId?: ObjectID | undefined;
}

// The columns the settings snapshot reads off a resource row.
const SETTINGS_SELECT: Record<string, boolean> = {
  _id: true,
  projectId: true,
  isAiInvestigationEnabled: true,
  aiRemediationMode: true,
  aiCommandAllowlist: true,
  aiAccessConfiguredAt: true,
};

// Undefined is an omitted property; null is an explicit clear, so a write.
function isAnyKeyWritten(
  data: JSONObject,
  keys: ReadonlyArray<string>,
): boolean {
  return keys.some((key: string): boolean => {
    return data[key] !== undefined;
  });
}

function describePatternCount(count: number): string {
  if (count === 0) {
    return "none";
  }

  return `${count} pattern${count === 1 ? "" : "s"}`;
}

function isSameAllowlist(left: Array<string>, right: Array<string>): boolean {
  return (
    left.length === right.length &&
    left.every((pattern: string, index: number): boolean => {
      return pattern === right[index];
    })
  );
}

export default class ResourceAiAccessSettings {
  // Whether a write carries any AI access setting (null counts: it clears).
  public static isSettingWritten(data: JSONObject): boolean {
    return isAnyKeyWritten(data, RESOURCE_AI_ACCESS_SETTING_KEYS);
  }

  /*
   * Why a write that is not the server's may not carry one of the aiAccess*
   * columns, or null when it carries none. The column ACLs already refuse
   * them to every role; this also covers the callers those checks let
   * through (a master admin, an API that skips them), because a hand-set
   * aiAccessConfiguredAt would make an agent skip its first-connection
   * defaults and a hand-set "Last verified" would claim access nobody saw
   * work.
   */
  public static getServerOnlyColumnRefusal(data: JSONObject): string | null {
    const written: Array<string> = RESOURCE_AI_ACCESS_SERVER_ONLY_KEYS.filter(
      (key: string): boolean => {
        return data[key] !== undefined;
      },
    );

    if (written.length === 0) {
      return null;
    }

    return `${written.join(", ")} ${
      written.length === 1 ? "is" : "are"
    } written by OneUptime itself and cannot be set through the API.`;
  }

  // A mode as the readers see it: anything unknown is Disabled.
  public static readStoredMode(value: unknown): ResourceAiRemediationMode {
    return RESOURCE_REMEDIATION_MODES_BY_AUTONOMY.includes(
      value as ResourceAiRemediationMode,
    )
      ? (value as ResourceAiRemediationMode)
      : ResourceAiRemediationMode.Disabled;
  }

  /*
   * A stored allowlist as the readers see it: trimmed non-empty strings, a
   * JSON-encoded array accepted, anything else empty.
   */
  public static readStoredAllowlist(value: unknown): Array<string> {
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
      .filter((pattern: unknown): boolean => {
        return typeof pattern === "string" && pattern.trim().length > 0;
      })
      .map((pattern: string): string => {
        return pattern.trim();
      });
  }

  public static getAllowlistShapeHint(resourceType: AiResourceType): string {
    const programs: string = (
      AI_RESOURCE_TYPE_INFO[resourceType]?.programs || []
    ).join(", ");

    return `The AI command allowlist must be a JSON array of command patterns for this ${getResourceSentenceName(
      resourceType,
    )}'s AI agent (${programs}), for example ["${
      RESOURCE_AI_ALLOWLIST_EXAMPLES[resourceType] || ""
    }"].`;
  }

  /*
   * What an operator's allowlist write stores: null (no allowlist) or an
   * array of trimmed patterns the matcher can actually use. Refused, with the
   * entry and the rule it broke:
   *
   * - anything but an array (a JSON-encoded array in a string is accepted,
   *   the form the readers already understand, and stored as the array);
   * - an entry that is not text;
   * - more than RESOURCE_ALLOWLIST_MAX_PATTERNS entries — the matcher skips
   *   every pattern past that silently;
   * - an entry ResourceCommandPolicy.describeAllowlistPatternProblem says
   *   can never pre-approve a change on this resource type (blank, too long,
   *   not one command, another program, a read, a Denied command, ...).
   */
  public static normalizeAllowlistForWrite(data: {
    resourceType: AiResourceType;
    value: unknown;
  }): Array<string> | null {
    let raw: unknown = data.value;

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
        throw new BadDataException(
          ResourceAiAccessSettings.getAllowlistShapeHint(data.resourceType),
        );
      }
    }

    if (!Array.isArray(raw)) {
      throw new BadDataException(
        ResourceAiAccessSettings.getAllowlistShapeHint(data.resourceType),
      );
    }

    if (raw.length > RESOURCE_ALLOWLIST_MAX_PATTERNS) {
      throw new BadDataException(
        `The AI command allowlist can hold at most ${RESOURCE_ALLOWLIST_MAX_PATTERNS} patterns (got ${raw.length}).`,
      );
    }

    return raw.map((entry: unknown, index: number): string => {
      const position: string = `Pattern ${index + 1} of the AI command allowlist`;

      if (typeof entry !== "string") {
        throw new BadDataException(
          `${position} must be text (got ${
            entry === null ? "null" : typeof entry
          }). ${ResourceAiAccessSettings.getAllowlistShapeHint(
            data.resourceType,
          )}`,
        );
      }

      // Stored trimmed, so it is judged exactly as it will be read.
      const pattern: string = entry.trim();

      const problem: string | null =
        ResourceCommandPolicy.describeAllowlistPatternProblem({
          resourceType: data.resourceType,
          pattern,
        });

      if (problem) {
        throw new BadDataException(
          `${position} cannot be used: ${
            problem.endsWith(".") ? problem : `${problem}.`
          } Patterns are compared with the command word by word; * stands for exactly one whole word.`,
        );
      }

      return pattern;
    });
  }

  /*
   * Refuse an unknown mode and store the allowlist in the one shape its
   * readers expect. Runs on every write, the server's included, and
   * normalizes `data` in place.
   */
  public static validateSettings(data: {
    resourceType: AiResourceType;
    data: JSONObject;
  }): void {
    const mode: unknown = data.data["aiRemediationMode"];

    if (
      mode !== undefined &&
      !RESOURCE_REMEDIATION_MODES_BY_AUTONOMY.includes(
        mode as ResourceAiRemediationMode,
      )
    ) {
      throw new BadDataException(
        `AI remediation mode must be one of ${RESOURCE_REMEDIATION_MODES_BY_AUTONOMY.join(
          ", ",
        )} (got ${JSON.stringify(mode)}).`,
      );
    }

    if (data.data["aiCommandAllowlist"] !== undefined) {
      data.data["aiCommandAllowlist"] =
        ResourceAiAccessSettings.normalizeAllowlistForWrite({
          resourceType: data.resourceType,
          value: data.data["aiCommandAllowlist"],
        });
    }
  }

  /*
   * Does this write let AI do more on a resource whose settings are
   * `current`? Only a real change counts: the AI agent page posts every
   * field of its form, so an editor who only flips the investigation switch
   * re-posts an unchanged mode and allowlist, and must not be refused for
   * settings someone else chose.
   *
   * - mode: ANY move up — turning fixes on from Off (even to Ask for
   *   approval: that is the step that lets AI change the resource at all),
   *   or up to Automatic or Bypass approval. Moving down (Bypass approval ->
   *   Automatic, anything -> Off) tightens;
   * - allowlist: adding a pattern the resource did not already have
   *   (removing patterns, or clearing the list, tightens).
   *
   * `data` has been through validateSettings, so the mode is a known value
   * and the allowlist a trimmed array or null.
   */
  public static getLoosening(data: {
    data: JSONObject;
    current: ResourceAiAccessSettingsSnapshot;
  }): ResourceAiAccessLoosening {
    let loosens: boolean = false;

    const mode: unknown = data.data["aiRemediationMode"];

    if (
      mode !== undefined &&
      mode !== null &&
      RESOURCE_REMEDIATION_MODES_BY_AUTONOMY.indexOf(
        ResourceAiAccessSettings.readStoredMode(mode),
      ) >
        RESOURCE_REMEDIATION_MODES_BY_AUTONOMY.indexOf(
          data.current.aiRemediationMode,
        )
    ) {
      loosens = true;
    }

    if (data.data["aiCommandAllowlist"] !== undefined) {
      const patterns: Array<string> =
        ResourceAiAccessSettings.readStoredAllowlist(
          data.data["aiCommandAllowlist"],
        );

      if (
        patterns.some((pattern: string): boolean => {
          return !data.current.aiCommandAllowlist.includes(pattern);
        })
      ) {
        loosens = true;
      }
    }

    return { loosens };
  }

  /*
   * Why this caller may not make this write, or null when they may. A
   * resource's AI mode does the job of a FullAuto AutoRemediationRule with
   * no rule row, so making AI do MORE takes the same permissions as
   * authoring such a rule (RESOURCE_AI_ACCESS_ADMIN_PERMISSIONS). The
   * column ACLs stay open to every editor of the resource on purpose: a
   * column ACL cannot say "tightening is free", and turning AI remediation
   * off must never need more than editing the resource.
   *
   * `current` holds the settings of every resource the write reaches, and
   * the permission must be held in each one's own project. When it matched
   * none, the write is judged against the never-configured defaults in the
   * caller's tenant, so the answer does not depend on whether the id exists;
   * with no project to check against at all it fails closed.
   *
   * Root and master admins are the caller's business (see checkUpdate).
   */
  public static getLooseningRefusal(data: {
    resourceType: AiResourceType;
    data: JSONObject;
    props: DatabaseCommonInteractionProps;
    current: Array<ResourceAiAccessSettingsSnapshot>;
  }): string | null {
    const baselines: Array<ResourceAiAccessSettingsSnapshot> =
      data.current.length > 0
        ? data.current
        : [
            {
              ...NEVER_CONFIGURED_RESOURCE_AI_ACCESS,
              projectId: data.props.tenantId,
            },
          ];

    for (const baseline of baselines) {
      if (
        !ResourceAiAccessSettings.getLoosening({
          data: data.data,
          current: baseline,
        }).loosens
      ) {
        continue;
      }

      if (
        !baseline.projectId ||
        !holdsAnyPermission({
          props: data.props,
          projectId: baseline.projectId,
          allowed: RESOURCE_AI_ACCESS_ADMIN_PERMISSIONS,
        })
      ) {
        return getResourceAiAccessAdminRefusal(data.resourceType);
      }
    }

    return null;
  }

  /*
   * The whole update-hook rule, for a resource service's onBeforeUpdate:
   * validate (every caller), refuse the server-only columns and gate a
   * loosening (every caller but root; a master admin is not gated on who
   * may loosen, as on a Kubernetes cluster). Returns the carry-forward for
   * onUpdateSuccess — the settings as they stood — for an operator's write
   * of an AI setting, else null.
   */
  @CaptureSpan()
  public static async checkUpdate<TBaseModel extends BaseModel>(data: {
    resourceType: AiResourceType;
    service: DatabaseService<TBaseModel>;
    updateBy: UpdateBy<TBaseModel>;
  }): Promise<ResourceAiAccessWriteCarryForward | null> {
    const updateData: JSONObject = (data.updateBy.data ||
      {}) as unknown as JSONObject;

    ResourceAiAccessSettings.validateSettings({
      resourceType: data.resourceType,
      data: updateData,
    });

    if (data.updateBy.props.isRoot) {
      return null;
    }

    const serverOnlyRefusal: string | null =
      ResourceAiAccessSettings.getServerOnlyColumnRefusal(updateData);

    if (serverOnlyRefusal) {
      throw new NotAuthorizedException(serverOnlyRefusal);
    }

    if (!ResourceAiAccessSettings.isSettingWritten(updateData)) {
      return null;
    }

    const previousResourceAiAccessSettings: Record<
      string,
      ResourceAiAccessSettingsSnapshot
    > = await ResourceAiAccessSettings.readSettingsForUpdateQuery({
      service: data.service,
      updateBy: data.updateBy,
    });

    /*
     * Investigation and fixes are the agent's while it sets them: a change
     * to either is refused for everyone but the server itself, master
     * admins included — it is where the setting lives, not who may change
     * it. Re-posting the value the resource has is no change and passes.
     */
    await ResourceAiAccessSettings.readAiSettingsSources({
      resourceType: data.resourceType,
      settings: previousResourceAiAccessSettings,
    });

    const agentSetRefusal: string | null =
      ResourceAiAccessSettings.getAgentSetSettingsRefusal({
        resourceType: data.resourceType,
        data: updateData,
        current: Object.values(previousResourceAiAccessSettings),
      });

    if (agentSetRefusal) {
      throw new BadDataException(agentSetRefusal);
    }

    if (!data.updateBy.props.isMasterAdmin) {
      const refusal: string | null =
        ResourceAiAccessSettings.getLooseningRefusal({
          resourceType: data.resourceType,
          data: updateData,
          props: data.updateBy.props,
          current: Object.values(previousResourceAiAccessSettings),
        });

      if (refusal) {
        throw new NotAuthorizedException(refusal);
      }
    }

    return {
      resourceType: data.resourceType,
      previousResourceAiAccessSettings,
    };
  }

  /*
   * Fill in aiSettingsSource on each snapshot: one read of the resources'
   * agent rows per project. Fails closed: when the sources cannot be read,
   * every resource is treated as set by its agent's configuration, so a
   * change to investigation or fixes is refused rather than slipping past
   * the agent.
   */
  public static async readAiSettingsSources(data: {
    resourceType: AiResourceType;
    settings: Record<string, ResourceAiAccessSettingsSnapshot>;
  }): Promise<void> {
    const byProject: Map<string, Array<string>> = new Map<
      string,
      Array<string>
    >();

    for (const [resourceId, snapshot] of Object.entries(data.settings)) {
      const projectId: string = snapshot.projectId?.toString() || "";
      const ids: Array<string> = byProject.get(projectId) || [];
      ids.push(resourceId);
      byProject.set(projectId, ids);
    }

    for (const [projectId, resourceIds] of byProject.entries()) {
      let sources: Map<string, AgentAiSettingsSource> | null = null;

      if (projectId) {
        try {
          sources =
            await ResourceAiAgentService.getAiSettingsSourcesForResources({
              projectId: new ObjectID(projectId),
              resourceType: data.resourceType,
              resources: resourceIds.map(
                (
                  resourceId: string,
                ): {
                  id: ObjectID;
                  aiAccessConfiguredAt: Date | null | undefined;
                } => {
                  return {
                    id: new ObjectID(resourceId),
                    aiAccessConfiguredAt:
                      data.settings[resourceId]!.aiAccessConfiguredAt,
                  };
                },
              ),
            });
        } catch (error) {
          logger.error(
            `ResourceAiAccessSettings: could not read where the AI settings of project ${projectId}'s resources are set; treating them as set by their agents: ${error}`,
          );
        }
      }

      for (const resourceId of resourceIds) {
        data.settings[resourceId]!.aiSettingsSource = sources
          ? sources.get(resourceId.toLowerCase()) || "oneuptime"
          : "agent_configuration";
      }
    }
  }

  /*
   * Why a write may not change investigation or fixes on one of these
   * resources (their agent sets them), or null. A write that posts the
   * value a resource already has changes nothing and passes.
   */
  public static getAgentSetSettingsRefusal(data: {
    resourceType: AiResourceType;
    data: JSONObject;
    current: Array<ResourceAiAccessSettingsSnapshot>;
  }): string | null {
    const investigation: unknown = data.data["isAiInvestigationEnabled"];
    const mode: unknown = data.data["aiRemediationMode"];

    for (const snapshot of data.current) {
      if (!isAgentAiSettingsSourceAgent(snapshot.aiSettingsSource)) {
        continue;
      }

      const changesInvestigation: boolean =
        investigation !== undefined &&
        (investigation === true) !== snapshot.isAiInvestigationEnabled;
      const changesMode: boolean =
        mode !== undefined &&
        ResourceAiAccessSettings.readStoredMode(mode) !==
          snapshot.aiRemediationMode;

      if (changesInvestigation || changesMode) {
        return getAgentSetResourceAiAccessRefusal({
          resourceType: data.resourceType,
          source: snapshot.aiSettingsSource!,
        });
      }
    }

    return null;
  }

  /*
   * The same rule for a resource service's onBeforeCreate, judged against
   * the never-configured defaults a new resource starts from (as
   * KubernetesClusterService.onBeforeCreate judges a new cluster): validate
   * (every caller, root included), refuse the server-only columns (every
   * caller but root — a master admin included, whom the create column ACLs
   * never check) and gate a loosening (every caller but root and master
   * admins). The create column ACLs of the AI columns are empty, so a
   * user's create cannot carry them today and the gate is defence in depth.
   * Normalizes the allowlist in `createBy.data` in place.
   */
  public static checkCreate<TBaseModel extends BaseModel>(data: {
    resourceType: AiResourceType;
    createBy: CreateBy<TBaseModel>;
  }): void {
    const createData: JSONObject = (data.createBy.data ||
      {}) as unknown as JSONObject;
    const props: DatabaseCommonInteractionProps = data.createBy.props;

    ResourceAiAccessSettings.validateSettings({
      resourceType: data.resourceType,
      data: createData,
    });

    if (props.isRoot) {
      return;
    }

    const serverOnlyRefusal: string | null =
      ResourceAiAccessSettings.getServerOnlyColumnRefusal(createData);

    if (serverOnlyRefusal) {
      throw new NotAuthorizedException(serverOnlyRefusal);
    }

    if (
      props.isMasterAdmin ||
      !ResourceAiAccessSettings.isSettingWritten(createData)
    ) {
      return;
    }

    // The tenant column is stamped from props.tenantId before this hook.
    const projectId: ObjectID | undefined =
      props.tenantId ||
      (createData["projectId"] as ObjectID | undefined) ||
      undefined;

    const refusal: string | null = ResourceAiAccessSettings.getLooseningRefusal(
      {
        resourceType: data.resourceType,
        data: createData,
        props,
        current: [{ ...NEVER_CONFIGURED_RESOURCE_AI_ACCESS, projectId }],
      },
    );

    if (refusal) {
      throw new NotAuthorizedException(refusal);
    }
  }

  /*
   * The AI access settings of every resource an operator's update reaches,
   * read before the write. onBeforeUpdate runs before the framework scopes
   * the query to the caller's project, so scope it here: a caller must
   * never learn anything about, or be judged against, another project's
   * resource.
   */
  public static async readSettingsForUpdateQuery<
    TBaseModel extends BaseModel,
  >(data: {
    service: DatabaseService<TBaseModel>;
    updateBy: UpdateBy<TBaseModel>;
  }): Promise<Record<string, ResourceAiAccessSettingsSnapshot>> {
    const rows: Array<TBaseModel> = await data.service.findBy({
      query: {
        ...data.updateBy.query,
        ...(data.updateBy.props.tenantId
          ? { projectId: data.updateBy.props.tenantId }
          : {}),
      } as never,
      select: SETTINGS_SELECT as never,
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const settings: Record<string, ResourceAiAccessSettingsSnapshot> = {};

    for (const row of rows) {
      const record: Record<string, unknown> = row as unknown as Record<
        string,
        unknown
      >;
      const resourceId: string | undefined =
        row.id?.toString() || row._id?.toString();

      if (!resourceId) {
        continue;
      }

      settings[resourceId] = {
        projectId: record["projectId"] as ObjectID | undefined,
        isAiInvestigationEnabled: record["isAiInvestigationEnabled"] === true,
        aiRemediationMode: ResourceAiAccessSettings.readStoredMode(
          record["aiRemediationMode"],
        ),
        aiCommandAllowlist: ResourceAiAccessSettings.readStoredAllowlist(
          record["aiCommandAllowlist"],
        ),
        aiAccessConfiguredAt:
          (record["aiAccessConfiguredAt"] as Date | null | undefined) || null,
      };
    }

    return settings;
  }

  public static getWriteCarryForward(
    carryForward: unknown,
  ): ResourceAiAccessWriteCarryForward | null {
    if (
      carryForward &&
      typeof carryForward === "object" &&
      "previousResourceAiAccessSettings" in carryForward
    ) {
      return carryForward as ResourceAiAccessWriteCarryForward;
    }

    return null;
  }

  /*
   * For a resource service's onUpdateSuccess: after an operator's write of
   * an AI setting, record it on the resource's feed (fire and forget: the
   * write has committed, so who changed what AI may do is recorded even
   * when the marker write below fails) and mark each updated resource
   * AI-configured (awaited: a registering agent reads the marker to tell an
   * operator's "off" from a resource nobody ever configured, so a save that
   * could not record it must not look like one that did).
   *
   * The service supplies its feed: how its resources are linked in
   * markdown, and how an item is written (its own "updated" event type).
   */
  @CaptureSpan()
  public static async afterUpdate<TBaseModel extends BaseModel>(data: {
    service: DatabaseService<TBaseModel>;
    onUpdate: OnUpdate<TBaseModel>;
    updatedItemIds: Array<ObjectID>;
    getResourceMarkdownLink: (
      projectId: ObjectID,
      resourceId: ObjectID,
    ) => Promise<string>;
    createFeedItem: (item: ResourceAiAccessFeedItem) => Promise<void>;
  }): Promise<void> {
    const carryForward: ResourceAiAccessWriteCarryForward | null =
      ResourceAiAccessSettings.getWriteCarryForward(data.onUpdate.carryForward);

    if (!carryForward || data.updatedItemIds.length === 0) {
      return;
    }

    ResourceAiAccessSettings.writeSettingsChangedFeed({
      service: data.service,
      carryForward,
      updateData: (data.onUpdate.updateBy.data || {}) as unknown as JSONObject,
      updatedByUserId: data.onUpdate.updateBy.props.userId || undefined,
      updatedItemIds: data.updatedItemIds,
      getResourceMarkdownLink: data.getResourceMarkdownLink,
      createFeedItem: data.createFeedItem,
    }).catch((error: Error) => {
      logger.error(error);
    });

    /*
     * A resource whose agent set investigation and fixes when the write came
     * in had neither chosen by it (they are refused), so the write does not
     * mark it configured: the agent's defaults keep deciding.
     */
    await ResourceAiAccessSettings.markConfigured({
      service: data.service,
      resourceIds: data.updatedItemIds.filter(
        (resourceId: ObjectID): boolean => {
          return !isAgentAiSettingsSourceAgent(
            carryForward.previousResourceAiAccessSettings[resourceId.toString()]
              ?.aiSettingsSource,
          );
        },
      ),
    });
  }

  /*
   * Set aiAccessConfiguredAt on each resource that does not have it yet, and
   * never touch one that does: the marker records when AI access was FIRST
   * configured. A server-only column, so it is written here, as root, after
   * the operator's own write succeeded, rather than slipped into that write.
   */
  public static async markConfigured<TBaseModel extends BaseModel>(data: {
    service: DatabaseService<TBaseModel>;
    resourceIds: Array<ObjectID>;
  }): Promise<void> {
    if (data.resourceIds.length === 0) {
      return;
    }

    await data.service.updateBy({
      query: {
        _id: QueryHelper.any(data.resourceIds),
        aiAccessConfiguredAt: QueryHelper.isNull(),
      } as never,
      data: {
        aiAccessConfiguredAt: OneUptimeDate.getCurrentDate(),
      } as never,
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * One line per AI access setting this write actually changed, old -> new.
   * With no `previous` (the resource was not among those read before the
   * write) every written setting is reported as set, without a "from".
   */
  public static describeChanges(data: {
    updateData: JSONObject;
    previous: ResourceAiAccessSettingsSnapshot | undefined;
  }): Array<string> {
    const changes: Array<string> = [];
    const { updateData, previous } = data;

    if (updateData["isAiInvestigationEnabled"] !== undefined) {
      const isEnabled: boolean =
        updateData["isAiInvestigationEnabled"] === true;

      if (!previous || previous.isAiInvestigationEnabled !== isEnabled) {
        changes.push(
          `AI investigation with read-only commands turned **${
            isEnabled ? "on" : "off"
          }**`,
        );
      }
    }

    if (updateData["aiRemediationMode"] !== undefined) {
      const mode: ResourceAiRemediationMode =
        ResourceAiAccessSettings.readStoredMode(
          updateData["aiRemediationMode"],
        );

      if (!previous) {
        changes.push(
          `AI remediation set to **${RESOURCE_AI_REMEDIATION_MODE_LABELS[mode]}**`,
        );
      } else if (previous.aiRemediationMode !== mode) {
        changes.push(
          `AI remediation changed from **${
            RESOURCE_AI_REMEDIATION_MODE_LABELS[previous.aiRemediationMode]
          }** to **${RESOURCE_AI_REMEDIATION_MODE_LABELS[mode]}**`,
        );
      }
    }

    if (updateData["aiCommandAllowlist"] !== undefined) {
      const patterns: Array<string> =
        ResourceAiAccessSettings.readStoredAllowlist(
          updateData["aiCommandAllowlist"],
        );

      if (
        !previous ||
        !isSameAllowlist(previous.aiCommandAllowlist, patterns)
      ) {
        changes.push(
          patterns.length === 0
            ? "AI command allowlist cleared"
            : `AI command allowlist changed to ${describePatternCount(
                patterns.length,
              )}${
                previous
                  ? ` (was ${describePatternCount(
                      previous.aiCommandAllowlist.length,
                    )})`
                  : ""
              }`,
        );
      }
    }

    return changes;
  }

  /*
   * Who changed what OneUptime AI may do on a resource, and when. The
   * generic "was updated" feed item only covers MEANINGFUL_UPDATE_COLUMNS
   * (shared by every resource type and deliberately left alone), so
   * without this an operator switching a production host to Bypass
   * approval — or back off — left no trace.
   *
   * One item per resource that actually changed; a save that re-posts
   * unchanged values (the AI page posts its whole form) records nothing.
   * API-key and Terraform writes carry no user and are attributed to an API
   * key rather than dropped.
   */
  private static async writeSettingsChangedFeed<
    TBaseModel extends BaseModel,
  >(data: {
    service: DatabaseService<TBaseModel>;
    carryForward: ResourceAiAccessWriteCarryForward;
    updateData: JSONObject;
    updatedByUserId: ObjectID | undefined;
    updatedItemIds: Array<ObjectID>;
    getResourceMarkdownLink: (
      projectId: ObjectID,
      resourceId: ObjectID,
    ) => Promise<string>;
    createFeedItem: (item: ResourceAiAccessFeedItem) => Promise<void>;
  }): Promise<void> {
    for (const resourceId of data.updatedItemIds) {
      const previous: ResourceAiAccessSettingsSnapshot | undefined =
        data.carryForward.previousResourceAiAccessSettings[
          resourceId.toString()
        ];

      const changes: Array<string> = ResourceAiAccessSettings.describeChanges({
        updateData: data.updateData,
        previous,
      });

      if (changes.length === 0) {
        continue;
      }

      const projectId: ObjectID | undefined =
        previous?.projectId ||
        ((
          (await data.service.findOneById({
            id: resourceId,
            select: { projectId: true } as never,
            props: { isRoot: true },
          })) as unknown as Record<string, unknown> | null
        )?.["projectId"] as ObjectID | undefined);

      if (!projectId) {
        continue;
      }

      const userMarkdown: string = data.updatedByUserId
        ? (await UserService.getUserMarkdownString({
            userId: data.updatedByUserId,
            projectId,
          })) || "A user"
        : "";

      const actor: string = userMarkdown ? `**${userMarkdown}**` : "An API key";

      /*
       * Yellow when the change lets AI do more (the same test the permission
       * check applies), grey when it tightens or only flips investigation.
       */
      const displayColor: Color = ResourceAiAccessSettings.getLoosening({
        data: data.updateData,
        current: previous || NEVER_CONFIGURED_RESOURCE_AI_ACCESS,
      }).loosens
        ? Yellow500
        : Gray500;

      const moreInformation: Array<string> = [
        `**Changed by**: ${userMarkdown || "An API key (no user)"}`,
      ];

      const allowlist: Array<string> =
        ResourceAiAccessSettings.readStoredAllowlist(
          data.updateData["aiCommandAllowlist"],
        );

      if (
        data.updateData["aiCommandAllowlist"] !== undefined &&
        allowlist.length > 0
      ) {
        moreInformation.push(
          `**AI command allowlist**:\n\n${allowlist
            .map((pattern: string): string => {
              return `- \`${pattern.replace(/`/g, "'")}\``;
            })
            .join("\n")}`,
        );
      }

      await data.createFeedItem({
        resourceId,
        projectId,
        displayColor,
        feedInfoInMarkdown: `🤖 ${actor} changed what OneUptime AI may do on ${await data.getResourceMarkdownLink(
          projectId,
          resourceId,
        )}:\n\n${changes
          .map((change: string): string => {
            return `- ${change}`;
          })
          .join("\n")}`,
        moreInformationInMarkdown: moreInformation.join("\n\n"),
        userId: data.updatedByUserId,
      });
    }
  }
}
