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

export const DATA_SECURITY_FIX_SIGN_IN_MESSAGE: string =
  "Sign in to ask OneUptime AI for a fix.";

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

// At most this many repositories are asked about at once (canAskInRepository).
const ASK_CHECKS_AT_ONCE: number = 10;

export default class DataSecurityCodeTask {
  @CaptureSpan()
  public static async requestFix(data: {
    // The person who asked, with their own permissions.
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
  }): Promise<DataSecurityFixResult> {
    const userId: ObjectID | undefined = data.props.userId || undefined;

    if (!userId) {
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

    // 2. The repository, as the person may read it and ask in it.
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

    // 3. What stops AI working in it: its connection, and a Runner.
    const blocker: CodeTaskBlocker | null = await CodeTaskGate.getBlocker({
      props: data.props,
      projectId: data.projectId,
      repository: choice.repository,
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

    const run: AIRun = await CodeTaskRuns.start({
      projectId: data.projectId,
      userId,
      repository: choice.repository,
      message: request.text,
      context: [],
    });

    for (const issueId of data.issueIds) {
      await DataSecurityIssueFeedService.createDataSecurityIssueFeedItem({
        projectId: data.projectId,
        dataSecurityIssueId: issueId,
        eventType: DataSecurityIssueFeedEventType.AiFixRequested,
        displayColor: Purple500,
        feedInfoInMarkdown: DATA_SECURITY_FIX_FEED_MESSAGE,
        userId,
      });
    }

    return {
      message: DATA_SECURITY_FIX_STARTED_MESSAGE,
      aiRunId: run.id?.toString(),
    };
  }

  /*
   * Of the repositories the person may read, those they may ask OneUptime AI
   * to work in (CodeTaskAccess.canAskInRepository), in the order given.
   */
  @CaptureSpan()
  public static async getAskableRepositories(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    readable: ReadonlyArray<CodeRepository>;
  }): Promise<Array<CodeRepository>> {
    const askable: Array<CodeRepository> = [];

    for (
      let start: number = 0;
      start < data.readable.length;
      start += ASK_CHECKS_AT_ONCE
    ) {
      const batch: ReadonlyArray<CodeRepository> = data.readable.slice(
        start,
        start + ASK_CHECKS_AT_ONCE,
      );
      const canAsk: Array<boolean> = await Promise.all(
        batch.map((repository: CodeRepository): Promise<boolean> => {
          return CodeTaskAccess.canAskInRepository({
            props: data.props,
            projectId: data.projectId,
            repositoryId: repository.id!,
          });
        }),
      );

      batch.forEach((repository: CodeRepository, index: number): void => {
        if (canAsk[index]) {
          askable.push(repository);
        }
      });
    }

    return askable;
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
