import GitHubWebhookHandler, {
  GitHubWebhookHandlingResult,
} from "../../../../Server/Utils/CodeRepository/GitHub/GitHubWebhookHandler";
import GitHubAgentTaskTrigger from "../../../../Server/Utils/CodeRepository/GitHub/GitHubAgentTaskTrigger";
import GitHubCommandAuthorizer, {
  GitHubAuthorizationOutcome,
  GitHubAuthorizationResult,
} from "../../../../Server/Utils/CodeRepository/GitHub/GitHubCommandAuthorizer";
import GitHubCommandParser from "../../../../Server/Utils/CodeRepository/GitHub/GitHubCommandParser";
import GitHubConversation, {
  GitHubPullRequestDetails,
  GitHubReaction,
} from "../../../../Server/Utils/CodeRepository/GitHub/GitHubConversation";
import GitHubRunReply from "../../../../Server/Utils/CodeRepository/GitHub/GitHubRunReply";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import logger from "../../../../Server/Utils/Logger";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import CodeFixTaskType from "../../../../Types/AI/CodeFixTaskType";
import { GitHubTaskContext } from "../../../../Types/AI/CodeFixTaskContext";
import GitHubCommandType, {
  GitHubCommandSurface,
} from "../../../../Types/CodeRepository/GitHubCommand";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * The decision tree between a VERIFIED GitHub webhook and a queued agent run.
 *
 * The route above this only checks the signature and answers 200; everything
 * that decides whether an arbitrary comment in somebody else's repository gets
 * to spend an AI budget, push commits, or make this app write a comment lives
 * here. Four invariants are worth failing a build over, and each of them is a
 * real incident if it regresses:
 *
 *   1. It NEVER throws. GitHub redelivers anything that is not a 2xx, so an
 *      exception escaping handleEvent is a redelivery storm of the exact
 *      payload that just failed — forever, at GitHub's pace, not ours.
 *
 *   2. One delivery does at most one thing. GitHub redelivers on failure and
 *      on manual replay, and a second "on it" comment on one request reads as
 *      a bug even when the run dedupe holds. The fence is keyed on the
 *      DELIVERY id — a constant key would swallow every delivery after the
 *      first, which is the far worse failure.
 *
 *   3. A command that was understood always gets a visible answer, with ONE
 *      deliberate exception: a command from an account without write access
 *      gets a reaction and no comment. Replying there would turn the app into
 *      a comment-poster any GitHub account can drive at a repository it
 *      cannot write to.
 *
 *   4. The branch a run works on is captured HERE, from the pull request
 *      lookup, at trigger time — and only when it is a branch this
 *      installation can actually reach. A force-push between the comment and
 *      the worker claiming the run must not be able to redirect it, and a
 *      fork's branch must not be pinned at all, because it does not exist in
 *      the repository the run will clone.
 *
 * Everything the handler collaborates with is spied: no Redis, no Postgres, no
 * GitHub. What is deliberately NOT mocked is the pure logic the tree depends
 * on — the command parser, the surface rules, the task-type mapping, the fork
 * check and the reply composer — because those decisions are the behaviour
 * under test, not a dependency of it.
 * ---------------------------------------------------------------------------
 */

const ORGANIZATION_NAME: string = "acme";
const REPOSITORY_NAME: string = "checkout";
const REPOSITORY_FULL_NAME: string = `${ORGANIZATION_NAME}/${REPOSITORY_NAME}`;
const INSTALLATION_ID_NUMBER: number = 42424242;
const INSTALLATION_ID: string = "42424242";
const SENDER_LOGIN: string = "octo-dev";
const APP_SLUG: string = "oneuptime";
const BOT_LOGIN: string = "oneuptime[bot]";
const PROJECT_NAME: string = "Checkout Platform";
const DELIVERY_ID: string = "6a8f0e10-0000-11ef-9c1a-0242ac120002";
const ACK_COMMENT_ID: number = 5150;
const ISSUE_NUMBER: number = 12;
const PULL_REQUEST_NUMBER: number = 42;
const TRIGGER_COMMENT_ID: number = 987654;
const HEAD_REF_NAME: string = "feature/retry-backoff";

describe("GitHubWebhookHandler", () => {
  let codeRepositoryId: ObjectID;
  let projectId: ObjectID;
  let aiRunId: ObjectID;

  let setStringIfNotExistsSpy: jest.SpyInstance;
  let getAppSlugSpy: jest.SpyInstance;
  let authorizeSpy: jest.SpyInstance;
  let getPullRequestDetailsSpy: jest.SpyInstance;
  let createIssueCommentSpy: jest.SpyInstance;
  let addReactionToCommentSpy: jest.SpyInstance;
  let addReactionToIssueSpy: jest.SpyInstance;
  let enqueueRunSpy: jest.SpyInstance;
  let findRunsSpy: jest.SpyInstance;
  let cancelRunsSpy: jest.SpyInstance;
  let recordAcknowledgementSpy: jest.SpyInstance;
  let acknowledgeSpy: jest.SpyInstance;

  // ---------------------------------------------------------------- fixtures

  function connectedRepository(triggerLabel?: string): CodeRepository {
    const codeRepository: CodeRepository = new CodeRepository();
    codeRepository.id = codeRepositoryId;
    codeRepository.projectId = projectId;
    codeRepository.organizationName = ORGANIZATION_NAME;
    codeRepository.repositoryName = REPOSITORY_NAME;

    if (triggerLabel) {
      codeRepository.gitHubTriggerLabel = triggerLabel;
    }

    return codeRepository;
  }

  function allowedAuthorization(
    triggerLabel?: string,
  ): GitHubAuthorizationResult {
    return {
      outcome: GitHubAuthorizationOutcome.Allowed,
      codeRepository: connectedRepository(triggerLabel),
      projectName: PROJECT_NAME,
    };
  }

  function queuedRun(): AIRun {
    const run: AIRun = new AIRun();
    run.id = aiRunId;
    run.status = AIRunStatus.Queued;
    return run;
  }

  // A live run as "status" reads it back out of the database.
  function liveRun(commandType: GitHubCommandType): AIRun {
    const run: AIRun = new AIRun();
    run.id = ObjectID.generate();
    run.status = AIRunStatus.Queued;
    run.taskContext = {
      github: {
        codeRepositoryId: codeRepositoryId.toString(),
        installationId: INSTALLATION_ID,
        organizationName: ORGANIZATION_NAME,
        repositoryName: REPOSITORY_NAME,
        commandType: commandType,
        instruction: "",
        pullRequestNumber: PULL_REQUEST_NUMBER,
      },
    };
    return run;
  }

  function pullRequestDetails(data: {
    state?: string;
    headRefName?: string;
    // Explicitly null models a deleted fork, which GitHub really does send.
    headRepositoryFullName?: string | null;
    pullRequestNumber?: number;
  }): GitHubPullRequestDetails {
    const conversationNumber: number =
      data.pullRequestNumber ?? PULL_REQUEST_NUMBER;

    return {
      pullRequestNumber: conversationNumber,
      title: "fix: back off the retry loop",
      body: "Retries hammer the upstream on a 429.",
      state: data.state || "open",
      htmlUrl: `https://github.com/${REPOSITORY_FULL_NAME}/pull/${conversationNumber}`,
      authorLogin: SENDER_LOGIN,
      headRefName: data.headRefName || HEAD_REF_NAME,
      headSha: "0f1e2d3c4b5a69788796a5b4c3d2e1f009887766",
      baseRefName: "main",
      headRepositoryFullName:
        data.headRepositoryFullName === undefined
          ? REPOSITORY_FULL_NAME
          : data.headRepositoryFullName,
      isDraft: false,
      isMerged: data.state === "closed",
      changedFilesCount: 3,
      additions: 41,
      deletions: 7,
    };
  }

  // ---------------------------------------------------------------- payloads

  // The three keys every webhook carries and resolveContext refuses without.
  function webhookEnvelope(): JSONObject {
    return {
      repository: { full_name: REPOSITORY_FULL_NAME },
      installation: { id: INSTALLATION_ID_NUMBER },
      sender: { login: SENDER_LOGIN, type: "User" },
    };
  }

  // `issue_comment` on a plain issue: no `pull_request` key anywhere.
  function issueCommentPayload(data: {
    body: string;
    action?: string;
    issueNumber?: number;
    commentId?: number;
  }): JSONObject {
    return {
      ...webhookEnvelope(),
      action: data.action || "created",
      issue: {
        number: data.issueNumber ?? ISSUE_NUMBER,
        title: "Checkout throws on an empty cart",
      },
      comment: {
        id: data.commentId ?? TRIGGER_COMMENT_ID,
        body: data.body,
        user: { login: SENDER_LOGIN, type: "User" },
      },
    };
  }

  /*
   * `issue_comment` on a PULL REQUEST. GitHub sends the same event name; the
   * only discriminator is the `pull_request` key inside `issue`.
   */
  function pullRequestCommentPayload(data: {
    body: string;
    action?: string;
    pullRequestNumber?: number;
    commentId?: number;
  }): JSONObject {
    const conversationNumber: number =
      data.pullRequestNumber ?? PULL_REQUEST_NUMBER;

    return {
      ...webhookEnvelope(),
      action: data.action || "created",
      issue: {
        number: conversationNumber,
        title: "fix: back off the retry loop",
        pull_request: {
          url: `https://api.github.com/repos/${REPOSITORY_FULL_NAME}/pulls/${conversationNumber}`,
        },
      },
      comment: {
        id: data.commentId ?? TRIGGER_COMMENT_ID,
        body: data.body,
        user: { login: SENDER_LOGIN, type: "User" },
      },
    };
  }

  // `pull_request_review`: the body lives under `review`, not `comment`.
  function reviewSubmittedPayload(data: {
    body: string;
    reviewId?: number;
  }): JSONObject {
    return {
      ...webhookEnvelope(),
      action: "submitted",
      pull_request: {
        number: PULL_REQUEST_NUMBER,
        title: "fix: back off the retry loop",
      },
      review: {
        id: data.reviewId ?? 314159,
        body: data.body,
        user: { login: SENDER_LOGIN, type: "User" },
      },
    };
  }

  function issuesLabeledPayload(data: {
    labelName: string;
    issueNumber?: number;
    isReallyAPullRequest?: boolean;
  }): JSONObject {
    const issue: JSONObject = {
      number: data.issueNumber ?? ISSUE_NUMBER,
      title: "Checkout throws on an empty cart",
    };

    if (data.isReallyAPullRequest) {
      issue["pull_request"] = {
        url: `https://api.github.com/repos/${REPOSITORY_FULL_NAME}/pulls/${data.issueNumber ?? ISSUE_NUMBER}`,
      };
    }

    return {
      ...webhookEnvelope(),
      action: "labeled",
      issue: issue,
      label: { name: data.labelName },
    };
  }

  function issuesAssignedPayload(data: {
    assigneeLogin?: string;
    issueNumber?: number;
  }): JSONObject {
    const payload: JSONObject = {
      ...webhookEnvelope(),
      action: "assigned",
      issue: {
        number: data.issueNumber ?? ISSUE_NUMBER,
        title: "Checkout throws on an empty cart",
      },
    };

    if (data.assigneeLogin) {
      payload["assignee"] = { login: data.assigneeLogin };
    }

    return payload;
  }

  function reviewRequestedPayload(data: {
    requestedReviewerLogin?: string;
    pullRequestNumber?: number;
    action?: string;
  }): JSONObject {
    const payload: JSONObject = {
      ...webhookEnvelope(),
      action: data.action || "review_requested",
      pull_request: {
        number: data.pullRequestNumber ?? PULL_REQUEST_NUMBER,
        title: "fix: back off the retry loop",
      },
    };

    if (data.requestedReviewerLogin) {
      payload["requested_reviewer"] = { login: data.requestedReviewerLogin };
    }

    return payload;
  }

  // ----------------------------------------------------------------- helpers

  async function handle(data: {
    event: string;
    payload: JSONObject;
    deliveryId?: string;
  }): Promise<GitHubWebhookHandlingResult> {
    return GitHubWebhookHandler.handleEvent({
      event: data.event,
      deliveryId: data.deliveryId ?? DELIVERY_ID,
      payload: data.payload,
    });
  }

  interface EnqueueArguments {
    projectId: ObjectID;
    taskType: CodeFixTaskType;
    github: GitHubTaskContext;
  }

  function nthCallArgument(spy: jest.SpyInstance, callNumber: number): unknown {
    const call: Array<unknown> | undefined = spy.mock.calls[callNumber - 1] as
      | Array<unknown>
      | undefined;

    if (!call || call[0] === undefined) {
      throw new Error(`Expected at least ${callNumber} call(s), got none.`);
    }

    return call[0];
  }

  function enqueueArguments(callNumber: number): EnqueueArguments {
    return nthCallArgument(enqueueRunSpy, callNumber) as EnqueueArguments;
  }

  function enqueuedContext(callNumber: number): GitHubTaskContext {
    return enqueueArguments(callNumber).github;
  }

  interface CommentArguments {
    installationId: string;
    organizationName: string;
    repositoryName: string;
    issueNumber: number;
    body: string;
  }

  function commentArguments(callNumber: number): CommentArguments {
    return nthCallArgument(
      createIssueCommentSpy,
      callNumber,
    ) as CommentArguments;
  }

  interface ReactionArguments {
    installationId: string;
    organizationName: string;
    repositoryName: string;
    commentId: number;
    reaction: GitHubReaction;
  }

  function reactionArguments(callNumber: number): ReactionArguments {
    return nthCallArgument(
      addReactionToCommentSpy,
      callNumber,
    ) as ReactionArguments;
  }

  // Nothing was started, and nothing was written into somebody's repository.
  function expectNoRunAndNoWrites(): void {
    expect(enqueueRunSpy).not.toHaveBeenCalled();
    expect(acknowledgeSpy).not.toHaveBeenCalled();
    expect(recordAcknowledgementSpy).not.toHaveBeenCalled();
    expect(cancelRunsSpy).not.toHaveBeenCalled();
    expect(createIssueCommentSpy).not.toHaveBeenCalled();
    expect(addReactionToCommentSpy).not.toHaveBeenCalled();
    expect(addReactionToIssueSpy).not.toHaveBeenCalled();
  }

  beforeEach(() => {
    codeRepositoryId = ObjectID.generate();
    projectId = ObjectID.generate();
    aiRunId = ObjectID.generate();

    /*
     * The handler logs on every branch, including the ones this file drives on
     * purpose. Silenced rather than mocked away: restoreAllMocks puts the real
     * logger back for anything else in the worker.
     */
    jest.spyOn(logger, "error").mockImplementation((): void => {});
    jest.spyOn(logger, "warn").mockImplementation((): void => {});
    jest.spyOn(logger, "info").mockImplementation((): void => {});
    jest.spyOn(logger, "debug").mockImplementation((): void => {});

    setStringIfNotExistsSpy = jest.spyOn(GlobalCache, "setStringIfNotExists");
    // true == "this delivery id was claimed by us", i.e. not a redelivery.
    setStringIfNotExistsSpy.mockResolvedValue(true);

    getAppSlugSpy = jest.spyOn(GitHubConversation, "getAppSlug");
    getAppSlugSpy.mockResolvedValue(APP_SLUG);

    authorizeSpy = jest.spyOn(GitHubCommandAuthorizer, "authorize");
    authorizeSpy.mockResolvedValue(allowedAuthorization());

    getPullRequestDetailsSpy = jest.spyOn(
      GitHubConversation,
      "getPullRequestDetails",
    );
    getPullRequestDetailsSpy.mockResolvedValue(pullRequestDetails({}));

    createIssueCommentSpy = jest.spyOn(
      GitHubConversation,
      "createIssueComment",
    );
    createIssueCommentSpy.mockResolvedValue({
      commentId: 24680,
      htmlUrl: `https://github.com/${REPOSITORY_FULL_NAME}/issues/1#issuecomment-24680`,
      body: "",
      authorLogin: BOT_LOGIN,
      isBot: true,
      createdAt: "2026-09-10T09:00:00Z",
    });

    addReactionToCommentSpy = jest.spyOn(
      GitHubConversation,
      "addReactionToComment",
    );
    addReactionToCommentSpy.mockResolvedValue(true);

    addReactionToIssueSpy = jest.spyOn(
      GitHubConversation,
      "addReactionToIssue",
    );
    addReactionToIssueSpy.mockResolvedValue(true);

    enqueueRunSpy = jest.spyOn(
      GitHubAgentTaskTrigger,
      "enqueueGitHubCodeFixRun",
    );
    enqueueRunSpy.mockResolvedValue(queuedRun());

    findRunsSpy = jest.spyOn(
      GitHubAgentTaskTrigger,
      "findNonTerminalRunsForConversation",
    );
    findRunsSpy.mockResolvedValue([]);

    cancelRunsSpy = jest.spyOn(
      GitHubAgentTaskTrigger,
      "cancelRunsForConversation",
    );
    cancelRunsSpy.mockResolvedValue(0);

    recordAcknowledgementSpy = jest.spyOn(
      GitHubAgentTaskTrigger,
      "recordAcknowledgementComment",
    );
    recordAcknowledgementSpy.mockResolvedValue(undefined);

    acknowledgeSpy = jest.spyOn(GitHubRunReply, "acknowledge");
    acknowledgeSpy.mockResolvedValue(ACK_COMMENT_ID);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * The app is subscribed to more events than it acts on, and the ones it
   * ignores are the high-volume ones. Touching the dedupe cache or the
   * authorizer for a push would put a Redis round trip and a database read on
   * every commit in every connected repository.
   */
  describe("events it does not act on", () => {
    test.each(["push", "installation", "installation_repositories", "star"])(
      "ignores %s without touching the cache, the authorizer or anything else",
      async (event: string) => {
        const result: GitHubWebhookHandlingResult = await handle({
          event: event,
          payload: issueCommentPayload({ body: `@${APP_SLUG} implement this` }),
        });

        expect(result.handled).toBe(false);
        expect(result.outcome).toBe("event-not-interactive");
        expect(setStringIfNotExistsSpy).not.toHaveBeenCalled();
        expect(authorizeSpy).not.toHaveBeenCalled();
        expectNoRunAndNoWrites();
      },
    );

    test("ignores a delivery with no event header at all", async () => {
      const result: GitHubWebhookHandlingResult =
        await GitHubWebhookHandler.handleEvent({
          event: undefined,
          deliveryId: DELIVERY_ID,
          payload: issueCommentPayload({ body: `@${APP_SLUG} implement this` }),
        });

      expect(result.handled).toBe(false);
      expect(result.outcome).toBe("event-not-interactive");
      expectNoRunAndNoWrites();
    });

    test("ignores an actionable event whose action is not one (a deleted comment)", async () => {
      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: issueCommentPayload({
          body: `@${APP_SLUG} implement this`,
          action: "deleted",
        }),
      });

      expect(result.handled).toBe(false);
      expect(result.outcome).toBe("action-not-actionable");
      expect(authorizeSpy).not.toHaveBeenCalled();
      expectNoRunAndNoWrites();
    });

    /*
     * People really do go back and add the mention to a comment they already
     * posted, so `edited` has to stay actionable.
     */
    test("acts on an edited comment, because adding the mention later is a real way to ask", async () => {
      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: issueCommentPayload({
          body: `@${APP_SLUG} implement this`,
          action: "edited",
        }),
      });

      expect(result.handled).toBe(true);
      expect(result.outcome).toBe("queued");
    });
  });

  describe("delivery de-duplication", () => {
    test("a redelivered delivery id is dropped before the authorizer is consulted", async () => {
      // false == the key already existed, i.e. we have seen this delivery.
      setStringIfNotExistsSpy.mockResolvedValue(false);

      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: issueCommentPayload({ body: `@${APP_SLUG} implement this` }),
      });

      expect(result.handled).toBe(false);
      expect(result.outcome).toBe("duplicate-delivery");
      expect(authorizeSpy).not.toHaveBeenCalled();
      expectNoRunAndNoWrites();
    });

    /*
     * The fence must be keyed on the DELIVERY id. A constant key would look
     * like it worked in a single-delivery test and then silently swallow every
     * webhook after the first one for the whole TTL.
     */
    test("fences on the delivery id itself, with a bounded expiry", async () => {
      await handle({
        event: "issue_comment",
        payload: issueCommentPayload({ body: `@${APP_SLUG} implement this` }),
        deliveryId: "delivery-abc",
      });

      expect(setStringIfNotExistsSpy).toHaveBeenCalledTimes(1);

      const call: Array<unknown> = setStringIfNotExistsSpy.mock
        .calls[0] as Array<unknown>;

      expect(call[1]).toBe("delivery-abc");
      expect(
        (call[3] as { expiresInSeconds?: number } | undefined)
          ?.expiresInSeconds,
      ).toBeGreaterThan(0);
    });

    test("two different delivery ids are two different requests", async () => {
      await handle({
        event: "issue_comment",
        payload: issueCommentPayload({ body: `@${APP_SLUG} implement this` }),
        deliveryId: "delivery-one",
      });
      await handle({
        event: "issue_comment",
        payload: issueCommentPayload({
          body: `@${APP_SLUG} implement this`,
          issueNumber: 13,
        }),
        deliveryId: "delivery-two",
      });

      expect(enqueueRunSpy).toHaveBeenCalledTimes(2);
    });

    /*
     * No delivery id means nothing to fence ON. Treating that as "seen" would
     * silently discard the delivery instead of doing the work.
     */
    test("a missing delivery id is not a duplicate, and is not fenced", async () => {
      const result: GitHubWebhookHandlingResult =
        await GitHubWebhookHandler.handleEvent({
          event: "issue_comment",
          deliveryId: undefined,
          payload: issueCommentPayload({ body: `@${APP_SLUG} implement this` }),
        });

      expect(setStringIfNotExistsSpy).not.toHaveBeenCalled();
      expect(result.handled).toBe(true);
      expect(result.outcome).toBe("queued");
    });

    test("an empty-string delivery id is not a duplicate either", async () => {
      const result: GitHubWebhookHandlingResult =
        await GitHubWebhookHandler.handleEvent({
          event: "issue_comment",
          deliveryId: "",
          payload: issueCommentPayload({ body: `@${APP_SLUG} implement this` }),
        });

      expect(setStringIfNotExistsSpy).not.toHaveBeenCalled();
      expect(result.outcome).toBe("queued");
    });

    /*
     * A Redis outage must not stop the app working. Failing closed here would
     * take the whole integration down with the cache — a much larger outage
     * than the duplicate comment the fence exists to avoid.
     */
    test("a throwing cache is not treated as a duplicate", async () => {
      setStringIfNotExistsSpy.mockRejectedValue(
        new Error("Cache is not connected"),
      );

      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: issueCommentPayload({ body: `@${APP_SLUG} implement this` }),
      });

      expect(result.handled).toBe(true);
      expect(result.outcome).toBe("queued");
      expect(enqueueRunSpy).toHaveBeenCalledTimes(1);
    });

    test("isDuplicateDelivery answers false for a cache that throws", async () => {
      setStringIfNotExistsSpy.mockRejectedValue(
        new Error("Cache is not connected"),
      );

      await expect(
        GitHubWebhookHandler.isDuplicateDelivery("delivery-abc"),
      ).resolves.toBe(false);
    });
  });

  /*
   * GitHub retries any delivery that did not get a 2xx. An exception escaping
   * handleEvent therefore does not fail once — it fails on a schedule we do
   * not control, replaying the same broken payload.
   */
  describe("handleEvent never throws", () => {
    test("a rejecting authorizer becomes handled:false / error, not an exception", async () => {
      authorizeSpy.mockRejectedValue(new Error("Postgres connection lost"));

      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: issueCommentPayload({ body: `@${APP_SLUG} implement this` }),
      });

      expect(result.handled).toBe(false);
      expect(result.outcome).toBe("error");
      expectNoRunAndNoWrites();
    });

    test("a rejecting pull request lookup does not escape either", async () => {
      getPullRequestDetailsSpy.mockRejectedValue(new Error("502 from GitHub"));

      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: pullRequestCommentPayload({ body: `@${APP_SLUG} review` }),
      });

      expect(result.handled).toBe(false);
      expect(result.outcome).toBe("error");
      expect(enqueueRunSpy).not.toHaveBeenCalled();
    });

    test("a rejecting app-slug lookup does not escape either", async () => {
      getAppSlugSpy.mockRejectedValue(new Error("GitHub App JWT is invalid"));

      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: issueCommentPayload({ body: `@${APP_SLUG} implement this` }),
      });

      expect(result.handled).toBe(false);
      expect(result.outcome).toBe("error");
    });

    /*
     * The acknowledgement happens AFTER the run is queued, so a throw there is
     * the one place an exception could undo work that already succeeded. It
     * must still be swallowed: the run stands, and the redelivery GitHub sends
     * is caught by the delivery fence rather than queueing a second run.
     */
    test("an acknowledgement that throws does not escape, and does not un-queue the run", async () => {
      acknowledgeSpy.mockRejectedValue(new Error("503 from GitHub"));

      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: issueCommentPayload({ body: `@${APP_SLUG} implement this` }),
      });

      expect(enqueueRunSpy).toHaveBeenCalledTimes(1);
      expect(result.handled).toBe(false);
      expect(result.outcome).toBe("error");
    });
  });

  describe("a mention on an issue", () => {
    test("queues a GitHubIssueFix run", async () => {
      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: issueCommentPayload({
          body: `@${APP_SLUG} implement this — the cart guard is missing`,
        }),
      });

      expect(result.handled).toBe(true);
      expect(result.outcome).toBe("queued");
      expect(result.aiRunId?.toString()).toBe(aiRunId.toString());
      expect(enqueueArguments(1).taskType).toBe(CodeFixTaskType.GitHubIssueFix);
      expect(enqueueArguments(1).projectId.toString()).toBe(
        projectId.toString(),
      );
    });

    /*
     * issueNumber and pullRequestNumber are mutually exclusive and they pick
     * the recipe. Setting the wrong one sends an issue to the pull request
     * revision agent, which then tries to push to a branch that does not exist.
     */
    test("carries the ISSUE number, and no pull request number", async () => {
      await handle({
        event: "issue_comment",
        payload: issueCommentPayload({
          body: `@${APP_SLUG} implement this`,
          issueNumber: 12,
        }),
      });

      expect(enqueuedContext(1).issueNumber).toBe(12);
      expect(enqueuedContext(1).pullRequestNumber).toBeUndefined();
      expect(enqueuedContext(1).pullRequestHeadRefName).toBeUndefined();
      // An issue has no head branch and no fork question to answer.
      expect(enqueuedContext(1).isPullRequestFromFork).toBeUndefined();
    });

    test("does not look up a pull request for an issue command", async () => {
      await handle({
        event: "issue_comment",
        payload: issueCommentPayload({ body: `@${APP_SLUG} implement this` }),
      });

      expect(getPullRequestDetailsSpy).not.toHaveBeenCalled();
    });

    /*
     * Everything the worker needs comes from the SIGNED payload, captured now.
     * The worker cannot see the webhook, so anything missing here is gone.
     */
    test("carries the installation, the org/repo and the OneUptime repository row", async () => {
      await handle({
        event: "issue_comment",
        payload: issueCommentPayload({ body: `@${APP_SLUG} implement this` }),
      });

      const github: GitHubTaskContext = enqueuedContext(1);

      expect(github.installationId).toBe(INSTALLATION_ID);
      expect(github.organizationName).toBe(ORGANIZATION_NAME);
      expect(github.repositoryName).toBe(REPOSITORY_NAME);
      expect(github.codeRepositoryId).toBe(codeRepositoryId.toString());
      expect(github.commandType).toBe(GitHubCommandType.Implement);
    });

    test("carries the triggering comment id and the sender's login", async () => {
      await handle({
        event: "issue_comment",
        payload: issueCommentPayload({
          body: `@${APP_SLUG} implement this`,
          commentId: 777001,
        }),
      });

      expect(enqueuedContext(1).triggerCommentId).toBe(777001);
      expect(enqueuedContext(1).triggeredByLogin).toBe(SENDER_LOGIN);
      expect(enqueuedContext(1).webhookDeliveryId).toBe(DELIVERY_ID);
    });

    /*
     * The instruction is untrusted text that ends up quoted into a prompt. It
     * must survive verbatim — a handler that normalizes or truncates it here
     * changes what the user asked for before anyone can read it back.
     */
    test("carries a unicode instruction through byte for byte", async () => {
      const instruction: string =
        "implement this — 空のカートを守って 🙏 (and keep the public API)";

      await handle({
        event: "issue_comment",
        payload: issueCommentPayload({ body: `@${APP_SLUG} ${instruction}` }),
      });

      expect(enqueuedContext(1).instruction).toBe(instruction);
    });

    test("acknowledges the run and records the acknowledgement comment id", async () => {
      await handle({
        event: "issue_comment",
        payload: issueCommentPayload({ body: `@${APP_SLUG} implement this` }),
      });

      expect(acknowledgeSpy).toHaveBeenCalledTimes(1);

      const acknowledgement: {
        aiRunId: ObjectID;
        projectId: ObjectID;
        projectName: string | undefined;
        github: GitHubTaskContext;
      } = nthCallArgument(acknowledgeSpy, 1) as {
        aiRunId: ObjectID;
        projectId: ObjectID;
        projectName: string | undefined;
        github: GitHubTaskContext;
      };

      expect(acknowledgement.aiRunId.toString()).toBe(aiRunId.toString());
      expect(acknowledgement.projectName).toBe(PROJECT_NAME);

      const recorded: {
        aiRunId: ObjectID;
        acknowledgementCommentId: number;
      } = nthCallArgument(recordAcknowledgementSpy, 1) as {
        aiRunId: ObjectID;
        acknowledgementCommentId: number;
      };

      expect(recorded.acknowledgementCommentId).toBe(ACK_COMMENT_ID);
      expect(recorded.aiRunId.toString()).toBe(aiRunId.toString());
    });

    /*
     * No comment id means there is no comment to edit later. Recording a null
     * would make the finishing sweep edit "comment null" instead of posting.
     */
    test("records nothing when GitHub did not give back a comment id", async () => {
      acknowledgeSpy.mockResolvedValue(null);

      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: issueCommentPayload({ body: `@${APP_SLUG} implement this` }),
      });

      expect(recordAcknowledgementSpy).not.toHaveBeenCalled();
      expect(result.outcome).toBe("queued");
    });

    /*
     * The overwhelmingly common case: this runs on every comment in every
     * connected repository, and almost none of them are for us.
     */
    test("an ordinary comment that never mentions the app does nothing", async () => {
      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: issueCommentPayload({
          body: "I think the cart guard is missing here, will pick it up.",
        }),
      });

      expect(result.handled).toBe(false);
      expect(result.outcome).toBe("no-mention");
      expectNoRunAndNoWrites();
    });

    /*
     * GitHub's "Quote reply" button copies the parent comment into a `>`
     * block. Without this, every reply to one of the app's own comments
     * re-triggers it — a comment loop that bills the project until someone
     * notices.
     */
    test("a mention quoted from an earlier comment does not re-trigger a run", async () => {
      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: issueCommentPayload({
          body: `> @${APP_SLUG} implement this\n\nThanks, I will take it from here.`,
        }),
      });

      expect(result.outcome).toBe("no-mention");
      expectNoRunAndNoWrites();
    });

    test("a mention of a DIFFERENT app is not a mention of this one", async () => {
      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: issueCommentPayload({
          body: `@${APP_SLUG}-staging implement this`,
        }),
      });

      expect(result.outcome).toBe("no-mention");
      expectNoRunAndNoWrites();
    });
  });

  describe("a mention on a pull request", () => {
    test("queues a GitHubPullRequestRevision run for a revise command", async () => {
      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: pullRequestCommentPayload({
          body: `@${APP_SLUG} revise this because the retry loop never backs off`,
        }),
      });

      expect(result.outcome).toBe("queued");
      expect(enqueueArguments(1).taskType).toBe(
        CodeFixTaskType.GitHubPullRequestRevision,
      );
      expect(enqueuedContext(1).commandType).toBe(GitHubCommandType.Revise);
    });

    test("carries the PULL REQUEST number, and no issue number", async () => {
      await handle({
        event: "issue_comment",
        payload: pullRequestCommentPayload({
          body: `@${APP_SLUG} revise this`,
          pullRequestNumber: 42,
        }),
      });

      expect(enqueuedContext(1).pullRequestNumber).toBe(42);
      expect(enqueuedContext(1).issueNumber).toBeUndefined();
    });

    /*
     * THE force-push guard. The head branch is read once, here, and pinned on
     * the run. If the worker re-derived it when it claimed the task, a push to
     * the pull request in between would silently point the revision at a
     * different branch than the one the human was looking at.
     */
    test("pins the head branch from the pull request lookup, not from the payload", async () => {
      getPullRequestDetailsSpy.mockResolvedValue(
        pullRequestDetails({ headRefName: "hotfix/retry-backoff-v2" }),
      );

      await handle({
        event: "issue_comment",
        payload: pullRequestCommentPayload({
          body: `@${APP_SLUG} revise this`,
        }),
      });

      expect(enqueuedContext(1).pullRequestHeadRefName).toBe(
        "hotfix/retry-backoff-v2",
      );
      expect(enqueuedContext(1).isPullRequestFromFork).toBe(false);
    });

    test("looks the pull request up on the repository the webhook named", async () => {
      await handle({
        event: "issue_comment",
        payload: pullRequestCommentPayload({
          body: `@${APP_SLUG} revise this`,
          pullRequestNumber: 42,
        }),
      });

      const lookup: {
        installationId: string;
        organizationName: string;
        repositoryName: string;
        pullRequestNumber: number;
      } = nthCallArgument(getPullRequestDetailsSpy, 1) as {
        installationId: string;
        organizationName: string;
        repositoryName: string;
        pullRequestNumber: number;
      };

      expect(lookup.pullRequestNumber).toBe(42);
      expect(lookup.installationId).toBe(INSTALLATION_ID);
      expect(lookup.organizationName).toBe(ORGANIZATION_NAME);
      expect(lookup.repositoryName).toBe(REPOSITORY_NAME);
    });

    test("queues a GitHubPullRequestReview run for a review command", async () => {
      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: pullRequestCommentPayload({ body: `@${APP_SLUG} review` }),
      });

      expect(result.outcome).toBe("queued");
      expect(enqueueArguments(1).taskType).toBe(
        CodeFixTaskType.GitHubPullRequestReview,
      );
      expect(enqueuedContext(1).commandType).toBe(GitHubCommandType.Review);
    });

    /*
     * The review events carry the body under `review`, and there is no `issue`
     * key at all — the surface has to come from `pull_request`. Reading it
     * wrong turns a review request into an "implement" on a pull request.
     */
    test("reads a submitted review's body, and treats the surface as a pull request", async () => {
      const result: GitHubWebhookHandlingResult = await handle({
        event: "pull_request_review",
        payload: reviewSubmittedPayload({
          body: `@${APP_SLUG} review`,
          reviewId: 314159,
        }),
      });

      expect(result.outcome).toBe("queued");
      expect(enqueueArguments(1).taskType).toBe(
        CodeFixTaskType.GitHubPullRequestReview,
      );
      expect(enqueuedContext(1).pullRequestNumber).toBe(PULL_REQUEST_NUMBER);
      expect(enqueuedContext(1).triggerCommentId).toBe(314159);
    });
  });

  describe("commands that cannot be carried out where they were written", () => {
    /*
     * A silently dropped command reads as a broken integration. The user gets
     * told what to do instead — but no run is started and no pull request is
     * looked up.
     */
    test("a review asked for on an ISSUE is answered, not run", async () => {
      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: issueCommentPayload({ body: `@${APP_SLUG} review` }),
      });

      expect(result.handled).toBe(true);
      expect(result.outcome).toBe("unsupported-on-surface");
      expect(enqueueRunSpy).not.toHaveBeenCalled();
      expect(getPullRequestDetailsSpy).not.toHaveBeenCalled();
      expect(createIssueCommentSpy).toHaveBeenCalledTimes(1);
      expect(commentArguments(1).body).toContain(
        "I can only review pull requests",
      );
      expect(commentArguments(1).issueNumber).toBe(ISSUE_NUMBER);
    });

    test("an implement asked for on a PULL REQUEST is answered, not run", async () => {
      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: pullRequestCommentPayload({
          body: `@${APP_SLUG} implement this`,
        }),
      });

      expect(result.handled).toBe(true);
      expect(result.outcome).toBe("unsupported-on-surface");
      expect(enqueueRunSpy).not.toHaveBeenCalled();
      expect(commentArguments(1).body).toContain("I can only implement issues");
    });

    /*
     * The loop guard, checked the only way that actually proves it: feed the
     * comment this app just posted back through the real parser. Its own
     * comments arrive as webhooks like anyone else's, so a reply the parser
     * reads as a command is a two-comment loop that bills the project until
     * somebody notices. Asserting the absence of an "@" string would be both
     * weaker (a mention is only a command in a commandable position) and more
     * brittle (the help text legitimately prints one inside a code fence).
     */
    test("the refusal it posts cannot be read back as a command", async () => {
      await handle({
        event: "issue_comment",
        payload: issueCommentPayload({ body: `@${APP_SLUG} review` }),
      });

      expect(
        GitHubCommandParser.parse({
          body: commentArguments(1).body,
          appSlug: APP_SLUG,
          surface: GitHubCommandSurface.Issue,
        }),
      ).toBeNull();
    });
  });

  describe("pull requests it refuses to work on", () => {
    test("a closed pull request is answered and no run is started", async () => {
      getPullRequestDetailsSpy.mockResolvedValue(
        pullRequestDetails({ state: "closed" }),
      );

      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: pullRequestCommentPayload({
          body: `@${APP_SLUG} revise this`,
        }),
      });

      expect(result.handled).toBe(true);
      expect(result.outcome).toBe("pull-request-not-open");
      expect(enqueueRunSpy).not.toHaveBeenCalled();
      expect(createIssueCommentSpy).toHaveBeenCalledTimes(1);
      expect(commentArguments(1).body).toContain("already closed");
      expect(commentArguments(1).issueNumber).toBe(PULL_REQUEST_NUMBER);
    });

    test("a merged pull request is refused for a REVIEW as well", async () => {
      getPullRequestDetailsSpy.mockResolvedValue(
        pullRequestDetails({ state: "closed" }),
      );

      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: pullRequestCommentPayload({ body: `@${APP_SLUG} review` }),
      });

      expect(result.outcome).toBe("pull-request-not-open");
      expect(enqueueRunSpy).not.toHaveBeenCalled();
    });

    /*
     * A fork's branch lives in a repository this installation cannot write to.
     * Discovering that after a clone and a full agent run spends the budget
     * and ends in a confusing push error.
     */
    test("a revise on a FORK pull request is refused up front", async () => {
      getPullRequestDetailsSpy.mockResolvedValue(
        pullRequestDetails({ headRepositoryFullName: "contributor/checkout" }),
      );

      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: pullRequestCommentPayload({
          body: `@${APP_SLUG} revise this`,
        }),
      });

      expect(result.handled).toBe(true);
      expect(result.outcome).toBe("pull-request-from-fork");
      expect(enqueueRunSpy).not.toHaveBeenCalled();
      expect(commentArguments(1).body).toContain("comes from a fork");
    });

    /*
     * The other half of the same rule, and the one a naive "forks are unsafe"
     * fix would break: a review is WRITTEN on the base repository's pull
     * request, so a fork changes nothing about it.
     */
    test("a REVIEW of the same fork pull request is allowed", async () => {
      getPullRequestDetailsSpy.mockResolvedValue(
        pullRequestDetails({ headRepositoryFullName: "contributor/checkout" }),
      );

      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: pullRequestCommentPayload({ body: `@${APP_SLUG} review` }),
      });

      expect(result.outcome).toBe("queued");
      expect(enqueueArguments(1).taskType).toBe(
        CodeFixTaskType.GitHubPullRequestReview,
      );
      expect(createIssueCommentSpy).not.toHaveBeenCalled();
    });

    /*
     * A fork's head branch does not exist in the repository this installation
     * can reach, so pinning it would send the run after a ref that is not
     * there — which a clone answers with the default branch, quietly reviewing
     * the wrong code. The flag says why it is missing, so the recipe can work
     * from the base plus the diff instead of guessing.
     */
    test("a fork review carries the fork flag and NO head branch to check out", async () => {
      getPullRequestDetailsSpy.mockResolvedValue(
        pullRequestDetails({ headRepositoryFullName: "contributor/checkout" }),
      );

      await handle({
        event: "issue_comment",
        payload: pullRequestCommentPayload({ body: `@${APP_SLUG} review` }),
      });

      expect(enqueuedContext(1).isPullRequestFromFork).toBe(true);
      expect(enqueuedContext(1).pullRequestHeadRefName).toBeUndefined();
    });

    // GitHub reports a null head repository for a fork that has been deleted.
    test("a revise on a pull request whose head repository is gone is refused", async () => {
      getPullRequestDetailsSpy.mockResolvedValue(
        pullRequestDetails({ headRepositoryFullName: null }),
      );

      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: pullRequestCommentPayload({
          body: `@${APP_SLUG} revise this`,
        }),
      });

      expect(result.outcome).toBe("pull-request-from-fork");
      expect(enqueueRunSpy).not.toHaveBeenCalled();
    });

    /*
     * GitHub preserves the case of an owner or repository rename. Treating a
     * case difference as a fork would refuse every revision on a repository
     * whose owner capitalized their name.
     */
    test("a differently-cased head repository is the same repository, not a fork", async () => {
      getPullRequestDetailsSpy.mockResolvedValue(
        pullRequestDetails({ headRepositoryFullName: "Acme/Checkout" }),
      );

      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: pullRequestCommentPayload({
          body: `@${APP_SLUG} revise this`,
        }),
      });

      expect(result.outcome).toBe("queued");
      expect(enqueueArguments(1).taskType).toBe(
        CodeFixTaskType.GitHubPullRequestRevision,
      );
    });
  });

  /*
   * help / status / cancel cost no agent run, so none of them may enqueue one
   * — and all of them must answer, because "why is nothing happening?" is
   * exactly the question they exist to answer.
   */
  describe("conversational commands", () => {
    test("help replies with the command list and starts nothing", async () => {
      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: issueCommentPayload({ body: `@${APP_SLUG} help` }),
      });

      expect(result.handled).toBe(true);
      expect(result.outcome).toBe("help");
      expect(enqueueRunSpy).not.toHaveBeenCalled();
      expect(createIssueCommentSpy).toHaveBeenCalledTimes(1);
      expect(commentArguments(1).body).toContain("Here is what you can ask me");
    });

    /*
     * The help text is the one comment this app posts that HAS to print
     * mentions of itself — it is documentation. They are fenced, and the
     * parser ignores fenced regions, so the two files agree by construction.
     * If either side of that arrangement drifts, the app answers its own help
     * comment, forever.
     */
    test("the help text it posts cannot be read back as a command", async () => {
      await handle({
        event: "issue_comment",
        payload: issueCommentPayload({ body: `@${APP_SLUG} help` }),
      });

      expect(commentArguments(1).body).toContain(`@${APP_SLUG} review`);
      expect(
        GitHubCommandParser.parse({
          body: commentArguments(1).body,
          appSlug: APP_SLUG,
          surface: GitHubCommandSurface.Issue,
        }),
      ).toBeNull();
    });

    /*
     * A bare mention is a request for orientation, not a licence to start work
     * on whatever the thread happens to be about.
     */
    test("a bare mention is help, not an implicit command", async () => {
      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: issueCommentPayload({ body: `Hey @${APP_SLUG}` }),
      });

      expect(result.outcome).toBe("help");
      expect(enqueueRunSpy).not.toHaveBeenCalled();
    });

    test("status reports the live runs for this conversation and starts nothing", async () => {
      findRunsSpy.mockResolvedValue([liveRun(GitHubCommandType.Revise)]);

      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: pullRequestCommentPayload({ body: `@${APP_SLUG} status` }),
      });

      expect(result.handled).toBe(true);
      expect(result.outcome).toBe("status");
      expect(enqueueRunSpy).not.toHaveBeenCalled();
      expect(commentArguments(1).body).toContain("Revising this pull request");

      const query: {
        projectId: ObjectID;
        codeRepositoryId: ObjectID;
        conversationNumber: number;
      } = nthCallArgument(findRunsSpy, 1) as {
        projectId: ObjectID;
        codeRepositoryId: ObjectID;
        conversationNumber: number;
      };

      expect(query.conversationNumber).toBe(PULL_REQUEST_NUMBER);
      expect(query.codeRepositoryId.toString()).toBe(
        codeRepositoryId.toString(),
      );
    });

    test("status still answers when nothing is running", async () => {
      findRunsSpy.mockResolvedValue([]);

      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: issueCommentPayload({ body: `@${APP_SLUG} status` }),
      });

      expect(result.outcome).toBe("status");
      expect(createIssueCommentSpy).toHaveBeenCalledTimes(1);
      expect(commentArguments(1).body).toContain("not working on anything");
    });

    test("cancel cancels this conversation's runs and says how many", async () => {
      cancelRunsSpy.mockResolvedValue(2);

      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: pullRequestCommentPayload({ body: `@${APP_SLUG} cancel` }),
      });

      expect(result.handled).toBe(true);
      expect(result.outcome).toBe("cancel");
      expect(enqueueRunSpy).not.toHaveBeenCalled();
      expect(cancelRunsSpy).toHaveBeenCalledTimes(1);

      const query: {
        projectId: ObjectID;
        codeRepositoryId: ObjectID;
        conversationNumber: number;
      } = nthCallArgument(cancelRunsSpy, 1) as {
        projectId: ObjectID;
        codeRepositoryId: ObjectID;
        conversationNumber: number;
      };

      expect(query.conversationNumber).toBe(PULL_REQUEST_NUMBER);
      expect(query.projectId.toString()).toBe(projectId.toString());
      expect(commentArguments(1).body).toContain("Cancelled");
    });

    /*
     * Cancelling with nothing running is still answered — silence would leave
     * the user wondering whether the cancel landed.
     */
    test("cancel with nothing running still replies", async () => {
      cancelRunsSpy.mockResolvedValue(0);

      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: pullRequestCommentPayload({ body: `@${APP_SLUG} cancel` }),
      });

      expect(result.outcome).toBe("cancel");
      expect(commentArguments(1).body).toContain("Nothing of mine is running");
    });

    // A conversational command never touches the pull request API.
    test("no conversational command looks up the pull request", async () => {
      await handle({
        event: "issue_comment",
        payload: pullRequestCommentPayload({ body: `@${APP_SLUG} status` }),
      });

      expect(getPullRequestDetailsSpy).not.toHaveBeenCalled();
    });
  });

  describe("an issue handed over with the trigger label", () => {
    test("the default label starts an Implement run when none is configured", async () => {
      authorizeSpy.mockResolvedValue(allowedAuthorization());

      const result: GitHubWebhookHandlingResult = await handle({
        event: "issues",
        payload: issuesLabeledPayload({ labelName: "oneuptime" }),
      });

      expect(result.handled).toBe(true);
      expect(result.outcome).toBe("queued");
      expect(enqueueArguments(1).taskType).toBe(CodeFixTaskType.GitHubIssueFix);
      expect(enqueuedContext(1).commandType).toBe(GitHubCommandType.Implement);
      expect(enqueuedContext(1).issueNumber).toBe(ISSUE_NUMBER);
    });

    /*
     * GitHub labels are case-preserving but case-insensitively unique, so
     * "OneUptime" and "oneuptime" are the SAME label. An exact-match check
     * would miss half of them, and the feature would look broken at random.
     */
    test("matches the configured label case-insensitively and ignoring surrounding space", async () => {
      authorizeSpy.mockResolvedValue(allowedAuthorization("  Needs-AI  "));

      const result: GitHubWebhookHandlingResult = await handle({
        event: "issues",
        payload: issuesLabeledPayload({ labelName: "needs-ai" }),
      });

      expect(result.outcome).toBe("queued");
      expect(enqueueArguments(1).taskType).toBe(CodeFixTaskType.GitHubIssueFix);
    });

    test("a different label starts nothing and says nothing", async () => {
      authorizeSpy.mockResolvedValue(allowedAuthorization("needs-ai"));

      const result: GitHubWebhookHandlingResult = await handle({
        event: "issues",
        payload: issuesLabeledPayload({ labelName: "bug" }),
      });

      expect(result.handled).toBe(false);
      expect(result.outcome).toBe("label-is-not-the-trigger-label");
      expectNoRunAndNoWrites();
    });

    /*
     * With a label configured, the default must NOT also fire — a repository
     * that renamed its trigger label would otherwise still answer the old one.
     */
    test("the default label stops working once another one is configured", async () => {
      authorizeSpy.mockResolvedValue(allowedAuthorization("needs-ai"));

      const result: GitHubWebhookHandlingResult = await handle({
        event: "issues",
        payload: issuesLabeledPayload({ labelName: "oneuptime" }),
      });

      expect(result.outcome).toBe("label-is-not-the-trigger-label");
      expect(enqueueRunSpy).not.toHaveBeenCalled();
    });

    test("an all-whitespace configured label falls back to the default", async () => {
      authorizeSpy.mockResolvedValue(allowedAuthorization("   "));

      const result: GitHubWebhookHandlingResult = await handle({
        event: "issues",
        payload: issuesLabeledPayload({ labelName: "oneuptime" }),
      });

      expect(result.outcome).toBe("queued");
    });

    test("an issues event with no label object starts nothing", async () => {
      const result: GitHubWebhookHandlingResult = await handle({
        event: "issues",
        payload: {
          ...webhookEnvelope(),
          action: "labeled",
          issue: { number: ISSUE_NUMBER, title: "Checkout throws" },
        },
      });

      expect(result.outcome).toBe("label-is-not-the-trigger-label");
      expectNoRunAndNoWrites();
    });

    /*
     * Most `issues` deliveries are opened / edited / closed, and authorizing
     * costs a database read plus a GitHub permission call. Doing that on every
     * issue anyone touches in every connected repository burns the
     * installation's rate limit on deliveries that were never going to do
     * anything — so the cheap action check has to come first.
     */
    test.each(["opened", "edited", "closed", "reopened", "unassigned"])(
      "an issues %s event is dropped before anything expensive happens",
      async (action: string) => {
        const result: GitHubWebhookHandlingResult = await handle({
          event: "issues",
          payload: {
            ...webhookEnvelope(),
            action: action,
            issue: { number: ISSUE_NUMBER, title: "Checkout throws" },
          },
        });

        expect(result.outcome).toBe("action-not-actionable");
        expect(authorizeSpy).not.toHaveBeenCalled();
        expect(getAppSlugSpy).not.toHaveBeenCalled();
        expectNoRunAndNoWrites();
      },
    );

    /*
     * GitHub models a pull request as an issue, so labelling a pull request
     * arrives here too — with the real event following on `pull_request`.
     * Acting on both would run the work twice.
     */
    test("an issues event that is really a pull request is left to the pull_request event", async () => {
      const result: GitHubWebhookHandlingResult = await handle({
        event: "issues",
        payload: issuesLabeledPayload({
          labelName: "oneuptime",
          isReallyAPullRequest: true,
        }),
      });

      expect(result.handled).toBe(false);
      expect(result.outcome).toBe("issue-is-pull-request");
      expect(authorizeSpy).not.toHaveBeenCalled();
      expectNoRunAndNoWrites();
    });

    test("an issues event with no issue number is dropped before authorizing", async () => {
      const result: GitHubWebhookHandlingResult = await handle({
        event: "issues",
        payload: {
          ...webhookEnvelope(),
          action: "labeled",
          issue: { title: "Checkout throws" },
          label: { name: "oneuptime" },
        },
      });

      expect(result.outcome).toBe("no-issue-number");
      expect(authorizeSpy).not.toHaveBeenCalled();
    });
  });

  describe("an issue assigned to the app", () => {
    test("an assignment to the app's bot login starts an Implement run", async () => {
      const result: GitHubWebhookHandlingResult = await handle({
        event: "issues",
        payload: issuesAssignedPayload({ assigneeLogin: BOT_LOGIN }),
      });

      expect(result.handled).toBe(true);
      expect(result.outcome).toBe("queued");
      expect(enqueueArguments(1).taskType).toBe(CodeFixTaskType.GitHubIssueFix);
      expect(enqueuedContext(1).issueNumber).toBe(ISSUE_NUMBER);
      // Nobody wrote a sentence, so the agent is told to read the issue.
      expect(enqueuedContext(1).instruction).toBe("");
      expect(enqueuedContext(1).triggerCommentId).toBeUndefined();
    });

    test("the bot login is matched case-insensitively", async () => {
      const result: GitHubWebhookHandlingResult = await handle({
        event: "issues",
        payload: issuesAssignedPayload({ assigneeLogin: "OneUptime[Bot]" }),
      });

      expect(result.outcome).toBe("queued");
    });

    /*
     * Assigning a teammate an issue in a connected repository must not start
     * an agent run. This is the single check standing between "normal triage"
     * and "every assignment spends AI budget".
     */
    test.each([
      "octo-dev",
      "oneuptime",
      "oneuptime-staging[bot]",
      "someone[bot]",
    ])("an assignment to %s starts nothing", async (assigneeLogin: string) => {
      const result: GitHubWebhookHandlingResult = await handle({
        event: "issues",
        payload: issuesAssignedPayload({ assigneeLogin: assigneeLogin }),
      });

      expect(result.handled).toBe(false);
      expect(result.outcome).toBe("assignee-is-not-this-app");
      // Answered from the payload alone: no database read, no GitHub call.
      expect(authorizeSpy).not.toHaveBeenCalled();
      expectNoRunAndNoWrites();
    });

    test("an assignment event with no assignee object starts nothing", async () => {
      const result: GitHubWebhookHandlingResult = await handle({
        event: "issues",
        payload: issuesAssignedPayload({}),
      });

      expect(result.outcome).toBe("assignee-is-not-this-app");
      expectNoRunAndNoWrites();
    });

    /*
     * Without a slug there is no bot login to compare against, and "unknown"
     * must never compare equal to "the app".
     */
    test("an unresolvable app slug starts nothing", async () => {
      getAppSlugSpy.mockResolvedValue(null);

      const result: GitHubWebhookHandlingResult = await handle({
        event: "issues",
        payload: issuesAssignedPayload({ assigneeLogin: BOT_LOGIN }),
      });

      expect(result.outcome).toBe("assignee-is-not-this-app");
      expectNoRunAndNoWrites();
    });
  });

  describe("a review requested from the app", () => {
    test("a review request for the app's bot login queues a review run", async () => {
      const result: GitHubWebhookHandlingResult = await handle({
        event: "pull_request",
        payload: reviewRequestedPayload({
          requestedReviewerLogin: BOT_LOGIN,
        }),
      });

      expect(result.handled).toBe(true);
      expect(result.outcome).toBe("queued");
      expect(enqueueArguments(1).taskType).toBe(
        CodeFixTaskType.GitHubPullRequestReview,
      );
      expect(enqueuedContext(1).pullRequestNumber).toBe(PULL_REQUEST_NUMBER);
      expect(enqueuedContext(1).pullRequestHeadRefName).toBe(HEAD_REF_NAME);
    });

    /*
     * Requesting a human reviewer is the single most common pull request
     * event in an active repository. Answering it would start an agent run
     * every time anyone asked a colleague to look at their code.
     */
    test("a review request for a human starts nothing and never even authorizes", async () => {
      const result: GitHubWebhookHandlingResult = await handle({
        event: "pull_request",
        payload: reviewRequestedPayload({
          requestedReviewerLogin: "some-reviewer",
        }),
      });

      expect(result.handled).toBe(false);
      expect(result.outcome).toBe("reviewer-is-not-this-app");
      expect(authorizeSpy).not.toHaveBeenCalled();
      expectNoRunAndNoWrites();
    });

    test("a review requested from a TEAM (no requested_reviewer) starts nothing", async () => {
      const result: GitHubWebhookHandlingResult = await handle({
        event: "pull_request",
        payload: reviewRequestedPayload({}),
      });

      expect(result.outcome).toBe("reviewer-is-not-this-app");
      expectNoRunAndNoWrites();
    });

    test.each(["opened", "synchronize", "closed", "labeled"])(
      "a pull_request %s event starts nothing",
      async (action: string) => {
        const result: GitHubWebhookHandlingResult = await handle({
          event: "pull_request",
          payload: reviewRequestedPayload({
            requestedReviewerLogin: BOT_LOGIN,
            action: action,
          }),
        });

        expect(result.handled).toBe(false);
        expect(result.outcome).toBe("action-not-actionable");
        expectNoRunAndNoWrites();
      },
    );
  });

  /*
   * "Already working on this" and "over the daily budget" are normal answers,
   * not failures — and useless unless the person who asked can read them. A
   * command that produces no visible response reads as a broken integration.
   */
  describe("when the enqueue refuses", () => {
    test("a BadDataException becomes a refusal comment carrying its message", async () => {
      enqueueRunSpy.mockRejectedValue(
        new BadDataException(
          "I am already working on this — I will comment here when I am done.",
        ),
      );

      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: issueCommentPayload({ body: `@${APP_SLUG} implement this` }),
      });

      expect(result.handled).toBe(true);
      expect(result.outcome).toBe("refused");
      expect(createIssueCommentSpy).toHaveBeenCalledTimes(1);
      expect(commentArguments(1).body).toContain("already working on this");
      expect(commentArguments(1).issueNumber).toBe(ISSUE_NUMBER);
      expect(acknowledgeSpy).not.toHaveBeenCalled();
      expect(recordAcknowledgementSpy).not.toHaveBeenCalled();
    });

    test("an over-budget refusal is reported in the thread too", async () => {
      enqueueRunSpy.mockRejectedValue(
        new BadDataException(
          "This project is over its daily AI fix-run budget.",
        ),
      );

      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: pullRequestCommentPayload({ body: `@${APP_SLUG} review` }),
      });

      expect(result.outcome).toBe("refused");
      expect(commentArguments(1).body).toContain("daily AI fix-run budget");
    });

    // A thrown non-Error must still produce words a human can act on.
    test("a non-Error rejection still gets a plain-English refusal", async () => {
      enqueueRunSpy.mockRejectedValue("something odd");

      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: issueCommentPayload({ body: `@${APP_SLUG} implement this` }),
      });

      expect(result.outcome).toBe("refused");
      expect(commentArguments(1).body).toContain(
        "I could not start that just now",
      );
    });

    /*
     * The reply is best effort. GitHub being unavailable for the comment must
     * not turn a clean refusal into a non-2xx and a redelivery.
     */
    test("a refusal whose comment fails to post does not fail the delivery", async () => {
      enqueueRunSpy.mockRejectedValue(new BadDataException("Already running."));
      createIssueCommentSpy.mockRejectedValue(new Error("503 from GitHub"));

      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: issueCommentPayload({ body: `@${APP_SLUG} implement this` }),
      });

      expect(result.handled).toBe(true);
      expect(result.outcome).toBe("refused");
    });
  });

  describe("authorization outcomes", () => {
    test("passes the sender through so the authorizer can apply its own rules", async () => {
      await handle({
        event: "issue_comment",
        payload: issueCommentPayload({ body: `@${APP_SLUG} implement this` }),
      });

      const authorization: {
        organizationName: string;
        repositoryName: string;
        installationId: string;
        senderLogin: string;
        senderType: string | undefined;
      } = nthCallArgument(authorizeSpy, 1) as {
        organizationName: string;
        repositoryName: string;
        installationId: string;
        senderLogin: string;
        senderType: string | undefined;
      };

      expect(authorization.senderLogin).toBe(SENDER_LOGIN);
      expect(authorization.senderType).toBe("User");
      expect(authorization.installationId).toBe(INSTALLATION_ID);
      expect(authorization.organizationName).toBe(ORGANIZATION_NAME);
      expect(authorization.repositoryName).toBe(REPOSITORY_NAME);
    });

    /*
     * THE anti-amplification rule. Replying to a command from an account
     * without write access would make this app a comment-poster that any
     * GitHub account can drive at a repository it cannot write to: one
     * mention, one guaranteed comment, repeat.
     */
    test("insufficient permission gets a reaction on the comment and NO comment", async () => {
      authorizeSpy.mockResolvedValue({
        outcome: GitHubAuthorizationOutcome.InsufficientPermission,
        codeRepository: connectedRepository(),
      });

      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: issueCommentPayload({
          body: `@${APP_SLUG} implement this`,
          commentId: 4242,
        }),
      });

      expect(result.handled).toBe(false);
      expect(result.outcome).toBe("unresolvable-context");
      expect(createIssueCommentSpy).not.toHaveBeenCalled();
      expect(enqueueRunSpy).not.toHaveBeenCalled();
      expect(addReactionToCommentSpy).toHaveBeenCalledTimes(1);
      expect(reactionArguments(1).reaction).toBe(GitHubReaction.Confused);
      expect(reactionArguments(1).commentId).toBe(4242);
      expect(reactionArguments(1).installationId).toBe(INSTALLATION_ID);
    });

    test("insufficient permission on an event with no comment says nothing at all", async () => {
      authorizeSpy.mockResolvedValue({
        outcome: GitHubAuthorizationOutcome.InsufficientPermission,
        codeRepository: connectedRepository(),
      });

      const result: GitHubWebhookHandlingResult = await handle({
        event: "issues",
        payload: issuesLabeledPayload({ labelName: "oneuptime" }),
      });

      expect(result.handled).toBe(false);
      expect(result.outcome).toBe("unresolvable-context");
      expectNoRunAndNoWrites();
    });

    /*
     * The opposite rule, and the reason the two outcomes are separate: a
     * collaborator whose repository has the switch off is told where the
     * switch is, or the integration reads as broken.
     */
    test("commands disabled DOES reply, and starts nothing", async () => {
      authorizeSpy.mockResolvedValue({
        outcome: GitHubAuthorizationOutcome.CommandsDisabled,
        codeRepository: connectedRepository(),
        reason:
          "GitHub commands are switched off for this repository. A project admin can turn them back on.",
      });

      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: issueCommentPayload({ body: `@${APP_SLUG} implement this` }),
      });

      /*
       * handled is TRUE: the app did something visible in the thread, which is
       * the whole point of separating this outcome from Ignore.
       */
      expect(result.handled).toBe(true);
      expect(result.outcome).toBe("commands-disabled");
      expect(enqueueRunSpy).not.toHaveBeenCalled();
      expect(addReactionToCommentSpy).not.toHaveBeenCalled();
      expect(createIssueCommentSpy).toHaveBeenCalledTimes(1);
      expect(commentArguments(1).body).toContain("switched off");
      expect(commentArguments(1).issueNumber).toBe(ISSUE_NUMBER);
    });

    /*
     * ...but ONLY when the app was actually addressed. This runs for every
     * label added to every issue in the repository, and answering here turned
     * a repository with the switch off into one where labelling anything at
     * all produced a bot comment.
     */
    test("commands disabled says NOTHING when a non-trigger label is added", async () => {
      authorizeSpy.mockResolvedValue({
        outcome: GitHubAuthorizationOutcome.CommandsDisabled,
        codeRepository: connectedRepository(),
        reason: "GitHub commands are switched off for this repository.",
      });

      const result: GitHubWebhookHandlingResult = await handle({
        event: "issues",
        payload: issuesLabeledPayload({ labelName: "needs-triage" }),
      });

      expect(result.handled).toBe(false);
      expect(result.outcome).toBe("label-is-not-the-trigger-label");
      expect(createIssueCommentSpy).not.toHaveBeenCalled();
    });

    test("commands disabled DOES reply when the trigger label is added", async () => {
      authorizeSpy.mockResolvedValue({
        outcome: GitHubAuthorizationOutcome.CommandsDisabled,
        codeRepository: connectedRepository(),
        reason: "GitHub commands are switched off for this repository.",
      });

      const result: GitHubWebhookHandlingResult = await handle({
        event: "issues",
        payload: issuesLabeledPayload({ labelName: "oneuptime" }),
      });

      expect(result.handled).toBe(true);
      expect(result.outcome).toBe("commands-disabled");
      expect(enqueueRunSpy).not.toHaveBeenCalled();
      expect(createIssueCommentSpy).toHaveBeenCalledTimes(1);
    });

    test("commands disabled with no reason still says something useful", async () => {
      authorizeSpy.mockResolvedValue({
        outcome: GitHubAuthorizationOutcome.CommandsDisabled,
        codeRepository: connectedRepository(),
      });

      await handle({
        event: "issue_comment",
        payload: issueCommentPayload({ body: `@${APP_SLUG} implement this` }),
      });

      expect(commentArguments(1).body).toContain(
        "GitHub commands are switched off for this repository.",
      );
    });

    /*
     * Ignore is the loop guard and the "not our repository" answer. It must be
     * completely silent: this app has no standing to comment in a repository
     * no OneUptime project has connected, and answering another bot is how a
     * budget disappears overnight.
     */
    test("ignore is completely silent — no comment, no reaction, no run", async () => {
      authorizeSpy.mockResolvedValue({
        outcome: GitHubAuthorizationOutcome.Ignore,
      });

      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: issueCommentPayload({ body: `@${APP_SLUG} implement this` }),
      });

      expect(result.handled).toBe(false);
      expect(result.outcome).toBe("unresolvable-context");
      expectNoRunAndNoWrites();
    });

    /*
     * An Allowed outcome whose repository row carries no id cannot be billed
     * to a project or deduped against one. Starting a run anyway would create
     * an AIRun no worker could execute.
     */
    test("an allowed outcome with no repository row starts nothing", async () => {
      authorizeSpy.mockResolvedValue({
        outcome: GitHubAuthorizationOutcome.Allowed,
        projectName: PROJECT_NAME,
      });

      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: issueCommentPayload({ body: `@${APP_SLUG} implement this` }),
      });

      expect(result.handled).toBe(false);
      expect(result.outcome).toBe("no-repository");
      expect(enqueueRunSpy).not.toHaveBeenCalled();
    });
  });

  /*
   * Every field read here comes out of a JSON blob an untrusted party can
   * influence. None of these shapes may throw, and none may be acted on.
   */
  describe("malformed and adversarial payloads", () => {
    // A mention whose envelope is missing one of the three required keys.
    function commentPayloadMissing(data: {
      repository?: JSONObject;
      installation?: JSONObject;
      sender?: JSONObject;
    }): JSONObject {
      const payload: JSONObject = {
        action: "created",
        issue: { number: ISSUE_NUMBER, title: "Checkout throws" },
        comment: {
          id: TRIGGER_COMMENT_ID,
          body: `@${APP_SLUG} implement this`,
        },
      };

      if (data.repository) {
        payload["repository"] = data.repository;
      }

      if (data.installation) {
        payload["installation"] = data.installation;
      }

      if (data.sender) {
        payload["sender"] = data.sender;
      }

      return payload;
    }

    test("a payload with no repository never reaches the authorizer", async () => {
      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: commentPayloadMissing({
          installation: { id: INSTALLATION_ID_NUMBER },
          sender: { login: SENDER_LOGIN, type: "User" },
        }),
      });

      expect(result.outcome).toBe("unresolvable-context");
      expect(authorizeSpy).not.toHaveBeenCalled();
      expectNoRunAndNoWrites();
    });

    test.each(["checkout", "/checkout", "acme/", "", "   "])(
      "a repository full_name of %p is not a repository",
      async (fullName: string) => {
        const result: GitHubWebhookHandlingResult = await handle({
          event: "issue_comment",
          payload: {
            ...issueCommentPayload({ body: `@${APP_SLUG} implement this` }),
            repository: { full_name: fullName },
          },
        });

        expect(result.outcome).toBe("unresolvable-context");
        expect(authorizeSpy).not.toHaveBeenCalled();
      },
    );

    /*
     * No installation means no credential to act with. This is the value the
     * whole authorization chain is anchored on, so an absent one can never be
     * defaulted or inferred.
     */
    test("a payload with no installation never reaches the authorizer", async () => {
      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: commentPayloadMissing({
          repository: { full_name: REPOSITORY_FULL_NAME },
          sender: { login: SENDER_LOGIN, type: "User" },
        }),
      });

      expect(result.outcome).toBe("unresolvable-context");
      expect(authorizeSpy).not.toHaveBeenCalled();
    });

    test("a payload with no sender never reaches the authorizer", async () => {
      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: commentPayloadMissing({
          repository: { full_name: REPOSITORY_FULL_NAME },
          installation: { id: INSTALLATION_ID_NUMBER },
        }),
      });

      expect(result.outcome).toBe("unresolvable-context");
      expect(authorizeSpy).not.toHaveBeenCalled();
    });

    test("a sender with no login never reaches the authorizer", async () => {
      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: commentPayloadMissing({
          repository: { full_name: REPOSITORY_FULL_NAME },
          installation: { id: INSTALLATION_ID_NUMBER },
          sender: { type: "User" },
        }),
      });

      expect(result.outcome).toBe("unresolvable-context");
      expect(authorizeSpy).not.toHaveBeenCalled();
    });

    test("a comment with an empty body is dropped before anything else", async () => {
      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: issueCommentPayload({ body: "" }),
      });

      expect(result.outcome).toBe("no-comment-body");
      expect(authorizeSpy).not.toHaveBeenCalled();
      expectNoRunAndNoWrites();
    });

    test("a comment event with no comment object at all is dropped", async () => {
      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: {
          ...webhookEnvelope(),
          action: "created",
          issue: { number: ISSUE_NUMBER, title: "Checkout throws" },
        },
      });

      expect(result.outcome).toBe("no-comment-body");
      expectNoRunAndNoWrites();
    });

    /*
     * A missing number means there is no thread to answer in. Defaulting it to
     * anything would post into a stranger's issue.
     */
    test("a comment on a conversation with no number is dropped", async () => {
      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: {
          ...webhookEnvelope(),
          action: "created",
          issue: { title: "Checkout throws" },
          comment: { id: 1, body: `@${APP_SLUG} implement this` },
        },
      });

      expect(result.outcome).toBe("no-conversation-number");
      expectNoRunAndNoWrites();
    });

    /*
     * GitHub sends numbers as JSON numbers. A string here means the payload is
     * not the shape it claims to be, and guessing at it is how a run ends up
     * pointed at the wrong conversation.
     */
    test("a conversation number sent as a string is not accepted", async () => {
      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: {
          ...webhookEnvelope(),
          action: "created",
          issue: { number: "12", title: "Checkout throws" },
          comment: { id: 1, body: `@${APP_SLUG} implement this` },
        },
      });

      expect(result.outcome).toBe("no-conversation-number");
      expectNoRunAndNoWrites();
    });

    test("an instance that cannot resolve its own app slug answers no comment", async () => {
      getAppSlugSpy.mockResolvedValue(null);

      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: issueCommentPayload({ body: `@${APP_SLUG} implement this` }),
      });

      expect(result.handled).toBe(false);
      expect(result.outcome).toBe("no-app-slug");
      expect(authorizeSpy).not.toHaveBeenCalled();
      expectNoRunAndNoWrites();
    });

    /*
     * A comment that is nothing but a fenced block containing a mention — for
     * example someone pasting the help text back into the thread.
     */
    test("a mention inside a fenced code block is not a command", async () => {
      const result: GitHubWebhookHandlingResult = await handle({
        event: "issue_comment",
        payload: issueCommentPayload({
          body: `Try this:\n\n\`\`\`text\n@${APP_SLUG} implement this\n\`\`\`\n`,
        }),
      });

      expect(result.outcome).toBe("no-mention");
      expectNoRunAndNoWrites();
    });
  });
});
