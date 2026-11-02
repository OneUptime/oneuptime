import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import { SecurityCaseFeedEventType } from "../../../Models/DatabaseModels/SecurityCaseFeed";
import SecurityPlaybookRun from "../../../Models/DatabaseModels/SecurityPlaybookRun";
import Queue, { QueueName } from "../../Infrastructure/Queue";
import SecurityCaseFeedService from "../../Services/SecurityCaseFeedService";
import SecurityCaseService from "../../Services/SecurityCaseService";
import SecurityPlaybookRunService from "../../Services/SecurityPlaybookRunService";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import SecurityPlaybookActions, {
  PlaybookStepOutcome,
} from "./SecurityPlaybookActions";
import SecurityCaseNotifications from "../SecurityCase/SecurityCaseNotifications";
import SecurityPlaybookContainment from "./SecurityPlaybookContainment";
import SecurityPlaybookTargets from "./SecurityPlaybookTargets";
import {
  Green500,
  Indigo500,
  Red500,
  Yellow500,
} from "../../../Types/BrandColors";
import OneUptimeDate from "../../../Types/Date";

import ObjectID from "../../../Types/ObjectID";
import {
  SecurityPlaybookActionDefinition,
  actsOnSecurityEntities,
  getSecurityPlaybookAction,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import SecurityPlaybookRunStatus, {
  SecurityPlaybookStepStatus,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import {
  SecurityPlaybookStep,
  doesStepNeedApproval,
  parseSecurityPlaybookSteps,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import {
  SecurityPlaybookApprovalDecision,
  SecurityPlaybookStepResult,
  SecurityPlaybookTarget,
  SecurityPlaybookTargetState,
  clampStepResultText,
  readStepResults,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import { evaluateSecurityPlaybookStepCondition } from "../../../Types/SecurityPlaybook/SecurityPlaybookStepCondition";
import FeedMarkdown, {
  MarkdownText,
} from "../../../Utils/Markdown/FeedMarkdown";
import {
  approvalRequestedMarkdown,
  playbookFailedMarkdown,
  playbookFinishedMarkdown,
  playbookInterruptedMarkdown,
  playbookStepMarkdown,
} from "../../../Utils/SecurityCase/SecurityCaseMarkdown";
import PartialEntity from "../../../Types/Database/PartialEntity";

export const SECURITY_PLAYBOOK_RUN_JOB: string =
  "SecurityPlaybooks:RunPlaybook";

// One run's turn on a worker, at most. Steps wait on outside products.
export const SECURITY_PLAYBOOK_RUN_TIMEOUT_MS: number = 10 * 60 * 1000;

/*
 * A run that has said nothing for this long while Running was dropped by the
 * worker that had it (a restart, a timeout) and is failed by the recovery
 * sweep; a Queued one this old lost its queue job and is queued again.
 */
export const SECURITY_PLAYBOOK_STALE_RUNNING_MS: number = 30 * 60 * 1000;
export const SECURITY_PLAYBOOK_STALE_QUEUED_MS: number = 2 * 60 * 1000;

export function getStepTitle(step: SecurityPlaybookStep): string {
  const definition: SecurityPlaybookActionDefinition | undefined =
    getSecurityPlaybookAction(step.action);

  return definition?.title || step.action;
}

/*
 * THE PLAYBOOK ENGINE: runs a playbook's steps against its case, one at a
 * time, in order.
 *
 * A run is claimed by moving it from Queued to Running in one
 * compare-and-set, so two workers handed the same run (a retried job, the
 * recovery sweep) never both run it. Between steps it reads its own status
 * again, so a person's Cancel stops it at the next step boundary; every
 * status it writes afterwards is a compare-and-set from Running, so a
 * cancellation is never written over.
 *
 * A step that waits on an earlier step's result (runIf) runs only when that
 * step ended with it, and is skipped before it does anything else - asks
 * for an approval, picks a target - saying which result it waited on
 * (evaluateSecurityPlaybookStepCondition). That is how a playbook branches:
 * contain only what threat intel knows is bad, and leave a task to check
 * the rest.
 *
 * A step marked "needs approval" - and every containment step a Security
 * Admin did not let run without it - stops the run in Waiting for Approval
 * before it does anything. Approving it (SecurityPlaybookRunAPI) records the
 * decision on the step and queues the run again, which carries on from that
 * step; rejecting it ends the run.
 *
 * A step that acts on users or hosts picks its targets first, by the target
 * rule (SecurityPlaybookTargets), and keeps them on its result: the approver
 * decides on those, and the step acts on what the approver kept. A step with
 * nothing to act on - the case is about an address, or all it is about is
 * protected - is skipped rather than held for an approval of nothing.
 */
export default class SecurityPlaybookEngine {
  @CaptureSpan()
  public static async enqueueRun(runId: ObjectID): Promise<void> {
    /*
     * A job id of its own each time: a run is queued again after every
     * approval, and a queue keeps finished jobs under their id for a while.
     */
    await Queue.addJob(
      QueueName.Worker,
      `security-playbook-run-${runId.toString()}-${OneUptimeDate.getCurrentDate().getTime()}`,
      SECURITY_PLAYBOOK_RUN_JOB,
      { runId: runId.toString() },
      { attempts: 1 },
    );
  }

  @CaptureSpan()
  public static async executeRun(runId: ObjectID): Promise<void> {
    const claimed: boolean =
      await SecurityPlaybookRunService.compareAndSetColumnsByIdWithoutHooks({
        id: runId,
        data: {
          status: SecurityPlaybookRunStatus.Running,
        },
        expectedData: {
          status: SecurityPlaybookRunStatus.Queued,
        },
      });

    if (!claimed) {
      return;
    }

    try {
      await this.runSteps(runId);
    } catch (error) {
      logger.error(`SecurityPlaybookEngine: run ${runId.toString()} failed:`);
      logger.error(error);

      await this.finishRun({
        runId,
        status: SecurityPlaybookRunStatus.Failed,
        errorMessage:
          error instanceof Error && error.message
            ? error.message
            : "The run stopped on an unexpected error.",
      });
    }
  }

  private static async readRun(
    runId: ObjectID,
  ): Promise<SecurityPlaybookRun | null> {
    return await SecurityPlaybookRunService.findOneById({
      id: runId,
      select: {
        _id: true,
        projectId: true,
        securityCaseId: true,
        playbookName: true,
        status: true,
        steps: true,
        stepResults: true,
        currentStepIndex: true,
        threatIntelMatched: true,
        startedAt: true,
        triggeredByUserId: true,
      },
      props: {
        isRoot: true,
      },
    });
  }

  private static async readStatus(
    runId: ObjectID,
  ): Promise<SecurityPlaybookRunStatus | undefined> {
    const run: SecurityPlaybookRun | null =
      await SecurityPlaybookRunService.findOneById({
        id: runId,
        select: {
          status: true,
        },
        props: {
          isRoot: true,
        },
      });

    return run?.status;
  }

  // The case as a step reads it: fresh before every step, since steps change it.
  public static async readCase(
    projectId: ObjectID,
    securityCaseId: ObjectID,
  ): Promise<SecurityCase | null> {
    return await SecurityCaseService.findOneBy({
      query: {
        _id: securityCaseId,
        projectId: projectId,
      },
      select: {
        _id: true,
        projectId: true,
        caseNumber: true,
        caseNumberWithPrefix: true,
        title: true,
        description: true,
        securityCaseStatusId: true,
        securityCasePriorityId: true,
        verdict: true,
        source: true,
        groupingKey: true,
        entities: true,
        mitreTactics: true,
        mitreTechniques: true,
        detectionCount: true,
        assignedToUserId: true,
        assignedToTeamId: true,
        incidentId: true,
        firstDetectedAt: true,
        lastDetectedAt: true,
        createdAt: true,
      },
      props: {
        isRoot: true,
      },
    });
  }

  private static async saveProgress(data: {
    runId: ObjectID;
    results: Array<SecurityPlaybookStepResult>;
    currentStepIndex: number;
    threatIntelMatched: boolean;
  }): Promise<void> {
    const update: PartialEntity<SecurityPlaybookRun> = {
      stepResults: data.results as unknown as NonNullable<
        PartialEntity<SecurityPlaybookRun>["stepResults"]
      >,
      currentStepIndex: data.currentStepIndex,
      threatIntelMatched: data.threatIntelMatched,
    };

    await SecurityPlaybookRunService.updateOneById({
      id: data.runId,
      data: update,
      props: {
        isRoot: true,
      },
    });
  }

  private static async runSteps(runId: ObjectID): Promise<void> {
    const run: SecurityPlaybookRun | null = await this.readRun(runId);

    if (!run || !run.projectId || !run.securityCaseId) {
      throw new Error("The run, or the case it runs on, no longer exists.");
    }

    const projectId: ObjectID = run.projectId;
    const securityCaseId: ObjectID = run.securityCaseId;
    const playbookName: string = run.playbookName || "Playbook";

    if (!run.startedAt) {
      await SecurityPlaybookRunService.updateColumnsByIdWithoutHooks({
        id: runId,
        data: {
          startedAt: OneUptimeDate.getCurrentDate(),
        },
      });
    }

    const steps: Array<SecurityPlaybookStep> = parseSecurityPlaybookSteps(
      run.steps,
    );
    const results: Array<SecurityPlaybookStepResult> = readStepResults(
      run.stepResults,
      steps,
    );
    let threatIntelMatched: boolean = run.threatIntelMatched === true;

    for (
      let index: number = Math.max(0, run.currentStepIndex || 0);
      index < steps.length;
      index++
    ) {
      // A person's Cancel takes effect between steps.
      if (
        (await this.readStatus(runId)) !== SecurityPlaybookRunStatus.Running
      ) {
        return;
      }

      const step: SecurityPlaybookStep = steps[index]!;
      const stepNumber: number = index + 1;
      const stepTitle: string = getStepTitle(step);
      const definition: SecurityPlaybookActionDefinition | undefined =
        getSecurityPlaybookAction(step.action);

      // A step that waits on an earlier step's result runs only on that result.
      const condition: { holds: boolean; reason?: string | undefined } =
        evaluateSecurityPlaybookStepCondition({
          condition: step.runIf,
          index,
          steps,
          results,
        });

      if (!condition.holds) {
        results[index] = {
          ...results[index]!,
          status: SecurityPlaybookStepStatus.Skipped,
          completedAt: OneUptimeDate.getCurrentDate().toISOString(),
          message: clampStepResultText(
            condition.reason || "Skipped: its condition did not hold.",
          ),
        };

        await this.saveProgress({
          runId,
          results,
          currentStepIndex: index + 1,
          threatIntelMatched,
        });
        continue;
      }

      if (step.onlyIfThreatIntelMatched && !threatIntelMatched) {
        results[index] = {
          ...results[index]!,
          status: SecurityPlaybookStepStatus.Skipped,
          completedAt: OneUptimeDate.getCurrentDate().toISOString(),
          message:
            "Skipped: no entity of the case matched threat intel earlier in this run.",
        };

        await this.saveProgress({
          runId,
          results,
          currentStepIndex: index + 1,
          threatIntelMatched,
        });
        continue;
      }

      if (
        actsOnSecurityEntities(definition) &&
        !results[index]!.targets &&
        definition?.entityType
      ) {
        const caseNow: SecurityCase | null = await this.readCase(
          projectId,
          securityCaseId,
        );

        if (!caseNow) {
          throw new Error("The case this run was started on no longer exists.");
        }

        const targets: Array<SecurityPlaybookTarget> =
          await SecurityPlaybookTargets.selectTargets({
            projectId,
            securityCase: caseNow,
            entityType: definition.entityType,
          });

        results[index] = { ...results[index]!, targets };

        const hasTarget: boolean = targets.some(
          (target: SecurityPlaybookTarget): boolean => {
            return target.state === SecurityPlaybookTargetState.Proposed;
          },
        );

        if (!hasTarget) {
          const summary: MarkdownText =
            SecurityPlaybookContainment.describeNothingToActOn({
              entityType: definition.entityType,
              targets,
            });

          results[index] = {
            ...results[index]!,
            status: SecurityPlaybookStepStatus.Skipped,
            completedAt: OneUptimeDate.getCurrentDate().toISOString(),
            message: clampStepResultText(summary.toString()),
          };

          await this.saveProgress({
            runId,
            results,
            currentStepIndex: index + 1,
            threatIntelMatched,
          });

          await SecurityCaseFeedService.createSecurityCaseFeedItem({
            projectId,
            securityCaseId,
            feedInfoInMarkdown: playbookStepMarkdown({
              playbookName,
              stepNumber,
              stepTitle,
              summary,
            }).toString(),
            eventType: SecurityCaseFeedEventType.ResponseAction,
            displayColor: Indigo500,
          });
          continue;
        }
      }

      if (
        doesStepNeedApproval(step) &&
        results[index]!.approval?.decision !==
          SecurityPlaybookApprovalDecision.Approved
      ) {
        results[index] = {
          ...results[index]!,
          status: SecurityPlaybookStepStatus.WaitingForApproval,
        };

        await this.saveProgress({
          runId,
          results,
          currentStepIndex: index,
          threatIntelMatched,
        });

        const isWaiting: boolean =
          await SecurityPlaybookRunService.compareAndSetColumnsByIdWithoutHooks(
            {
              id: runId,
              data: {
                status: SecurityPlaybookRunStatus.WaitingForApproval,
              },
              expectedData: {
                status: SecurityPlaybookRunStatus.Running,
              },
            },
          );

        if (isWaiting) {
          await SecurityCaseFeedService.createSecurityCaseFeedItem({
            projectId,
            securityCaseId,
            feedInfoInMarkdown: approvalRequestedMarkdown({
              playbookName,
              stepNumber,
              stepTitle,
              targets: (results[index]!.targets || [])
                .filter((target: SecurityPlaybookTarget): boolean => {
                  return target.state === SecurityPlaybookTargetState.Proposed;
                })
                .map((target: SecurityPlaybookTarget): string => {
                  return target.value;
                }),
            }).toString(),
            eventType: SecurityCaseFeedEventType.ApprovalRequested,
            displayColor: Yellow500,
          });

          // The people who can decide are asked (SecurityCaseNotifications).
          await SecurityCaseNotifications.approvalRequested({
            projectId,
            securityCaseId,
            runId,
          });
        }

        return;
      }

      const securityCase: SecurityCase | null = await this.readCase(
        projectId,
        securityCaseId,
      );

      if (!securityCase) {
        throw new Error("The case this run was started on no longer exists.");
      }

      const startedAt: string = OneUptimeDate.getCurrentDate().toISOString();

      results[index] = {
        ...results[index]!,
        status: SecurityPlaybookStepStatus.Running,
        startedAt,
      };

      await this.saveProgress({
        runId,
        results,
        currentStepIndex: index,
        threatIntelMatched,
      });

      let outcome: PlaybookStepOutcome;

      try {
        outcome = await SecurityPlaybookActions.execute({
          projectId,
          runId,
          playbookName,
          step,
          stepNumber,
          securityCase,
          triggeredByUserId: run.triggeredByUserId,
          targets: results[index]!.targets,
        });
      } catch (error) {
        outcome = {
          status: SecurityPlaybookStepStatus.Failed,
          summary: FeedMarkdown.empty(),
          error:
            error instanceof Error && error.message
              ? error.message
              : "The step failed on an unexpected error.",
        };
      }

      if (outcome.threatIntelMatched) {
        threatIntelMatched = true;
      }

      const summaryText: string = outcome.summary.toString();

      results[index] = {
        ...results[index]!,
        status: outcome.status,
        startedAt,
        completedAt: OneUptimeDate.getCurrentDate().toISOString(),
        message: clampStepResultText(summaryText || undefined),
        error: clampStepResultText(outcome.error),
        ...(outcome.targets ? { targets: outcome.targets } : {}),
        ...(outcome.found !== undefined ? { found: outcome.found } : {}),
      };

      await this.saveProgress({
        runId,
        results,
        currentStepIndex: index + 1,
        threatIntelMatched,
      });

      if (summaryText && !outcome.hasWrittenOwnFeed) {
        await SecurityCaseFeedService.createSecurityCaseFeedItem({
          projectId,
          securityCaseId,
          feedInfoInMarkdown: playbookStepMarkdown({
            playbookName,
            stepNumber,
            stepTitle,
            summary: outcome.summary,
          }).toString(),
          moreInformationInMarkdown: outcome.detailsInMarkdown?.toString(),
          eventType:
            outcome.feedEventType || SecurityCaseFeedEventType.PlaybookStep,
          displayColor:
            outcome.status === SecurityPlaybookStepStatus.Failed
              ? Red500
              : Indigo500,
        });
      }

      if (
        outcome.status === SecurityPlaybookStepStatus.Failed &&
        !step.continueOnFailure
      ) {
        await this.finishRun({
          runId,
          status: SecurityPlaybookRunStatus.Failed,
          errorMessage: `Step ${stepNumber} (${stepTitle}) failed: ${outcome.error || "no reason was given."}`,
          feed: {
            projectId,
            securityCaseId,
            markdown: playbookFailedMarkdown({
              playbookName,
              stepNumber,
              stepTitle,
            }),
            detailsInMarkdown: outcome.error
              ? FeedMarkdown.multilineText(outcome.error)
              : undefined,
          },
        });
        return;
      }
    }

    const counts: { succeeded: number; skipped: number; failed: number } = {
      succeeded: 0,
      skipped: 0,
      failed: 0,
    };

    for (const result of results) {
      if (result.status === SecurityPlaybookStepStatus.Succeeded) {
        counts.succeeded++;
      } else if (result.status === SecurityPlaybookStepStatus.Skipped) {
        counts.skipped++;
      } else if (result.status === SecurityPlaybookStepStatus.Failed) {
        counts.failed++;
      }
    }

    await this.finishRun({
      runId,
      status: SecurityPlaybookRunStatus.Succeeded,
      feed: {
        projectId,
        securityCaseId,
        markdown: playbookFinishedMarkdown({
          playbookName,
          ...counts,
        }),
      },
    });
  }

  /*
   * Ends a run that is Running: never one a person cancelled in the
   * meantime, which keeps its Cancelled.
   */
  public static async finishRun(data: {
    runId: ObjectID;
    status:
      | SecurityPlaybookRunStatus.Succeeded
      | SecurityPlaybookRunStatus.Failed;
    errorMessage?: string | undefined;
    feed?:
      | {
          projectId: ObjectID;
          securityCaseId: ObjectID;
          markdown: MarkdownText;
          detailsInMarkdown?: MarkdownText | undefined;
        }
      | undefined;
  }): Promise<void> {
    const errorMessage: string | undefined = clampStepResultText(
      data.errorMessage || undefined,
    );
    const update: PartialEntity<SecurityPlaybookRun> = {
      status: data.status,
      completedAt: OneUptimeDate.getCurrentDate(),
    };

    if (errorMessage) {
      update.errorMessage = errorMessage;
    }

    const finished: boolean =
      await SecurityPlaybookRunService.compareAndSetColumnsByIdWithoutHooks({
        id: data.runId,
        data: update,
        expectedData: {
          status: SecurityPlaybookRunStatus.Running,
        },
      });

    if (!finished || !data.feed) {
      return;
    }

    await SecurityCaseFeedService.createSecurityCaseFeedItem({
      projectId: data.feed.projectId,
      securityCaseId: data.feed.securityCaseId,
      feedInfoInMarkdown: data.feed.markdown.toString(),
      moreInformationInMarkdown: data.feed.detailsInMarkdown?.toString(),
      eventType: SecurityCaseFeedEventType.PlaybookRun,
      displayColor:
        data.status === SecurityPlaybookRunStatus.Succeeded ? Green500 : Red500,
    });
  }

  /*
   * The recovery sweep, every minute: a Queued run whose job was lost is
   * queued again, and a Running run nobody has touched for half an hour -
   * its worker died with it - is failed, saying why.
   */
  @CaptureSpan()
  public static async recoverRuns(): Promise<void> {
    const now: Date = OneUptimeDate.getCurrentDate();

    const queued: Array<SecurityPlaybookRun> =
      await SecurityPlaybookRunService.findBy({
        query: {
          status: SecurityPlaybookRunStatus.Queued,
        },
        select: {
          _id: true,
          updatedAt: true,
        },
        skip: 0,
        limit: 500,
        props: {
          isRoot: true,
        },
      });

    for (const run of queued) {
      if (
        run.id &&
        run.updatedAt &&
        now.getTime() - OneUptimeDate.fromString(run.updatedAt).getTime() >
          SECURITY_PLAYBOOK_STALE_QUEUED_MS
      ) {
        try {
          /*
           * Rewriting its status moves its updatedAt, so the next sweep
           * does not queue it once more; a run claimed in the meantime is
           * left alone. A job that was only slow and turns up after all
           * finds the run claimed and does nothing.
           */
          const isStillQueued: boolean =
            await SecurityPlaybookRunService.compareAndSetColumnsByIdWithoutHooks(
              {
                id: run.id,
                data: {
                  status: SecurityPlaybookRunStatus.Queued,
                },
                expectedData: {
                  status: SecurityPlaybookRunStatus.Queued,
                },
              },
            );

          if (isStillQueued) {
            await this.enqueueRun(run.id);
          }
        } catch (error) {
          logger.error(
            `SecurityPlaybookEngine: could not queue run ${run.id.toString()} again:`,
          );
          logger.error(error);
        }
      }
    }

    const running: Array<SecurityPlaybookRun> =
      await SecurityPlaybookRunService.findBy({
        query: {
          status: SecurityPlaybookRunStatus.Running,
        },
        select: {
          _id: true,
          updatedAt: true,
          projectId: true,
          securityCaseId: true,
          playbookName: true,
        },
        skip: 0,
        limit: 500,
        props: {
          isRoot: true,
        },
      });

    for (const run of running) {
      if (
        run.id &&
        run.updatedAt &&
        now.getTime() - OneUptimeDate.fromString(run.updatedAt).getTime() >
          SECURITY_PLAYBOOK_STALE_RUNNING_MS
      ) {
        await this.finishRun({
          runId: run.id,
          status: SecurityPlaybookRunStatus.Failed,
          errorMessage:
            "The run stopped without finishing: the worker running it was restarted or timed out. Run the playbook again from the case.",
          feed:
            run.projectId && run.securityCaseId
              ? {
                  projectId: run.projectId,
                  securityCaseId: run.securityCaseId,
                  markdown: playbookInterruptedMarkdown({
                    playbookName: run.playbookName || "Playbook",
                  }),
                }
              : undefined,
        });
      }
    }
  }
}
