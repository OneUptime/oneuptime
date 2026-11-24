import AIRun from "../../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import { DataSecurityIssueFeedEventType } from "../../../../Models/DatabaseModels/DataSecurityIssueFeed";
import { CodeTaskBlocker } from "../../../../Types/AI/CodeTask";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { Purple500 } from "../../../../Types/BrandColors";
import {
  DataSecurityFixRepository,
  DataSecurityFixResult,
} from "../../../../Types/DataSecurity/DataSecurityApiTypes";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../../Types/ObjectID";
import DataSecurityIssueFeedService from "../../../Services/DataSecurityIssueFeedService";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import CodeTaskAccess, {
  CODE_TASK_ASK_REFUSED_MESSAGE,
} from "../CodeTask/CodeTaskAccess";
import CodeTaskGate from "../CodeTask/CodeTaskGate";
import CodeTaskRuns from "../CodeTask/CodeTaskRuns";
import CodeFixTaskType from "../../../../Types/AI/CodeFixTaskType";
import {
  InfrastructureFixTaskContext,
  TelemetryLeakFixTaskContext,
} from "../../../../Types/AI/CodeFixTaskContext";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../../Utils/Markdown/FeedMarkdown";
import CodeRepositoryService from "../../../Services/CodeRepositoryService";
import DataSecurityIssueService from "../../../Services/DataSecurityIssueService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";
import SubjectCodeFixRun from "../SRE/SubjectCodeFixRun";
import {
  DataSecurityAiCodeRequest,
  isDataSecurityAiCodeRequest,
} from "./DataSecurityAiInput";

/*
 * A CODE CHANGE FOR DATA SECURITY ISSUES, ASKED OF ONEUPTIME AI AS THE
 * PERSON WHO ASKED (#10362).
 *
 * Fix with AI on an issue starts a Code task (CodeTaskRuns.start) that opens
 * a pull request: in the infrastructure code of a cloud store, or in the
 * code of the service that writes a telemetry issue's data. It is asked as
 * the person would ask in Code, so nothing starts that they could not have
 * started there, or that could not finish:
 *
 *   1. Whether AI can work at all, before any repository is chosen
 *      (CodeTaskGate, with no repository): the bill and the plan, the
 *      project's AI switch, an LLM provider with credits behind it, and the
 *      project's daily limits. Nobody is asked to pick a repository for a
 *      fix that cannot start.
 *   2. The repository, read with the person's own permissions
 *      (CodeTaskAccess). One they may not read cannot be named, and one
 *      they may read but not change is refused with Code's own sentence:
 *      asking AI to work in a repository takes what changing it takes.
 *      With none named, the only one they may read is the one, when they may
 *      ask in it; with several, they choose among those they may ask in.
 *   3. Whether AI can work in that repository (CodeTaskGate again): its
 *      connection to its Git server, and a Runner online to do the work.
 *
 * What stops it comes back as the answer's message, in Code's words, with
 * nothing started - so the button says what to fix. A repository the request
 * names that the person may not read is not found, and one they may not
 * change is refused, as Code answers both. A task that starts is noted on
 * the timeline of every issue it is for: a task can be for several (#10367,
 * #10370), and starts through these same checks.
 */

// Which code the change is made in: what the answers name.
export enum DataSecurityFixCode {
  // A cloud store's: Terraform, CloudFormation, Bicep or the like.
  Infrastructure = "Infrastructure",
  // The service whose telemetry carries the data: the code that writes it.
  Service = "Service",
}

export const DATA_SECURITY_FIX_STARTED_MESSAGE: string =
  "OneUptime AI is working on a fix. Its pull request will appear under Code.";

export const DATA_SECURITY_FIX_FEED_MESSAGE: string =
  "OneUptime AI was asked to open a fix as a pull request.";

/*
 * What each issue of a group says when its cause's fix is asked for
 * (#10370) - read by everyone who reads the issue, one held to labels too,
 * so it says nothing of the group's other issues (#10739).
 */
export const DATA_SECURITY_GROUP_FIX_FEED_MESSAGE: string =
  "OneUptime AI was asked to fix this issue's cause once, in one pull request to the code that declares its store.";

export const DATA_SECURITY_GROUP_FIX_STARTED_MESSAGE: string =
  "OneUptime AI is working on one pull request for the cause. It will appear under Code, and on each of the group's issues.";

// OneUptime asked for a group's fix with no repository to work in.
export const DATA_SECURITY_GROUP_FIX_NO_REPOSITORY_MESSAGE: string =
  "No repository was found for the code that declares these stores. Ask for the fix from the Issues list, and pick the repository.";

// OneUptime asked for one issue's fix with no repository to work in (#10740).
export const DATA_SECURITY_ISSUE_FIX_NO_REPOSITORY_MESSAGE: string =
  "No repository was found for the code that declares this store. Ask for the fix from the issue, and pick the repository.";

// What an issue says when a security playbook asked OneUptime AI for its fix (#10740).
export const DATA_SECURITY_PLAYBOOK_FIX_FEED_MESSAGE: string =
  "A security playbook asked OneUptime AI to open a fix for this issue as a pull request, in the code that declares its store.";

export const DATA_SECURITY_FIX_SIGN_IN_MESSAGE: string =
  "Sign in to ask OneUptime AI for a fix.";

// A service's telemetry leaks, fixed in its code in one pull request (#10367).
export const DATA_SECURITY_TELEMETRY_FIX_STARTED_MESSAGE: string =
  "OneUptime AI is working on one pull request for the service's leaks. It will appear under Code, and on each issue it fixes.";

// OneUptime asked for a service's telemetry fix with no repository to work in.
export const DATA_SECURITY_TELEMETRY_FIX_NO_REPOSITORY_MESSAGE: string =
  "No repository was found for this service's code. Ask for the fix with Fix with AI on one of its issues, and pick the repository.";

/*
 * What each issue a service's telemetry fix is for says on its timeline
 * (#10367): one pull request for all of the service's leaks - and, for a
 * secret, that the fix stops new copies only.
 */
export function getTelemetryFixFeedMessage(data: {
  serviceName: string;
  issueCount: number;
  hasSecrets: boolean;
}): string {
  const fix: MarkdownText =
    data.issueCount > 1
      ? mdText`OneUptime AI was asked for one pull request that stops ${data.serviceName || "the service"} writing sensitive data to its telemetry, for this issue and ${String(data.issueCount - 1)} more of the service's.`
      : mdText`OneUptime AI was asked for a pull request that stops ${data.serviceName || "the service"} writing this data to its telemetry.`;

  return data.hasSecrets
    ? FeedMarkdown.join(
        [
          fix,
          mdText`**Rotate the secret too:** the code fix stops new copies only. Copies already written stay where they went.`,
        ],
        " ",
      ).toString()
    : fix.toString();
}

// Readable repositories, several, none the person may ask in.
export const DATA_SECURITY_FIX_NO_ASKABLE_REPOSITORY_MESSAGE: string =
  "You can read this project's repositories in Code. Asking AI to work in one takes permission to edit it - ask a Project Admin for it.";

const CODE_NAMES: Record<DataSecurityFixCode, string> = {
  [DataSecurityFixCode.Infrastructure]: "this store's infrastructure code",
  [DataSecurityFixCode.Service]: "this service's code",
};

/*
 * No repository the person may read: none is connected, or none is theirs
 * to read - either way, what to do next.
 */
export function getDataSecurityFixNoRepositoryMessage(
  code: DataSecurityFixCode,
): string {
  return `Connect the repository that holds ${CODE_NAMES[code]} under Code, then ask again. If it is connected already, asking OneUptime AI to change it takes permission to edit it in Code - ask a Project Admin for it.`;
}

// Several repositories the person may read: which one.
export function getDataSecurityFixPickRepositoryMessage(
  code: DataSecurityFixCode,
): string {
  return `This project has several repositories: choose the one that holds ${CODE_NAMES[code]}.`;
}

export default class DataSecurityCodeTask {
  /*
   * Fix with AI on one issue: asked by a person, as the module comment
   * says - or by OneUptime, for a security playbook's Fix the code with AI
   * step on a case whose issue is in no group (#10740): with no person, it
   * works only in the repository it was given - the one the issue's declared
   * code points to, which must be the project's - the gate still decides,
   * and the run names the case, so the case keeps its pull request.
   */
  @CaptureSpan()
  public static async requestFix(data: {
    // The person who asked, with their own permissions; OneUptime's props for none.
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    // The issues the change is for: each one's timeline says it was asked for.
    issueIds: Array<ObjectID>;
    code: DataSecurityFixCode;
    // The repository the person chose, as sent: an id that is not one chooses none.
    requestedRepositoryId?: unknown;
    /*
     * The request for the coding agent, built once the task will start:
     * only one DataSecurityAiInput made (#10365), which holds no sample
     * and no record.
     */
    buildMessage: () => Promise<DataSecurityAiCodeRequest>;
    // The security case whose playbook asked, when OneUptime asks (#10740).
    triggeredBySecurityCaseId?: ObjectID | undefined;
  }): Promise<DataSecurityFixResult> {
    const userId: ObjectID | undefined = data.props.userId || undefined;

    // OneUptime asks for one issue at a time.
    if (!userId && (!data.props.isRoot || data.issueIds.length !== 1)) {
      throw new BadDataException(DATA_SECURITY_FIX_SIGN_IN_MESSAGE);
    }

    // 1. What stops any code task now, whatever the repository.
    const blockerBeforeRepository: CodeTaskBlocker | null =
      await CodeTaskGate.getBlocker({
        props: data.props,
        projectId: data.projectId,
        repository: null,
        canAsk: true,
      });

    if (blockerBeforeRepository) {
      return { message: blockerBeforeRepository.message };
    }

    // 2. The repository, as the person may read it and ask in it - or the one OneUptime was given.
    let repository: CodeRepository | null = null;

    if (userId) {
      const choice: RepositoryChoice =
        await DataSecurityCodeTask.chooseRepository({
          props: data.props,
          projectId: data.projectId,
          code: data.code,
          requestedRepositoryId: data.requestedRepositoryId,
        });

      if (!choice.repository) {
        return choice.answer;
      }

      repository = choice.repository;
    } else {
      repository = await DataSecurityCodeTask.readGivenRepository({
        projectId: data.projectId,
        requestedRepositoryId: data.requestedRepositoryId,
      });

      if (!repository?.id) {
        return { message: DATA_SECURITY_ISSUE_FIX_NO_REPOSITORY_MESSAGE };
      }
    }

    // 3. What stops AI working in it: its connection, and a Runner.
    const blocker: CodeTaskBlocker | null = await CodeTaskGate.getBlocker({
      props: data.props,
      projectId: data.projectId,
      repository,
      canAsk: true,
    });

    if (blocker) {
      return { message: blocker.message };
    }

    const request: DataSecurityAiCodeRequest = await data.buildMessage();

    if (!isDataSecurityAiCodeRequest(request)) {
      throw new BadDataException(
        "A Data Security fix takes a request built by DataSecurityAiInput.",
      );
    }

    const run: AIRun = userId
      ? await CodeTaskRuns.start({
          projectId: data.projectId,
          userId,
          repository,
          message: request.text,
          context: [],
          // A task for one issue says so; one for several is about each (#10370).
          ...(data.issueIds.length === 1
            ? { triggeredByDataSecurityIssueId: data.issueIds[0]! }
            : {}),
        })
      : await CodeTaskRuns.startForDataSecurityIssue({
          projectId: data.projectId,
          repository,
          message: request.text,
          triggeredByDataSecurityIssueId: data.issueIds[0]!,
          triggeredBySecurityCaseId: data.triggeredBySecurityCaseId,
        });

    for (const issueId of data.issueIds) {
      await DataSecurityIssueFeedService.createDataSecurityIssueFeedItem({
        projectId: data.projectId,
        dataSecurityIssueId: issueId,
        eventType: DataSecurityIssueFeedEventType.AiFixRequested,
        displayColor: Purple500,
        feedInfoInMarkdown: userId
          ? DATA_SECURITY_FIX_FEED_MESSAGE
          : DATA_SECURITY_PLAYBOOK_FIX_FEED_MESSAGE,
        ...(userId ? { userId } : {}),
      });
    }

    // The issue keeps its fix (#10367): its page shows the task and its pull request.
    if (run.id) {
      await DataSecurityCodeTask.keepFixOnIssues({
        projectId: data.projectId,
        issueIds: data.issueIds,
        taskId: run.id,
      });
    }

    return {
      message: DATA_SECURITY_FIX_STARTED_MESSAGE,
      aiRunId: run.id?.toString(),
    };
  }

  /*
   * The repository OneUptime was given, when it asks with no person: the
   * project's own, by its id - never one of another project. Null for
   * none.
   */
  private static async readGivenRepository(data: {
    projectId: ObjectID;
    requestedRepositoryId?: unknown;
  }): Promise<CodeRepository | null> {
    const requested: string =
      typeof data.requestedRepositoryId === "string"
        ? data.requestedRepositoryId.trim()
        : "";

    if (!ObjectID.isValidUUID(requested)) {
      return null;
    }

    return await CodeRepositoryService.findOneBy({
      query: { _id: requested, projectId: data.projectId },
      select: {
        _id: true,
        name: true,
        organizationName: true,
        repositoryName: true,
        repositoryHostedAt: true,
        gitHubAppInstallationId: true,
        codeRepositoryConnectionId: true,
      },
      props: { isRoot: true },
    });
  }

  /*
   * ONE PULL REQUEST THAT STOPS A SERVICE WRITING ITS TELEMETRY LEAKS
   * (#10367), in the repository its leaks are written in: a task of its own
   * recipe (CodeFixTaskType.FixSensitiveDataInTelemetry), whose context
   * carries the request the builder made and every leak - its places,
   * keys, data types and templates - and the issues its pull request lists.
   *
   * A person asks as for any fix: the gate, then a repository they may read
   * and ask in - the one the plan found or they picked, or the only one -
   * then the gate for that repository. OneUptime asks with no person (an
   * approved proposal made without asking): it works only in the repository
   * it was given, which must be the project's, and the gate still decides.
   * Each issue the fix is for says so, and keeps the task.
   */
  @CaptureSpan()
  public static async requestTelemetryLeakFix(data: {
    // The person who asked, with their own permissions; OneUptime's props for none.
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    issueIds: Array<ObjectID>;
    requestedRepositoryId?: unknown;
    // The context the task carries, but its request: built below.
    fix: Omit<TelemetryLeakFixTaskContext, "request">;
    // The provider the deciding AI rule picks, for a fix made without asking.
    llmProviderId?: ObjectID | undefined;
    buildMessage: () => Promise<DataSecurityAiCodeRequest>;
  }): Promise<DataSecurityFixResult> {
    const userId: ObjectID | undefined = data.props.userId || undefined;

    if (!userId && !data.props.isRoot) {
      throw new BadDataException(DATA_SECURITY_FIX_SIGN_IN_MESSAGE);
    }

    const blockerBeforeRepository: CodeTaskBlocker | null =
      await CodeTaskGate.getBlocker({
        props: data.props,
        projectId: data.projectId,
        repository: null,
        canAsk: true,
      });

    if (blockerBeforeRepository) {
      return { message: blockerBeforeRepository.message };
    }

    let repository: CodeRepository | null = null;

    if (userId) {
      const choice: RepositoryChoice =
        await DataSecurityCodeTask.chooseRepository({
          props: data.props,
          projectId: data.projectId,
          code: DataSecurityFixCode.Service,
          requestedRepositoryId: data.requestedRepositoryId,
        });

      if (!choice.repository) {
        return choice.answer;
      }

      repository = choice.repository;
    } else {
      const requested: string =
        typeof data.requestedRepositoryId === "string"
          ? data.requestedRepositoryId.trim()
          : "";

      repository = ObjectID.isValidUUID(requested)
        ? await CodeRepositoryService.findOneBy({
            query: { _id: requested, projectId: data.projectId },
            select: {
              _id: true,
              name: true,
              organizationName: true,
              repositoryName: true,
              repositoryHostedAt: true,
              gitHubAppInstallationId: true,
              codeRepositoryConnectionId: true,
            },
            props: { isRoot: true },
          })
        : null;

      if (!repository?.id) {
        return { message: DATA_SECURITY_TELEMETRY_FIX_NO_REPOSITORY_MESSAGE };
      }
    }

    const blocker: CodeTaskBlocker | null = await CodeTaskGate.getBlocker({
      props: data.props,
      projectId: data.projectId,
      repository,
      canAsk: true,
    });

    if (blocker) {
      return { message: blocker.message };
    }

    const request: DataSecurityAiCodeRequest = await data.buildMessage();

    if (!isDataSecurityAiCodeRequest(request)) {
      throw new BadDataException(
        "A Data Security fix takes a request built by DataSecurityAiInput.",
      );
    }

    const run: AIRun = await SubjectCodeFixRun.enqueueSubjectCodeFixRun({
      projectId: data.projectId,
      taskType: CodeFixTaskType.FixSensitiveDataInTelemetry,
      userId,
      codeRepositoryId: repository.id!,
      taskContext: {
        telemetryLeakFix: { ...data.fix, request: request.text },
      },
      ...(data.llmProviderId ? { llmProviderId: data.llmProviderId } : {}),
    });

    for (const issueId of data.issueIds) {
      await DataSecurityIssueFeedService.createDataSecurityIssueFeedItem({
        projectId: data.projectId,
        dataSecurityIssueId: issueId,
        eventType: DataSecurityIssueFeedEventType.AiFixRequested,
        displayColor: Purple500,
        feedInfoInMarkdown: getTelemetryFixFeedMessage({
          serviceName: data.fix.serviceName,
          issueCount: data.issueIds.length,
          hasSecrets: data.fix.hasSecrets,
        }),
        userId,
      });
    }

    if (run.id) {
      await DataSecurityCodeTask.keepFixOnIssues({
        projectId: data.projectId,
        issueIds: data.issueIds,
        taskId: run.id,
      });
    }

    return {
      message: DATA_SECURITY_TELEMETRY_FIX_STARTED_MESSAGE,
      aiRunId: run.id?.toString(),
    };
  }

  /*
   * Each issue a fix is for keeps its task (DataSecurityIssue.codeFixTaskId,
   * #10367): what its page reads its pull request and its state by, and
   * what #10368 follows to production. The newest asked for wins. Never
   * fails the fix: it is asked already.
   */
  public static async keepFixOnIssues(data: {
    projectId: ObjectID;
    issueIds: ReadonlyArray<ObjectID>;
    taskId: ObjectID;
  }): Promise<void> {
    if (data.issueIds.length === 0) {
      return;
    }

    try {
      await DataSecurityIssueService.updateBy({
        query: {
          projectId: data.projectId,
          _id: QueryHelper.any(
            data.issueIds.map((issueId: ObjectID): string => {
              return issueId.toString();
            }),
          ),
        },
        data: { codeFixTaskId: data.taskId },
        skip: 0,
        limit: data.issueIds.length,
        props: { isRoot: true },
      });
    } catch (error) {
      logger.error(
        `DataSecurity: could not keep task ${data.taskId.toString()} on the issues it fixes:`,
      );
      logger.error(error);
    }
  }

  /*
   * ONE PULL REQUEST FOR A GROUP OF ISSUES ONE MISTAKE MADE (#10370), in
   * the infrastructure code that declares their stores: a task of its own
   * recipe (CodeFixTaskType.FixInfrastructureCode), whose context carries
   * the request the builder made, the cause, and the stores and issues its
   * pull request lists.
   *
   * A person asks as for any fix: the gate, then a repository they may read
   * and ask in - the one they confirmed, or the only one - then the gate
   * for that repository. OneUptime asks with no person (a security
   * playbook's step, an approved proposal made without asking): it works
   * only in the repository it was given, which must be the project's, and
   * the gate still decides. Each of the group's issues says it was asked.
   */
  @CaptureSpan()
  public static async requestGroupFix(data: {
    // The person who asked, with their own permissions; OneUptime's props for none.
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    issueIds: Array<ObjectID>;
    requestedRepositoryId?: unknown;
    // The context the task carries, but its request: built below.
    fix: Omit<InfrastructureFixTaskContext, "request">;
    triggeredBySecurityCaseId?: ObjectID | undefined;
    buildMessage: () => Promise<DataSecurityAiCodeRequest>;
  }): Promise<DataSecurityFixResult> {
    const userId: ObjectID | undefined = data.props.userId || undefined;

    if (!userId && !data.props.isRoot) {
      throw new BadDataException(DATA_SECURITY_FIX_SIGN_IN_MESSAGE);
    }

    const blockerBeforeRepository: CodeTaskBlocker | null =
      await CodeTaskGate.getBlocker({
        props: data.props,
        projectId: data.projectId,
        repository: null,
        canAsk: true,
      });

    if (blockerBeforeRepository) {
      return { message: blockerBeforeRepository.message };
    }

    let repository: CodeRepository | null = null;

    if (userId) {
      const choice: RepositoryChoice =
        await DataSecurityCodeTask.chooseRepository({
          props: data.props,
          projectId: data.projectId,
          code: DataSecurityFixCode.Infrastructure,
          requestedRepositoryId: data.requestedRepositoryId,
        });

      if (!choice.repository) {
        return choice.answer;
      }

      repository = choice.repository;
    } else {
      repository = await DataSecurityCodeTask.readGivenRepository({
        projectId: data.projectId,
        requestedRepositoryId: data.requestedRepositoryId,
      });

      if (!repository?.id) {
        return { message: DATA_SECURITY_GROUP_FIX_NO_REPOSITORY_MESSAGE };
      }
    }

    const blocker: CodeTaskBlocker | null = await CodeTaskGate.getBlocker({
      props: data.props,
      projectId: data.projectId,
      repository,
      canAsk: true,
    });

    if (blocker) {
      return { message: blocker.message };
    }

    const request: DataSecurityAiCodeRequest = await data.buildMessage();

    if (!isDataSecurityAiCodeRequest(request)) {
      throw new BadDataException(
        "A Data Security fix takes a request built by DataSecurityAiInput.",
      );
    }

    const run: AIRun = await SubjectCodeFixRun.enqueueSubjectCodeFixRun({
      projectId: data.projectId,
      taskType: CodeFixTaskType.FixInfrastructureCode,
      userId,
      codeRepositoryId: repository.id!,
      taskContext: {
        infrastructureFix: { ...data.fix, request: request.text },
      },
      triggeredBySecurityCaseId: data.triggeredBySecurityCaseId,
    });

    for (const issueId of data.issueIds) {
      await DataSecurityIssueFeedService.createDataSecurityIssueFeedItem({
        projectId: data.projectId,
        dataSecurityIssueId: issueId,
        eventType: DataSecurityIssueFeedEventType.AiFixRequested,
        displayColor: Purple500,
        feedInfoInMarkdown: DATA_SECURITY_GROUP_FIX_FEED_MESSAGE,
        userId,
      });
    }

    return {
      message: DATA_SECURITY_GROUP_FIX_STARTED_MESSAGE,
      aiRunId: run.id?.toString(),
    };
  }

  /*
   * Of the repositories the person may read, those they may ask OneUptime AI
   * to work in, in the order given - every one they may read, however many
   * (#10764), asked of in one read a batch
   * (CodeTaskAccess.keepAskableRepositories).
   */
  @CaptureSpan()
  public static async getAskableRepositories(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    readable: ReadonlyArray<CodeRepository>;
  }): Promise<Array<CodeRepository>> {
    return await CodeTaskAccess.keepAskableRepositories<CodeRepository>({
      props: data.props,
      projectId: data.projectId,
      repositories: data.readable,
      getId: (repository: CodeRepository): string => {
        return repository.id?.toString() || "";
      },
    });
  }

  /*
   * The repositories the person may read in Code, by name: none for a role
   * that may read no repository at all (a Security Admin's, a Security
   * Member's), which the permission layer refuses outright.
   */
  private static async listReadableRepositories(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
  }): Promise<Array<CodeRepository>> {
    try {
      return await CodeTaskAccess.listReadableRepositories({
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
  }

  /*
   * The repository the task works in: the one named, when the person may
   * read it and ask in it; else the only one they may read, when they may
   * ask in it; else the answer that says what to do - choose among those
   * they may ask in, connect one, or ask for permission.
   */
  private static async chooseRepository(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    code: DataSecurityFixCode;
    requestedRepositoryId?: unknown;
  }): Promise<RepositoryChoice> {
    const requested: string =
      typeof data.requestedRepositoryId === "string"
        ? data.requestedRepositoryId.trim()
        : "";

    if (ObjectID.isValidUUID(requested)) {
      const repositoryId: ObjectID = new ObjectID(requested);
      /*
       * Not found unless the person may read it, in this project (Code's
       * 404) - and refused, as Code refuses it, when they may read no
       * repository at all.
       */
      const repository: CodeRepository =
        await CodeTaskAccess.getReadableRepository({
          props: data.props,
          projectId: data.projectId,
          repositoryId,
        });

      if (
        !(await CodeTaskAccess.canAskInRepository({
          props: data.props,
          projectId: data.projectId,
          repositoryId,
        }))
      ) {
        throw new NotAuthorizedException(CODE_TASK_ASK_REFUSED_MESSAGE);
      }

      return { repository };
    }

    const readable: Array<CodeRepository> =
      await DataSecurityCodeTask.listReadableRepositories(data);

    if (readable.length === 0) {
      return {
        answer: { message: getDataSecurityFixNoRepositoryMessage(data.code) },
      };
    }

    const askable: Array<CodeRepository> =
      await DataSecurityCodeTask.getAskableRepositories({
        props: data.props,
        projectId: data.projectId,
        readable,
      });

    if (askable.length === 0) {
      return {
        answer: {
          message:
            readable.length === 1
              ? CODE_TASK_ASK_REFUSED_MESSAGE
              : DATA_SECURITY_FIX_NO_ASKABLE_REPOSITORY_MESSAGE,
        },
      };
    }

    // The only repository the person may read: no choice to make.
    if (readable.length === 1) {
      return { repository: askable[0]! };
    }

    return {
      answer: {
        message: getDataSecurityFixPickRepositoryMessage(data.code),
        repositories: askable.map(
          (repository: CodeRepository): DataSecurityFixRepository => {
            return {
              id: repository.id!.toString(),
              name: repository.name || repository.id!.toString(),
            };
          },
        ),
      },
    };
  }
}

// The repository a task works in, or the answer that says why there is none.
type RepositoryChoice =
  | { repository: CodeRepository; answer?: undefined }
  | { repository?: undefined; answer: DataSecurityFixResult };
