import logger from "../../Logger";
import ObjectID from "../../../../Types/ObjectID";
import { JSONObject } from "../../../../Types/JSON";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import CodeFixTaskType from "../../../../Types/AI/CodeFixTaskType";
import { GitHubTaskContext } from "../../../../Types/AI/CodeFixTaskContext";
import GitHubCommandType, {
  GitHubCommand,
  GitHubCommandSurface,
  isConversationalCommand,
} from "../../../../Types/CodeRepository/GitHubCommand";
import GlobalCache from "../../../Infrastructure/GlobalCache";
import GitHubAgentTaskTrigger from "./GitHubAgentTaskTrigger";
import GitHubCommandAuthorizer, {
  GitHubAuthorizationOutcome,
  GitHubAuthorizationResult,
} from "./GitHubCommandAuthorizer";
import GitHubCommandParser from "./GitHubCommandParser";
import GitHubConversation, {
  GitHubPullRequestDetails,
  GitHubReaction,
} from "./GitHubConversation";
import GitHubReplyComposer from "./GitHubReplyComposer";
import GitHubRunReply from "./GitHubRunReply";
import GitHubWebhookEvents, {
  DEFAULT_GITHUB_TRIGGER_LABEL,
  GitHubWebhookEvent,
  GitHubWebhookRepository,
  GitHubWebhookSender,
} from "./GitHubWebhookEvents";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * The interactive half of the GitHub App: everything between a verified
 * webhook and a queued agent run.
 *
 * Kept out of the express route on purpose. The route's job is signature
 * verification and a 200; this file's job is the decision tree, and a decision
 * tree that can only be exercised through an HTTP request does not get tested
 * properly.
 *
 * Two rules run through all of it:
 *
 *   - It NEVER throws at the caller. GitHub retries a delivery that did not
 *     get a 2xx, so an exception escaping here becomes a redelivery storm of
 *     the exact payload that just failed. Everything is caught and logged.
 *
 *   - A command that was understood always gets a visible response — a
 *     reaction, a comment, or both. The one deliberate exception is a command
 *     from someone without write access, which gets a reaction and no comment;
 *     see GitHubCommandAuthorizer for why replying there would be a mistake.
 */

// How long a processed delivery id is remembered, to swallow redeliveries.
const DELIVERY_DEDUPE_SECONDS: number = 60 * 60 * 6;
const DELIVERY_DEDUPE_NAMESPACE: string = "github-webhook-delivery";

export interface GitHubWebhookHandlingResult {
  // True when this delivery started a run or wrote something to GitHub.
  handled: boolean;
  // A short machine-readable reason, for logs and tests.
  outcome: string;
  aiRunId?: ObjectID | undefined;
}

const NOT_HANDLED: (outcome: string) => GitHubWebhookHandlingResult = (
  outcome: string,
): GitHubWebhookHandlingResult => {
  return { handled: false, outcome: outcome };
};

export default class GitHubWebhookHandler {
  /*
   * Has this exact delivery been processed before?
   *
   * GitHub redelivers on any non-2xx and on manual replay, and a duplicate
   * delivery must not produce a duplicate comment. The per-conversation run
   * dedupe already stops a duplicate RUN, but it does not stop a duplicate
   * acknowledgement, and two "on it" comments on one request reads as a bug.
   *
   * A cache outage answers "not seen": the run dedupe still holds, so the
   * worst case is a repeated comment, and refusing to work while Redis is
   * down would be a much larger outage than the one being avoided.
   */
  @CaptureSpan()
  public static async isDuplicateDelivery(
    deliveryId: string | undefined,
  ): Promise<boolean> {
    if (!deliveryId) {
      return false;
    }

    try {
      const claimed: boolean = await GlobalCache.setStringIfNotExists(
        DELIVERY_DEDUPE_NAMESPACE,
        deliveryId,
        "1",
        { expiresInSeconds: DELIVERY_DEDUPE_SECONDS },
      );

      return !claimed;
    } catch (error) {
      logger.debug(
        `Could not check the GitHub webhook delivery fence, continuing: ${error}`,
      );
      return false;
    }
  }

  @CaptureSpan()
  public static async handleEvent(data: {
    event: string | undefined;
    deliveryId: string | undefined;
    payload: JSONObject;
  }): Promise<GitHubWebhookHandlingResult> {
    try {
      if (!GitHubWebhookHandler.isInteractiveEvent(data.event)) {
        return NOT_HANDLED("event-not-interactive");
      }

      if (await GitHubWebhookHandler.isDuplicateDelivery(data.deliveryId)) {
        logger.debug(
          `Ignoring a redelivered GitHub webhook (${data.deliveryId}).`,
        );
        return NOT_HANDLED("duplicate-delivery");
      }

      switch (data.event) {
        case GitHubWebhookEvent.IssueComment:
        case GitHubWebhookEvent.PullRequestReviewComment:
        case GitHubWebhookEvent.PullRequestReview:
          return await GitHubWebhookHandler.handleMention(data);
        case GitHubWebhookEvent.Issues:
          return await GitHubWebhookHandler.handleIssuesEvent(data);
        case GitHubWebhookEvent.PullRequest:
          return await GitHubWebhookHandler.handlePullRequestEvent(data);
        default:
          return NOT_HANDLED("event-not-interactive");
      }
    } catch (error) {
      /*
       * Swallowed on purpose — see the note at the top. A failure here has
       * already been logged with its context; propagating it would turn one
       * bad payload into an endless redelivery loop.
       */
      logger.error(
        `Failed to handle GitHub webhook event "${data.event}" (${data.deliveryId}):`,
      );
      logger.error(error);

      /*
       * Give the fence back. It is claimed before any work is attempted, so a
       * transient failure — a database blip, a 502 from GitHub — would
       * otherwise be permanent: GitHub's redelivery of the SAME delivery id
       * arrives inside the six-hour window and is swallowed as a duplicate,
       * and the command is lost with the user still looking at their comment.
       *
       * Releasing it risks a duplicate ACKNOWLEDGEMENT if the failure happened
       * after one was posted. That is the better failure: the per-conversation
       * run guard still stops a duplicate run, so the cost is one extra
       * comment rather than a command that silently never happened.
       */
      await GitHubWebhookHandler.releaseDelivery(data.deliveryId);

      return NOT_HANDLED("error");
    }
  }

  /*
   * Release a delivery fence so GitHub's retry of that delivery is processed.
   * Only used on the failure path — see the note in handleEvent.
   */
  private static async releaseDelivery(
    deliveryId: string | undefined,
  ): Promise<void> {
    if (!deliveryId) {
      return;
    }

    try {
      await GlobalCache.deleteKey(DELIVERY_DEDUPE_NAMESPACE, deliveryId);
    } catch (error) {
      logger.debug(
        `Could not release the GitHub webhook delivery fence for ${deliveryId}: ${error}`,
      );
    }
  }

  public static isInteractiveEvent(event: string | undefined): boolean {
    return (
      event === GitHubWebhookEvent.IssueComment ||
      event === GitHubWebhookEvent.Issues ||
      event === GitHubWebhookEvent.PullRequest ||
      event === GitHubWebhookEvent.PullRequestReview ||
      event === GitHubWebhookEvent.PullRequestReviewComment
    );
  }

  /*
   * A comment somewhere in an issue or pull request conversation: the plain
   * comment stream, an inline review comment on the diff, or the body of a
   * submitted review. All three are the same interaction — a human wrote
   * something that may mention the app — so they share a path.
   */
  private static async handleMention(data: {
    event: string | undefined;
    deliveryId: string | undefined;
    payload: JSONObject;
  }): Promise<GitHubWebhookHandlingResult> {
    const action: string | null = GitHubWebhookEvents.getAction(data.payload);

    /*
     * `created` covers a new comment; `submitted` a new review; `edited` a
     * comment someone went back and added the mention to, which is a real way
     * people ask. Every other action (deleted, dismissed) is not a request.
     */
    if (action !== "created" && action !== "edited" && action !== "submitted") {
      return NOT_HANDLED("action-not-actionable");
    }

    const commentContainer: JSONObject | undefined =
      (data.payload["comment"] as JSONObject) ||
      (data.payload["review"] as JSONObject);

    const body: string | undefined = commentContainer?.["body"]?.toString();

    if (!body) {
      return NOT_HANDLED("no-comment-body");
    }

    /*
     * On issue_comment GitHub sends the same event for both surfaces; on the
     * review events the surface is always a pull request.
     */
    const issue: JSONObject | undefined = data.payload["issue"] as JSONObject;
    const pullRequest: JSONObject | undefined = data.payload[
      "pull_request"
    ] as JSONObject;

    const isPullRequest: boolean =
      Boolean(pullRequest) || GitHubWebhookEvents.isPullRequestIssue(issue);

    const conversationNumber: number | null = GitHubWebhookEvents.getNumber(
      issue || pullRequest,
    );

    if (conversationNumber === null) {
      return NOT_HANDLED("no-conversation-number");
    }

    return GitHubWebhookHandler.runCommandFromText({
      payload: data.payload,
      deliveryId: data.deliveryId,
      body: body,
      surface: isPullRequest
        ? GitHubCommandSurface.PullRequest
        : GitHubCommandSurface.Issue,
      conversationNumber: conversationNumber,
      triggerCommentId: (commentContainer?.["id"] as number) || undefined,
    });
  }

  /*
   * An issue assigned to the app's bot user, or labelled with the
   * repository's trigger label.
   *
   * Both exist because GitHub does not offer one reliable way to hand work to
   * an app. Assignment is the gesture people reach for first, but a GitHub
   * App's bot user cannot be assigned from the web UI on most repositories, so
   * a label is the mechanism that always works. Supporting both costs one
   * branch and means the feature is never mysteriously unavailable.
   */
  private static async handleIssuesEvent(data: {
    event: string | undefined;
    deliveryId: string | undefined;
    payload: JSONObject;
  }): Promise<GitHubWebhookHandlingResult> {
    const action: string | null = GitHubWebhookEvents.getAction(data.payload);
    const issue: JSONObject | undefined = data.payload["issue"] as JSONObject;
    const issueNumber: number | null = GitHubWebhookEvents.getNumber(issue);

    if (issueNumber === null) {
      return NOT_HANDLED("no-issue-number");
    }

    if (GitHubWebhookEvents.isPullRequestIssue(issue)) {
      // Pull requests arrive on the `pull_request` event; ignore the alias.
      return NOT_HANDLED("issue-is-pull-request");
    }

    /*
     * Everything cheap first. Most `issues` deliveries are opened / edited /
     * closed, and resolveContext costs a database read plus a GitHub
     * permission call — spending that on every issue anyone touches in every
     * connected repository is how an integration eats its own rate limit.
     */
    if (action !== "assigned" && action !== "labeled") {
      return NOT_HANDLED("action-not-actionable");
    }

    if (action === "assigned") {
      const assigneeLogin: string | undefined = (
        data.payload["assignee"] as JSONObject
      )?.["login"]?.toString();

      const appSlug: string | null = await GitHubConversation.getAppSlug();

      if (
        !appSlug ||
        !assigneeLogin ||
        assigneeLogin.toLowerCase() !==
          GitHubConversation.toBotLogin(appSlug).toLowerCase()
      ) {
        return NOT_HANDLED("assignee-is-not-this-app");
      }
    }

    const context: ResolvedWebhookContext | null =
      await GitHubWebhookHandler.resolveContext(data.payload);

    if (!context) {
      return NOT_HANDLED("unresolvable-context");
    }

    /*
     * The label check needs the repository, so it is the one that has to wait
     * until after resolveContext — the trigger label is per-repository
     * configuration.
     */
    if (action === "labeled") {
      const triggerLabel: string =
        context.authorization.codeRepository?.gitHubTriggerLabel?.trim() ||
        DEFAULT_GITHUB_TRIGGER_LABEL;

      const addedLabel: string | undefined = (
        data.payload["label"] as JSONObject
      )?.["name"]?.toString();

      if (
        !addedLabel ||
        addedLabel.trim().toLowerCase() !== triggerLabel.toLowerCase()
      ) {
        return NOT_HANDLED("label-is-not-the-trigger-label");
      }
    }

    /*
     * Only now — with an assignment to this app or its own trigger label
     * confirmed — is the app addressed, and only now is a comment about the
     * switch being off something the person did anything to deserve.
     */
    if (GitHubWebhookHandler.areCommandsDisabled(context)) {
      return GitHubWebhookHandler.replyCommandsDisabled({
        context: context,
        conversationNumber: issueNumber,
      });
    }

    /*
     * Assignment and labelling carry no words, so the issue speaks for
     * itself. The empty instruction is honest: the agent is told to read the
     * issue rather than handed a sentence nobody wrote.
     */
    return GitHubWebhookHandler.startRun({
      context: context,
      command: { commandType: GitHubCommandType.Implement, instruction: "" },
      surface: GitHubCommandSurface.Issue,
      conversationNumber: issueNumber,
      triggerCommentId: undefined,
      deliveryId: data.deliveryId,
    });
  }

  // A review requested from the app's bot user on a pull request.
  private static async handlePullRequestEvent(data: {
    event: string | undefined;
    deliveryId: string | undefined;
    payload: JSONObject;
  }): Promise<GitHubWebhookHandlingResult> {
    if (GitHubWebhookEvents.getAction(data.payload) !== "review_requested") {
      return NOT_HANDLED("action-not-actionable");
    }

    const pullRequestNumber: number | null = GitHubWebhookEvents.getNumber(
      data.payload["pull_request"] as JSONObject,
    );

    if (pullRequestNumber === null) {
      return NOT_HANDLED("no-pull-request-number");
    }

    const requestedLogin: string | undefined = (
      data.payload["requested_reviewer"] as JSONObject
    )?.["login"]?.toString();

    const appSlug: string | null = await GitHubConversation.getAppSlug();

    if (
      !appSlug ||
      !requestedLogin ||
      requestedLogin.toLowerCase() !==
        GitHubConversation.toBotLogin(appSlug).toLowerCase()
    ) {
      return NOT_HANDLED("reviewer-is-not-this-app");
    }

    const context: ResolvedWebhookContext | null =
      await GitHubWebhookHandler.resolveContext(data.payload);

    if (!context) {
      return NOT_HANDLED("unresolvable-context");
    }

    if (GitHubWebhookHandler.areCommandsDisabled(context)) {
      return GitHubWebhookHandler.replyCommandsDisabled({
        context: context,
        conversationNumber: pullRequestNumber,
      });
    }

    return GitHubWebhookHandler.startRun({
      context: context,
      command: { commandType: GitHubCommandType.Review, instruction: "" },
      surface: GitHubCommandSurface.PullRequest,
      conversationNumber: pullRequestNumber,
      triggerCommentId: undefined,
      deliveryId: data.deliveryId,
    });
  }

  /*
   * Parse a comment, authorize its author, and either answer it or start work.
   */
  private static async runCommandFromText(data: {
    payload: JSONObject;
    deliveryId: string | undefined;
    body: string;
    surface: GitHubCommandSurface;
    conversationNumber: number;
    triggerCommentId: number | undefined;
  }): Promise<GitHubWebhookHandlingResult> {
    const appSlug: string | null = await GitHubConversation.getAppSlug();

    if (!appSlug) {
      logger.warn(
        "A GitHub comment arrived but this instance cannot resolve its own app slug — set GITHUB_APP_NAME or check the app credentials.",
      );
      return NOT_HANDLED("no-app-slug");
    }

    const command: GitHubCommand | null = GitHubCommandParser.parse({
      body: data.body,
      appSlug: appSlug,
      surface: data.surface,
    });

    if (!command) {
      // By far the common case: an ordinary comment that never mentions us.
      return NOT_HANDLED("no-mention");
    }

    const context: ResolvedWebhookContext | null =
      await GitHubWebhookHandler.resolveContext(data.payload);

    if (!context) {
      return NOT_HANDLED("unresolvable-context");
    }

    if (GitHubWebhookHandler.areCommandsDisabled(context)) {
      return GitHubWebhookHandler.replyCommandsDisabled({
        context: context,
        conversationNumber: data.conversationNumber,
      });
    }

    if (
      !GitHubCommandParser.isSupportedOnSurface({
        commandType: command.commandType,
        surface: data.surface,
      })
    ) {
      await GitHubWebhookHandler.reply({
        context: context,
        conversationNumber: data.conversationNumber,
        body: GitHubReplyComposer.unsupportedOnSurface({
          commandType: command.commandType,
          appSlug: appSlug,
        }),
      });

      return { handled: true, outcome: "unsupported-on-surface" };
    }

    if (isConversationalCommand(command.commandType)) {
      return GitHubWebhookHandler.answerConversationalCommand({
        context: context,
        command: command,
        appSlug: appSlug,
        conversationNumber: data.conversationNumber,
      });
    }

    return GitHubWebhookHandler.startRun({
      context: context,
      command: command,
      surface: data.surface,
      conversationNumber: data.conversationNumber,
      triggerCommentId: data.triggerCommentId,
      deliveryId: data.deliveryId,
    });
  }

  /*
   * help / status / cancel. None of them costs an agent run, so none of them
   * is subject to the fix-run budget — and all of them are answered even when
   * the repository has commands switched off, because "why is nothing
   * happening?" is exactly the question those replies exist to answer.
   */
  private static async answerConversationalCommand(data: {
    context: ResolvedWebhookContext;
    command: GitHubCommand;
    appSlug: string;
    conversationNumber: number;
  }): Promise<GitHubWebhookHandlingResult> {
    const codeRepository: CodeRepository | undefined =
      data.context.authorization.codeRepository;

    if (data.command.commandType === GitHubCommandType.Help) {
      await GitHubWebhookHandler.reply({
        context: data.context,
        conversationNumber: data.conversationNumber,
        body: GitHubReplyComposer.help({ appSlug: data.appSlug }),
      });

      return { handled: true, outcome: "help" };
    }

    if (!codeRepository?.id || !codeRepository.projectId) {
      return NOT_HANDLED("no-repository-for-conversational-command");
    }

    if (data.command.commandType === GitHubCommandType.Status) {
      const runs: Array<AIRun> =
        await GitHubAgentTaskTrigger.findNonTerminalRunsForConversation({
          projectId: codeRepository.projectId,
          codeRepositoryId: codeRepository.id,
          conversationNumber: data.conversationNumber,
        });

      await GitHubWebhookHandler.reply({
        context: data.context,
        conversationNumber: data.conversationNumber,
        body: GitHubReplyComposer.status({
          runDescriptions: runs.map((run: AIRun) => {
            return GitHubRunReply.describeLiveRun(run);
          }),
          runUrlBase: GitHubRunReply.buildProjectRunsUrl(
            codeRepository.projectId,
          ),
        }),
      });

      return { handled: true, outcome: "status" };
    }

    const cancelledCount: number =
      await GitHubAgentTaskTrigger.cancelRunsForConversation({
        projectId: codeRepository.projectId,
        codeRepositoryId: codeRepository.id,
        conversationNumber: data.conversationNumber,
      });

    await GitHubWebhookHandler.reply({
      context: data.context,
      conversationNumber: data.conversationNumber,
      body: GitHubReplyComposer.cancelled({ cancelledCount: cancelledCount }),
    });

    return { handled: true, outcome: "cancel" };
  }

  /*
   * Queue the agent run and acknowledge it in the thread.
   *
   * A Revise or Review reads the pull request first, because the run needs the
   * head branch it must push to — captured HERE, at trigger time, so that a
   * force-push between the comment and the agent claiming the work cannot
   * silently redirect it at a different branch.
   */
  private static async startRun(data: {
    context: ResolvedWebhookContext;
    command: GitHubCommand;
    surface: GitHubCommandSurface;
    conversationNumber: number;
    triggerCommentId: number | undefined;
    deliveryId: string | undefined;
  }): Promise<GitHubWebhookHandlingResult> {
    const codeRepository: CodeRepository | undefined =
      data.context.authorization.codeRepository;

    if (!codeRepository?.id || !codeRepository.projectId) {
      return NOT_HANDLED("no-repository");
    }

    const taskType: CodeFixTaskType | null =
      GitHubAgentTaskTrigger.getTaskTypeForCommand(data.command.commandType);

    if (!taskType) {
      return NOT_HANDLED("command-has-no-task-type");
    }

    const isPullRequestCommand: boolean =
      data.surface === GitHubCommandSurface.PullRequest;

    let pullRequestHeadRefName: string | undefined = undefined;
    let isPullRequestFromFork: boolean = false;

    if (isPullRequestCommand) {
      const pullRequest: GitHubPullRequestDetails =
        await GitHubConversation.getPullRequestDetails({
          installationId: data.context.installationId,
          organizationName: data.context.repository.organizationName,
          repositoryName: data.context.repository.repositoryName,
          pullRequestNumber: data.conversationNumber,
        });

      /*
       * A merged or closed pull request has nothing left to revise, and a
       * review of it would land on a thread nobody is reading. Say so rather
       * than spending a run to discover it.
       */
      if (pullRequest.state !== "open") {
        await GitHubWebhookHandler.reply({
          context: data.context,
          conversationNumber: data.conversationNumber,
          body: GitHubReplyComposer.refusal({
            reason:
              "This pull request is already closed, so there is nothing for me to do here.",
          }),
        });

        return { handled: true, outcome: "pull-request-not-open" };
      }

      isPullRequestFromFork = GitHubConversation.isFromFork({
        headRepositoryFullName: pullRequest.headRepositoryFullName,
        organizationName: data.context.repository.organizationName,
        repositoryName: data.context.repository.repositoryName,
      });

      /*
       * A fork's branch is in a repository this installation cannot write to.
       * Reviewing one is fine — reviews are written on the BASE repository's
       * pull request — but revising one is not, and finding that out after a
       * clone and a full agent run would waste the budget and end in a
       * confusing push error. Refuse up front and say why.
       */
      if (
        data.command.commandType === GitHubCommandType.Revise &&
        isPullRequestFromFork
      ) {
        await GitHubWebhookHandler.reply({
          context: data.context,
          conversationNumber: data.conversationNumber,
          body: GitHubReplyComposer.refusal({
            reason:
              "This pull request comes from a fork, so I cannot push to its branch. I can still review it — ask me to review instead, or push the branch to this repository if you want me to revise it.",
          }),
        });

        return { handled: true, outcome: "pull-request-from-fork" };
      }

      /*
       * Pin the head branch only when it is actually reachable. For a fork it
       * is not, and pinning it would send the review after a branch that does
       * not exist here — which the clone would quietly answer with the default
       * branch. Leaving it unset says "work from the base", which is the
       * honest description of what a fork review can do.
       */
      if (!isPullRequestFromFork) {
        pullRequestHeadRefName = pullRequest.headRefName;
      }
    }

    const github: GitHubTaskContext = {
      codeRepositoryId: codeRepository.id.toString(),
      installationId: data.context.installationId,
      organizationName: data.context.repository.organizationName,
      repositoryName: data.context.repository.repositoryName,
      commandType: data.command.commandType,
      instruction: data.command.instruction,
      ...(isPullRequestCommand
        ? { pullRequestNumber: data.conversationNumber }
        : { issueNumber: data.conversationNumber }),
      ...(pullRequestHeadRefName
        ? { pullRequestHeadRefName: pullRequestHeadRefName }
        : {}),
      ...(isPullRequestCommand
        ? { isPullRequestFromFork: isPullRequestFromFork }
        : {}),
      ...(data.triggerCommentId
        ? { triggerCommentId: data.triggerCommentId }
        : {}),
      ...(data.context.sender
        ? { triggeredByLogin: data.context.sender.login }
        : {}),
      ...(data.deliveryId ? { webhookDeliveryId: data.deliveryId } : {}),
    };

    let run: AIRun;

    try {
      run = await GitHubAgentTaskTrigger.enqueueGitHubCodeFixRun({
        projectId: codeRepository.projectId,
        taskType: taskType,
        github: github,
      });
    } catch (error) {
      /*
       * "Already working on this" and "over the daily budget" are both normal
       * answers, not failures — and both are useless unless the person who
       * asked can read them, so they go into the thread verbatim.
       */
      await GitHubWebhookHandler.reply({
        context: data.context,
        conversationNumber: data.conversationNumber,
        body: GitHubReplyComposer.refusal({
          reason:
            error instanceof Error
              ? error.message
              : "I could not start that just now.",
        }),
      });

      return { handled: true, outcome: "refused" };
    }

    const acknowledgementCommentId: number | null =
      await GitHubRunReply.acknowledge({
        aiRunId: run.id!,
        projectId: codeRepository.projectId,
        projectName: data.context.authorization.projectName,
        github: github,
      });

    if (acknowledgementCommentId) {
      /*
       * The run is already queued and the comment is already posted; this only
       * records which comment to EDIT later. A failure here costs one extra
       * comment when the run finishes — it must not turn a successful command
       * into an "error" outcome that releases the delivery fence and invites
       * GitHub to replay the whole thing.
       */
      try {
        await GitHubAgentTaskTrigger.recordAcknowledgementComment({
          aiRunId: run.id!,
          github: github,
          acknowledgementCommentId: acknowledgementCommentId,
        });
      } catch (error) {
        logger.warn(
          `Could not record the acknowledgement comment for run ${run.id?.toString()}: ${error}`,
        );
      }
    }

    logger.info(
      `Queued a ${taskType} run (${run.id?.toString()}) from GitHub for ${data.context.repository.organizationName}/${data.context.repository.repositoryName}#${data.conversationNumber}.`,
    );

    return { handled: true, outcome: "queued", aiRunId: run.id || undefined };
  }

  /*
   * Everything a command needs from the payload, once. Returns null — and
   * says nothing in the thread — whenever the app has no business answering:
   * a malformed payload, a bot author, an unconnected repository, or a
   * commenter without write access.
   */
  private static async resolveContext(
    payload: JSONObject,
  ): Promise<ResolvedWebhookContext | null> {
    const repository: GitHubWebhookRepository | null =
      GitHubWebhookEvents.getRepository(payload);
    const installationId: string | null =
      GitHubWebhookEvents.getInstallationId(payload);
    const sender: GitHubWebhookSender | null =
      GitHubWebhookEvents.getSender(payload);

    if (!repository || !installationId || !sender) {
      return null;
    }

    const authorization: GitHubAuthorizationResult =
      await GitHubCommandAuthorizer.authorize({
        organizationName: repository.organizationName,
        repositoryName: repository.repositoryName,
        installationId: installationId,
        senderLogin: sender.login,
        senderType: sender.type,
      });

    if (authorization.outcome === GitHubAuthorizationOutcome.Ignore) {
      return null;
    }

    if (
      authorization.outcome ===
      GitHubAuthorizationOutcome.InsufficientPermission
    ) {
      /*
       * A reaction, never a comment. See GitHubCommandAuthorizer: a comment
       * here would let any GitHub account use this app to post in a
       * repository it has no write access to.
       */
      const commentId: number | undefined = (
        payload["comment"] as JSONObject
      )?.["id"] as number | undefined;

      if (commentId) {
        await GitHubConversation.addReactionToComment({
          installationId: installationId,
          organizationName: repository.organizationName,
          repositoryName: repository.repositoryName,
          commentId: commentId,
          reaction: GitHubReaction.Confused,
        });
      }

      return null;
    }

    /*
     * CommandsDisabled is returned rather than answered here. Whether it
     * deserves a comment depends on whether the app was actually addressed,
     * and only the caller knows that: a mention was, and a trigger label was —
     * but this runs for EVERY label added to EVERY issue, and replying at this
     * point turned a repository with the switch off into one where labelling
     * anything produced a bot comment.
     */
    return {
      repository: repository,
      installationId: installationId,
      sender: sender,
      authorization: authorization,
    };
  }

  /*
   * Answer a command the repository has switched off. Called only once the
   * caller has established that the app really was addressed.
   */
  private static async replyCommandsDisabled(data: {
    context: ResolvedWebhookContext;
    conversationNumber: number;
  }): Promise<GitHubWebhookHandlingResult> {
    await GitHubWebhookHandler.reply({
      context: data.context,
      conversationNumber: data.conversationNumber,
      body: GitHubReplyComposer.refusal({
        reason:
          data.context.authorization.reason ||
          "GitHub commands are switched off for this repository.",
      }),
    });

    return { handled: true, outcome: "commands-disabled" };
  }

  private static areCommandsDisabled(context: ResolvedWebhookContext): boolean {
    return (
      context.authorization.outcome ===
      GitHubAuthorizationOutcome.CommandsDisabled
    );
  }

  // Post one comment, and never let a failed comment fail the delivery.
  private static async reply(data: {
    context: ResolvedWebhookContext;
    conversationNumber: number;
    body: string;
  }): Promise<void> {
    try {
      await GitHubConversation.createIssueComment({
        installationId: data.context.installationId,
        organizationName: data.context.repository.organizationName,
        repositoryName: data.context.repository.repositoryName,
        issueNumber: data.conversationNumber,
        body: data.body,
      });
    } catch (error) {
      logger.warn(
        `Could not reply in ${data.context.repository.organizationName}/${data.context.repository.repositoryName}#${data.conversationNumber}: ${error}`,
      );
    }
  }
}

interface ResolvedWebhookContext {
  repository: GitHubWebhookRepository;
  installationId: string;
  sender: GitHubWebhookSender;
  authorization: GitHubAuthorizationResult;
}
