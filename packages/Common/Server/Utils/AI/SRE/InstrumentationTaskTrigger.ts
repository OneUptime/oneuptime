import ObjectID from "../../../../Types/ObjectID";
import CodeFixTaskType from "../../../../Types/AI/CodeFixTaskType";
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
import ProjectService from "../../../Services/ProjectService";
import SubjectCodeFixRun from "./SubjectCodeFixRun";
import RemediationRulePullRequests from "./RemediationRulePullRequests";
import FixRunBudget, { FixRunBudgetDecision } from "../CodeFix/FixRunBudget";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * AI SRE — the ImproveInstrumentation trigger.
 *
 * When an investigation finishes INCONCLUSIVE — per the structured G6
 * confidence signal (ConfidenceSignal.ts), never the analysis prose — the
 * telemetry itself is the bug: the code paths involved were not observable
 * enough to diagnose. While the subject lane's fixing switch ("Fix new
 * incidents automatically" or alerts) is on, and the project has no auto
 * remediation rule for the lane or a rule that matches the subject has
 * "Telemetry pull requests" on (on by default) - the pull request is one of
 * the ways OneUptime AI fixes, so it follows fixing and its rules
 * (Types/AI/AutomaticFixPullRequests) - the inconclusive analysis becomes
 * the input to a CodeFix AIRun (codeFixTaskType: ImproveInstrumentation)
 * that the agent worker turns into a pull request adding the missing
 * observability — so the NEXT investigation of a similar signal can reach a
 * conclusion.
 *
 * Called from the investigation runners' postAnalysis, strictly AFTER the
 * analysis is posted; this trigger never throws, so a failed enqueue can
 * never fail (or duplicate) the investigation itself.
 */

export interface InstrumentationTaskGateInput {
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
  // A non-terminal ImproveInstrumentation run for the same subject, if any.
  existingRun: AIRun | null;
}

export interface InstrumentationTaskGateDecision {
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

export default class InstrumentationTaskTrigger {
  /*
   * The pure trigger decision, separated from IO so it can be tested
   * directly: Enable AI, the lane's fixing switch and its auto remediation
   * rules (Types/AI/AutomaticFixPullRequests), a repository the rules allow
   * that the agent can actually open a PR against, and the per-subject
   * dedupe guard.
   */
  public static shouldEnqueueInstrumentationTask(
    input: InstrumentationTaskGateInput,
  ): InstrumentationTaskGateDecision {
    const skip: (reason: string) => InstrumentationTaskGateDecision = (
      reason: string,
    ): InstrumentationTaskGateDecision => {
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
     * are read - the rules: none for the lane, or a matching one with
     * telemetry pull requests on.
     */
    const decision: AutomaticFixPullRequestDecision =
      decideAutomaticFixPullRequest({
        project: input.project,
        signal,
        pullRequest: AutomaticFixPullRequest.MissingTelemetry,
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
          pullRequest: AutomaticFixPullRequest.MissingTelemetry,
        }),
      );
    }

    if (!input.hasConnectedRepository) {
      return skip(
        "project has no connected repository the AI rules allow",
      );
    }

    /*
     * Dedupe: at most one non-terminal ImproveInstrumentation run per
     * incident/alert — repeated inconclusive attempts on the same subject
     * must not fan out into duplicate PRs.
     */
    if (input.existingRun) {
      return skip(
        "a non-terminal ImproveInstrumentation run already exists for this subject",
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
   * Record the durable intent as a Queued CodeFix AIRun that the external
   * agent worker claims via /ai-agent-task/get-pending-task. Exactly one of
   * incidentId/alertId is expected (the investigation's subject). NEVER
   * throws — every failure is logged and swallowed, because this runs
   * inside the investigation's postAnalysis and must not fail it.
   */
  @CaptureSpan()
  public static async enqueueForInconclusiveInvestigation(data: {
    projectId: ObjectID;
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
      const optInDecision: InstrumentationTaskGateDecision =
        this.shouldEnqueueInstrumentationTask({
          project,
          incidentId: data.incidentId,
          alertId: data.alertId,
          hasConnectedRepository: true,
          existingRun: null,
        });

      if (!optInDecision.enqueue) {
        logger.debug(
          `AI: not enqueueing instrumentation task for project ${projectId.toString()} — ${optInDecision.reason}.`,
        );
        return;
      }

      /*
       * G11 guardrail: the per-project daily fix-run budget. For this
       * AUTOMATIC trigger, over-budget is a logged skip — never an error
       * thrown into the investigation (enqueueSubjectCodeFixRun would
       * throw the same rejection, but that lands in the catch below as an
       * error log; a budget skip is expected behavior, not a failure).
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
          `AI: not enqueueing instrumentation task for project ${projectId.toString()} — ${FixRunBudget.describeRejection(
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
       * The lane's auto remediation rules: with none, every subject's pull
       * request opens in any connected repository; with some, only a
       * subject a rule with telemetry pull requests on matches, in the
       * repositories those rules name.
       */
      const rules: AutomaticFixPullRequestRules | null =
        await RemediationRulePullRequests.getRulesForSignal({
          projectId,
          incidentId: data.incidentId,
          alertId: data.alertId,
        });

      const ruleDecision: InstrumentationTaskGateDecision =
        this.shouldEnqueueInstrumentationTask({
          project,
          incidentId: data.incidentId,
          alertId: data.alertId,
          rules,
          hasConnectedRepository: true,
          existingRun: null,
        });

      if (!ruleDecision.enqueue) {
        logger.debug(
          `AI: not enqueueing instrumentation task for project ${projectId.toString()} — ${ruleDecision.reason}.`,
        );
        return;
      }

      /*
       * Repository + per-subject dedupe checks are the enqueue idiom shared
       * with the FixFromIncident sibling — see SubjectCodeFixRun.
       */
      const hasConnectedRepository: boolean =
        await SubjectCodeFixRun.hasConnectedRepository(
          projectId,
          ruleDecision.repositories,
        );

      const existingRun: AIRun | null =
        await SubjectCodeFixRun.findNonTerminalRunForSubject({
          taskType: CodeFixTaskType.ImproveInstrumentation,
          incidentId: data.incidentId,
          alertId: data.alertId,
        });

      const decision: InstrumentationTaskGateDecision =
        this.shouldEnqueueInstrumentationTask({
          project,
          incidentId: data.incidentId,
          alertId: data.alertId,
          rules,
          hasConnectedRepository,
          existingRun,
        });

      if (!decision.enqueue) {
        logger.debug(
          `AI: not enqueueing instrumentation task for project ${projectId.toString()} — ${decision.reason}.`,
        );
        return;
      }

      const allowedCodeRepositoryIds: Array<string> | undefined =
        toStoredCodeRepositoryIds(decision.repositories);

      const createdRun: AIRun =
        await SubjectCodeFixRun.enqueueSubjectCodeFixRun({
          projectId,
          taskType: CodeFixTaskType.ImproveInstrumentation,
          incidentId: data.incidentId,
          alertId: data.alertId,
          ...(allowedCodeRepositoryIds
            ? { taskContext: { allowedCodeRepositoryIds } }
            : {}),
          // The LLM provider the rules that open it pick.
          llmProviderId: SubjectCodeFixRun.toRunLlmProviderId(
            decision.llmProviderId,
          ),
        });

      logger.debug(
        `AI: enqueued ImproveInstrumentation run ${createdRun.id?.toString()} for ${
          data.incidentId
            ? `incident ${data.incidentId.toString()}`
            : `alert ${data.alertId?.toString()}`
        } after an inconclusive investigation.`,
      );
    } catch (error) {
      logger.error(
        `AI: failed to enqueue instrumentation task for project ${projectId.toString()}: ${error}`,
      );
    }
  }
}
