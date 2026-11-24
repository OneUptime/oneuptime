import AIAgentTaskPullRequest from "../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import DataSecurityIssueGroup from "../../../Models/DatabaseModels/DataSecurityIssueGroup";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import DataStoreFinding from "../../../Models/DatabaseModels/DataStoreFinding";
import AIRunType from "../../../Types/AI/AIRunType";
import {
  InfrastructureFixTaskContext,
  TelemetryLeakFixTaskContext,
  getInfrastructureFixTaskContext,
  getTelemetryLeakFixIssueIds,
  getTelemetryLeakFixTaskContext,
} from "../../../Types/AI/CodeFixTaskContext";
import CodeFixTaskType, {
  CodeFixTaskTypeHelper,
} from "../../../Types/AI/CodeFixTaskType";
import { CodeTaskState, CodeTaskStateUtil } from "../../../Types/AI/CodeTask";
import FixProductionReport from "../../../Types/AI/FixProductionReport";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import {
  DataSecurityIssueCodeFixJSON,
  DataSecurityIssueCodeFixPullRequestJSON,
  DataSecurityIssueCodeFixResult,
  DataSecuritySecretSighting,
} from "../../../Types/DataSecurity/DataSecurityApiTypes";
import {
  SECRETS_IN_TELEMETRY_CHECK_ID,
  getTelemetryCheckIdOfDataType,
} from "../../../Types/DataSecurity/DataSecurityCheckCatalog";
import DataTypeNamer from "../../../Types/DataSecurity/DataTypeNamer";
import {
  TelemetryLeakSignal,
  getTelemetryLeakSignal,
} from "../../../Types/DataSecurity/TelemetryLeakFix";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../Types/ObjectID";
import { DeclaredCodeChangeState } from "../../../Utils/AiRemediation/DeclaredCodeChange";
import AIRunService from "../../Services/AIRunService";
import DataSecurityIssueGroupService from "../../Services/DataSecurityIssueGroupService";
import DataSecurityIssueService from "../../Services/DataSecurityIssueService";
import DataStoreFindingService from "../../Services/DataStoreFindingService";
import DataStoreService from "../../Services/DataStoreService";
import FixProductionReportUtil from "../AI/CodeFix/FixProductionReportUtil";
import CodeTaskAccess from "../AI/CodeTask/CodeTaskAccess";
import CodeTaskListRows, {
  CodeTaskRepliesRead,
} from "../AI/CodeTask/CodeTaskListRows";
import CodeTaskThread from "../AI/CodeTask/CodeTaskThread";
import { getRepositoryFullName } from "../AI/Remediation/DeclaredCodeOwner";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import ProjectDataTypeNames from "./ProjectDataTypeNames";

/*
 * WHERE A DATA SECURITY ISSUE'S FIX IN CODE STANDS (#10367).
 *
 * "The issue keeps its fix": the Code task whose pull request fixes it -
 * the issue's own (DataSecurityIssue.codeFixTaskId: Fix with AI's, or the
 * one pull request that stops its service writing all of its telemetry
 * leaks), else the newest code fix Fix with AI asked for it before it kept
 * one (AIRun.triggeredByDataSecurityIssueId), else its group's (#10370) -
 * read for the person on its page:
 *
 *   - how the task stands: being written, open as a pull request, waiting
 *     for them, ended without one, or failed (DeclaredCodeChangeState) - and
 *     nothing of it, but that it is there, for a task a reply carried a
 *     private record into that they do not see;
 *   - its pull request's own state - open, merged or closed - with its
 *     link for a reader of its repository, and what production showed once
 *     it merged (#10368 writes it on the pull request's row);
 *   - how many issues it fixes, and for which service.
 *
 * For a secret's issue it also lists where the secret was seen - a code
 * fix stops new copies only, and a person rotates it - from the issue's
 * store's findings, read with the person's own permissions.
 */

const ROOT: { isRoot: true } = { isRoot: true };

// The most places a secret's issue lists where it was seen.
export const MAX_SECRET_SIGHTINGS: number = 10;

function idOf(record: { id?: ObjectID | null; _id?: unknown }): string {
  return (record.id?.toString() || String(record._id || "")).toLowerCase();
}

export default class DataSecurityIssueCodeFix {
  /*
   * The issue's fix in code, as the reader may read it, and - for a
   * secret's - where it was seen. The issue must be one the reader may
   * read: one of another project, or one they may not, is not found.
   */
  @CaptureSpan()
  public static async read(data: {
    projectId: ObjectID;
    issueId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<DataSecurityIssueCodeFixResult> {
    const readable: DataSecurityIssue | null =
      await DataSecurityIssueService.findOneBy({
        query: { _id: data.issueId, projectId: data.projectId },
        select: { _id: true },
        props: data.props,
      });

    if (!readable?.id) {
      throw new NotFoundException("Issue not found.");
    }

    const issue: DataSecurityIssue | null =
      await DataSecurityIssueService.findOneBy({
        query: { _id: data.issueId, projectId: data.projectId },
        select: {
          _id: true,
          checkId: true,
          dataStoreId: true,
          codeFixTaskId: true,
          dataSecurityIssueGroupId: true,
        },
        props: ROOT,
      });

    if (!issue?.id) {
      throw new NotFoundException("Issue not found.");
    }

    const taskId: ObjectID | null = await DataSecurityIssueCodeFix.findTaskId({
      projectId: data.projectId,
      issue,
    });
    const fix: DataSecurityIssueCodeFixJSON | null = taskId
      ? await DataSecurityIssueCodeFix.readTask({
          projectId: data.projectId,
          taskId,
          props: data.props,
        })
      : null;
    const result: DataSecurityIssueCodeFixResult = { fix };

    if (issue.checkId === SECRETS_IN_TELEMETRY_CHECK_ID && issue.dataStoreId) {
      result.secretSightings = await DataSecurityIssueCodeFix.readSecretSightings(
        {
          projectId: data.projectId,
          dataStoreId: issue.dataStoreId,
          props: data.props,
        },
      );
    }

    return result;
  }

  /*
   * The issue's fix's task: its own, else the newest code fix asked for it,
   * else its group's. Null when no fix was asked for.
   */
  public static async findTaskId(data: {
    projectId: ObjectID;
    issue: Pick<
      DataSecurityIssue,
      "id" | "_id" | "codeFixTaskId" | "dataSecurityIssueGroupId"
    >;
  }): Promise<ObjectID | null> {
    if (data.issue.codeFixTaskId) {
      return data.issue.codeFixTaskId;
    }

    const asked: AIRun | null = await AIRunService.findOneBy({
      query: {
        projectId: data.projectId,
        runType: AIRunType.CodeFix,
        triggeredByDataSecurityIssueId: new ObjectID(idOf(data.issue)),
      },
      select: { _id: true, codeTaskId: true },
      sort: { createdAt: SortOrder.Descending },
      props: ROOT,
    });

    if (asked) {
      return asked.codeTaskId || asked.id || null;
    }

    if (data.issue.dataSecurityIssueGroupId) {
      const group: DataSecurityIssueGroup | null =
        await DataSecurityIssueGroupService.findOneBy({
          query: {
            _id: data.issue.dataSecurityIssueGroupId,
            projectId: data.projectId,
          },
          select: { _id: true, codeTaskId: true },
          props: ROOT,
        });

      return group?.codeTaskId || null;
    }

    return null;
  }

  /*
   * Where a task stands, for this reader (see the module comment) - or
   * null when it is not one of the project's code tasks.
   */
  public static async readTask(data: {
    projectId: ObjectID;
    taskId: ObjectID;
    props: DatabaseCommonInteractionProps;
    // What the caller knows already: how many issues it fixes, its service.
    issueCount?: number | undefined;
    serviceName?: string | undefined;
  }): Promise<DataSecurityIssueCodeFixJSON | null> {
    try {
      const task: AIRun | null = await AIRunService.findOneBy({
        query: {
          _id: data.taskId.toString(),
          projectId: data.projectId,
          runType: AIRunType.CodeFix,
        },
        select: {
          _id: true,
          status: true,
          needsUserInput: true,
          codeRepositoryId: true,
          codeFixTaskType: true,
          taskContext: true,
        },
        props: ROOT,
      });

      if (!task?.id) {
        return null;
      }

      const recipe: CodeFixTaskType = CodeFixTaskTypeHelper.fromDatabaseValue(
        task.codeFixTaskType,
      );
      const hidden: Set<string> = data.props.isRoot
        ? new Set()
        : await CodeTaskThread.findTasksHiddenFrom({
            projectId: data.projectId,
            taskIds: [task.id],
            reader: data.props,
          });

      if (hidden.has(idOf(task))) {
        return {
          taskId: "",
          recipe,
          state: DeclaredCodeChangeState.Hidden,
          issueCount: data.issueCount || 1,
        };
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
      const repositoryName: string | undefined =
        await DataSecurityIssueCodeFix.readableRepositoryName({
          projectId: data.projectId,
          props: data.props,
          repositoryId: task.codeRepositoryId,
        });
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
      const telemetryLeakFix: TelemetryLeakFixTaskContext | null =
        recipe === CodeFixTaskType.FixSensitiveDataInTelemetry
          ? getTelemetryLeakFixTaskContext(task.taskContext?.telemetryLeakFix)
          : null;
      const infrastructureFix: InfrastructureFixTaskContext | null =
        recipe === CodeFixTaskType.FixInfrastructureCode
          ? getInfrastructureFixTaskContext(task.taskContext?.infrastructureFix)
          : null;
      const issueCount: number =
        data.issueCount ||
        (telemetryLeakFix
          ? getTelemetryLeakFixIssueIds(telemetryLeakFix).length
          : infrastructureFix
            ? infrastructureFix.storeCount
            : 1);
      const serviceName: string =
        data.serviceName || telemetryLeakFix?.serviceName || "";
      const fix: DataSecurityIssueCodeFixJSON = {
        taskId: task.id.toString(),
        recipe,
        state,
        issueCount: Math.max(1, issueCount),
        ...(repositoryName ? { repositoryName } : {}),
        ...(serviceName ? { serviceName } : {}),
      };

      if (pullRequest) {
        const production: FixProductionReport | undefined =
          FixProductionReportUtil.fromPullRequest(pullRequest);
        const shown: DataSecurityIssueCodeFixPullRequestJSON = {
          state: String(pullRequest.pullRequestState || "open"),
          ...(pullRequest.title ? { title: pullRequest.title } : {}),
          ...(pullRequest.pullRequestNumber
            ? { number: pullRequest.pullRequestNumber }
            : {}),
          // Its link, for a reader of its repository only.
          ...(repositoryName && pullRequest.pullRequestUrl
            ? { url: pullRequest.pullRequestUrl.toString() }
            : {}),
          ...(production ? { production } : {}),
        };

        fix.pullRequest = shown;
      }

      return fix;
    } catch (error) {
      logger.debug(
        `DataSecurity code fix: could not read task ${data.taskId.toString()}: ${error}`,
      );
      return null;
    }
  }

  // The repository's name, for a reader who may read it in Code.
  private static async readableRepositoryName(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    repositoryId: ObjectID | undefined;
  }): Promise<string | undefined> {
    if (!data.repositoryId) {
      return undefined;
    }

    try {
      const readable: Array<CodeRepository> = data.props.isRoot
        ? []
        : await CodeTaskAccess.listReadableRepositories({
            props: data.props,
            projectId: data.projectId,
          });
      const repository: CodeRepository | undefined = readable.find(
        (candidate: CodeRepository): boolean => {
          return idOf(candidate) === idOf({ id: data.repositoryId || null });
        },
      );

      return repository
        ? getRepositoryFullName({
            name: repository.name || "",
            organizationName: repository.organizationName || "",
            repositoryName: repository.repositoryName || "",
          })
        : undefined;
    } catch {
      return undefined;
    }
  }

  /*
   * Where a secret's issue's store saw secrets: each finding of a secret's
   * type - its data type, location and when it was first and last seen -
   * read with the reader's own permissions, the newest first. None for a
   * reader who may not read the store's findings.
   */
  public static async readSecretSightings(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<DataSecuritySecretSighting>> {
    try {
      const store: DataStore | null = await DataStoreService.findOneBy({
        query: { _id: data.dataStoreId, projectId: data.projectId },
        select: { _id: true, name: true, kind: true },
        props: ROOT,
      });
      const findings: Array<DataStoreFinding> =
        await DataStoreFindingService.findBy({
          query: {
            projectId: data.projectId,
            dataStoreId: data.dataStoreId,
            isSuppressed: false,
          },
          select: {
            _id: true,
            dataTypeId: true,
            dataTypeName: true,
            location: true,
            firstSeenAt: true,
            lastSeenAt: true,
          },
          sort: { lastSeenAt: SortOrder.Descending },
          skip: 0,
          limit: 100,
          props: data.props,
        });
      const namer: DataTypeNamer = await ProjectDataTypeNames.read({
        projectId: data.projectId,
        props: data.props,
      });
      const signal: TelemetryLeakSignal | null = getTelemetryLeakSignal(
        store?.kind,
      );

      return findings
        .filter((finding: DataStoreFinding): boolean => {
          return (
            Boolean(finding.dataTypeId && finding.location) &&
            getTelemetryCheckIdOfDataType(finding.dataTypeId!) ===
              SECRETS_IN_TELEMETRY_CHECK_ID
          );
        })
        .slice(0, MAX_SECRET_SIGHTINGS)
        .map((finding: DataStoreFinding): DataSecuritySecretSighting => {
          return {
            dataTypeName: namer.nameOf(
              finding.dataTypeId!,
              finding.dataTypeName,
            ),
            location: finding.location!,
            storeName: store?.name || "",
            ...(signal ? { signal } : {}),
            ...(finding.firstSeenAt
              ? { firstSeenAt: new Date(finding.firstSeenAt).toISOString() }
              : {}),
            ...(finding.lastSeenAt
              ? { lastSeenAt: new Date(finding.lastSeenAt).toISOString() }
              : {}),
          };
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
  }
}
