import AIAgentTaskPullRequest from "../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import DataSecurityIssueGroup from "../../../Models/DatabaseModels/DataSecurityIssueGroup";
import { DataSecurityIssueFeedEventType } from "../../../Models/DatabaseModels/DataSecurityIssueFeed";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import {
  InfrastructureFixStore,
  InfrastructureFixTaskContext,
  getInfrastructureFixTaskContext,
} from "../../../Types/AI/CodeFixTaskContext";
import { CodeTaskState, CodeTaskStateUtil } from "../../../Types/AI/CodeTask";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { Purple500 } from "../../../Types/BrandColors";
import { readCloudTags } from "../../../Types/Cloud/CloudInventory";
import {
  DATA_SECURITY_RESPONSE_FIELD_KEY,
  isCloudConnectionDataSecurityResponseOn,
} from "../../../Types/CloudConnection/CloudConnectionCatalog";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import { DataSecurityAiProposalKind } from "../../../Types/DataSecurity/DataSecurityAi";
import { DataSecurityFixResult } from "../../../Types/DataSecurity/DataSecurityApiTypes";
import {
  DataSecurityCheckInfo,
  getDataSecurityCheck,
} from "../../../Types/DataSecurity/DataSecurityCheckCatalog";
import {
  DataSecurityAnalysisFactKind,
  DataSecurityIssueAnalysisRecord,
  GrantFact,
  isRecentDataSecurityRecency,
  readDataSecurityIssueAnalysis,
} from "../../../Types/DataSecurity/DataSecurityIssueAnalysis";
import {
  DataSecurityIssueGroupFacts,
  DataSecurityIssueGroupFixStateJSON,
  describeIssueGroupCause,
  getIssueGroupOriginName,
  readDataSecurityIssueGroupFacts,
} from "../../../Types/DataSecurity/DataSecurityIssueGroup";
import {
  DataSecurityIssueGroupFixPart,
  DataSecurityIssueGroupFixPlanJSON,
  DataSecurityIssueGroupFixResultJSON,
  DataSecurityIssueGroupFixStoreJSON,
  DataSecurityIssueGroupLeftOutJSON,
  DataSecurityIssueGroupLeftOutReason,
  getIssueGroupFixPlanFingerprint,
  isDataSecurityIssueGroupFixPart,
} from "../../../Types/DataSecurity/DataSecurityIssueGroupFix";
import DataSecurityIssueStatus from "../../../Types/DataSecurity/DataSecurityIssueStatus";
import {
  DataSecurityResponseAction,
  EXPOSURE_RESPONSE_ACTIONS,
  getDataSecurityResponseActionForIssue,
} from "../../../Types/DataSecurity/DataSecurityResponseAction";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  DeclaredCode,
  DeclaredCodeChangeState,
  DeclaredCodeOwnerCandidateJSON,
  readDeclaredCode,
} from "../../../Utils/AiRemediation/DeclaredCodeChange";
import { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import { DashboardClientUrl } from "../../EnvironmentConfig";
import AIRunService from "../../Services/AIRunService";
import CloudConnectionService from "../../Services/CloudConnectionService";
import DataSecurityAiProposalService from "../../Services/DataSecurityAiProposalService";
import DataSecurityIssueFeedService from "../../Services/DataSecurityIssueFeedService";
import DataSecurityIssueGroupService from "../../Services/DataSecurityIssueGroupService";
import DataSecurityIssueService from "../../Services/DataSecurityIssueService";
import DataStoreService from "../../Services/DataStoreService";
import QueryHelper from "../../Types/Database/QueryHelper";
import {
  AiGroupFixStore,
  DataSecurityAiCodeRequest,
} from "../AI/DataSecurity/DataSecurityAiInput";
import DataSecurityCodeTask, {
  DataSecurityFixCode,
  getDataSecurityFixNoRepositoryMessage,
} from "../AI/DataSecurity/DataSecurityCodeTask";
import { buildIssueGroupFixRequest } from "../AI/DataSecurity/DataSecurityIssueGroupPrompt";
import CodeTaskAccess from "../AI/CodeTask/CodeTaskAccess";
import CodeTaskGate from "../AI/CodeTask/CodeTaskGate";
import CodeTaskListRows, {
  CodeTaskRepliesRead,
} from "../AI/CodeTask/CodeTaskListRows";
import CodeTaskThread from "../AI/CodeTask/CodeTaskThread";
import DeclaredCodeOwner, {
  DeclaredCodeOwnerCandidate,
  getRepositoryFullName,
} from "../AI/Remediation/DeclaredCodeOwner";
import CloudAiTargets from "../AI/ResourceAccess/CloudAiTargets";
import logger from "../Logger";
import CallerPermission from "../Permission/CallerPermission";
import CaptureSpan from "../Telemetry/CaptureSpan";
import DataSecurityResponse from "./DataSecurityResponse";
import ServerProducts from "../ServerProducts/ServerProducts";
import ProductKey from "../../../Types/Product/ProductKey";
import {
  ServerProductOffReason,
  getProductOffMessage,
} from "../../../Types/Product/ServerProducts";
import { DataSecurityResponseOutcome } from "./Cloud/DataSecurityCloudTypes";

/*
 * ONE FIX FOR THE ISSUES ONE MISTAKE MADE (#10370).
 *
 * A group of issues (DataSecurityIssueGrouper) is fixed once, in up to two
 * parts that one press makes:
 *
 *   - Declared as code: ONE pull request to the module or file that
 *     declares the stores, changing what they all take, through a task of
 *     its own recipe in Code (DataSecurityCodeTask.requestGroupFix,
 *     CodeFixTaskType.FixInfrastructureCode). Asking takes what Fix with AI
 *     takes - changing the issues, and a repository the person may change
 *     in Code - and the person confirms the repository, as for an
 *     incident's fix: the repositories are ranked as DeclaredCodeOwner
 *     ranks them, the one the grouping found first.
 *   - Made in the console: the response action that fixes the check (Fix it
 *     from here, DataSecurityResponse), run on every store through its cloud
 *     connection, as one approval that lists each store and what changes.
 *     It takes what running a response action takes (CLOUD_FIX_PERMISSIONS).
 *
 * What each part leaves out is said store by store, and why
 * (DataSecurityIssueGroupLeftOutReason): a store marked Public By Design is
 * never blocked; a store OneUptime AI's analysis says the fix would break
 * something it uses (a grant the fix takes away, used in the last 90 days,
 * #10369) waits for the person to tick it in; a store whose connection does
 * not let Data Security change it is left to be fixed by hand.
 *
 * The group keeps its pull request (codeTaskId), and so does each of its
 * issues: their pages and the Issues list say where it stands, and each
 * issue resolves as its own check passes. #10368 will follow the pull
 * request to production and mark each issue fixed as its change ships: it
 * reads the group's task (getFixTaskId) and its issues.
 */

// Who may ask for a group's pull request: who may change its issues (Fix with AI's list).
export const GROUP_PULL_REQUEST_PERMISSIONS: ReadonlyArray<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.EditDataSecurityIssue,
];

// Who may run a response action on a group's stores: who may run one from an issue.
export const CLOUD_FIX_PERMISSIONS: ReadonlyArray<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.EditDataStore,
];

export const GROUP_PULL_REQUEST_REFUSED_MESSAGE: string =
  "Asking OneUptime AI for this pull request takes permission to change Data Security issues.";

export const CLOUD_FIX_REFUSED_MESSAGE: string =
  "Changing these stores through their cloud connections takes permission to edit data stores.";

export const GROUP_NOT_FOUND_MESSAGE: string =
  "This group of issues could not be found. Its issues may have resolved, or no longer share a cause.";

export const GROUP_FIX_CHANGED_MESSAGE: string =
  "This group changed since its fix was shown to you - issues resolved, or stores left it - so nothing was done. Look at what it fixes now.";

export const GROUP_FIX_NOTHING_TO_DO_MESSAGE: string =
  "Nothing in this group can be fixed from here: every store is left out of its fix.";

// The most of a group's open issues one fix covers.
export const MAX_GROUP_FIX_ISSUES: number = 500;

// The most stores one press changes through their cloud connections at once.
const CLOUD_FIX_CONCURRENCY: number = 4;

const ROOT: { isRoot: true } = { isRoot: true };

// One open issue of the group, with its store and what the analysis says.
export interface GroupFixMember {
  issue: DataSecurityIssue;
  store: DataStore;
  tags: Dictionary<string>;
  // The code its tags say declares it, or null: made in the console.
  declaredCode: DeclaredCode | null;
  // Who uses the access its fix takes away, as its analysis says (#10369).
  breaks: Array<string>;
}

function idOf(record: { _id?: unknown; id?: unknown }): string {
  const value: unknown = record.id || record._id;

  return value ? String(value).toLowerCase() : "";
}

function storeJson(member: GroupFixMember): DataSecurityIssueGroupFixStoreJSON {
  return {
    issueId: idOf(member.issue),
    dataStoreId: idOf(member.store),
    name: member.store.name || "",
    ...(member.store.kind ? { kind: member.store.kind } : {}),
    ...(member.store.region ? { region: member.store.region } : {}),
  };
}

/*
 * Who uses the access a check's fix takes away, as the issue's analysis
 * found it: each grant the fix removes that was used in the last 90 days,
 * by who has it. None for a check whose fix takes nothing away.
 */
export function getWhatTheFixBreaks(
  analysis: DataSecurityIssueAnalysisRecord | null,
): Array<string> {
  if (!analysis) {
    return [];
  }

  const breaks: Array<string> = [];

  for (const fact of analysis.facts) {
    if (fact.kind !== DataSecurityAnalysisFactKind.Grant) {
      continue;
    }

    const grant: GrantFact = fact as GrantFact;

    if (
      grant.isRemovedByFix &&
      isRecentDataSecurityRecency(grant.lastUsed) &&
      grant.principal &&
      !breaks.includes(grant.principal)
    ) {
      breaks.push(grant.principal);
    }
  }

  return breaks.slice(0, 5);
}

// Whether the caller holds one of these, across the whole project.
function holds(
  props: DatabaseCommonInteractionProps,
  permissions: ReadonlyArray<Permission>,
): boolean {
  return (
    Boolean(props.isRoot) ||
    Boolean(props.isMasterAdmin) ||
    CallerPermission.holdsAnyOf(props, permissions, {
      projectWideOnly: true,
      labelledBlocksRefuse: true,
    })
  );
}

// The Dashboard's page of an issue, and of the project's issues.
export function getIssuePageUrl(projectId: ObjectID, issueId: string): string {
  return `${DashboardClientUrl.toString()}/${projectId.toString()}/data-security/issues/${issueId}`;
}

export function getIssuesPageUrl(projectId: ObjectID): string {
  return `${DashboardClientUrl.toString()}/${projectId.toString()}/data-security/issues`;
}

export default class DataSecurityIssueGroupFix {
  // The group, in the project: one of another project is not found.
  public static async readGroup(data: {
    projectId: ObjectID;
    groupId: unknown;
  }): Promise<DataSecurityIssueGroup> {
    const id: string =
      typeof data.groupId === "string" ? data.groupId.trim() : "";

    if (!ObjectID.isValidUUID(id)) {
      throw new NotFoundException(GROUP_NOT_FOUND_MESSAGE);
    }

    const group: DataSecurityIssueGroup | null =
      await DataSecurityIssueGroupService.findOneBy({
        query: { _id: id, projectId: data.projectId },
        select: {
          _id: true,
          groupKey: true,
          checkId: true,
          cause: true,
          facts: true,
          name: true,
          issueCount: true,
          openIssueCount: true,
          codeTaskId: true,
        },
        props: ROOT,
      });

    if (!group?.id) {
      throw new NotFoundException(GROUP_NOT_FOUND_MESSAGE);
    }

    return group;
  }

  /*
   * The group's open issues, each with its store, the code its tags say
   * declares it, and what its analysis says the fix would break. Archived
   * stores are no fix's.
   */
  public static async readMembers(data: {
    projectId: ObjectID;
    groupId: ObjectID;
  }): Promise<Array<GroupFixMember>> {
    const issues: Array<DataSecurityIssue> =
      await DataSecurityIssueService.findBy({
        query: {
          projectId: data.projectId,
          dataSecurityIssueGroupId: data.groupId,
          status: DataSecurityIssueStatus.Open,
        },
        select: {
          _id: true,
          checkId: true,
          checkGroup: true,
          title: true,
          severity: true,
          riskScore: true,
          dataTypeIds: true,
          dataStoreId: true,
          aiAnalysis: true,
        },
        skip: 0,
        limit: MAX_GROUP_FIX_ISSUES,
        props: ROOT,
      });
    const storeIds: Array<string> = Array.from(
      new Set(
        issues
          .map((issue: DataSecurityIssue): string => {
            return issue.dataStoreId?.toString().toLowerCase() || "";
          })
          .filter(Boolean),
      ),
    );
    const stores: Array<DataStore> =
      storeIds.length > 0
        ? await DataStoreService.findBy({
            query: {
              projectId: data.projectId,
              _id: QueryHelper.any(storeIds),
            },
            select: {
              _id: true,
              name: true,
              kind: true,
              region: true,
              cloudTags: true,
              providerResourceId: true,
              cloudConnectionId: true,
              isPublicByDesign: true,
              isArchived: true,
              // What a Data Security AI rule reads off the store (#10364).
              provider: true,
              environment: true,
              sensitivity: true,
              serviceId: true,
              labels: { _id: true },
            },
            skip: 0,
            limit: storeIds.length,
            props: ROOT,
          })
        : [];
    const storeById: Map<string, DataStore> = new Map(
      stores.map((store: DataStore): [string, DataStore] => {
        return [idOf(store), store];
      }),
    );
    const members: Array<GroupFixMember> = [];

    for (const issue of issues) {
      const store: DataStore | undefined = storeById.get(
        issue.dataStoreId?.toString().toLowerCase() || "",
      );

      if (!store || store.isArchived) {
        continue;
      }

      const tags: Dictionary<string> = readCloudTags(store.cloudTags);

      members.push({
        issue,
        store,
        tags,
        declaredCode: readDeclaredCode(CloudAiTargets.getManagedAsCode(tags)),
        breaks: getWhatTheFixBreaks(
          readDataSecurityIssueAnalysis(issue.aiAnalysis),
        ),
      });
    }

    return members.sort((left: GroupFixMember, right: GroupFixMember) => {
      return (
        (left.store.name || "").localeCompare(right.store.name || "") ||
        idOf(left.store).localeCompare(idOf(right.store))
      );
    });
  }

  /*
   * What the group's fix would do now, for this reader: the pull request
   * for the stores declared as code, the one approval for the stores made
   * in the console, and every store each leaves out, with why.
   */
  @CaptureSpan()
  public static async plan(data: {
    projectId: ObjectID;
    groupId: unknown;
    props: DatabaseCommonInteractionProps;
  }): Promise<DataSecurityIssueGroupFixPlanJSON> {
    const group: DataSecurityIssueGroup =
      await DataSecurityIssueGroupFix.readGroup(data);
    const members: Array<GroupFixMember> =
      await DataSecurityIssueGroupFix.readMembers({
        projectId: data.projectId,
        groupId: group.id!,
      });

    return await DataSecurityIssueGroupFix.planOf({
      projectId: data.projectId,
      group,
      members,
      props: data.props,
    });
  }

  public static async planOf(data: {
    projectId: ObjectID;
    group: DataSecurityIssueGroup;
    members: Array<GroupFixMember>;
    props: DatabaseCommonInteractionProps;
  }): Promise<DataSecurityIssueGroupFixPlanJSON> {
    const facts: DataSecurityIssueGroupFacts | null =
      readDataSecurityIssueGroupFacts(data.group.facts);
    const checkId: string = data.group.checkId || facts?.checkId || "";
    const declared: Array<GroupFixMember> = data.members.filter(
      (member: GroupFixMember): boolean => {
        return Boolean(member.declaredCode);
      },
    );
    const madeInConsole: Array<GroupFixMember> = data.members.filter(
      (member: GroupFixMember): boolean => {
        return !member.declaredCode;
      },
    );
    const leftOut: Array<DataSecurityIssueGroupLeftOutJSON> = [];
    const plan: Omit<DataSecurityIssueGroupFixPlanJSON, "planFingerprint"> = {
      groupId: idOf(data.group),
      checkId,
      leftOut,
    };

    if (declared.length > 0) {
      plan.pullRequest = await DataSecurityIssueGroupFix.planPullRequest({
        projectId: data.projectId,
        group: data.group,
        facts,
        members: declared,
        props: data.props,
      });
    }

    if (madeInConsole.length > 0) {
      const cloud: {
        action: DataSecurityResponseAction | null;
        included: Array<GroupFixMember>;
      } = await DataSecurityIssueGroupFix.planCloud({
        projectId: data.projectId,
        checkId,
        members: madeInConsole,
        leftOut,
      });

      if (cloud.action) {
        plan.cloud = {
          action: cloud.action,
          stores: cloud.included.map(storeJson),
          ...(holds(data.props, CLOUD_FIX_PERMISSIONS)
            ? {}
            : { refusal: CLOUD_FIX_REFUSED_MESSAGE }),
        };
      }
    }

    return {
      ...plan,
      planFingerprint: getIssueGroupFixPlanFingerprint(plan),
    };
  }

  /*
   * The pull request's part: its stores, where the grouping found their
   * code, the repositories the reader may pick (ranked as an incident's fix
   * ranks them), what stops them asking, and the one already on its way.
   */
  private static async planPullRequest(data: {
    projectId: ObjectID;
    group: DataSecurityIssueGroup;
    facts: DataSecurityIssueGroupFacts | null;
    members: Array<GroupFixMember>;
    props: DatabaseCommonInteractionProps;
  }): Promise<NonNullable<DataSecurityIssueGroupFixPlanJSON["pullRequest"]>> {
    const declaredCode: DeclaredCode = data.members[0]!.declaredCode!;
    const existing: DataSecurityIssueGroupFixStateJSON | undefined = data.group
      .codeTaskId
      ? (await DataSecurityIssueGroupFix.readFixState({
          projectId: data.projectId,
          taskId: data.group.codeTaskId,
          props: data.props,
        })) || undefined
      : undefined;
    const part: NonNullable<DataSecurityIssueGroupFixPlanJSON["pullRequest"]> =
      {
        stores: data.members.map(storeJson),
        codeKind: data.facts?.code?.codeKind || declaredCode.name,
        candidates: [],
        ...(data.facts?.code
          ? {
              location: {
                repositoryId: data.facts.code.repositoryId,
                repositoryName: data.facts.code.repositoryName,
                paths: data.facts.code.paths,
              },
            }
          : {}),
        ...(existing ? { existing } : {}),
      };

    if (data.props.isRoot) {
      return part;
    }

    if (!holds(data.props, GROUP_PULL_REQUEST_PERMISSIONS)) {
      return { ...part, refusal: GROUP_PULL_REQUEST_REFUSED_MESSAGE };
    }

    // A task in Code, so refused while the server has Code switched off (#9489).
    const codeOff: ServerProductOffReason | null =
      await ServerProducts.getOffReasonOfServerWork(ProductKey.Code);

    if (codeOff) {
      return {
        ...part,
        refusal: getProductOffMessage({
          product: ProductKey.Code,
          reason: codeOff,
        }),
      };
    }

    const blocker: { message: string } | null = await CodeTaskGate.getBlocker({
      props: data.props,
      projectId: data.projectId,
      repository: null,
      canAsk: true,
    });

    if (blocker) {
      return { ...part, refusal: blocker.message };
    }

    part.candidates = await DataSecurityIssueGroupFix.rankRepositories({
      projectId: data.projectId,
      facts: data.facts,
      member: data.members[0]!,
      declaredCode,
      props: data.props,
    });

    if (part.candidates.length === 0) {
      return {
        ...part,
        refusal: getDataSecurityFixNoRepositoryMessage(
          DataSecurityFixCode.Infrastructure,
        ),
      };
    }

    return part;
  }

  /*
   * The repositories the reader may read, ranked for the group's code: the
   * one the grouping found first, then as DeclaredCodeOwner ranks them for
   * the module's or stack's name, each with whether the reader may ask AI
   * to work in it.
   */
  private static async rankRepositories(data: {
    projectId: ObjectID;
    facts: DataSecurityIssueGroupFacts | null;
    member: GroupFixMember;
    declaredCode: DeclaredCode;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<DeclaredCodeOwnerCandidateJSON>> {
    let readable: Array<CodeRepository> = [];

    try {
      readable = await CodeTaskAccess.listReadableRepositories({
        props: data.props,
        projectId: data.projectId,
      });
    } catch (error) {
      if (
        error instanceof NotAuthorizedException ||
        error instanceof PaymentRequiredException
      ) {
        return [];
      }

      throw error;
    }

    if (readable.length === 0) {
      return [];
    }

    let ranked: Array<DeclaredCodeOwnerCandidate> = [];

    try {
      ranked = await DeclaredCodeOwner.findCandidates({
        projectId: data.projectId,
        declaredCode: data.declaredCode,
        resource: {
          name:
            (data.facts ? getIssueGroupOriginName(data.facts) : null) ||
            data.member.store.name ||
            "",
          tags: data.member.tags,
        },
      });
    } catch (error) {
      logger.debug(
        `DataSecurity group fix: could not rank the repositories of project ${data.projectId.toString()}: ${error}`,
      );
    }

    const readableIds: Set<string> = new Set(
      readable.map((repository: CodeRepository): string => {
        return idOf(repository);
      }),
    );
    const found: string = (data.facts?.code?.repositoryId || "").toLowerCase();
    const candidates: Array<DeclaredCodeOwnerCandidate> = ranked
      .filter((candidate: DeclaredCodeOwnerCandidate): boolean => {
        return readableIds.has(candidate.repository.id.toLowerCase());
      })
      .sort(
        (
          left: DeclaredCodeOwnerCandidate,
          right: DeclaredCodeOwnerCandidate,
        ): number => {
          return (
            Number(right.repository.id.toLowerCase() === found) -
            Number(left.repository.id.toLowerCase() === found)
          );
        },
      );
    const best: DeclaredCodeOwnerCandidate | null =
      DeclaredCodeOwner.getBest(candidates);
    const canAsk: Array<boolean> = await Promise.all(
      candidates.map(
        (candidate: DeclaredCodeOwnerCandidate): Promise<boolean> => {
          return CodeTaskAccess.canAskInRepository({
            props: data.props,
            projectId: data.projectId,
            repositoryId: new ObjectID(candidate.repository.id),
          });
        },
      ),
    );

    return candidates.map(
      (
        candidate: DeclaredCodeOwnerCandidate,
        index: number,
      ): DeclaredCodeOwnerCandidateJSON => {
        return {
          repositoryId: candidate.repository.id,
          name: candidate.repository.name,
          fullName: getRepositoryFullName(candidate.repository),
          reason: candidate.reason,
          matchedPaths:
            candidate.repository.id.toLowerCase() === found &&
            data.facts?.code?.paths.length
              ? data.facts.code.paths
              : candidate.matchedPaths,
          isBest: candidate === best,
          canAsk: Boolean(canAsk[index]),
        };
      },
    );
  }

  /*
   * The one approval's part: the response action that fixes the check on
   * the stores' kind, and each store it runs on - every store it leaves
   * out goes in `leftOut`, with why. Reads each connection once.
   */
  private static async planCloud(data: {
    projectId: ObjectID;
    checkId: string;
    members: Array<GroupFixMember>;
    leftOut: Array<DataSecurityIssueGroupLeftOutJSON>;
  }): Promise<{
    action: DataSecurityResponseAction | null;
    included: Array<GroupFixMember>;
  }> {
    const connectionIds: Array<string> = Array.from(
      new Set(
        data.members
          .map((member: GroupFixMember): string => {
            return (
              member.store.cloudConnectionId?.toString().toLowerCase() || ""
            );
          })
          .filter(Boolean),
      ),
    );
    const connections: Array<CloudConnection> =
      connectionIds.length > 0
        ? await CloudConnectionService.findBy({
            query: {
              projectId: data.projectId,
              _id: QueryHelper.any(connectionIds),
            },
            select: { _id: true, config: true, isEnabled: true },
            skip: 0,
            limit: connectionIds.length,
            props: ROOT,
          })
        : [];
    const connectionById: Map<string, CloudConnection> = new Map(
      connections.map(
        (connection: CloudConnection): [string, CloudConnection] => {
          return [idOf(connection), connection];
        },
      ),
    );
    const included: Array<GroupFixMember> = [];
    let action: DataSecurityResponseAction | null = null;

    const leave: (
      member: GroupFixMember,
      reason: DataSecurityIssueGroupLeftOutReason,
      more?: Partial<DataSecurityIssueGroupLeftOutJSON>,
    ) => void = (
      member: GroupFixMember,
      reason: DataSecurityIssueGroupLeftOutReason,
      more?: Partial<DataSecurityIssueGroupLeftOutJSON>,
    ): void => {
      data.leftOut.push({
        ...storeJson(member),
        part: DataSecurityIssueGroupFixPart.Cloud,
        reason,
        canInclude: false,
        ...more,
      });
    };

    for (const member of data.members) {
      const memberAction: DataSecurityResponseAction | undefined =
        getDataSecurityResponseActionForIssue(data.checkId, member.store.kind);

      // One action for the group: a store whose kind takes another is fixed by hand.
      if (!memberAction || (action && memberAction !== action)) {
        leave(member, DataSecurityIssueGroupLeftOutReason.NothingToRun);
        continue;
      }

      action = memberAction;

      const closesExposure: boolean =
        EXPOSURE_RESPONSE_ACTIONS.includes(memberAction);

      if (closesExposure && member.store.isPublicByDesign) {
        leave(member, DataSecurityIssueGroupLeftOutReason.PublicByDesign);
        continue;
      }

      const connectionId: string =
        member.store.cloudConnectionId?.toString().toLowerCase() || "";
      const connection: CloudConnection | undefined =
        connectionById.get(connectionId);

      if (!connectionId) {
        leave(member, DataSecurityIssueGroupLeftOutReason.NotThroughACloud);
        continue;
      }

      if (!connection || connection.isEnabled === false) {
        leave(member, DataSecurityIssueGroupLeftOutReason.ConnectionGone);
        continue;
      }

      if (
        !isCloudConnectionDataSecurityResponseOn(
          connection.config
            ? connection.config[DATA_SECURITY_RESPONSE_FIELD_KEY]
            : undefined,
        )
      ) {
        leave(member, DataSecurityIssueGroupLeftOutReason.ResponseOff, {
          cloudConnectionId: connectionId,
        });
        continue;
      }

      if (member.breaks.length > 0) {
        leave(member, DataSecurityIssueGroupLeftOutReason.FixWouldBreak, {
          canInclude: true,
          breaks: member.breaks,
        });
        continue;
      }

      included.push(member);
    }

    return { action, included };
  }

  /*
   * The group's fix, made: the pull request for the stores declared as
   * code, and the response action on every store made in the console that
   * the plan runs on - with the stores the person ticked in among those it
   * left out. Each part is made as the actor, held to its own permission;
   * a part the actor may not make is not made, and says why. A press made
   * on a plan that changed since it was shown does nothing.
   */
  @CaptureSpan()
  public static async run(data: {
    projectId: ObjectID;
    groupId: unknown;
    props: DatabaseCommonInteractionProps;
    codeRepositoryId?: unknown;
    includeDataStoreIds?: unknown;
    parts?: unknown;
    expectedPlanFingerprint?: unknown;
    /*
     * The stores a person approved, for a proposal of OneUptime AI's: the
     * one approval changes none it did not list, even one that joined the
     * group since.
     */
    onlyDataStoreIds?: ReadonlyArray<string> | undefined;
    triggeredBySecurityCaseId?: ObjectID | undefined;
  }): Promise<DataSecurityIssueGroupFixResultJSON> {
    const group: DataSecurityIssueGroup =
      await DataSecurityIssueGroupFix.readGroup(data);
    const members: Array<GroupFixMember> =
      await DataSecurityIssueGroupFix.readMembers({
        projectId: data.projectId,
        groupId: group.id!,
      });
    const plan: DataSecurityIssueGroupFixPlanJSON =
      await DataSecurityIssueGroupFix.planOf({
        projectId: data.projectId,
        group,
        members,
        props: data.props,
      });

    if (
      typeof data.expectedPlanFingerprint === "string" &&
      data.expectedPlanFingerprint &&
      data.expectedPlanFingerprint !== plan.planFingerprint
    ) {
      throw new BadDataException(GROUP_FIX_CHANGED_MESSAGE);
    }

    const parts: Array<DataSecurityIssueGroupFixPart> = Array.isArray(
      data.parts,
    )
      ? (data.parts as Array<unknown>).filter(isDataSecurityIssueGroupFixPart)
      : [
          DataSecurityIssueGroupFixPart.PullRequest,
          DataSecurityIssueGroupFixPart.Cloud,
        ];
    const result: DataSecurityIssueGroupFixResultJSON = {
      leftOut: plan.leftOut.length,
    };
    const memberById: Map<string, GroupFixMember> = new Map(
      members.map((member: GroupFixMember): [string, GroupFixMember] => {
        return [idOf(member.store), member];
      }),
    );

    if (
      parts.includes(DataSecurityIssueGroupFixPart.PullRequest) &&
      plan.pullRequest
    ) {
      if (plan.pullRequest.refusal) {
        result.pullRequest = { message: plan.pullRequest.refusal };
      } else {
        result.pullRequest = await DataSecurityIssueGroupFix.openPullRequest({
          projectId: data.projectId,
          group,
          plan,
          members: plan.pullRequest.stores
            .map((store: DataSecurityIssueGroupFixStoreJSON) => {
              return memberById.get(store.dataStoreId.toLowerCase());
            })
            .filter((member: GroupFixMember | undefined) => {
              return Boolean(member);
            }) as Array<GroupFixMember>,
          props: data.props,
          codeRepositoryId: data.codeRepositoryId,
          triggeredBySecurityCaseId: data.triggeredBySecurityCaseId,
        });
      }
    }

    if (
      parts.includes(DataSecurityIssueGroupFixPart.Cloud) &&
      plan.cloud?.refusal
    ) {
      result.cloud = {
        action: plan.cloud.action,
        changed: 0,
        unchanged: 0,
        failed: [],
        refusal: plan.cloud.refusal,
      };
    } else if (
      parts.includes(DataSecurityIssueGroupFixPart.Cloud) &&
      plan.cloud
    ) {
      const ticked: Set<string> = new Set(
        (Array.isArray(data.includeDataStoreIds)
          ? (data.includeDataStoreIds as Array<unknown>)
          : []
        )
          .filter((id: unknown): id is string => {
            return typeof id === "string";
          })
          .map((id: string): string => {
            return id.toLowerCase();
          }),
      );
      const approved: Set<string> | null = data.onlyDataStoreIds
        ? new Set(
            data.onlyDataStoreIds.map((id: string): string => {
              return id.toLowerCase();
            }),
          )
        : null;
      const stores: Array<DataSecurityIssueGroupFixStoreJSON> = [
        ...plan.cloud.stores,
        ...plan.leftOut.filter(
          (store: DataSecurityIssueGroupLeftOutJSON): boolean => {
            return (
              store.part === DataSecurityIssueGroupFixPart.Cloud &&
              store.canInclude &&
              ticked.has(store.dataStoreId.toLowerCase())
            );
          },
        ),
      ].filter((store: DataSecurityIssueGroupFixStoreJSON): boolean => {
        return !approved || approved.has(store.dataStoreId.toLowerCase());
      });

      result.leftOut =
        plan.leftOut.length + plan.cloud.stores.length - stores.length;
      result.cloud = await DataSecurityIssueGroupFix.runCloud({
        projectId: data.projectId,
        action: plan.cloud.action,
        stores,
        userId: data.props.userId || undefined,
      });
    }

    if (!result.pullRequest && !result.cloud) {
      throw new BadDataException(GROUP_FIX_NOTHING_TO_DO_MESSAGE);
    }

    await DataSecurityIssueGroupService.updateOneById({
      id: group.id!,
      data: {
        fixRequestedAt: OneUptimeDate.getCurrentDate(),
        fixRequestedByUserId: data.props.userId || null,
      } as never,
      props: ROOT,
    });

    /*
     * What OneUptime AI proposed for the parts just made, and still waits,
     * is no longer needed (a proposal being approved is not waiting).
     */
    await DataSecurityAiProposalService.expireWaitingForGroup({
      dataSecurityIssueGroupId: group.id!,
      kinds: [
        ...(result.pullRequest?.aiRunId
          ? [DataSecurityAiProposalKind.FixIssueGroupInCode]
          : []),
        ...(result.cloud && !result.cloud.refusal
          ? [DataSecurityAiProposalKind.FixIssueGroupInCloud]
          : []),
      ],
      at: OneUptimeDate.getCurrentDate(),
    });

    return result;
  }

  /*
   * The one pull request: the group's task again, while it is on its way
   * or open; else a new one, asked as the actor, with the request the
   * builder made from the group and its stores. The group keeps it.
   */
  private static async openPullRequest(data: {
    projectId: ObjectID;
    group: DataSecurityIssueGroup;
    plan: DataSecurityIssueGroupFixPlanJSON;
    members: Array<GroupFixMember>;
    props: DatabaseCommonInteractionProps;
    codeRepositoryId?: unknown;
    triggeredBySecurityCaseId?: ObjectID | undefined;
  }): Promise<NonNullable<DataSecurityIssueGroupFixResultJSON["pullRequest"]>> {
    const existing: DataSecurityIssueGroupFixStateJSON | undefined =
      data.plan.pullRequest?.existing;

    if (
      existing &&
      data.group.codeTaskId &&
      (existing.state === DeclaredCodeChangeState.Writing ||
        existing.state === DeclaredCodeChangeState.Opened ||
        existing.state === DeclaredCodeChangeState.WaitingForYou)
    ) {
      return {
        message:
          existing.state === DeclaredCodeChangeState.Opened
            ? "This group's pull request is open already: review it in Code."
            : "OneUptime AI is already working on this group's pull request.",
        aiRunId: data.group.codeTaskId.toString(),
        wasAlreadyAsked: true,
      };
    }

    const facts: DataSecurityIssueGroupFacts = readDataSecurityIssueGroupFacts(
      data.group.facts,
    ) || {
      cause: data.group.cause as never,
      checkId: data.group.checkId || "",
    };
    const check: DataSecurityCheckInfo | undefined = getDataSecurityCheck(
      facts.checkId,
    );
    const cause: string = describeIssueGroupCause(facts);
    const stores: Array<InfrastructureFixStore> = data.members.map(
      (member: GroupFixMember): InfrastructureFixStore => {
        return {
          name: member.store.name || "",
          issueId: idOf(member.issue),
          issueUrl: getIssuePageUrl(data.projectId, idOf(member.issue)),
          ...(member.store.kind ? { kind: member.store.kind } : {}),
          ...(member.store.region ? { region: member.store.region } : {}),
        };
      },
    );
    const requested: unknown =
      data.codeRepositoryId ||
      (data.props.isRoot
        ? data.plan.pullRequest?.location?.repositoryId
        : undefined);
    const answer: DataSecurityFixResult =
      await DataSecurityCodeTask.requestGroupFix({
        props: data.props,
        projectId: data.projectId,
        issueIds: data.members.map((member: GroupFixMember): ObjectID => {
          return member.issue.id!;
        }),
        requestedRepositoryId: requested,
        triggeredBySecurityCaseId: data.triggeredBySecurityCaseId,
        fix: {
          groupId: idOf(data.group),
          checkId: facts.checkId,
          title: `Fix ${(check?.title || facts.checkId).replace(
            /^./,
            (first: string) => {
              return first.toLowerCase();
            },
          )} in ${cause}`.slice(0, 200),
          cause,
          stores: stores.slice(0, 200),
          storeCount: stores.length,
          issuesUrl: getIssuesPageUrl(data.projectId),
          ...(facts.code
            ? { codeKind: facts.code.codeKind, paths: facts.code.paths }
            : data.plan.pullRequest?.codeKind
              ? { codeKind: data.plan.pullRequest.codeKind }
              : {}),
        },
        buildMessage: async (): Promise<DataSecurityAiCodeRequest> => {
          return buildIssueGroupFixRequest({
            facts,
            stores: data.members.map(
              (member: GroupFixMember): AiGroupFixStore => {
                return {
                  store: {
                    name: member.store.name,
                    kind: member.store.kind,
                    region: member.store.region,
                    providerResourceId: member.store.providerResourceId,
                  },
                  issue: {
                    _id: idOf(member.issue),
                    title: member.issue.title,
                    checkId: member.issue.checkId,
                  },
                };
              },
            ),
          });
        },
      });

    if (answer.aiRunId) {
      await DataSecurityIssueGroupService.updateOneById({
        id: data.group.id!,
        data: { codeTaskId: new ObjectID(answer.aiRunId) } as never,
        props: ROOT,
      });
    }

    return {
      message: answer.message,
      ...(answer.aiRunId ? { aiRunId: answer.aiRunId } : {}),
      ...(answer.repositories ? { repositories: answer.repositories } : {}),
    };
  }

  /*
   * The one approval, made: the response action on every store, as the
   * person - each store's own timeline, and its issue's, say what was done
   * (DataSecurityResponse.run). A store that fails says why and stops no
   * other; a few run at once.
   */
  private static async runCloud(data: {
    projectId: ObjectID;
    action: DataSecurityResponseAction;
    stores: Array<DataSecurityIssueGroupFixStoreJSON>;
    userId?: ObjectID | undefined;
  }): Promise<NonNullable<DataSecurityIssueGroupFixResultJSON["cloud"]>> {
    const outcome: NonNullable<DataSecurityIssueGroupFixResultJSON["cloud"]> = {
      action: data.action,
      changed: 0,
      unchanged: 0,
      failed: [],
    };

    for (
      let start: number = 0;
      start < data.stores.length;
      start += CLOUD_FIX_CONCURRENCY
    ) {
      const batch: Array<DataSecurityIssueGroupFixStoreJSON> =
        data.stores.slice(start, start + CLOUD_FIX_CONCURRENCY);
      const results: Array<PromiseSettledResult<DataSecurityResponseOutcome>> =
        await Promise.allSettled(
          batch.map(
            (
              store: DataSecurityIssueGroupFixStoreJSON,
            ): Promise<DataSecurityResponseOutcome> => {
              return DataSecurityResponse.run({
                projectId: data.projectId,
                dataStoreId: new ObjectID(store.dataStoreId),
                action: data.action,
                userId: data.userId,
                dataSecurityIssueId: new ObjectID(store.issueId),
              });
            },
          ),
        );

      results.forEach(
        (
          result: PromiseSettledResult<DataSecurityResponseOutcome>,
          index: number,
        ): void => {
          const store: DataSecurityIssueGroupFixStoreJSON = batch[index]!;

          if (result.status === "rejected") {
            outcome.failed.push({
              dataStoreId: store.dataStoreId,
              name: store.name,
              message:
                result.reason instanceof Error
                  ? result.reason.message.slice(0, 500)
                  : String(result.reason).slice(0, 500),
            });
          } else if (result.value.changed) {
            outcome.changed++;
          } else {
            outcome.unchanged++;
          }
        },
      );
    }

    return outcome;
  }

  // The group's pull request task, for #10368 to follow it to production.
  public static async getFixTaskId(data: {
    projectId: ObjectID;
    groupId: ObjectID;
  }): Promise<ObjectID | null> {
    const group: DataSecurityIssueGroup | null =
      await DataSecurityIssueGroupService.findOneBy({
        query: { _id: data.groupId, projectId: data.projectId },
        select: { _id: true, codeTaskId: true },
        props: ROOT,
      });

    return group?.codeTaskId || null;
  }

  /*
   * Where a group's pull request stands, for this reader: being written,
   * open (with the pull request, for a reader of its repository), waiting
   * for them, ended without one, or failed - or nothing of it, for a task
   * a reply carried a private record into that they do not see.
   */
  public static async readFixState(data: {
    projectId: ObjectID;
    taskId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<DataSecurityIssueGroupFixStateJSON | null> {
    try {
      const task: AIRun | null = await AIRunService.findOneBy({
        query: { _id: data.taskId.toString(), projectId: data.projectId },
        select: {
          _id: true,
          status: true,
          needsUserInput: true,
          codeRepositoryId: true,
        },
        props: ROOT,
      });

      if (!task?.id) {
        return null;
      }

      const hidden: Set<string> = data.props.isRoot
        ? new Set()
        : await CodeTaskThread.findTasksHiddenFrom({
            projectId: data.projectId,
            taskIds: [task.id],
            reader: data.props,
          });

      if (hidden.has(idOf(task))) {
        return { taskId: "", state: DeclaredCodeChangeState.Hidden };
      }

      const [replies, pullRequests]: [
        Map<string, CodeTaskRepliesRead>,
        Map<string, AIAgentTaskPullRequest>,
      ] = await Promise.all([
        CodeTaskListRows.readReplies({
          projectId: data.projectId,
          taskIds: [task.id],
        }),
        CodeTaskListRows.readPullRequests({
          projectId: data.projectId,
          taskIds: [task.id],
        }),
      ]);
      const key: string = CodeTaskListRows.key(task.id);
      const latest: AIRun = replies.get(key)?.newest || task;
      const pullRequest: AIAgentTaskPullRequest | undefined =
        pullRequests.get(key);
      const taskState: CodeTaskState = CodeTaskStateUtil.fromRun(latest);
      let readableName: string | undefined;

      try {
        const readable: Array<CodeRepository> = data.props.isRoot
          ? []
          : await CodeTaskAccess.listReadableRepositories({
              props: data.props,
              projectId: data.projectId,
            });
        const repository: CodeRepository | undefined = readable.find(
          (candidate: CodeRepository): boolean => {
            return idOf(candidate) === idOf({ id: task.codeRepositoryId });
          },
        );

        readableName = repository
          ? getRepositoryFullName({
              name: repository.name || "",
              organizationName: repository.organizationName || "",
              repositoryName: repository.repositoryName || "",
            })
          : undefined;
      } catch {
        readableName = undefined;
      }

      const state: DeclaredCodeChangeState = pullRequest
        ? DeclaredCodeChangeState.Opened
        : taskState === CodeTaskState.Working
          ? DeclaredCodeChangeState.Writing
          : taskState === CodeTaskState.WaitingForYou
            ? DeclaredCodeChangeState.WaitingForYou
            : taskState === CodeTaskState.Failed ||
                taskState === CodeTaskState.Stopped
              ? DeclaredCodeChangeState.Failed
              : DeclaredCodeChangeState.Ended;

      return {
        taskId: task.id.toString(),
        state,
        ...(readableName ? { repositoryName: readableName } : {}),
        ...(pullRequest && readableName && pullRequest.pullRequestUrl
          ? {
              pullRequestUrl: pullRequest.pullRequestUrl.toString(),
              ...(pullRequest.pullRequestNumber
                ? { pullRequestNumber: pullRequest.pullRequestNumber }
                : {}),
            }
          : {}),
      };
    } catch (error) {
      logger.debug(
        `DataSecurity group fix: could not read task ${data.taskId.toString()}: ${error}`,
      );
      return null;
    }
  }

  /*
   * A pull request a Code task opened (CodeFixPullRequestRecord): when the
   * task fixes a group's cause - its first turn's context names the group -
   * each of the group's open issues says so (noteOnGroupIssues). Never
   * throws.
   */
  @CaptureSpan()
  public static async onPullRequestOpened(data: {
    projectId: ObjectID;
    aiRunId: ObjectID;
    pullRequestUrl: string;
    title: string;
  }): Promise<void> {
    try {
      const run: AIRun | null = await AIRunService.findOneBy({
        query: { _id: data.aiRunId.toString(), projectId: data.projectId },
        select: { _id: true, codeTaskId: true, taskContext: true },
        props: ROOT,
      });
      // A reply's pull request is its task's: the first turn holds the group.
      const task: AIRun | null =
        run && run.codeTaskId
          ? await AIRunService.findOneBy({
              query: {
                _id: run.codeTaskId.toString(),
                projectId: data.projectId,
              },
              select: { _id: true, taskContext: true },
              props: ROOT,
            })
          : run;
      const fix: InfrastructureFixTaskContext | null =
        getInfrastructureFixTaskContext(task?.taskContext?.infrastructureFix);

      if (!fix) {
        return;
      }

      await DataSecurityIssueGroupFix.noteOnGroupIssues({
        projectId: data.projectId,
        groupId: fix.groupId,
        pullRequestUrl: data.pullRequestUrl,
        title: data.title,
      });
    } catch (error) {
      logger.error(
        `DataSecurity group fix: could not read run ${data.aiRunId.toString()}'s pull request: ${error}`,
      );
    }
  }

  /*
   * A pull request a group's task opened: each of the group's open issues
   * says so on its timeline, with the link - the issue keeps the pull
   * request that fixes its cause. Never throws.
   */
  public static async noteOnGroupIssues(data: {
    projectId: ObjectID;
    groupId: string;
    pullRequestUrl: string;
    title: string;
  }): Promise<void> {
    try {
      if (!ObjectID.isValidUUID(data.groupId)) {
        return;
      }

      const issues: Array<DataSecurityIssue> =
        await DataSecurityIssueService.findBy({
          query: {
            projectId: data.projectId,
            dataSecurityIssueGroupId: new ObjectID(data.groupId),
            status: DataSecurityIssueStatus.Open,
          },
          select: { _id: true },
          skip: 0,
          limit: MAX_GROUP_FIX_ISSUES,
          props: ROOT,
        });
      const isWebAddress: boolean =
        data.pullRequestUrl.startsWith("https://") ||
        data.pullRequestUrl.startsWith("http://");
      const markdown: string = (
        isWebAddress
          ? mdText`OneUptime AI opened one pull request that fixes this issue's cause, for every issue of its group: [${data.title}](${data.pullRequestUrl}). This issue resolves on its own once its check passes after the change is applied.`
          : mdText`OneUptime AI opened one pull request that fixes this issue's cause, for every issue of its group: ${data.title}. This issue resolves on its own once its check passes after the change is applied.`
      ).toString();

      for (const issue of issues) {
        await DataSecurityIssueFeedService.createDataSecurityIssueFeedItem({
          projectId: data.projectId,
          dataSecurityIssueId: issue.id!,
          eventType: DataSecurityIssueFeedEventType.AiFixRequested,
          displayColor: Purple500,
          feedInfoInMarkdown: markdown,
        });
      }
    } catch (error) {
      logger.error(
        `DataSecurity group fix: could not say that group ${data.groupId} has a pull request: ${error}`,
      );
    }
  }
}
