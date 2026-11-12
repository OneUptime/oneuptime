import AIAgentTaskPullRequest from "../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import { AlertFeedEventType } from "../../../Models/DatabaseModels/AlertFeed";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import { IncidentFeedEventType } from "../../../Models/DatabaseModels/IncidentFeed";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import AIRunType from "../../../Types/AI/AIRunType";
import {
  CodeTaskContextInput,
  CodeTaskContextItem,
  CodeTaskContextType,
  CodeTaskState,
  CodeTaskStateUtil,
} from "../../../Types/AI/CodeTask";
import {
  AiRemediationCommand,
  AiRemediationCommandExecutionStatus,
  AiRemediationCommandPlan,
  AiRemediationCommandPlanUtil,
} from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { Indigo500 } from "../../../Types/BrandColors";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType, {
  isCloudAiResourceType,
} from "../../../Types/ResourceAiAgent/AiResourceType";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import {
  DeclaredCode,
  DeclaredCodeChangeJSON,
  DeclaredCodeChangeState,
  DeclaredCodeChangeTaskContext,
  DeclaredCodeOwnerCandidateJSON,
  DeclaredCodeOwnerJSON,
  DeclaredResourceFacts,
  LastingCloudChange,
  getDeclaredCodeChangeRequest,
  getDeclaredCodeTarget,
  getLastingCloudChange,
  readDeclaredCode,
  readDeclaredCodeChangeTaskContext,
} from "../../../Utils/AiRemediation/DeclaredCodeChange";
import {
  getCloudOperation,
  readCloudReplacedValue,
} from "../../../Utils/AiRemediation/Resource/CloudOperationCatalog";
import { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import { DashboardClientUrl } from "../../EnvironmentConfig";
import QueryHelper from "../../Types/Database/QueryHelper";
import AIRunService from "../../Services/AIRunService";
import AlertFeedService from "../../Services/AlertFeedService";
import AutoRemediationSuggestionService from "../../Services/AutoRemediationSuggestionService";
import IncidentFeedService from "../../Services/IncidentFeedService";
import CodeTaskAccess from "../AI/CodeTask/CodeTaskAccess";
import CodeTaskContextBuilder from "../AI/CodeTask/CodeTaskContextBuilder";
import CodeTaskGate from "../AI/CodeTask/CodeTaskGate";
import CodeTaskListRows, {
  CodeTaskRepliesRead,
} from "../AI/CodeTask/CodeTaskListRows";
import CodeTaskRuns from "../AI/CodeTask/CodeTaskRuns";
import DeclaredCodeOwner, {
  DeclaredCodeOwnerCandidate,
  getRepositoryFullName,
} from "../AI/Remediation/DeclaredCodeOwner";
import CloudAiTargets, {
  CloudChangeTarget,
} from "../AI/ResourceAccess/CloudAiTargets";
import logger from "../Logger";
import ProductBrandingText from "../ProductBrandingText";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * A FIX THAT LASTS: A PULL REQUEST TO THE CODE THAT DECLARES THE RESOURCE.
 *
 * A step of OneUptime AI's fix that changes a cloud resource declared as
 * code (its plan's command carries managedAsCode) is only ever proposed,
 * because the next apply would put the old value back. From the fix's card
 * a person can also ask for a pull request to that code with the same
 * change - beside the live change, or instead of it:
 *
 *   - getOwner: the repositories connected to Code that may hold the code,
 *     ranked (DeclaredCodeOwner), each the reader may read, with whether
 *     they may ask AI to work in it - what the dialog that asks before
 *     opening the pull request shows;
 *   - start: a Code task in the repository the person confirmed, asked as
 *     they would ask in Code - the same permission (CodeTaskAccess) and the
 *     same gate (CodeTaskGate) - with the request written from the change
 *     (getDeclaredCodeChangeRequest), and the incident or alert as its
 *     context. A step that already has a task that has not failed gets that
 *     one back. The incident's or alert's feed, and so its Slack and Teams
 *     channels, say who asked, with a link to the task;
 *   - list: each step's task as it stands - being written, opened (with its
 *     pull request), ended without one, or failed;
 *   - onPullRequestOpened: the task's pull request, on the incident's or
 *     alert's feed and channels, when the Runner records it.
 *
 * Only a change whose value the code declares (getLastingCloudChange) has
 * a pull request: a restart or a reboot leaves nothing for an apply to
 * undo. Nothing here changes the fix: approving or dismissing it stays the
 * person's choice.
 */

// The most Code tasks of one fix read at once.
const MAX_TASKS_PER_FIX: number = 50;

// What a step needs to be asked for in the code.
interface DeclaredStep {
  suggestion: AutoRemediationSuggestion;
  command: AiRemediationCommand;
  change: LastingCloudChange;
  declaredCode: DeclaredCode;
  resource: DeclaredResourceFacts;
}

export const DECLARED_CODE_NOT_DECLARED_MESSAGE: string =
  "This step's resource is not declared as code, so there is no code to change.";

export const DECLARED_CODE_NOT_LASTING_MESSAGE: string =
  "This step's change sets nothing the code declares - a restart, a reboot, a start or a fail over is not undone by the next apply - so there is no code to change.";

export const DECLARED_CODE_STEP_NOT_FOUND_MESSAGE: string =
  "This fix has no such step.";

function readSequence(value: unknown): number {
  const sequence: number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value.trim())
        : NaN;

  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new BadDataException("sequence must be a step of the fix.");
  }

  return sequence;
}

/*
 * The fix a person asked about, read under their own permissions: one they
 * may not read is answered exactly as one that does not exist.
 */
async function findReadableSuggestionId(
  value: unknown,
  props: DatabaseCommonInteractionProps,
): Promise<ObjectID> {
  if (typeof value !== "string" || !ObjectID.isValidUUID(value)) {
    throw new BadDataException("suggestionId is required.");
  }

  const suggestion: AutoRemediationSuggestion | null =
    await AutoRemediationSuggestionService.findOneById({
      id: new ObjectID(value),
      select: { _id: true },
      props,
    });

  if (!suggestion || !suggestion.id) {
    throw new BadDataException(
      "Auto-remediation suggestion not found (or you do not have access to it).",
    );
  }

  return suggestion.id;
}

// The Dashboard's page of a Code task.
export function getCodeTaskPageUrl(data: {
  projectId: ObjectID;
  taskId: ObjectID;
}): string {
  return `${DashboardClientUrl.toString()}/${data.projectId.toString()}/code/tasks/${data.taskId.toString()}`;
}

export default class DeclaredCodeChanges {
  /*
   * The step a person asked about, in a fix they may read, in the tenant
   * they asked in: one that changes a value of a cloud resource declared
   * as code.
   */
  private static async readStep(data: {
    props: DatabaseCommonInteractionProps;
    tenantId: ObjectID;
    suggestionId: unknown;
    sequence: unknown;
  }): Promise<DeclaredStep> {
    const sequence: number = readSequence(data.sequence);
    const suggestionId: ObjectID = await findReadableSuggestionId(
      data.suggestionId,
      data.props,
    );
    const suggestion: AutoRemediationSuggestion | null =
      await AutoRemediationSuggestionService.findOneBy({
        query: { _id: suggestionId.toString(), projectId: data.tenantId },
        select: {
          _id: true,
          projectId: true,
          incidentId: true,
          alertId: true,
          status: true,
          commandPlan: true,
        },
        props: { isRoot: true },
      });

    if (!suggestion || !suggestion.id || !suggestion.projectId) {
      throw new BadDataException(
        "Auto-remediation suggestion not found (or you do not have access to it).",
      );
    }

    const plan: AiRemediationCommandPlan | null =
      AiRemediationCommandPlanUtil.parse(suggestion.commandPlan);
    const command: AiRemediationCommand | undefined = plan?.commands.find(
      (candidate: AiRemediationCommand): boolean => {
        return candidate.sequence === sequence;
      },
    );

    if (!command) {
      throw new BadDataException(DECLARED_CODE_STEP_NOT_FOUND_MESSAGE);
    }

    const declaredCode: DeclaredCode | null = readDeclaredCode(
      command.managedAsCode,
    );

    if (
      command.stepType !== RunbookStepType.ResourceCommand ||
      !isCloudAiResourceType(command.resourceType) ||
      !command.resourceId ||
      !ObjectID.isValidUUID(command.resourceId) ||
      !declaredCode
    ) {
      throw new BadDataException(DECLARED_CODE_NOT_DECLARED_MESSAGE);
    }

    const change: LastingCloudChange | null = getLastingCloudChange({
      resourceType: command.resourceType,
      command: command.command,
    });

    if (!change) {
      throw new BadDataException(DECLARED_CODE_NOT_LASTING_MESSAGE);
    }

    // The resource as the account's inventory has it: its name and tags.
    const target: CloudChangeTarget | null =
      await CloudAiTargets.findChangeTarget({
        projectId: suggestion.projectId,
        resourceType: command.resourceType as AiResourceType,
        cloudAccountId: new ObjectID(command.resourceId),
        providerResourceId: change.resourceId,
      });
    const tags: Dictionary<string> = target?.cloudTags || {};

    return {
      suggestion,
      command,
      change,
      declaredCode,
      resource: {
        providerResourceId: target?.providerResourceId || change.resourceId,
        name: target?.name || change.resourceName,
        tags: Object.keys(tags).reduce(
          (
            all: Record<string, string>,
            key: string,
          ): Record<string, string> => {
            if (typeof tags[key] === "string") {
              all[key] = tags[key] as string;
            }
            return all;
          },
          {},
        ),
      },
    };
  }

  // What the dialog that asks before opening the pull request shows.
  @CaptureSpan()
  public static async getOwner(data: {
    props: DatabaseCommonInteractionProps;
    tenantId: ObjectID;
    suggestionId: unknown;
    sequence: unknown;
  }): Promise<DeclaredCodeOwnerJSON> {
    const step: DeclaredStep = await DeclaredCodeChanges.readStep(data);
    const projectId: ObjectID = step.suggestion.projectId!;

    const [ranked, readable]: [
      Array<DeclaredCodeOwnerCandidate>,
      Array<CodeRepository>,
    ] = await Promise.all([
      DeclaredCodeOwner.findCandidates({
        projectId,
        declaredCode: step.declaredCode,
        resource: { name: step.resource.name, tags: step.resource.tags },
      }),
      CodeTaskAccess.listReadableRepositories({
        props: data.props,
        projectId,
      }),
    ]);

    // Only the repositories the reader may read are named to them.
    const readableIds: Set<string> = new Set<string>(
      readable.map((repository: CodeRepository): string => {
        return repository.id!.toString();
      }),
    );
    const candidates: Array<DeclaredCodeOwnerCandidate> = ranked.filter(
      (candidate: DeclaredCodeOwnerCandidate): boolean => {
        return readableIds.has(candidate.repository.id);
      },
    );
    const best: DeclaredCodeOwnerCandidate | null =
      DeclaredCodeOwner.getBest(candidates);
    const canAsk: Array<boolean> = await Promise.all(
      candidates.map(
        (candidate: DeclaredCodeOwnerCandidate): Promise<boolean> => {
          return CodeTaskAccess.canAskInRepository({
            props: data.props,
            projectId,
            repositoryId: new ObjectID(candidate.repository.id),
          });
        },
      ),
    );

    return {
      sequence: step.command.sequence,
      managedAsCode: step.command.managedAsCode || step.declaredCode.name,
      codeKind: step.declaredCode.kind,
      sentence: step.change.sentence,
      target: getDeclaredCodeTarget({
        provider: step.change.provider,
        operation: step.change.operation,
        kind: step.change.kind,
        codeKind: step.declaredCode.kind,
      }),
      candidates: candidates.map(
        (
          candidate: DeclaredCodeOwnerCandidate,
          index: number,
        ): DeclaredCodeOwnerCandidateJSON => {
          return {
            repositoryId: candidate.repository.id,
            name: candidate.repository.name,
            fullName: getRepositoryFullName(candidate.repository),
            reason: candidate.reason,
            matchedPaths: candidate.matchedPaths,
            isBest: candidate === best,
            canAsk: Boolean(canAsk[index]),
          };
        },
      ),
    };
  }

  // The value the live change replaced, when it ran and its output said.
  private static readReplacedValue(
    command: AiRemediationCommand,
    change: LastingCloudChange,
  ): string | null {
    if (
      !command.execution ||
      command.execution.status !== AiRemediationCommandExecutionStatus.Succeeded
    ) {
      return null;
    }

    const valueKey: string | null | undefined = getCloudOperation(
      change.operation,
    )?.undo?.valueKey;
    const replaced: Record<string, string> = readCloudReplacedValue(
      command.execution.output || "",
    );

    return valueKey && replaced[valueKey] ? replaced[valueKey]! : null;
  }

  /*
   * The pull request asked for: a Code task in the repository the person
   * confirmed, or the step's task already on its way.
   */
  @CaptureSpan()
  public static async start(data: {
    props: DatabaseCommonInteractionProps;
    tenantId: ObjectID;
    suggestionId: unknown;
    sequence: unknown;
    codeRepositoryId: unknown;
  }): Promise<{ taskId: string; wasAlreadyAsked: boolean }> {
    if (
      typeof data.codeRepositoryId !== "string" ||
      !ObjectID.isValidUUID(data.codeRepositoryId)
    ) {
      throw new BadDataException(
        "Choose the repository the pull request goes to.",
      );
    }

    const step: DeclaredStep = await DeclaredCodeChanges.readStep(data);
    const projectId: ObjectID = step.suggestion.projectId!;
    const suggestionId: ObjectID = step.suggestion.id!;

    // A step whose task is on its way, or done, gets that one back.
    const existing: Array<AIRun> = await DeclaredCodeChanges.findTasks({
      projectId,
      suggestionId,
    });
    const current: AIRun | undefined = existing.find((task: AIRun): boolean => {
      const context: DeclaredCodeChangeTaskContext | null =
        readDeclaredCodeChangeTaskContext(task.taskContext?.declaredCodeChange);

      return (
        context?.sequence === step.command.sequence &&
        task.status !== AIRunStatus.Error &&
        task.status !== AIRunStatus.Stale &&
        task.status !== AIRunStatus.Cancelled
      );
    });

    if (current && current.id) {
      return { taskId: current.id.toString(), wasAlreadyAsked: true };
    }

    const repositoryId: ObjectID = new ObjectID(data.codeRepositoryId);
    const repository: CodeRepository =
      await CodeTaskAccess.getReadableRepository({
        props: data.props,
        projectId,
        repositoryId,
      });

    // As asking in Code: the person's permission, then everything AI needs.
    await CodeTaskGate.assertCanStart({
      props: data.props,
      projectId,
      repository,
      canAsk: await CodeTaskAccess.canAskInRepository({
        props: data.props,
        projectId,
        repositoryId,
      }),
    });

    const message: string = getDeclaredCodeChangeRequest({
      change: step.change,
      declaredCode: step.declaredCode,
      resource: step.resource,
      command: step.command.command,
      replacedValue: DeclaredCodeChanges.readReplacedValue(
        step.command,
        step.change,
      ),
      hasLiveChangeRun:
        step.command.execution?.status ===
        AiRemediationCommandExecutionStatus.Succeeded,
    });

    // The incident or alert, as the person may read it, is the task's context.
    const inputs: Array<CodeTaskContextInput> = [];

    if (step.suggestion.incidentId) {
      inputs.push({
        type: CodeTaskContextType.Incident,
        id: step.suggestion.incidentId.toString(),
      });
    } else if (step.suggestion.alertId) {
      inputs.push({
        type: CodeTaskContextType.Alert,
        id: step.suggestion.alertId.toString(),
      });
    }

    let context: Array<CodeTaskContextItem> = [];

    try {
      context = await CodeTaskContextBuilder.build({
        inputs,
        projectId,
        props: data.props,
      });
    } catch (error) {
      // The request says what to change; the record only adds why.
      logger.debug(
        `DeclaredCodeChanges: the fix's record could not be added to the task: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const task: AIRun = await CodeTaskRuns.start({
      projectId,
      userId: data.props.userId!,
      repository,
      message,
      context,
      declaredCodeChange: {
        suggestionId: suggestionId.toString(),
        sequence: step.command.sequence,
        resourceType: String(step.command.resourceType),
        resourceId: step.command.resourceId!,
        command: step.command.command,
        managedAsCode: step.command.managedAsCode || step.declaredCode.name,
      },
    });

    /*
     * "Maya Chen asked OneUptime AI for a pull request to the Terraform code
     * in acme/infra: Scale the ECS service web out to 4 tasks." - the change
     * names its resource, so the note does not name it twice. The product's
     * name is the installation's: the note reaches Slack and Teams as written.
     */
    await DeclaredCodeChanges.postFeedNote({
      suggestion: step.suggestion,
      userId: data.props.userId!,
      leadWithAuthor: true,
      markdown:
        mdText`asked ${ProductBrandingText.getProductName()} AI for a pull request to the ${
          step.declaredCode.name
        } code in ${getRepositoryFullName({
          name: repository.name || "",
          organizationName: repository.organizationName || "",
          repositoryName: repository.repositoryName || "",
        })}: ${step.change.sentence}. [View the task](${getCodeTaskPageUrl({
          projectId,
          taskId: task.id!,
        })})`.toString(),
    });

    return { taskId: task.id!.toString(), wasAlreadyAsked: false };
  }

  // Each step's task as it stands, for whoever may read the fix.
  @CaptureSpan()
  public static async list(data: {
    props: DatabaseCommonInteractionProps;
    tenantId: ObjectID;
    suggestionId: unknown;
  }): Promise<{ changes: Array<DeclaredCodeChangeJSON> }> {
    const suggestionId: ObjectID = await findReadableSuggestionId(
      data.suggestionId,
      data.props,
    );
    const tasks: Array<AIRun> = await DeclaredCodeChanges.findTasks({
      projectId: data.tenantId,
      suggestionId,
    });

    if (tasks.length === 0) {
      return { changes: [] };
    }

    // The newest task of each step: an older one failed, and was asked again.
    const latestBySequence: Map<number, AIRun> = new Map<number, AIRun>();

    for (const task of tasks) {
      const context: DeclaredCodeChangeTaskContext | null =
        readDeclaredCodeChangeTaskContext(task.taskContext?.declaredCodeChange);

      if (context && !latestBySequence.has(context.sequence)) {
        latestBySequence.set(context.sequence, task);
      }
    }

    const taskIds: Array<ObjectID> = Array.from(latestBySequence.values()).map(
      (task: AIRun): ObjectID => {
        return task.id!;
      },
    );

    /*
     * Each step's task as it stands: its newest turn and the pull request
     * it shows, read per task however many turns it has (CodeTaskListRows)
     * - a task kept open as a working thread never reads as it stood
     * months ago.
     */
    const [replies, pullRequests, readable]: [
      Map<string, CodeTaskRepliesRead>,
      Map<string, AIAgentTaskPullRequest>,
      Array<CodeRepository>,
    ] = await Promise.all([
      CodeTaskListRows.readReplies({ projectId: data.tenantId, taskIds }),
      CodeTaskListRows.readPullRequests({ projectId: data.tenantId, taskIds }),
      CodeTaskAccess.listReadableRepositories({
        props: data.props,
        projectId: data.tenantId,
      }),
    ]);
    const readableNames: Map<string, string> = new Map<string, string>(
      readable.map((repository: CodeRepository): [string, string] => {
        return [
          repository.id!.toString(),
          getRepositoryFullName({
            name: repository.name || "",
            organizationName: repository.organizationName || "",
            repositoryName: repository.repositoryName || "",
          }),
        ];
      }),
    );

    const changes: Array<DeclaredCodeChangeJSON> = [];

    for (const [sequence, task] of latestBySequence) {
      const key: string = CodeTaskListRows.key(task.id!);
      const latest: AIRun = replies.get(key)?.newest || task;
      // The newest open one any turn opened, else the newest.
      const pullRequest: AIAgentTaskPullRequest | undefined =
        pullRequests.get(key);
      const repositoryName: string | undefined = task.codeRepositoryId
        ? readableNames.get(task.codeRepositoryId.toString())
        : undefined;
      const taskState: CodeTaskState = CodeTaskStateUtil.fromRun(latest);
      let state: DeclaredCodeChangeState;

      if (pullRequest) {
        state = DeclaredCodeChangeState.Opened;
      } else if (taskState === CodeTaskState.Working) {
        state = DeclaredCodeChangeState.Writing;
      } else if (taskState === CodeTaskState.WaitingForYou) {
        // Nothing moves until the person answers: said apart from "nothing to change".
        state = DeclaredCodeChangeState.WaitingForYou;
      } else if (
        taskState === CodeTaskState.Failed ||
        taskState === CodeTaskState.Stopped
      ) {
        state = DeclaredCodeChangeState.Failed;
      } else {
        state = DeclaredCodeChangeState.Ended;
      }

      const json: DeclaredCodeChangeJSON = {
        sequence,
        taskId: task.id!.toString(),
        repositoryName: repositoryName || "",
        state,
      };

      // The pull request, for a reader who may read its repository.
      if (pullRequest && repositoryName && pullRequest.pullRequestUrl) {
        json.pullRequestUrl = pullRequest.pullRequestUrl.toString();

        if (pullRequest.pullRequestNumber) {
          json.pullRequestNumber = pullRequest.pullRequestNumber;
        }
      }

      changes.push(json);
    }

    changes.sort(
      (left: DeclaredCodeChangeJSON, right: DeclaredCodeChangeJSON): number => {
        return left.sequence - right.sequence;
      },
    );

    return { changes };
  }

  // A fix's Code tasks, the newest first: their first turns.
  private static async findTasks(data: {
    projectId: ObjectID;
    suggestionId: ObjectID;
  }): Promise<Array<AIRun>> {
    return await AIRunService.findBy({
      query: {
        projectId: data.projectId,
        runType: AIRunType.CodeFix,
        triggeredByAutoRemediationSuggestionId: data.suggestionId,
        codeTaskId: QueryHelper.isNull(),
      },
      select: {
        _id: true,
        status: true,
        needsUserInput: true,
        taskContext: true,
        codeRepositoryId: true,
        createdAt: true,
      },
      sort: { createdAt: SortOrder.Descending },
      limit: MAX_TASKS_PER_FIX,
      skip: 0,
      props: { isRoot: true },
    });
  }

  /*
   * A pull request a Code task opened: when the task was asked from a fix,
   * its incident's or alert's feed and channels get the link. Never throws.
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
        select: {
          _id: true,
          codeTaskId: true,
          triggeredByAutoRemediationSuggestionId: true,
          taskContext: true,
        },
        props: { isRoot: true },
      });
      // A reply's pull request is its task's: the first turn holds the link.
      const task: AIRun | null =
        run && run.codeTaskId
          ? await AIRunService.findOneBy({
              query: {
                _id: run.codeTaskId.toString(),
                projectId: data.projectId,
              },
              select: {
                _id: true,
                triggeredByAutoRemediationSuggestionId: true,
                taskContext: true,
              },
              props: { isRoot: true },
            })
          : run;
      const context: DeclaredCodeChangeTaskContext | null =
        readDeclaredCodeChangeTaskContext(
          task?.taskContext?.declaredCodeChange,
        );

      if (!task || !task.triggeredByAutoRemediationSuggestionId || !context) {
        return;
      }

      const suggestion: AutoRemediationSuggestion | null =
        await AutoRemediationSuggestionService.findOneBy({
          query: {
            _id: task.triggeredByAutoRemediationSuggestionId.toString(),
            projectId: data.projectId,
          },
          select: {
            _id: true,
            projectId: true,
            incidentId: true,
            alertId: true,
          },
          props: { isRoot: true },
        });

      if (!suggestion) {
        return;
      }

      const change: LastingCloudChange | null = getLastingCloudChange({
        resourceType: context.resourceType,
        command: context.command,
      });
      const declaredCode: DeclaredCode | null = readDeclaredCode(
        context.managedAsCode,
      );

      const what: string = `${declaredCode?.name || "code"} code that declares ${
        change
          ? `the ${change.kindName} ${change.resourceName}`
          : "the resource"
      }`;
      // A web address only: the Runner reports it, and it is a link where it lands.
      const isWebAddress: boolean =
        data.pullRequestUrl.startsWith("https://") ||
        data.pullRequestUrl.startsWith("http://");
      const product: string = ProductBrandingText.getProductName();

      await DeclaredCodeChanges.postFeedNote({
        suggestion,
        leadWithAuthor: false,
        markdown: (isWebAddress
          ? mdText`${product} AI opened a pull request to the ${what}, so the next apply keeps the fix: [${data.title}](${data.pullRequestUrl})`
          : mdText`${product} AI opened a pull request to the ${what}, so the next apply keeps the fix: ${data.title}`
        ).toString(),
      });
    } catch (error) {
      logger.error(
        `DeclaredCodeChanges: could not say that run ${data.aiRunId.toString()} opened a pull request: ${error}`,
      );
    }
  }

  /*
   * A note on the fix's incident or alert, which its Slack and Teams
   * channels get too. Never throws.
   */
  private static async postFeedNote(data: {
    suggestion: AutoRemediationSuggestion;
    markdown: string;
    userId?: ObjectID | undefined;
    leadWithAuthor: boolean;
  }): Promise<void> {
    try {
      if (data.suggestion.incidentId && data.suggestion.projectId) {
        await IncidentFeedService.createIncidentFeedItem({
          incidentId: data.suggestion.incidentId,
          projectId: data.suggestion.projectId,
          incidentFeedEventType: IncidentFeedEventType.AutoRemediation,
          displayColor: Indigo500,
          feedInfoInMarkdown: data.markdown,
          ...(data.userId ? { userId: data.userId } : {}),
          workspaceNotification: {
            sendWorkspaceNotification: true,
            leadWithAuthor: data.leadWithAuthor,
          },
        });
      } else if (data.suggestion.alertId && data.suggestion.projectId) {
        await AlertFeedService.createAlertFeedItem({
          alertId: data.suggestion.alertId,
          projectId: data.suggestion.projectId,
          alertFeedEventType: AlertFeedEventType.AutoRemediation,
          displayColor: Indigo500,
          feedInfoInMarkdown: data.markdown,
          ...(data.userId ? { userId: data.userId } : {}),
          workspaceNotification: {
            sendWorkspaceNotification: true,
            leadWithAuthor: data.leadWithAuthor,
          },
        });
      }
    } catch (error) {
      logger.error(
        `DeclaredCodeChanges: could not post to the fix's feed: ${error}`,
      );
    }
  }
}
