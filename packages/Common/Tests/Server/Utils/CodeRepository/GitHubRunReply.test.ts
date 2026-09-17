import GitHubRunReply from "../../../../Server/Utils/CodeRepository/GitHub/GitHubRunReply";
import GitHubConversation, {
  GitHubIssueComment,
  GitHubReaction,
} from "../../../../Server/Utils/CodeRepository/GitHub/GitHubConversation";
import AIRunService from "../../../../Server/Services/AIRunService";
import AIAgentTaskPullRequestService from "../../../../Server/Services/AIAgentTaskPullRequestService";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIAgentTaskPullRequest from "../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import GitHubCommandType from "../../../../Types/CodeRepository/GitHubCommand";
import CodeFixTaskContext, {
  GitHubTaskContext,
} from "../../../../Types/AI/CodeFixTaskContext";
import ObjectID from "../../../../Types/ObjectID";
import URL from "../../../../Types/API/URL";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import logger from "../../../../Server/Utils/Logger";
import { DashboardClientUrl } from "../../../../Server/EnvironmentConfig";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * How a GitHub-triggered agent run talks back to the thread it came from.
 *
 * The invariant these tests pin is a counting one: ONE command produces
 * exactly ONE comment from this app. It is acknowledged when the run is
 * accepted and EDITED when the run finishes. A long-running agent that
 * appends a comment per state change turns a pull request into a status log,
 * and a reviewer stops reading it — so "did we edit or did we post again?" is
 * the single most valuable thing to hold still here.
 *
 * Three more properties matter as much and are easier to break by accident:
 *
 *   1. `acknowledge` is BEST EFFORT. The run is already queued by the time it
 *      is called, so a comment GitHub refused must not fail the command — it
 *      returns null and the work still happens.
 *
 *   2. `reportOutcome` returns a BOOLEAN, and the sweeper writes
 *      `reportedToGitHubAt` only on true. That pair is the whole retry story:
 *      a false that gets marked anyway silently loses the user's answer
 *      forever, and a true that never gets marked posts the answer again
 *      every minute for a day. Several tests here drive the sweeper's own
 *      `if (posted) markReported(...)` logic to pin both halves at once.
 *
 *   3. The words per status are load-bearing. NoFixFound must read as a
 *      FINDING, not a failure — a user who reads "failed" retries verbatim,
 *      a user who reads "found nothing" writes a better instruction. And a
 *      Revise run must NOT link the pull request the reader is already on.
 *
 * Everything GitHub-facing is a spy: no network, no database, no Postgres.
 * ---------------------------------------------------------------------------
 */

// The GitHub write calls, as this module makes them.
interface CreateCommentCall {
  installationId: string;
  organizationName: string;
  repositoryName: string;
  issueNumber: number;
  body: string;
}

interface UpdateCommentCall {
  installationId: string;
  organizationName: string;
  repositoryName: string;
  commentId: number;
  body: string;
}

interface ReactionOnCommentCall {
  installationId: string;
  organizationName: string;
  repositoryName: string;
  commentId: number;
  reaction: GitHubReaction;
}

interface ReactionOnIssueCall {
  installationId: string;
  organizationName: string;
  repositoryName: string;
  issueNumber: number;
  reaction: GitHubReaction;
}

interface PullRequestFindByCall {
  query: { aiRunId?: ObjectID };
  select: { pullRequestUrl?: boolean; pullRequestNumber?: boolean };
  limit: number;
  skip: number;
  props: { isRoot?: boolean };
}

interface UpdateOneByIdCall {
  id: ObjectID;
  data: { taskContext?: { github?: GitHubTaskContext } };
  props: { isRoot?: boolean };
}

const CODE_REPOSITORY_ID: string = "6650f0b1a1b2c3d4e5f60718";
const ACKNOWLEDGEMENT_COMMENT_ID: number = 555;
const TRIGGER_COMMENT_ID: number = 991;
const ISSUE_NUMBER: number = 42;
const PULL_REQUEST_NUMBER: number = 7;

describe("GitHubRunReply", () => {
  let projectId: ObjectID;
  let aiRunId: ObjectID;

  let createIssueCommentSpy: jest.SpyInstance;
  let updateIssueCommentSpy: jest.SpyInstance;
  let addReactionToCommentSpy: jest.SpyInstance;
  let addReactionToIssueSpy: jest.SpyInstance;
  let updateOneByIdSpy: jest.SpyInstance;
  let findPullRequestsSpy: jest.SpyInstance;
  let loggerErrorSpy: jest.SpyInstance;
  let loggerWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    projectId = ObjectID.generate();
    aiRunId = ObjectID.generate();

    createIssueCommentSpy = jest
      .spyOn(GitHubConversation, "createIssueComment")
      .mockResolvedValue(issueComment(ACKNOWLEDGEMENT_COMMENT_ID));

    updateIssueCommentSpy = jest
      .spyOn(GitHubConversation, "updateIssueComment")
      .mockResolvedValue(issueComment(ACKNOWLEDGEMENT_COMMENT_ID));

    /*
     * The real reaction helpers swallow their own failures and answer false —
     * they never reject. Mocking them the same way is what lets the "a failed
     * reaction changes nothing" tests below be honest rather than circular.
     */
    addReactionToCommentSpy = jest
      .spyOn(GitHubConversation, "addReactionToComment")
      .mockResolvedValue(true);

    addReactionToIssueSpy = jest
      .spyOn(GitHubConversation, "addReactionToIssue")
      .mockResolvedValue(true);

    // updateOneById answers with the number of rows it touched.
    updateOneByIdSpy = jest
      .spyOn(AIRunService, "updateOneById")
      .mockResolvedValue(1);

    findPullRequestsSpy = jest
      .spyOn(AIAgentTaskPullRequestService, "findBy")
      .mockResolvedValue([]);

    loggerErrorSpy = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {
        // Swallowed: the failure paths are asserted through the spy itself.
      });

    loggerWarnSpy = jest.spyOn(logger, "warn").mockImplementation((): void => {
      // Swallowed.
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ---------------------------------------------------------------- builders

  function issueComment(commentId: number): GitHubIssueComment {
    return {
      commentId: commentId,
      htmlUrl: `https://github.com/acme/checkout/issues/${ISSUE_NUMBER}#issuecomment-${commentId}`,
      body: "",
      authorLogin: "oneuptime[bot]",
      isBot: true,
      createdAt: "2026-09-10T09:00:00.000Z",
    };
  }

  // A run started from an ISSUE — the "@mention implement this" recipe.
  function issueContext(
    overrides: Partial<GitHubTaskContext> = {},
  ): GitHubTaskContext {
    return {
      codeRepositoryId: CODE_REPOSITORY_ID,
      installationId: "12345678",
      organizationName: "acme",
      repositoryName: "checkout",
      commandType: GitHubCommandType.Implement,
      instruction: "implement this",
      issueNumber: ISSUE_NUMBER,
      triggerCommentId: TRIGGER_COMMENT_ID,
      ...overrides,
    };
  }

  // A run started from a PULL REQUEST — the review / revise recipes.
  function pullRequestContext(
    overrides: Partial<GitHubTaskContext> = {},
  ): GitHubTaskContext {
    return {
      codeRepositoryId: CODE_REPOSITORY_ID,
      installationId: "12345678",
      organizationName: "acme",
      repositoryName: "checkout",
      commandType: GitHubCommandType.Revise,
      instruction: "revise this — the retry loop should back off exponentially",
      pullRequestNumber: PULL_REQUEST_NUMBER,
      pullRequestHeadRefName: "oneuptime-ai/retry-backoff",
      triggerCommentId: TRIGGER_COMMENT_ID,
      ...overrides,
    };
  }

  function aiRun(data: {
    status: AIRunStatus;
    errorMessage?: string;
    github?: GitHubTaskContext;
  }): AIRun {
    const run: AIRun = new AIRun();

    run.id = aiRunId;
    run.projectId = projectId;
    run.status = data.status;

    if (data.errorMessage !== undefined) {
      run.errorMessage = data.errorMessage;
    }

    if (data.github) {
      run.taskContext = { github: data.github } as CodeFixTaskContext;
    }

    return run;
  }

  function pullRequestRow(data: {
    pullRequestNumber?: number;
    url?: string;
  }): AIAgentTaskPullRequest {
    const row: AIAgentTaskPullRequest = new AIAgentTaskPullRequest();

    if (data.pullRequestNumber !== undefined) {
      row.pullRequestNumber = data.pullRequestNumber;
    }

    if (data.url !== undefined) {
      row.pullRequestUrl = URL.fromString(data.url);
    }

    return row;
  }

  // ----------------------------------------------------------- call readers

  function nthCallArgument(spy: jest.SpyInstance, callNumber: number): unknown {
    const call: Array<unknown> | undefined = spy.mock.calls[callNumber - 1] as
      | Array<unknown>
      | undefined;

    if (!call || call[0] === undefined) {
      throw new Error(`The spy was not called ${callNumber} time(s)`);
    }

    return call[0];
  }

  function createdComment(callNumber: number = 1): CreateCommentCall {
    return nthCallArgument(
      createIssueCommentSpy,
      callNumber,
    ) as CreateCommentCall;
  }

  function updatedComment(callNumber: number = 1): UpdateCommentCall {
    return nthCallArgument(
      updateIssueCommentSpy,
      callNumber,
    ) as UpdateCommentCall;
  }

  function reactionOnComment(callNumber: number = 1): ReactionOnCommentCall {
    return nthCallArgument(
      addReactionToCommentSpy,
      callNumber,
    ) as ReactionOnCommentCall;
  }

  function reactionOnIssue(callNumber: number = 1): ReactionOnIssueCall {
    return nthCallArgument(
      addReactionToIssueSpy,
      callNumber,
    ) as ReactionOnIssueCall;
  }

  /*
   * The body that actually reached GitHub, whichever write carried it. The
   * caller should not have to know whether this run had an acknowledgement to
   * edit — that is exactly what the tests around it are for.
   */
  async function postedOutcomeBody(data: {
    status: AIRunStatus;
    errorMessage?: string;
    github: GitHubTaskContext;
  }): Promise<string> {
    const run: AIRun =
      data.errorMessage === undefined
        ? aiRun({ status: data.status })
        : aiRun({ status: data.status, errorMessage: data.errorMessage });

    const posted: boolean = await GitHubRunReply.reportOutcome({
      run: run,
      github: data.github,
    });

    expect(posted).toBe(true);

    return data.github.acknowledgementCommentId
      ? updatedComment().body
      : createdComment().body;
  }

  /*
   * One tick of ReportGitHubRunOutcomes, copied deliberately: report, and mark
   * the run reported ONLY if GitHub accepted the write. Several tests below
   * assert against this rather than against reportOutcome alone, because the
   * bug worth catching lives in the pairing, not in either half.
   */
  async function sweepOnce(data: {
    run: AIRun;
    github: GitHubTaskContext;
  }): Promise<boolean> {
    const posted: boolean = await GitHubRunReply.reportOutcome({
      run: data.run,
      github: data.github,
    });

    if (posted) {
      await GitHubRunReply.markReported({
        aiRunId: data.run.id!,
        taskContext: data.run.taskContext,
        github: data.github,
      });
    }

    return posted;
  }

  // =========================================================================

  describe("buildRunUrl / buildProjectRunsUrl", () => {
    test("a run's page lives underneath its project's runs page", () => {
      const runsUrl: string = GitHubRunReply.buildProjectRunsUrl(projectId);
      const runUrl: string = GitHubRunReply.buildRunUrl({
        projectId: projectId,
        aiRunId: aiRunId,
      });

      expect(runUrl).toBe(`${runsUrl}/${aiRunId.toString()}`);
    });

    test("both URLs are rooted at the dashboard and scoped to the project", () => {
      const dashboard: string = DashboardClientUrl.toString();

      expect(
        GitHubRunReply.buildProjectRunsUrl(projectId).startsWith(
          `${dashboard}/${projectId.toString()}/`,
        ),
      ).toBe(true);

      expect(
        GitHubRunReply.buildRunUrl({
          projectId: projectId,
          aiRunId: aiRunId,
        }).startsWith(`${dashboard}/${projectId.toString()}/`),
      ).toBe(true);
    });

    /*
     * A template that lost an interpolation still returns a plausible-looking
     * string — and a comment linking ".../undefined/ai/agents" is a dead link
     * posted into someone else's repository. Asserted on the path only, so
     * this does not depend on how the host is configured.
     */
    test("neither URL can contain a lost interpolation", () => {
      const dashboard: string = DashboardClientUrl.toString();

      const runPath: string = GitHubRunReply.buildRunUrl({
        projectId: projectId,
        aiRunId: aiRunId,
      }).substring(dashboard.length);

      const runsPath: string = GitHubRunReply.buildProjectRunsUrl(
        projectId,
      ).substring(dashboard.length);

      expect(runPath).toBe(
        `/${projectId.toString()}/ai/agents/${aiRunId.toString()}`,
      );
      expect(runsPath).toBe(`/${projectId.toString()}/ai/agents`);
      expect(runPath).not.toContain("undefined");
      expect(runPath).not.toContain("[object Object]");
    });

    test("two projects never resolve to the same run link", () => {
      const otherProjectId: ObjectID = ObjectID.generate();

      expect(
        GitHubRunReply.buildRunUrl({
          projectId: projectId,
          aiRunId: aiRunId,
        }),
      ).not.toBe(
        GitHubRunReply.buildRunUrl({
          projectId: otherProjectId,
          aiRunId: aiRunId,
        }),
      );
    });
  });

  // =========================================================================

  describe("acknowledge", () => {
    describe("the 👀 reaction", () => {
      test("lands on the comment that asked, when a comment asked", async () => {
        await GitHubRunReply.acknowledge({
          aiRunId: aiRunId,
          projectId: projectId,
          projectName: "Acme",
          github: issueContext(),
        });

        expect(addReactionToCommentSpy).toHaveBeenCalledTimes(1);
        expect(addReactionToIssueSpy).not.toHaveBeenCalled();
        expect(reactionOnComment().commentId).toBe(TRIGGER_COMMENT_ID);
        expect(reactionOnComment().reaction).toBe(GitHubReaction.Eyes);
      });

      /*
       * A trigger LABEL and an assignment carry no comment at all. Reacting to
       * "the comment" there would either throw or, worse, react on comment id
       * undefined — so the issue itself is the only thing left to mark, and
       * without it those two triggers look completely ignored until the run
       * finishes minutes later.
       */
      test("lands on the issue itself when a label or an assignment triggered the run", async () => {
        await GitHubRunReply.acknowledge({
          aiRunId: aiRunId,
          projectId: projectId,
          projectName: "Acme",
          github: issueContext({ triggerCommentId: undefined }),
        });

        expect(addReactionToIssueSpy).toHaveBeenCalledTimes(1);
        expect(addReactionToCommentSpy).not.toHaveBeenCalled();
        expect(reactionOnIssue().issueNumber).toBe(ISSUE_NUMBER);
        expect(reactionOnIssue().reaction).toBe(GitHubReaction.Eyes);
      });

      // 0 is a real GitHub id in nobody's world, but it is falsy in everyone's.
      test("treats a zero trigger comment id as no comment rather than reacting on id 0", async () => {
        await GitHubRunReply.acknowledge({
          aiRunId: aiRunId,
          projectId: projectId,
          projectName: "Acme",
          github: issueContext({ triggerCommentId: 0 }),
        });

        expect(addReactionToCommentSpy).not.toHaveBeenCalled();
        expect(addReactionToIssueSpy).toHaveBeenCalledTimes(1);
      });

      test("reacts in the repository the context names, as its installation", async () => {
        await GitHubRunReply.acknowledge({
          aiRunId: aiRunId,
          projectId: projectId,
          projectName: "Acme",
          github: issueContext(),
        });

        expect(reactionOnComment().organizationName).toBe("acme");
        expect(reactionOnComment().repositoryName).toBe("checkout");
        expect(reactionOnComment().installationId).toBe("12345678");
      });
    });

    describe("the acknowledgement comment", () => {
      test("posts exactly one comment and returns its id for the outcome to edit", async () => {
        const commentId: number | null = await GitHubRunReply.acknowledge({
          aiRunId: aiRunId,
          projectId: projectId,
          projectName: "Acme",
          github: issueContext(),
        });

        expect(createIssueCommentSpy).toHaveBeenCalledTimes(1);
        expect(commentId).toBe(ACKNOWLEDGEMENT_COMMENT_ID);
      });

      test("posts into the issue the command came from", async () => {
        await GitHubRunReply.acknowledge({
          aiRunId: aiRunId,
          projectId: projectId,
          projectName: "Acme",
          github: issueContext(),
        });

        expect(createdComment().issueNumber).toBe(ISSUE_NUMBER);
      });

      /*
       * GitHub numbers issues and pull requests in one sequence and answers for
       * both at /issues/{n}, so a pull request command must address the PULL
       * REQUEST number. Falling back to the unset issueNumber would post to
       * `/issues/undefined` — or, on a repository that happens to have an issue
       * with that number, into a stranger's thread.
       */
      test("posts into the pull request's own thread, not a same-numbered issue", async () => {
        await GitHubRunReply.acknowledge({
          aiRunId: aiRunId,
          projectId: projectId,
          projectName: "Acme",
          github: pullRequestContext(),
        });

        expect(createdComment().issueNumber).toBe(PULL_REQUEST_NUMBER);
      });

      test("links the run and names the project the run is billed to", async () => {
        await GitHubRunReply.acknowledge({
          aiRunId: aiRunId,
          projectId: projectId,
          projectName: "Acme Platform",
          github: issueContext(),
        });

        expect(createdComment().body).toContain(
          GitHubRunReply.buildRunUrl({
            projectId: projectId,
            aiRunId: aiRunId,
          }),
        );
        expect(createdComment().body).toContain("Acme Platform");
      });

      test("still posts a usable acknowledgement when the project has no name", async () => {
        await GitHubRunReply.acknowledge({
          aiRunId: aiRunId,
          projectId: projectId,
          projectName: undefined,
          github: issueContext(),
        });

        expect(createdComment().body).toContain("On it");
        expect(createdComment().body).not.toContain("undefined");
      });

      test("describes the command it is about to run", async () => {
        await GitHubRunReply.acknowledge({
          aiRunId: aiRunId,
          projectId: projectId,
          projectName: "Acme",
          github: pullRequestContext({
            commandType: GitHubCommandType.Review,
          }),
        });

        expect(createdComment().body).toContain("reviewing this pull request");
      });

      /*
       * The user's own words are echoed back so they can see what was heard.
       * They are also arbitrary text from a stranger's comment, and a verbatim
       * echo of "@oneuptime implement this" is a webhook this app sends to
       * itself — a comment loop that bills the project until someone notices.
       * Blockquoting is what stops it, so every line has to carry the marker.
       */
      test("quotes an instruction that mentions the app so the echo cannot re-trigger it", async () => {
        await GitHubRunReply.acknowledge({
          aiRunId: aiRunId,
          projectId: projectId,
          projectName: "Acme",
          github: issueContext({
            instruction: "@oneuptime implement this\n@oneuptime and hurry",
          }),
        });

        const body: string = createdComment().body;

        expect(body).toContain("> @oneuptime implement this");
        expect(body).toContain("> @oneuptime and hurry");

        for (const line of body.split("\n")) {
          if (line.includes("@oneuptime")) {
            expect(line.startsWith(">")).toBe(true);
          }
        }
      });

      test("quotes a unicode instruction line by line without dropping it", async () => {
        await GitHubRunReply.acknowledge({
          aiRunId: aiRunId,
          projectId: projectId,
          projectName: "Acme",
          github: issueContext({
            instruction: "修复这个 bug\n🙏 пожалуйста",
          }),
        });

        expect(createdComment().body).toContain("> 修复这个 bug");
        expect(createdComment().body).toContain("> 🙏 пожалуйста");
      });

      test("posts a bare acknowledgement for an empty instruction rather than an empty quote", async () => {
        await GitHubRunReply.acknowledge({
          aiRunId: aiRunId,
          projectId: projectId,
          projectName: "Acme",
          github: issueContext({ instruction: "   \n  " }),
        });

        expect(createdComment().body).toContain("On it");
        expect(createdComment().body).not.toContain("You asked:");
      });
    });

    /*
     * The run is ALREADY QUEUED by the time this is called. Failing the command
     * because a comment did not post would take a working fix away from the
     * user to punish GitHub for a 502.
     */
    describe("when GitHub refuses the acknowledgement", () => {
      beforeEach(() => {
        createIssueCommentSpy.mockRejectedValue(
          new Error("503 Service Unavailable"),
        );
      });

      test("returns null instead of throwing, so the queued run still runs", async () => {
        await expect(
          GitHubRunReply.acknowledge({
            aiRunId: aiRunId,
            projectId: projectId,
            projectName: "Acme",
            github: issueContext(),
          }),
        ).resolves.toBeNull();
      });

      test("logs the run it could not acknowledge so an operator can find it", async () => {
        await GitHubRunReply.acknowledge({
          aiRunId: aiRunId,
          projectId: projectId,
          projectName: "Acme",
          github: issueContext(),
        });

        expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
        expect(String(loggerErrorSpy.mock.calls[0]![0])).toContain(
          aiRunId.toString(),
        );
      });

      // Nothing about a failed comment says the run is not being worked on.
      test("does not undo the reaction it already placed", async () => {
        await GitHubRunReply.acknowledge({
          aiRunId: aiRunId,
          projectId: projectId,
          projectName: "Acme",
          github: issueContext(),
        });

        expect(addReactionToCommentSpy).toHaveBeenCalledTimes(1);
      });
    });
  });

  // =========================================================================

  describe("reportOutcome", () => {
    describe("one command produces one comment", () => {
      test("EDITS the acknowledgement when there is one, and posts nothing new", async () => {
        await GitHubRunReply.reportOutcome({
          run: aiRun({ status: AIRunStatus.Completed }),
          github: issueContext({
            acknowledgementCommentId: ACKNOWLEDGEMENT_COMMENT_ID,
          }),
        });

        expect(updateIssueCommentSpy).toHaveBeenCalledTimes(1);
        expect(createIssueCommentSpy).not.toHaveBeenCalled();
        expect(updatedComment().commentId).toBe(ACKNOWLEDGEMENT_COMMENT_ID);
      });

      /*
       * The acknowledgement is best effort, so there may be nothing to edit.
       * A run that then says nothing at all is the worst outcome available:
       * the user sees no reply and no reaction and concludes nothing happened.
       */
      test("posts a NEW comment when the acknowledgement never got posted", async () => {
        await GitHubRunReply.reportOutcome({
          run: aiRun({ status: AIRunStatus.Completed }),
          github: issueContext({ acknowledgementCommentId: undefined }),
        });

        expect(createIssueCommentSpy).toHaveBeenCalledTimes(1);
        expect(updateIssueCommentSpy).not.toHaveBeenCalled();
        expect(createdComment().issueNumber).toBe(ISSUE_NUMBER);
      });

      test("the new comment goes to the pull request's own thread", async () => {
        await GitHubRunReply.reportOutcome({
          run: aiRun({ status: AIRunStatus.Completed }),
          github: pullRequestContext({ acknowledgementCommentId: undefined }),
        });

        expect(createdComment().issueNumber).toBe(PULL_REQUEST_NUMBER);
      });

      // The whole acknowledge-then-report round trip, counted end to end.
      test("acknowledging and then reporting leaves exactly one comment in the thread", async () => {
        const github: GitHubTaskContext = issueContext();

        const commentId: number | null = await GitHubRunReply.acknowledge({
          aiRunId: aiRunId,
          projectId: projectId,
          projectName: "Acme",
          github: github,
        });

        expect(commentId).not.toBeNull();

        await GitHubRunReply.reportOutcome({
          run: aiRun({ status: AIRunStatus.Completed }),
          github: issueContext({ acknowledgementCommentId: commentId! }),
        });

        expect(createIssueCommentSpy).toHaveBeenCalledTimes(1);
        expect(updateIssueCommentSpy).toHaveBeenCalledTimes(1);
      });
    });

    describe("the return value is what makes the sweep retryable", () => {
      test("returns true when GitHub accepts the edit", async () => {
        await expect(
          GitHubRunReply.reportOutcome({
            run: aiRun({ status: AIRunStatus.Completed }),
            github: issueContext({
              acknowledgementCommentId: ACKNOWLEDGEMENT_COMMENT_ID,
            }),
          }),
        ).resolves.toBe(true);
      });

      /*
       * A rejected EDIT is not a lost reply. The commonest cause is that
       * somebody deleted the app's acknowledgement — an ordinary thing to do
       * to a bot comment — and without the fallback the edit 404s forever:
       * the outcome is never delivered and the sweep retries the same doomed
       * write every minute until it ages out. A second comment beats silence.
       */
      test("falls back to a NEW comment when the edit is rejected, and still succeeds", async () => {
        updateIssueCommentSpy.mockRejectedValue(new Error("404 Not Found"));

        await expect(
          GitHubRunReply.reportOutcome({
            run: aiRun({ status: AIRunStatus.Completed }),
            github: issueContext({
              acknowledgementCommentId: ACKNOWLEDGEMENT_COMMENT_ID,
            }),
          }),
        ).resolves.toBe(true);

        expect(updateIssueCommentSpy).toHaveBeenCalledTimes(1);
        expect(createIssueCommentSpy).toHaveBeenCalledTimes(1);
      });

      // Only when BOTH writes fail has the reply genuinely been lost.
      test("returns false when the edit AND the fallback comment both fail", async () => {
        updateIssueCommentSpy.mockRejectedValue(new Error("502 Bad Gateway"));
        createIssueCommentSpy.mockRejectedValue(new Error("502 Bad Gateway"));

        await expect(
          GitHubRunReply.reportOutcome({
            run: aiRun({ status: AIRunStatus.Completed }),
            github: issueContext({
              acknowledgementCommentId: ACKNOWLEDGEMENT_COMMENT_ID,
            }),
          }),
        ).resolves.toBe(false);
      });

      test("returns false when GitHub rejects the new comment", async () => {
        createIssueCommentSpy.mockRejectedValue(new Error("502 Bad Gateway"));

        await expect(
          GitHubRunReply.reportOutcome({
            run: aiRun({ status: AIRunStatus.Completed }),
            github: issueContext({ acknowledgementCommentId: undefined }),
          }),
        ).resolves.toBe(false);
      });

      test("names the run in the warning, so a lost reply is findable in the logs", async () => {
        updateIssueCommentSpy.mockRejectedValue(new Error("502 Bad Gateway"));
        createIssueCommentSpy.mockRejectedValue(new Error("502 Bad Gateway"));

        await GitHubRunReply.reportOutcome({
          run: aiRun({ status: AIRunStatus.Completed }),
          github: issueContext({
            acknowledgementCommentId: ACKNOWLEDGEMENT_COMMENT_ID,
          }),
        });

        expect(loggerWarnSpy).toHaveBeenCalledTimes(1);
        expect(String(loggerWarnSpy.mock.calls[0]![0])).toContain(
          aiRunId.toString(),
        );
      });

      /*
       * The pairing, driven exactly as the sweeper drives it: a rejected write
       * must leave the run UNMARKED. Marking it anyway would burn the user's
       * only answer on a transient 502.
       */
      test("a rejected write leaves the run unmarked, and the next sweep still edits the SAME comment", async () => {
        const run: AIRun = aiRun({ status: AIRunStatus.Completed });
        const github: GitHubTaskContext = issueContext({
          acknowledgementCommentId: ACKNOWLEDGEMENT_COMMENT_ID,
        });

        /*
         * Both writes fail on the first sweep — an outage, not a deleted
         * comment — so there is genuinely nothing posted to mark.
         */
        updateIssueCommentSpy.mockRejectedValueOnce(new Error("502"));
        createIssueCommentSpy.mockRejectedValueOnce(new Error("502"));

        await expect(sweepOnce({ run: run, github: github })).resolves.toBe(
          false,
        );
        expect(updateOneByIdSpy).not.toHaveBeenCalled();

        await expect(sweepOnce({ run: run, github: github })).resolves.toBe(
          true,
        );
        expect(updateOneByIdSpy).toHaveBeenCalledTimes(1);

        // Two attempts, one comment: the retry edited, it did not duplicate.
        expect(updateIssueCommentSpy).toHaveBeenCalledTimes(2);
        expect(createIssueCommentSpy).toHaveBeenCalledTimes(1);
      });

      test("a successful write is marked reported exactly once", async () => {
        await sweepOnce({
          run: aiRun({ status: AIRunStatus.Completed }),
          github: issueContext({
            acknowledgementCommentId: ACKNOWLEDGEMENT_COMMENT_ID,
          }),
        });

        expect(updateOneByIdSpy).toHaveBeenCalledTimes(1);
      });

      /*
       * A run without an id or a project cannot even build its own link. There
       * is nothing useful to say, and saying it anyway would post a comment
       * pointing at ".../undefined".
       */
      /*
       * Built WITHOUT an id rather than by clearing one: DatabaseBaseModel's
       * `id` setter ignores a falsy value, so `run.id = null` leaves the id in
       * place and the test would silently exercise the happy path instead.
       */
      test("returns false and writes nothing for a run with no id", async () => {
        const run: AIRun = new AIRun();
        run.projectId = projectId;
        run.status = AIRunStatus.Completed;

        await expect(
          GitHubRunReply.reportOutcome({
            run: run,
            github: issueContext({
              acknowledgementCommentId: ACKNOWLEDGEMENT_COMMENT_ID,
            }),
          }),
        ).resolves.toBe(false);

        expect(updateIssueCommentSpy).not.toHaveBeenCalled();
        expect(createIssueCommentSpy).not.toHaveBeenCalled();
      });

      test("returns false and writes nothing for a run with no project", async () => {
        const run: AIRun = new AIRun();
        run.id = aiRunId;
        run.status = AIRunStatus.Completed;

        await expect(
          GitHubRunReply.reportOutcome({
            run: run,
            github: issueContext({
              acknowledgementCommentId: ACKNOWLEDGEMENT_COMMENT_ID,
            }),
          }),
        ).resolves.toBe(false);

        expect(updateIssueCommentSpy).not.toHaveBeenCalled();
        expect(createIssueCommentSpy).not.toHaveBeenCalled();
      });
    });

    describe("what the comment says, per terminal status", () => {
      test("Completed reads as done", async () => {
        const body: string = await postedOutcomeBody({
          status: AIRunStatus.Completed,
          github: issueContext(),
        });

        expect(body).toContain("**Done**");
        expect(body).toContain("working on this issue");
      });

      /*
       * The distinction that matters most in this file. NoFixFound is a
       * negative RESULT, not a failure: the agent read the code and had
       * nothing worth proposing. A user who reads "I could not finish"
       * retries the identical command; a user who reads "I looked and found
       * nothing" writes a better instruction instead.
       */
      test("NoFixFound reads as a finding and never as a failure", async () => {
        const body: string = await postedOutcomeBody({
          status: AIRunStatus.NoFixFound,
          errorMessage: "The retry loop already backs off; nothing to change.",
          github: issueContext(),
        });

        expect(body).toContain("I looked");
        expect(body).toContain("do not have a change worth proposing");
        expect(body).not.toContain("could not finish");
        expect(body).not.toContain("❌");
      });

      test("NoFixFound uses errorMessage as the REASON it found nothing", async () => {
        const body: string = await postedOutcomeBody({
          status: AIRunStatus.NoFixFound,
          errorMessage: "The retry loop already backs off; nothing to change.",
          github: issueContext(),
        });

        expect(body).toContain(
          "The retry loop already backs off; nothing to change.",
        );
      });

      test("NoFixFound with no reason still says something true rather than blank", async () => {
        const body: string = await postedOutcomeBody({
          status: AIRunStatus.NoFixFound,
          github: issueContext(),
        });

        expect(body).toContain("The agent finished without editing a file.");
        expect(body).not.toContain("undefined");
      });

      test("NoFixFound invites a better instruction instead of a blind retry", async () => {
        const body: string = await postedOutcomeBody({
          status: AIRunStatus.NoFixFound,
          github: issueContext(),
        });

        expect(body).toContain("Tell me more about what you want");
      });

      test("Error reads as a failure and carries the error message", async () => {
        const body: string = await postedOutcomeBody({
          status: AIRunStatus.Error,
          errorMessage: "Could not clone acme/checkout: 403",
          github: issueContext(),
        });

        expect(body).toContain("I could not finish this one.");
        expect(body).toContain("Could not clone acme/checkout: 403");
      });

      test("Error with no message still points at the run log", async () => {
        const body: string = await postedOutcomeBody({
          status: AIRunStatus.Error,
          github: issueContext(),
        });

        expect(body).toContain("I could not finish this one.");
        expect(body).toContain("for the full log");
        expect(body).not.toContain("undefined");
      });

      test("Cancelled says so, and says that pushed work stays pushed", async () => {
        const body: string = await postedOutcomeBody({
          status: AIRunStatus.Cancelled,
          github: issueContext(),
        });

        expect(body).toContain("**Cancelled**");
        expect(body).toContain("Anything already pushed stays pushed");
      });

      /*
       * This comment closes out ONE run's own acknowledgement, so it must not
       * quote a thread-wide count: "@mention cancel" stopping three runs would
       * otherwise produce three comments each announcing "1 run on this
       * thread". The thread-wide count belongs to the reply that answers the
       * cancel command itself, which is a different composer method.
       */
      test("Cancelled describes only itself, never a count of runs on the thread", async () => {
        const body: string = await postedOutcomeBody({
          status: AIRunStatus.Cancelled,
          github: issueContext(),
        });

        expect(body).not.toContain("run on this thread");
        expect(body).not.toContain("runs on this thread");
      });

      // ...and it links back, which is the one outcome a reader most wants.
      test("Cancelled links back to the run so the reader can see how far it got", async () => {
        const body: string = await postedOutcomeBody({
          status: AIRunStatus.Cancelled,
          github: issueContext(),
        });

        expect(body).toContain(
          GitHubRunReply.buildRunUrl({
            projectId: projectId,
            aiRunId: aiRunId,
          }),
        );
      });

      /*
       * A Stale run is one the heartbeat sweeper gave up on. From the reader's
       * side that is indistinguishable from any other failure, and it is
       * reported with the same words on purpose — what must NOT happen is a
       * stale run being reported as Done, or as having found nothing.
       */
      test("Stale reads as a failure, not as a completion and not as a finding", async () => {
        const body: string = await postedOutcomeBody({
          status: AIRunStatus.Stale,
          errorMessage: "The agent stopped sending heartbeats.",
          github: issueContext(),
        });

        expect(body).toContain("I could not finish this one.");
        expect(body).toContain("The agent stopped sending heartbeats.");
        expect(body).not.toContain("**Done**");
        expect(body).not.toContain("I looked");
      });

      test("Completed, NoFixFound, Error and Cancelled are four distinguishable replies", async () => {
        const bodies: Array<string> = [];

        for (const status of [
          AIRunStatus.Completed,
          AIRunStatus.NoFixFound,
          AIRunStatus.Error,
          AIRunStatus.Cancelled,
        ]) {
          createIssueCommentSpy.mockClear();
          bodies.push(
            await postedOutcomeBody({
              status: status,
              errorMessage: "the same words for every status",
              github: issueContext(),
            }),
          );
        }

        expect(new Set<string>(bodies).size).toBe(4);
      });

      test("every reply is signed, so a reader always knows what wrote it", async () => {
        const body: string = await postedOutcomeBody({
          status: AIRunStatus.Completed,
          github: issueContext(),
        });

        expect(body).toContain("Posted by OneUptime");
      });

      test("every reply links back to the run it is reporting", async () => {
        const body: string = await postedOutcomeBody({
          status: AIRunStatus.Error,
          github: issueContext(),
        });

        expect(body).toContain(
          GitHubRunReply.buildRunUrl({
            projectId: projectId,
            aiRunId: aiRunId,
          }),
        );
      });
    });

    describe("what the comment says the run produced", () => {
      /*
       * The revision pushed to the branch of the pull request this comment is
       * ON. Linking the reader to the page they are already reading is noise,
       * and a link to a DIFFERENT pull request would be a lie — a revision
       * opens nothing.
       */
      test("a Revise run says it pushed to this pull request's branch", async () => {
        const body: string = await postedOutcomeBody({
          status: AIRunStatus.Completed,
          github: pullRequestContext({
            commandType: GitHubCommandType.Revise,
          }),
        });

        expect(body).toContain("I pushed my changes to this pull request");
        expect(body).toContain("re-review the new commits");
      });

      test("a Revise run lists NO pull request link and never asks the database for one", async () => {
        const body: string = await postedOutcomeBody({
          status: AIRunStatus.Completed,
          github: pullRequestContext({
            commandType: GitHubCommandType.Revise,
          }),
        });

        expect(body).not.toContain("Opened");
        expect(body).not.toContain("github.com");
        expect(findPullRequestsSpy).not.toHaveBeenCalled();
      });

      test("a Review run says the review is posted, and links nothing either", async () => {
        const body: string = await postedOutcomeBody({
          status: AIRunStatus.Completed,
          github: pullRequestContext({
            commandType: GitHubCommandType.Review,
          }),
        });

        expect(body).toContain("My review is posted on this pull request.");
        expect(body).not.toContain("Opened");
        expect(findPullRequestsSpy).not.toHaveBeenCalled();
      });

      test("an Implement run lists every recorded pull request by number and URL", async () => {
        findPullRequestsSpy.mockResolvedValue([
          pullRequestRow({
            pullRequestNumber: 12,
            url: "https://github.com/acme/checkout/pull/12",
          }),
          pullRequestRow({
            pullRequestNumber: 13,
            url: "https://github.com/acme/checkout/pull/13",
          }),
        ]);

        const body: string = await postedOutcomeBody({
          status: AIRunStatus.Completed,
          github: issueContext(),
        });

        expect(body).toContain("Opened #12");
        expect(body).toContain("https://github.com/acme/checkout/pull/12");
        expect(body).toContain("Opened #13");
        expect(body).toContain("https://github.com/acme/checkout/pull/13");
      });

      /*
       * "Done" with no artefact is not an answer — the user goes looking for a
       * pull request that does not exist and concludes the integration lies.
       * Saying so plainly is the only honest option left.
       */
      test("an Implement run with NO recorded pull request says so instead of claiming one", async () => {
        findPullRequestsSpy.mockResolvedValue([]);

        const body: string = await postedOutcomeBody({
          status: AIRunStatus.Completed,
          github: issueContext(),
        });

        expect(body).toContain(
          "The run finished, but it did not record a pull request.",
        );
        expect(body).not.toContain("Opened #");
      });

      test("a recorded pull request with no number is still announced", async () => {
        findPullRequestsSpy.mockResolvedValue([
          pullRequestRow({ url: "https://github.com/acme/checkout/pull/14" }),
        ]);

        const body: string = await postedOutcomeBody({
          status: AIRunStatus.Completed,
          github: issueContext(),
        });

        expect(body).toContain(
          "Opened a pull request — https://github.com/acme/checkout/pull/14",
        );
      });

      test("a recorded pull request with no URL prints an empty link, never the word undefined", async () => {
        findPullRequestsSpy.mockResolvedValue([
          pullRequestRow({ pullRequestNumber: 15 }),
        ]);

        const body: string = await postedOutcomeBody({
          status: AIRunStatus.Completed,
          github: issueContext(),
        });

        expect(body).toContain("Opened #15");
        expect(body).not.toContain("undefined");
      });

      test("the pull request lookup is scoped to this run and reads as root", async () => {
        findPullRequestsSpy.mockResolvedValue([]);

        await postedOutcomeBody({
          status: AIRunStatus.Completed,
          github: issueContext(),
        });

        const call: PullRequestFindByCall = nthCallArgument(
          findPullRequestsSpy,
          1,
        ) as PullRequestFindByCall;

        expect(call.query.aiRunId?.toString()).toBe(aiRunId.toString());
        expect(call.props.isRoot).toBe(true);
        expect(call.limit).toBe(LIMIT_MAX);
        expect(call.skip).toBe(0);
      });

      // A failure has no artefacts to list; querying for them is dead weight.
      test("a failed Implement run never queries for pull requests", async () => {
        await postedOutcomeBody({
          status: AIRunStatus.Error,
          errorMessage: "boom",
          github: issueContext(),
        });

        expect(findPullRequestsSpy).not.toHaveBeenCalled();
      });
    });

    describe("the closing reaction", () => {
      test("🚀 on the trigger comment when the run completed", async () => {
        await GitHubRunReply.reportOutcome({
          run: aiRun({ status: AIRunStatus.Completed }),
          github: issueContext({
            acknowledgementCommentId: ACKNOWLEDGEMENT_COMMENT_ID,
          }),
        });

        expect(reactionOnComment().reaction).toBe(GitHubReaction.Rocket);
        expect(reactionOnComment().commentId).toBe(TRIGGER_COMMENT_ID);
      });

      test("😕 on the trigger comment for every non-completed status", async () => {
        for (const status of [
          AIRunStatus.NoFixFound,
          AIRunStatus.Error,
          AIRunStatus.Cancelled,
          AIRunStatus.Stale,
        ]) {
          addReactionToCommentSpy.mockClear();

          await GitHubRunReply.reportOutcome({
            run: aiRun({ status: status }),
            github: issueContext({
              acknowledgementCommentId: ACKNOWLEDGEMENT_COMMENT_ID,
            }),
          });

          expect(reactionOnComment().reaction).toBe(GitHubReaction.Confused);
        }
      });

      test("no reaction at all when a label or an assignment triggered the run", async () => {
        await GitHubRunReply.reportOutcome({
          run: aiRun({ status: AIRunStatus.Completed }),
          github: issueContext({
            triggerCommentId: undefined,
            acknowledgementCommentId: ACKNOWLEDGEMENT_COMMENT_ID,
          }),
        });

        expect(addReactionToCommentSpy).not.toHaveBeenCalled();
        expect(addReactionToIssueSpy).not.toHaveBeenCalled();
      });

      /*
       * The reaction is decoration; the comment is the answer. If a refused
       * reaction could drag the return value to false, the sweeper would post
       * the whole outcome again on the next tick — every minute, for a day.
       */
      test("a refused reaction still reports true, so the reply is not posted twice", async () => {
        addReactionToCommentSpy.mockResolvedValue(false);

        await expect(
          GitHubRunReply.reportOutcome({
            run: aiRun({ status: AIRunStatus.Completed }),
            github: issueContext({
              acknowledgementCommentId: ACKNOWLEDGEMENT_COMMENT_ID,
            }),
          }),
        ).resolves.toBe(true);
      });

      test("a refused reaction still lets the sweeper mark the run reported", async () => {
        addReactionToCommentSpy.mockResolvedValue(false);

        await sweepOnce({
          run: aiRun({ status: AIRunStatus.Completed }),
          github: issueContext({
            acknowledgementCommentId: ACKNOWLEDGEMENT_COMMENT_ID,
          }),
        });

        expect(updateOneByIdSpy).toHaveBeenCalledTimes(1);
      });

      // The comment is written first; a reaction is never a precondition for it.
      test("the outcome comment is written before the reaction is attempted", async () => {
        addReactionToCommentSpy.mockResolvedValue(false);

        await GitHubRunReply.reportOutcome({
          run: aiRun({ status: AIRunStatus.Completed }),
          github: issueContext({
            acknowledgementCommentId: ACKNOWLEDGEMENT_COMMENT_ID,
          }),
        });

        expect(updateIssueCommentSpy.mock.invocationCallOrder[0]!).toBeLessThan(
          addReactionToCommentSpy.mock.invocationCallOrder[0]!,
        );
      });
    });
  });

  // =========================================================================

  describe("needsOutcomeReport", () => {
    /*
     * The sweeper does not just need "yes"; it needs the conversation back,
     * because it re-checks the installation binding against the project before
     * it writes anything (GHSA-xx95-gmcf-7q86) and then replies into the thread
     * this names.
     */
    test("returns the conversation for a terminal run that has not reported yet", () => {
      const github: GitHubTaskContext = issueContext();

      const returned: GitHubTaskContext | null =
        GitHubRunReply.needsOutcomeReport(
          aiRun({ status: AIRunStatus.Completed, github: github }),
        );

      expect(returned).not.toBeNull();
      expect(returned!.installationId).toBe("12345678");
      expect(returned!.organizationName).toBe("acme");
      expect(returned!.repositoryName).toBe("checkout");
      expect(returned!.issueNumber).toBe(ISSUE_NUMBER);
      expect(returned!.commandType).toBe(GitHubCommandType.Implement);
    });

    /*
     * Idempotency of the whole sweep, in one line. Without this the reply is
     * re-posted on every tick of a cron that runs every minute.
     */
    test("returns null once the outcome has been reported", () => {
      expect(
        GitHubRunReply.needsOutcomeReport(
          aiRun({
            status: AIRunStatus.Completed,
            github: issueContext({
              reportedToGitHubAt: "2026-09-10T09:00:00.000Z",
            }),
          }),
        ),
      ).toBeNull();
    });

    // Only a real timestamp counts as "already answered".
    test("an empty marker is not a report", () => {
      expect(
        GitHubRunReply.needsOutcomeReport(
          aiRun({
            status: AIRunStatus.Completed,
            github: issueContext({ reportedToGitHubAt: "" }),
          }),
        ),
      ).not.toBeNull();
    });

    test("returns null for a run that did not come from GitHub", () => {
      expect(
        GitHubRunReply.needsOutcomeReport(
          aiRun({ status: AIRunStatus.Completed }),
        ),
      ).toBeNull();
    });

    test("returns null for a run whose taskContext has no github key at all", () => {
      const run: AIRun = aiRun({ status: AIRunStatus.Completed });
      run.taskContext = { traceId: "abc" } as CodeFixTaskContext;

      expect(GitHubRunReply.needsOutcomeReport(run)).toBeNull();
    });

    /*
     * A half-built context cannot name where to reply. Answering anyway means
     * either a crash inside the sweep or a comment posted somewhere nobody
     * asked for one, so the only safe reading of malformed JSON is "no
     * conversation".
     */
    test("returns null for a context missing the repository it belongs to", () => {
      const run: AIRun = aiRun({
        status: AIRunStatus.Completed,
        github: issueContext({ repositoryName: "" }),
      });

      expect(GitHubRunReply.needsOutcomeReport(run)).toBeNull();
    });

    test("returns null for a context missing its installation", () => {
      const run: AIRun = aiRun({
        status: AIRunStatus.Completed,
        github: issueContext({ installationId: "   " }),
      });

      expect(GitHubRunReply.needsOutcomeReport(run)).toBeNull();
    });

    test("returns null for a context that names neither an issue nor a pull request", () => {
      const run: AIRun = aiRun({
        status: AIRunStatus.Completed,
        github: issueContext({
          issueNumber: undefined,
          pullRequestNumber: undefined,
        }),
      });

      expect(GitHubRunReply.needsOutcomeReport(run)).toBeNull();
    });

    // Both set is a bug, not a convenience: the two would disagree about where.
    test("returns null for a context that names BOTH an issue and a pull request", () => {
      const run: AIRun = aiRun({
        status: AIRunStatus.Completed,
        github: issueContext({
          issueNumber: ISSUE_NUMBER,
          pullRequestNumber: PULL_REQUEST_NUMBER,
        }),
      });

      expect(GitHubRunReply.needsOutcomeReport(run)).toBeNull();
    });
  });

  // =========================================================================

  describe("markReported", () => {
    // Every field a context can carry, so "preserves the rest" means something.
    function fullContext(): GitHubTaskContext {
      return {
        codeRepositoryId: CODE_REPOSITORY_ID,
        installationId: "12345678",
        organizationName: "acme",
        repositoryName: "checkout",
        commandType: GitHubCommandType.Revise,
        instruction: "revise this — back off exponentially",
        pullRequestNumber: PULL_REQUEST_NUMBER,
        pullRequestHeadRefName: "oneuptime-ai/retry-backoff",
        isPullRequestFromFork: false,
        triggerCommentId: TRIGGER_COMMENT_ID,
        triggeredByLogin: "octocat",
        acknowledgementCommentId: ACKNOWLEDGEMENT_COMMENT_ID,
        webhookDeliveryId: "1a2b3c4d-0000-0000-0000-000000000000",
      };
    }

    function writtenContext(): GitHubTaskContext {
      const call: UpdateOneByIdCall = nthCallArgument(
        updateOneByIdSpy,
        1,
      ) as UpdateOneByIdCall;

      const github: GitHubTaskContext | undefined =
        call.data.taskContext?.github;

      if (!github) {
        throw new Error("markReported wrote no github context");
      }

      return github;
    }

    test("writes the marker onto the run it was given, as root", async () => {
      await GitHubRunReply.markReported({
        aiRunId: aiRunId,
        taskContext: { github: fullContext() },
        github: fullContext(),
      });

      const call: UpdateOneByIdCall = nthCallArgument(
        updateOneByIdSpy,
        1,
      ) as UpdateOneByIdCall;

      expect(call.id.toString()).toBe(aiRunId.toString());
      expect(call.props.isRoot).toBe(true);
    });

    test("writes an ISO 8601 timestamp that round-trips as a real date", async () => {
      await GitHubRunReply.markReported({
        aiRunId: aiRunId,
        taskContext: { github: fullContext() },
        github: fullContext(),
      });

      const marker: string | undefined = writtenContext().reportedToGitHubAt;

      expect(typeof marker).toBe("string");
      expect(new Date(marker!).toISOString()).toBe(marker);
    });

    /*
     * The marker is written back into the run's own taskContext, so this is a
     * whole-object overwrite of the conversation. Dropping a field here would
     * lose the thread the run belongs to — and the acknowledgement comment id
     * in particular, which is the ONLY thing keeping a re-report from posting
     * a second comment.
     */
    test("preserves every other field of the conversation", async () => {
      const github: GitHubTaskContext = fullContext();

      await GitHubRunReply.markReported({
        aiRunId: aiRunId,
        taskContext: { github: github },
        github: github,
      });

      const written: GitHubTaskContext = { ...writtenContext() };
      delete written.reportedToGitHubAt;

      expect(written).toEqual(github);
    });

    test("does not mutate the caller's context object", async () => {
      const github: GitHubTaskContext = fullContext();

      await GitHubRunReply.markReported({
        aiRunId: aiRunId,
        taskContext: { github: github },
        github: github,
      });

      expect(github.reportedToGitHubAt).toBeUndefined();
    });

    test("replaces an existing marker rather than appending a second one", async () => {
      const github: GitHubTaskContext = {
        ...fullContext(),
        reportedToGitHubAt: "2020-01-01T00:00:00.000Z",
      };

      await GitHubRunReply.markReported({
        aiRunId: aiRunId,
        taskContext: { github: github },
        github: github,
      });

      expect(writtenContext().reportedToGitHubAt).not.toBe(
        "2020-01-01T00:00:00.000Z",
      );
    });

    // The round trip the sweeper depends on: what is written must read as done.
    test("a run carrying the written context no longer needs an outcome report", async () => {
      await GitHubRunReply.markReported({
        aiRunId: aiRunId,
        taskContext: { github: fullContext() },
        github: fullContext(),
      });

      const run: AIRun = aiRun({
        status: AIRunStatus.Completed,
        github: writtenContext(),
      });

      expect(GitHubRunReply.needsOutcomeReport(run)).toBeNull();
    });
  });

  // =========================================================================

  /*
   * "@mention status" reads these lines out. Someone looking at a pull request
   * wants "revising this pull request", not a run id and an enum name.
   */
  describe("describeLiveRun", () => {
    function liveDescription(
      status: AIRunStatus,
      commandType: GitHubCommandType,
    ): string {
      return GitHubRunReply.describeLiveRun(
        aiRun({
          status: status,
          github: pullRequestContext({ commandType: commandType }),
        }),
      );
    }

    test("a queued run says it is waiting for an agent", () => {
      expect(
        liveDescription(AIRunStatus.Queued, GitHubCommandType.Review),
      ).toBe("Reviewing this pull request — queued, waiting for an agent");
    });

    test("a running run says it is in progress, not queued", () => {
      const text: string = liveDescription(
        AIRunStatus.Running,
        GitHubCommandType.Review,
      );

      expect(text).toBe("Reviewing this pull request — in progress");
      expect(text).not.toContain("queued");
    });

    test("a revision names the revision, queued and running alike", () => {
      expect(
        liveDescription(AIRunStatus.Queued, GitHubCommandType.Revise),
      ).toContain("Revising this pull request");
      expect(
        liveDescription(AIRunStatus.Running, GitHubCommandType.Revise),
      ).toContain("Revising this pull request");
    });

    test("an implementation says it is working on the issue", () => {
      expect(
        GitHubRunReply.describeLiveRun(
          aiRun({
            status: AIRunStatus.Running,
            github: issueContext({ commandType: GitHubCommandType.Implement }),
          }),
        ),
      ).toBe("Working on this issue — in progress");
    });

    /*
     * Only Queued gets the queue wording. A run paused for approval is not
     * waiting for an agent — telling the user it is would send them looking
     * for a capacity problem that does not exist.
     */
    test("a run waiting for approval is in progress, not queued", () => {
      expect(
        liveDescription(
          AIRunStatus.WaitingForApproval,
          GitHubCommandType.Revise,
        ),
      ).toBe("Revising this pull request — in progress");
    });

    test("a run with no GitHub conversation degrades to 'working' without throwing", () => {
      expect(
        GitHubRunReply.describeLiveRun(aiRun({ status: AIRunStatus.Running })),
      ).toBe("working — in progress");
    });

    test("a half-built conversation is not described as a specific command", () => {
      const run: AIRun = aiRun({
        status: AIRunStatus.Queued,
        github: pullRequestContext({ installationId: "" }),
      });

      expect(GitHubRunReply.describeLiveRun(run)).toBe(
        "working — queued, waiting for an agent",
      );
    });

    // Conversational commands never enqueue a run; the default must still be safe.
    test("an unexpected command type falls back to a plain description", () => {
      expect(
        GitHubRunReply.describeLiveRun(
          aiRun({
            status: AIRunStatus.Running,
            github: issueContext({ commandType: GitHubCommandType.Help }),
          }),
        ),
      ).toBe("Working — in progress");
    });

    test("never leaks the run id into the thread", () => {
      expect(
        liveDescription(AIRunStatus.Running, GitHubCommandType.Review),
      ).not.toContain(aiRunId.toString());
    });
  });
});
