import ObjectID from "../../../../Types/ObjectID";
import AIRunType from "../../../../Types/AI/AIRunType";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunCodeFixRecommendation from "../../../../Types/AI/AIRunCodeFixRecommendation";
import CodeFixTaskContext, {
  getInvestigationCodeFixTaskSnapshot,
  InvestigationCodeFixTaskSnapshot,
} from "../../../../Types/AI/CodeFixTaskContext";
import CodeFixTaskType from "../../../../Types/AI/CodeFixTaskType";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../../Types/Exception/BadDataException";
import AutoRemediationTriggerEntity from "../../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import {
  AutomaticFixPullRequest,
  AutomaticFixPullRequestDecision,
  AutomaticFixPullRequestRules,
  decideAutomaticFixPullRequest,
  describeAutomaticFixPullRequestBlocker,
  getAutomaticFixSignal,
  getAutomaticFixSwitchSelect,
} from "../../../../Types/AI/AutomaticFixPullRequests";
import {
  CodeRepositoryAllowance,
  EVERY_CODE_REPOSITORY,
  toStoredCodeRepositoryIds,
} from "../../../../Types/CodeRepository/CodeRepositoryAllowance";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Project from "../../../../Models/DatabaseModels/Project";
import AIRunService from "../../../Services/AIRunService";
import ProjectService from "../../../Services/ProjectService";
import FixRunBudget, { FixRunBudgetDecision } from "../CodeFix/FixRunBudget";
import SubjectCodeFixRun from "./SubjectCodeFixRun";
import PostedRootCause from "./PostedRootCause";
import RemediationRulePullRequests from "./RemediationRulePullRequests";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * AI SRE — the FixFromIncident trigger (the roadmap's headline `code_fix`
 * capability, vision §4.8), in two forms:
 *
 * HUMAN-TRIGGERED: after an AI investigation posts a root-cause analysis on
 * an incident or alert and records a Recommended code-fix decision, the user
 * can click "Open Fix PR from this analysis" on the investigation panel: the
 * agent takes the immutable stored copy of that posted analysis as its
 * context and opens a fix pull request. No project opt-in flag is needed for
 * this form, but the durable recommendation remains a server-side gate so a
 * stale or forged client cannot turn a non-code investigation into a PR.
 *
 * AUTOMATIC: while the subject lane's fixing switch ("Fix new incidents
 * automatically" or alerts) is on, and the project has no auto remediation
 * rule for the lane or a rule that matches the subject has "Fix pull
 * requests" on (on by default) - the pull request is one of the ways
 * OneUptime AI fixes, so it follows fixing and its rules
 * (Types/AI/AutomaticFixPullRequests) - an investigation that ends with a
 * POSITIVE code-fix classification (per
 * the structured G6 signal, never a regex over the analysis prose) enqueues
 * the same FixFromIncident task with no human click. Confidence alone is not
 * sufficient: operational and other non-code causes do not open PRs. Like its
 * InstrumentationTaskTrigger sibling it runs only after the Recommended
 * decision and snapshot are durable, and it never throws. The PR opens ready
 * for review, in one of the repositories the matching rules name (every
 * connected one when they name none), and is always human-reviewed — the
 * setting moves the human gate from PR creation to PR review, never past it.
 */

export interface AutoFixTaskGateInput {
  // The project row with enableAi and the subject lane's fixing switch selected.
  project: Project | null;
  // Exactly one subject selects the incident or alert lane.
  incidentId?: ObjectID | undefined;
  alertId?: ObjectID | undefined;
  /*
   * The lane's enabled auto remediation rules and the ones that match the
   * subject (RemediationRulePullRequests), null when they could not be
   * read - or left out while they have not been read yet, which asks only
   * the project's switches.
   */
  rules?: AutomaticFixPullRequestRules | null | undefined;
  /*
   * Whether a connected repository the rules allow exists - on GitHub,
   * GitLab, Forgejo, Gitea or any Git server (SubjectCodeFixRun
   * .hasConnectedRepository): one the agent can actually push the change to.
   */
  hasConnectedRepository: boolean;
  // A non-terminal FixFromIncident run for the same subject, if any.
  existingRun: AIRun | null;
}

export interface AutoFixTaskGateDecision {
  enqueue: boolean;
  // Human-readable reason recorded in the debug log when skipping.
  reason: string;
  // The repositories the pull request may open in, once it may open.
  repositories: CodeRepositoryAllowance;
  /*
   * The LLM provider the rules that open it pick, once it may open: "" (or
   * absent) for none - the project's default, else the global provider.
   */
  llmProviderId?: string | undefined;
}

export default class FixFromIncidentTaskTrigger {
  /*
   * Gate and enqueue a FixFromIncident CodeFix run for the subject. The
   * caller must already have access-checked the subject under the USER's
   * permissions — this method reads and writes as root. Exactly one of
   * incidentId/alertId is expected; userId is the clicking user
   * (attribution on the run).
   *
   * Throws BadDataException naming the failed gate: no latest
   * completed/recommended investigation, no GitHub-App repository, or a
   * duplicate active run.
   */
  @CaptureSpan()
  public static async createFixTaskFromInvestigation(data: {
    projectId: ObjectID;
    investigationRunId: ObjectID;
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
    userId: ObjectID;
  }): Promise<AIRun> {
    if (!data.investigationRunId) {
      throw new BadDataException(
        "An investigation run id is required to create a fix task.",
      );
    }

    if (Boolean(data.incidentId) === Boolean(data.alertId)) {
      throw new BadDataException(
        "Exactly one incident or alert subject is required to create a fix task.",
      );
    }

    const subjectLabel: "incident" | "alert" = data.incidentId
      ? "incident"
      : "alert";

    /*
     * Gate 1: inspect the LATEST investigation for the subject, matching the
     * run shown by the dashboard panel. Its durable recommendation is the
     * server-authored decision about whether a code fix is appropriate, and
     * its taskContext carries the exact posted analysis that decision covered.
     * An older Recommended run must never override a newer NotRecommended,
     * Running or failed result.
     */
    const latestInvestigation: AIRun | null = await AIRunService.findOneBy({
      query: {
        projectId: data.projectId,
        runType: AIRunType.Investigation,
        ...(data.incidentId
          ? { triggeredByIncidentId: data.incidentId }
          : { triggeredByAlertId: data.alertId! }),
      },
      select: {
        _id: true,
        completedAt: true,
        status: true,
        codeFixRecommendation: true,
        taskContext: true,
      },
      sort: { createdAt: SortOrder.Descending },
      props: { isRoot: true },
    });

    if (!latestInvestigation) {
      throw new BadDataException(
        `No completed AI investigation exists for this ${subjectLabel} — the fix task uses the investigation's posted analysis as its context. Wait for the investigation to complete, or enable AI investigations in the AI settings.`,
      );
    }

    if (
      latestInvestigation.id?.toString() !== data.investigationRunId.toString()
    ) {
      throw new BadDataException(
        `A newer AI investigation is now available for this ${subjectLabel}. Refresh the page before creating a fix task.`,
      );
    }

    if (latestInvestigation.status !== AIRunStatus.Completed) {
      throw new BadDataException(
        `The latest AI investigation for this ${subjectLabel} has not completed, so a fix task cannot be created from an older analysis. Wait for the latest investigation to complete successfully.`,
      );
    }

    if (
      latestInvestigation.codeFixRecommendation ===
      AIRunCodeFixRecommendation.Pending
    ) {
      throw new BadDataException(
        `The latest AI investigation for this ${subjectLabel} is still deciding whether a code fix is appropriate. Wait for that recommendation to finish before creating a fix task.`,
      );
    }

    if (
      latestInvestigation.codeFixRecommendation !==
      AIRunCodeFixRecommendation.Recommended
    ) {
      throw new BadDataException(
        `The latest AI investigation for this ${subjectLabel} did not recommend a code fix, so a fix pull request task cannot be created from it.`,
      );
    }

    /*
     * Gate the same immutable pair the worker will consume. A Recommended
     * row without a complete snapshot (or whose snapshot names another run)
     * is unsafe: looking up the subject's latest feed item would allow a
     * later investigation to change the task after this authorization check.
     */
    const investigationSnapshot: InvestigationCodeFixTaskSnapshot | null =
      getInvestigationCodeFixTaskSnapshot(latestInvestigation.taskContext);

    if (
      !latestInvestigation.id ||
      !investigationSnapshot ||
      investigationSnapshot.investigationRunId !==
        latestInvestigation.id.toString()
    ) {
      throw new BadDataException(
        `The latest AI investigation for this ${subjectLabel} has no complete stored analysis snapshot, so a fix task cannot be created safely. Run a new investigation and try again.`,
      );
    }

    /*
     * The feed item is the published report the user actually saw. Resolve
     * it by the exact run association added to the feed model, then require
     * it to match the durable recommendation snapshot. A missing or
     * mismatched report fails closed instead of silently borrowing a newer
     * subject-level RootCause.
     */
    const analysisMarkdown: string | null =
      await PostedRootCause.getForInvestigation({
        incidentId: data.incidentId,
        alertId: data.alertId,
        aiRunId: data.investigationRunId,
        runCompletedAt: latestInvestigation.completedAt,
      });

    if (!analysisMarkdown) {
      throw new BadDataException(
        `No posted investigation analysis exists for this ${subjectLabel} and investigation run. Refresh the page and wait for the report to finish publishing before creating a fix task.`,
      );
    }

    if (
      analysisMarkdown !== investigationSnapshot.investigationAnalysisMarkdown
    ) {
      throw new BadDataException(
        `The posted investigation analysis for this ${subjectLabel} does not match its durable recommendation snapshot. Run a new investigation before creating a fix task.`,
      );
    }

    // Gate 2: a repository the agent can actually open a PR against.
    const hasConnectedRepository: boolean =
      await SubjectCodeFixRun.hasConnectedRepository(data.projectId);

    if (!hasConnectedRepository) {
      throw new BadDataException(
        "No connected repository exists for this project, so the agent has nowhere to open the fix pull request. Connect one in Code.",
      );
    }

    /*
     * Gate 3: per-subject dedupe — at most one non-terminal FixFromIncident
     * run per incident/alert (repeated clicks must not fan out into
     * duplicate PRs).
     */
    const existingRun: AIRun | null =
      await SubjectCodeFixRun.findNonTerminalRunForSubject({
        taskType: CodeFixTaskType.FixFromIncident,
        incidentId: data.incidentId,
        alertId: data.alertId,
      });

    if (existingRun) {
      throw new BadDataException(
        `A fix pull request task is already queued or running for this ${subjectLabel}. Track its progress in Code.`,
      );
    }

    return SubjectCodeFixRun.enqueueSubjectCodeFixRun({
      projectId: data.projectId,
      taskType: CodeFixTaskType.FixFromIncident,
      incidentId: data.incidentId,
      alertId: data.alertId,
      userId: data.userId,
      taskContext: {
        sourceInvestigationRunId: data.investigationRunId.toString(),
        sourceInvestigationAnalysisMarkdown: analysisMarkdown,
      },
    });
  }

  /*
   * The pure trigger decision for the AUTOMATIC form, separated from IO so
   * it can be tested directly: Enable AI, the lane's fixing switch and its
   * auto remediation rules (Types/AI/AutomaticFixPullRequests), a
   * repository the rules allow that the agent can actually open a PR
   * against, and the per-subject dedupe guard. The caller has already
   * established and durably persisted the code-fix-recommended
   * investigation prerequisite.
   */
  public static shouldAutoEnqueueFixTask(
    input: AutoFixTaskGateInput,
  ): AutoFixTaskGateDecision {
    const skip: (reason: string) => AutoFixTaskGateDecision = (
      reason: string,
    ): AutoFixTaskGateDecision => {
      return { enqueue: false, reason, repositories: EVERY_CODE_REPOSITORY };
    };

    if (!input.project) {
      return skip("project not found");
    }

    if (input.project.enableAi === false) {
      return skip("AI is disabled for the project");
    }

    const signal: AutoRemediationTriggerEntity | null = getAutomaticFixSignal({
      incidentId: input.incidentId,
      alertId: input.alertId,
    });

    if (!signal) {
      return skip("exactly one incident or alert subject is required");
    }

    /*
     * The fixing switch first (strictly === true: the column defaults to
     * false, so an unset or legacy row never enqueues), then - once they
     * are read - the rules: none for the lane, or a matching one with fix
     * pull requests on.
     */
    const decision: AutomaticFixPullRequestDecision =
      decideAutomaticFixPullRequest({
        project: input.project,
        signal,
        pullRequest: AutomaticFixPullRequest.CodeFix,
        rules:
          input.rules === undefined
            ? { rulesSetUp: false, matchingRules: [] }
            : input.rules,
      });

    if (decision.blocker) {
      return skip(
        describeAutomaticFixPullRequestBlocker({
          blocker: decision.blocker,
          signal,
          pullRequest: AutomaticFixPullRequest.CodeFix,
        }),
      );
    }

    if (!input.hasConnectedRepository) {
      return skip("project has no connected repository the AI rules allow");
    }

    /*
     * Dedupe: at most one non-terminal FixFromIncident run per
     * incident/alert — an automatic trigger racing a human click (or a
     * re-investigation) must not fan out into duplicate PRs.
     */
    if (input.existingRun) {
      return skip(
        "a non-terminal FixFromIncident run already exists for this subject",
      );
    }

    return {
      enqueue: true,
      reason: "passed fixing, rule, repository and dedupe gates",
      repositories: decision.repositories,
      llmProviderId: decision.llmProviderId,
    };
  }

  /*
   * The AUTOMATIC form: enqueue a FixFromIncident run for a subject whose
   * latest investigation durably recommends a repository code fix. Exactly one of
   * incidentId/alertId is expected. NEVER throws — every failure is logged
   * and swallowed, because this is a best-effort post-recommendation
   * follow-up and must not fail the investigation. No userId: the run stays
   * system-authored.
   */
  @CaptureSpan()
  public static async autoEnqueueFromRecommendedInvestigation(data: {
    projectId: ObjectID;
    investigationRunId: ObjectID;
    analysisMarkdown: string;
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
  }): Promise<void> {
    const { projectId } = data;

    try {
      const signal: AutoRemediationTriggerEntity | null = getAutomaticFixSignal(
        {
          incidentId: data.incidentId,
          alertId: data.alertId,
        },
      );

      if (!signal) {
        return;
      }

      const taskContext: CodeFixTaskContext = {
        sourceInvestigationRunId: data.investigationRunId?.toString(),
        sourceInvestigationAnalysisMarkdown: data.analysisMarkdown,
      };
      const investigationSnapshot: InvestigationCodeFixTaskSnapshot | null =
        getInvestigationCodeFixTaskSnapshot(taskContext);

      if (!investigationSnapshot) {
        logger.error(
          `AI: not auto-enqueueing fix task for project ${projectId.toString()} — the recommended investigation has no complete stored analysis snapshot.`,
        );
        return;
      }

      // Enable AI and the lane's fixing switch.
      const project: Project | null = await ProjectService.findOneById({
        id: projectId,
        select: {
          enableAi: true,
          ...getAutomaticFixSwitchSelect(signal),
        },
        props: { isRoot: true },
      });

      /*
       * Cheapest gate first: the project's switches, before the rules are
       * read and the repositories counted (fixing starts off).
       */
      const optInDecision: AutoFixTaskGateDecision =
        this.shouldAutoEnqueueFixTask({
          project,
          incidentId: data.incidentId,
          alertId: data.alertId,
          hasConnectedRepository: true,
          existingRun: null,
        });

      if (!optInDecision.enqueue) {
        logger.debug(
          `AI: not auto-enqueueing fix task for project ${projectId.toString()} — ${optInDecision.reason}.`,
        );
        return;
      }

      /*
       * Re-read the authoritative latest source after the engine has durably
       * settled it. This prevents an older overlapping investigation from
       * auto-authorizing a task after a newer run became authoritative, and
       * guarantees a task is never claimable while its source is Pending.
       */
      const latestInvestigation: AIRun | null = await AIRunService.findOneBy({
        query: {
          projectId,
          runType: AIRunType.Investigation,
          ...(data.incidentId
            ? { triggeredByIncidentId: data.incidentId }
            : { triggeredByAlertId: data.alertId! }),
        },
        select: {
          _id: true,
          status: true,
          codeFixRecommendation: true,
          taskContext: true,
        },
        sort: { createdAt: SortOrder.Descending },
        props: { isRoot: true },
      });
      const persistedSnapshot: InvestigationCodeFixTaskSnapshot | null =
        getInvestigationCodeFixTaskSnapshot(latestInvestigation?.taskContext);

      if (
        !latestInvestigation?.id ||
        latestInvestigation.id.toString() !==
          data.investigationRunId.toString() ||
        latestInvestigation.status !== AIRunStatus.Completed ||
        latestInvestigation.codeFixRecommendation !==
          AIRunCodeFixRecommendation.Recommended ||
        !persistedSnapshot ||
        persistedSnapshot.investigationRunId !==
          data.investigationRunId.toString() ||
        persistedSnapshot.investigationAnalysisMarkdown !==
          investigationSnapshot.investigationAnalysisMarkdown
      ) {
        logger.debug(
          `AI: not auto-enqueueing fix task for project ${projectId.toString()} — the source is no longer the latest durably Recommended investigation.`,
        );
        return;
      }

      /*
       * G11 guardrail: the per-project daily fix-run budget. For this
       * AUTOMATIC trigger, over-budget is a logged skip — never an error
       * thrown into the investigation.
       */
      const budget: FixRunBudgetDecision = await FixRunBudget.getBudgetStatus(
        projectId,
        {
          incidentId: data.incidentId,
          alertId: data.alertId,
        },
      );

      if (!budget.allowed) {
        logger.debug(
          `AI: not auto-enqueueing fix task for project ${projectId.toString()} — ${FixRunBudget.describeRejection(
            budget,
            {
              incidentId: data.incidentId,
              alertId: data.alertId,
            },
          )}`,
        );
        return;
      }

      /*
       * The lane's auto remediation rules: with none, every subject's fix
       * opens in any connected repository; with some, only a subject a rule
       * with fix pull requests on matches, in the repositories those rules
       * name.
       */
      const rules: AutomaticFixPullRequestRules | null =
        await RemediationRulePullRequests.getRulesForSignal({
          projectId,
          incidentId: data.incidentId,
          alertId: data.alertId,
        });

      const ruleDecision: AutoFixTaskGateDecision =
        this.shouldAutoEnqueueFixTask({
          project,
          incidentId: data.incidentId,
          alertId: data.alertId,
          rules,
          hasConnectedRepository: true,
          existingRun: null,
        });

      if (!ruleDecision.enqueue) {
        logger.debug(
          `AI: not auto-enqueueing fix task for project ${projectId.toString()} — ${ruleDecision.reason}.`,
        );
        return;
      }

      const hasConnectedRepository: boolean =
        await SubjectCodeFixRun.hasConnectedRepository(
          projectId,
          ruleDecision.repositories,
        );

      const existingRun: AIRun | null =
        await SubjectCodeFixRun.findNonTerminalRunForSubject({
          taskType: CodeFixTaskType.FixFromIncident,
          incidentId: data.incidentId,
          alertId: data.alertId,
        });

      const decision: AutoFixTaskGateDecision = this.shouldAutoEnqueueFixTask({
        project,
        incidentId: data.incidentId,
        alertId: data.alertId,
        rules,
        hasConnectedRepository,
        existingRun,
      });

      if (!decision.enqueue) {
        logger.debug(
          `AI: not auto-enqueueing fix task for project ${projectId.toString()} — ${decision.reason}.`,
        );
        return;
      }

      const allowedCodeRepositoryIds: Array<string> | undefined =
        toStoredCodeRepositoryIds(decision.repositories);

      const createdRun: AIRun =
        await SubjectCodeFixRun.enqueueSubjectCodeFixRun({
          projectId,
          taskType: CodeFixTaskType.FixFromIncident,
          incidentId: data.incidentId,
          alertId: data.alertId,
          taskContext: {
            sourceInvestigationRunId: data.investigationRunId.toString(),
            sourceInvestigationAnalysisMarkdown: data.analysisMarkdown,
            ...(allowedCodeRepositoryIds ? { allowedCodeRepositoryIds } : {}),
          },
          // The LLM provider the rules that open it pick.
          llmProviderId: SubjectCodeFixRun.toRunLlmProviderId(
            decision.llmProviderId,
          ),
        });

      logger.debug(
        `AI: auto-enqueued FixFromIncident run ${createdRun.id?.toString()} for ${
          data.incidentId
            ? `incident ${data.incidentId.toString()}`
            : `alert ${data.alertId?.toString()}`
        } after a confident investigation.`,
      );
    } catch (error) {
      logger.error(
        `AI: failed to auto-enqueue fix task for project ${projectId.toString()}: ${error}`,
      );
    }
  }
}
