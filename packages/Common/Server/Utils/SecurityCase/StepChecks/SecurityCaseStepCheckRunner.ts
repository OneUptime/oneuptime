import Project from "../../../../Models/DatabaseModels/Project";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import { SecurityCaseFeedEventType } from "../../../../Models/DatabaseModels/SecurityCaseFeed";
import SecurityCaseStatus from "../../../../Models/DatabaseModels/SecurityCaseStatus";
import SecurityCaseStepCheck from "../../../../Models/DatabaseModels/SecurityCaseStepCheck";
import SecurityCaseTask from "../../../../Models/DatabaseModels/SecurityCaseTask";
import SecurityPlaybook from "../../../../Models/DatabaseModels/SecurityPlaybook";
import SecurityPlaybookRun from "../../../../Models/DatabaseModels/SecurityPlaybookRun";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { Red500 } from "../../../../Types/BrandColors";
import PartialEntity from "../../../../Types/Database/PartialEntity";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { SecurityCaseMatchesJson } from "../../../../Types/SecurityCase/SecurityCaseMatches";
import SecurityCaseStage, {
  SECURITY_CASE_STAGES,
} from "../../../../Types/SecurityCase/SecurityCaseStage";
import {
  SecurityCaseStepCheckEvidence,
  readStepCheckDataTime,
} from "../../../../Types/SecurityCase/SecurityCaseStepCheckEvidence";
import SecurityCaseStepCheckState from "../../../../Types/SecurityCase/SecurityCaseStepCheckState";
import { readSecurityEntities } from "../../../../Types/SecurityCase/SecurityEntity";
import { createTranslator, Translator } from "../../../../Types/Translator";
import {
  ResponsePlanInput,
  buildResponsePlan,
  readPlaybookRuns,
} from "../../../../Utils/SecurityCase/ResponsePlan/ResponsePlanBuilder";
import {
  readResponsePlaybooks,
  readResponseStepChecks,
  readResponseTasks,
} from "../../../../Utils/SecurityCase/ResponsePlan/ResponsePlanInputs";
import {
  ResponsePlan,
  ResponseStep,
  ResponseStepCheck,
  ResponseTask,
} from "../../../../Utils/SecurityCase/ResponsePlan/ResponsePlanTypes";
import { CHECK_COULD_NOT_CHECK } from "../../../../Utils/SecurityCase/ResponsePlan/StepCheckWords";
import { wordStepCheckSentence } from "../../../../Utils/SecurityCase/ResponsePlan/StepCheckSentences";
import {
  stepCheckRegressedDetailMarkdown,
  stepCheckRegressedMarkdown,
} from "../../../../Utils/SecurityCase/SecurityCaseMarkdown";
import SecurityCaseStatuses from "../../../../Utils/SecurityCase/SecurityCaseStatuses";
import ProjectService from "../../../Services/ProjectService";
import SecurityCaseFeedService from "../../../Services/SecurityCaseFeedService";
import SecurityCaseService, {
  SECURITY_CASE_CONTAINED_BY_CHECKS_KEY,
} from "../../../Services/SecurityCaseService";
import SecurityCaseStepCheckService from "../../../Services/SecurityCaseStepCheckService";
import SecurityCaseTaskService from "../../../Services/SecurityCaseTaskService";
import SecurityPlaybookRunService from "../../../Services/SecurityPlaybookRunService";
import SecurityPlaybookService from "../../../Services/SecurityPlaybookService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import SecurityCaseMatches from "../Context/SecurityCaseMatches";
import SecurityCaseNotifications, {
  isSetupTestCase,
} from "../SecurityCaseNotifications";
import SecurityCaseValues, {
  ProjectSecurityCaseValues,
} from "../SecurityCaseValues";
import {
  StepCheck,
  StepCheckCase,
  StepCheckEvidence,
  StepCheckResult,
  StepCheckTarget,
  evidenceOf,
  getNextCheckAt,
  sentence,
} from "./StepCheck";
import { createStepCheckEvidence } from "./StepCheckEvidenceReaders";
import { STEP_CHECKS, getStepCheck } from "./StepCheckRegistry";

/*
 * THE EVERY-MINUTE CHECK OF SECURITY CASES' RESPONSE PLAN STEPS (#10340).
 *
 * A case keeps when the check must next look at it
 * (SecurityCase.nextStepCheckAt: now as it opens, when something on it
 * changes, and then as often as its steps need), so the check reads only the
 * cases whose moment has come, by that column's index, the oldest first -
 * batched as SecurityCaseTargetCheck is. Each case is claimed in one
 * compare-and-set on that moment: of two workers handed the same case, one
 * checks it.
 *
 * For a case it builds the Response Plan with the same builder the card
 * draws it with, and runs the check of every step whose kind has one
 * (StepCheckRegistry) and whose own next check has come. Each result is
 * written compare-and-set on when the step was last checked, so a result
 * is said once. A step that was done and stopped holding is put on the
 * case's timeline and told to the people on it. Once every step that
 * contains the threat is verified, the case moves to Contained - when the
 * project lets it (Project.markSecurityCaseContainedWhenVerified) - and its
 * time to contain is recorded.
 *
 * A closed case, and the setup test's, are checked no more.
 */

// Cases read at once, and the most read in one run.
export const SECURITY_CASE_STEP_CHECK_BATCH_SIZE: number = 20;
export const SECURITY_CASE_STEP_CHECK_MAX_BATCHES: number = 10;

// How long a worker holds a case it is checking before another may.
export const SECURITY_CASE_STEP_CHECK_LEASE_MINUTES: number = 5;

// When a case with no step to check is read again: a new detection may bring one.
export const SECURITY_CASE_STEP_CHECK_IDLE_MINUTES: number = 30;

// How long one run may go on before it leaves the rest to the next.
export const SECURITY_CASE_STEP_CHECK_RUN_BUDGET_MS: number = 3 * 60 * 1000;

const MINUTE: number = 60 * 1000;

const CASE_SELECT: {
  _id: true;
  projectId: true;
  groupingKey: true;
  securityCaseStatusId: true;
  entities: true;
  mitreTactics: true;
  mitreTechniques: true;
  assignedToUserId: true;
  incidentId: true;
  aiSuggestedPlaybookId: true;
  aiTriageReport: true;
  createdAt: true;
  firstDetectedAt: true;
  lastDetectedAt: true;
  closedAt: true;
  nextStepCheckAt: true;
} = {
  _id: true,
  projectId: true,
  groupingKey: true,
  securityCaseStatusId: true,
  entities: true,
  mitreTactics: true,
  mitreTechniques: true,
  assignedToUserId: true,
  incidentId: true,
  aiSuggestedPlaybookId: true,
  aiTriageReport: true,
  createdAt: true,
  firstDetectedAt: true,
  lastDetectedAt: true,
  closedAt: true,
  nextStepCheckAt: true,
};

// English, for the timeline: every reader sees the same entry.
const ENGLISH: Translator = createTranslator(undefined, "en");

// A time as the timeline writes one: the same for everyone, in UTC.
export function writeTimelineTime(time: Date): string {
  return OneUptimeDate.getDateAsFormattedStringInTimezone({
    date: time,
    timezone: "UTC",
    use12HourFormat: false,
  });
}

// What a step is about, as written: the address, the user, the host.
export function getStepValue(step: ResponseStep): string {
  return (step.text.values["value"] || step.copyValue || "").trim();
}

// What one step's check settled on, ready to write.
export interface SettledStepCheck {
  state: SecurityCaseStepCheckState;
  evidence: SecurityCaseStepCheckEvidence;
  stateSince: Date;
  nextCheckAt: Date;
  // It stopped holding just now, or stopped holding again: said on the timeline and to the people.
  isNewRegression: boolean;
}

/*
 * A check's result as it is kept: a step stays Regressed through a read
 * that failed - not being able to read is no sign it holds again - and
 * keeps the moment it got into its state for as long as it stays in it.
 */
export function settleStepCheck(data: {
  previous: ResponseStepCheck | null;
  result: StepCheckResult;
  now: Date;
  intervalInMinutes: number;
}): SettledStepCheck {
  const { previous, now } = data;
  let result: StepCheckResult = data.result;

  if (
    previous?.state === SecurityCaseStepCheckState.Regressed &&
    result.state === SecurityCaseStepCheckState.CannotTell &&
    result.evidence.data["readFailed"] === true
  ) {
    result = {
      state: previous.state,
      evidence: previous.evidence,
      recheckInMinutes: result.recheckInMinutes,
    };
  }

  const isSameState: boolean = previous?.state === result.state;
  const stateSince: Date =
    isSameState && previous?.stateSince ? previous.stateSince : now;
  const isNewRegression: boolean =
    result.state === SecurityCaseStepCheckState.Regressed &&
    (!isSameState ||
      readStepCheckDataTime(
        previous?.evidence.data,
        "regressedAt",
      )?.getTime() !==
        readStepCheckDataTime(result.evidence.data, "regressedAt")?.getTime());

  return {
    state: result.state,
    evidence: result.evidence,
    stateSince,
    nextCheckAt: getNextCheckAt({
      state: result.state,
      stateSince,
      now,
      intervalInMinutes: data.intervalInMinutes,
      recheckInMinutes: result.recheckInMinutes,
    }),
    isNewRegression,
  };
}

// When the case is next read: its soonest step, or after a while when nothing is due.
export function getCaseNextStepCheckAt(data: {
  nextCheckAts: Array<Date>;
  now: Date;
}): Date {
  let soonest: Date = new Date(
    data.now.getTime() + SECURITY_CASE_STEP_CHECK_IDLE_MINUTES * MINUTE,
  );

  for (const next of data.nextCheckAts) {
    if (next.getTime() < soonest.getTime()) {
      soonest = next;
    }
  }

  // Never in the past, so one run never reads a case twice.
  return soonest.getTime() <= data.now.getTime()
    ? new Date(data.now.getTime() + MINUTE)
    : soonest;
}

function hasReached(
  stage: SecurityCaseStage,
  wanted: SecurityCaseStage,
): boolean {
  return (
    SECURITY_CASE_STAGES.indexOf(stage) >= SECURITY_CASE_STAGES.indexOf(wanted)
  );
}

// What one run over a case did.
export interface StepCheckRunOutcome {
  isClaimed: boolean;
  checkedStepKeys: Array<string>;
  regressedStepKeys: Array<string>;
  isContained: boolean;
}

const NOTHING_DONE: StepCheckRunOutcome = {
  isClaimed: false,
  checkedStepKeys: [],
  regressedStepKeys: [],
  isContained: false,
};

export default class SecurityCaseStepCheckRunner {
  /*
   * Every case whose moment has come, at most a run's worth, the oldest
   * first. Returns how many cases were looked at.
   */
  @CaptureSpan()
  public static async checkDueCases(
    now: Date = OneUptimeDate.getCurrentDate(),
  ): Promise<number> {
    const startedAt: number = Date.now();
    const valuesByProject: Map<string, ProjectSecurityCaseValues> = new Map();
    const seen: Set<string> = new Set();
    let checked: number = 0;

    for (
      let batch: number = 0;
      batch < SECURITY_CASE_STEP_CHECK_MAX_BATCHES;
      batch++
    ) {
      const cases: Array<SecurityCase> = await SecurityCaseService.findBy({
        query: {
          nextStepCheckAt: QueryHelper.lessThanEqualTo(now),
        },
        select: CASE_SELECT,
        sort: {
          nextStepCheckAt: SortOrder.Ascending,
        },
        skip: 0,
        limit: SECURITY_CASE_STEP_CHECK_BATCH_SIZE,
        props: {
          isRoot: true,
        },
      });

      // A case another worker holds may come back: each is looked at once a run.
      const fresh: Array<SecurityCase> = cases.filter(
        (securityCase: SecurityCase): boolean => {
          return Boolean(
            securityCase.id && !seen.has(securityCase.id.toString()),
          );
        },
      );

      if (fresh.length === 0) {
        break;
      }

      for (const securityCase of fresh) {
        seen.add(securityCase.id!.toString());

        try {
          await this.checkCase({ securityCase, now, valuesByProject });
        } catch (error) {
          logger.error(
            `SecurityCaseStepCheckRunner: could not check the steps of case ${securityCase.id!.toString()}:`,
          );
          logger.error(error);
        }

        checked++;

        // The rest wait for the next run: their moment has come, so it reads them first.
        if (Date.now() - startedAt > SECURITY_CASE_STEP_CHECK_RUN_BUDGET_MS) {
          return checked;
        }
      }

      if (cases.length < SECURITY_CASE_STEP_CHECK_BATCH_SIZE) {
        break;
      }
    }

    return checked;
  }

  // One case's steps, now and all of them: something on it changed (SecurityCaseStepChecks).
  @CaptureSpan()
  public static async checkCaseNow(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    now?: Date | undefined;
  }): Promise<StepCheckRunOutcome> {
    const securityCase: SecurityCase | null =
      await SecurityCaseService.findOneBy({
        query: { _id: data.securityCaseId, projectId: data.projectId },
        select: CASE_SELECT,
        props: { isRoot: true },
      });

    if (!securityCase) {
      return NOTHING_DONE;
    }

    return await this.checkCase({
      securityCase,
      now: data.now || OneUptimeDate.getCurrentDate(),
      isEveryStepDue: true,
    });
  }

  /*
   * One case: claimed, its plan built, each due step checked and written,
   * what stopped holding said, contained when every containment step is
   * verified, and its next moment set. Nothing when another worker had it.
   */
  @CaptureSpan()
  public static async checkCase(data: {
    securityCase: SecurityCase;
    now: Date;
    // Every step, whatever its own next check says: something on the case changed.
    isEveryStepDue?: boolean | undefined;
    valuesByProject?: Map<string, ProjectSecurityCaseValues> | undefined;
    // The evidence the checks read; the project's own by default.
    evidence?: ((securityCase: StepCheckCase) => StepCheckEvidence) | undefined;
    checks?: ReadonlyArray<StepCheck> | undefined;
  }): Promise<StepCheckRunOutcome> {
    const { securityCase, now } = data;

    if (!securityCase.id || !securityCase.projectId) {
      return NOTHING_DONE;
    }

    const lease: Date = new Date(
      now.getTime() + SECURITY_CASE_STEP_CHECK_LEASE_MINUTES * MINUTE,
    );
    const isClaimed: boolean =
      await SecurityCaseService.compareAndSetColumnsByIdWithoutHooks({
        id: securityCase.id,
        data: {
          nextStepCheckAt: lease,
        } as unknown as PartialEntity<SecurityCase>,
        expectedData: {
          nextStepCheckAt: (securityCase.nextStepCheckAt ||
            null) as unknown as Date,
        },
        skipUpdateDateColumn: true,
      });

    if (!isClaimed) {
      return NOTHING_DONE;
    }

    let nextStepCheckAt: Date | null = new Date(
      now.getTime() + SECURITY_CASE_STEP_CHECK_IDLE_MINUTES * MINUTE,
    );
    let outcome: StepCheckRunOutcome = { ...NOTHING_DONE, isClaimed: true };

    try {
      const projectKey: string = securityCase.projectId.toString();
      let values: ProjectSecurityCaseValues | undefined =
        data.valuesByProject?.get(projectKey);

      if (!values) {
        values = await SecurityCaseValues.getForProject(securityCase.projectId);
        data.valuesByProject?.set(projectKey, values);
      }

      const stage: SecurityCaseStage =
        SecurityCaseStatuses.getStage(
          values.statuses,
          securityCase.securityCaseStatusId,
        ) || SecurityCaseStage.New;

      // A closed case, and the setup test's, have nothing left to check.
      if (
        securityCase.closedAt ||
        stage === SecurityCaseStage.Closed ||
        isSetupTestCase(securityCase)
      ) {
        nextStepCheckAt = null;
        return outcome;
      }

      const result: {
        outcome: StepCheckRunOutcome;
        nextCheckAts: Array<Date>;
      } = await this.checkSteps({
        securityCase,
        now,
        stage,
        values,
        isEveryStepDue: data.isEveryStepDue === true,
        evidence: data.evidence,
        checks: data.checks || STEP_CHECKS,
      });

      outcome = result.outcome;
      nextStepCheckAt = getCaseNextStepCheckAt({
        nextCheckAts: result.nextCheckAts,
        now,
      });

      return outcome;
    } catch (error) {
      // A run that broke is tried again soon, not left for half an hour.
      nextStepCheckAt = new Date(
        now.getTime() + SECURITY_CASE_STEP_CHECK_LEASE_MINUTES * MINUTE,
      );
      throw error;
    } finally {
      /*
       * Its next moment, only while it still holds the lease: a change on
       * the case since (a tick, a playbook) has set it to now, and keeps it.
       */
      await SecurityCaseService.compareAndSetColumnsByIdWithoutHooks({
        id: securityCase.id,
        data: {
          nextStepCheckAt,
        } as unknown as PartialEntity<SecurityCase>,
        expectedData: {
          nextStepCheckAt: lease,
        } as unknown as PartialEntity<SecurityCase>,
        skipUpdateDateColumn: true,
      });
    }
  }

  private static async checkSteps(data: {
    securityCase: SecurityCase;
    now: Date;
    stage: SecurityCaseStage;
    values: ProjectSecurityCaseValues;
    isEveryStepDue: boolean;
    evidence: ((securityCase: StepCheckCase) => StepCheckEvidence) | undefined;
    checks: ReadonlyArray<StepCheck>;
  }): Promise<{ outcome: StepCheckRunOutcome; nextCheckAts: Array<Date> }> {
    const { securityCase, now, stage, values } = data;
    const projectId: ObjectID = securityCase.projectId!;
    const securityCaseId: ObjectID = securityCase.id!;

    const [matches, playbooks, runs, tasks, rows]: [
      SecurityCaseMatchesJson | null,
      Array<SecurityPlaybook>,
      Array<SecurityPlaybookRun>,
      Array<SecurityCaseTask>,
      Array<SecurityCaseStepCheck>,
    ] = await Promise.all([
      // The case's detections as OneUptime itself reads them; a failed read leaves them unknown.
      SecurityCaseMatches.build({
        projectId,
        securityCaseId,
        props: { isRoot: true },
        now,
      }).catch((error: unknown): null => {
        logger.error(
          `SecurityCaseStepCheckRunner: could not read the detections of case ${securityCaseId.toString()}:`,
        );
        logger.error(error);
        return null;
      }),
      SecurityPlaybookService.findBy({
        query: { projectId, isEnabled: true },
        select: { _id: true, name: true, steps: true },
        sort: { name: SortOrder.Ascending },
        skip: 0,
        limit: 100,
        props: { isRoot: true },
      }),
      SecurityPlaybookRunService.findBy({
        query: { projectId, securityCaseId },
        select: { _id: true, securityPlaybookId: true, status: true },
        sort: { createdAt: SortOrder.Descending },
        skip: 0,
        limit: 100,
        props: { isRoot: true },
      }),
      SecurityCaseTaskService.findBy({
        query: { projectId, securityCaseId },
        select: {
          _id: true,
          title: true,
          isDone: true,
          doneAt: true,
          responseStepKey: true,
        },
        sort: { createdAt: SortOrder.Ascending },
        skip: 0,
        limit: 200,
        props: { isRoot: true },
      }),
      SecurityCaseStepCheckService.findBy({
        query: { projectId, securityCaseId },
        select: {
          _id: true,
          stepKey: true,
          state: true,
          evidence: true,
          checkedAt: true,
          stateSince: true,
          nextCheckAt: true,
        },
        skip: 0,
        limit: 100,
        props: { isRoot: true },
      }),
    ]);

    const responseTasks: Array<ResponseTask> = readResponseTasks(tasks);
    const checks: Array<ResponseStepCheck> = readResponseStepChecks(rows);
    const containedStatus: SecurityCaseStatus | null =
      SecurityCaseStatuses.getStatusOfStage(
        values.statuses,
        SecurityCaseStage.Contained,
      );
    const planInput: ResponsePlanInput = {
      entities: readSecurityEntities(securityCase.entities),
      mitreTactics: securityCase.mitreTactics || [],
      mitreTechniques: securityCase.mitreTechniques || [],
      isAssigned: Boolean(securityCase.assignedToUserId),
      hasIncident: Boolean(securityCase.incidentId),
      stage,
      hasContainedStatus: Boolean(containedStatus),
      matches,
      playbooks: readResponsePlaybooks(playbooks),
      ...readPlaybookRuns(
        runs.map(
          (
            run: SecurityPlaybookRun,
          ): { playbookId: string; status: string } => {
            return {
              playbookId: run.securityPlaybookId?.toString() || "",
              status: run.status || "",
            };
          },
        ),
      ),
      tasks: responseTasks,
      ai: {
        suggestedPlaybookId: securityCase.aiSuggestedPlaybookId?.toString(),
        report: securityCase.aiTriageReport,
      },
      checks,
    };
    const plan: ResponsePlan = buildResponsePlan(planInput);
    const stepCase: StepCheckCase = {
      projectId,
      securityCaseId,
      createdAt: securityCase.createdAt
        ? new Date(securityCase.createdAt)
        : now,
      firstDetectedAt: securityCase.firstDetectedAt
        ? new Date(securityCase.firstDetectedAt)
        : null,
      lastDetectedAt: securityCase.lastDetectedAt
        ? new Date(securityCase.lastDetectedAt)
        : null,
      entities: planInput.entities,
      matches,
      plan,
      hasIncident: planInput.hasIncident,
    };
    const evidence: StepCheckEvidence = data.evidence
      ? data.evidence(stepCase)
      : createStepCheckEvidence({ securityCase: stepCase, now });
    const rowsByKey: Map<string, SecurityCaseStepCheck> = new Map(
      rows.map(
        (row: SecurityCaseStepCheck): [string, SecurityCaseStepCheck] => {
          return [(row.stepKey || "").trim(), row];
        },
      ),
    );
    const checksByKey: Map<string, ResponseStepCheck> = new Map(
      checks.map((check: ResponseStepCheck): [string, ResponseStepCheck] => {
        return [check.stepKey, check];
      }),
    );
    const tasksByKey: Map<string, ResponseTask> = new Map();

    for (const task of responseTasks) {
      if (!tasksByKey.has(task.responseStepKey) || task.isDone) {
        tasksByKey.set(task.responseStepKey, task);
      }
    }

    const nextCheckAts: Array<Date> = [];
    const outcome: StepCheckRunOutcome = {
      isClaimed: true,
      checkedStepKeys: [],
      regressedStepKeys: [],
      isContained: false,
    };
    const settledByKey: Map<string, ResponseStepCheck> = new Map(checksByKey);

    for (const step of plan.steps) {
      const check: StepCheck | null = getStepCheck(step.key, data.checks);

      if (!check) {
        continue;
      }

      const row: SecurityCaseStepCheck | undefined = rowsByKey.get(step.key);
      const isDue: boolean =
        data.isEveryStepDue ||
        !row ||
        !row.nextCheckAt ||
        new Date(row.nextCheckAt).getTime() <= now.getTime();

      if (!isDue) {
        nextCheckAts.push(new Date(row!.nextCheckAt!));
        continue;
      }

      const target: StepCheckTarget = {
        step,
        value: getStepValue(step),
        previous: checksByKey.get(step.key) || null,
        task: tasksByKey.get(step.key) || null,
      };
      let result: StepCheckResult | null;

      try {
        result = await check.check({
          securityCase: stepCase,
          target,
          now,
          evidence,
        });
      } catch (error) {
        // A check that breaks says it cannot tell, and is tried again soon.
        logger.error(
          `SecurityCaseStepCheckRunner: the check of ${step.key} on case ${securityCaseId.toString()} failed:`,
        );
        logger.error(error);
        result = {
          state: SecurityCaseStepCheckState.CannotTell,
          evidence: evidenceOf({
            sentence: sentence(CHECK_COULD_NOT_CHECK),
            data: { readFailed: true },
          }),
          recheckInMinutes: 5,
        };
      }

      // Not a step this check reads on this case (an incident declared, no address).
      if (!result) {
        continue;
      }

      const settled: SettledStepCheck = settleStepCheck({
        previous: target.previous,
        result,
        now,
        intervalInMinutes: check.intervalInMinutes,
      });
      const isWritten: boolean = await this.write({
        projectId,
        securityCaseId,
        stepKey: step.key,
        row,
        settled,
        now,
      });

      nextCheckAts.push(settled.nextCheckAt);

      if (!isWritten) {
        continue;
      }

      outcome.checkedStepKeys.push(step.key);
      settledByKey.set(step.key, {
        stepKey: step.key,
        state: settled.state,
        evidence: settled.evidence,
        checkedAt: now,
        stateSince: settled.stateSince,
      });

      if (settled.isNewRegression) {
        outcome.regressedStepKeys.push(step.key);
        await this.sayRegressed({
          projectId,
          securityCaseId,
          step,
          evidence: settled.evidence,
          now,
        });
      }
    }

    // Contained, once OneUptime has verified every step that contains it.
    const checkedPlan: ResponsePlan = buildResponsePlan({
      ...planInput,
      checks: Array.from(settledByKey.values()),
    });

    if (
      checkedPlan.isContainmentVerified &&
      containedStatus?.id &&
      !hasReached(stage, SecurityCaseStage.Contained) &&
      (await this.isMarkingContainedOn(projectId))
    ) {
      await SecurityCaseService.updateOneById({
        id: securityCaseId,
        data: {
          securityCaseStatusId: containedStatus.id,
        } as PartialEntity<SecurityCase>,
        miscDataProps: { [SECURITY_CASE_CONTAINED_BY_CHECKS_KEY]: true },
        props: { isRoot: true },
      });
      outcome.isContained = true;
    }

    return { outcome, nextCheckAts };
  }

  // Whether the project lets OneUptime mark a case Contained on verified steps: on unless switched off.
  private static async isMarkingContainedOn(
    projectId: ObjectID,
  ): Promise<boolean> {
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: { markSecurityCaseContainedWhenVerified: true },
      props: { isRoot: true },
    });

    return project?.markSecurityCaseContainedWhenVerified !== false;
  }

  /*
   * One step's result, written compare-and-set on when it was last checked
   * (a row of its own the first time): of two workers that checked it, one
   * writes it, and only that one says what it found.
   */
  private static async write(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    stepKey: string;
    row: SecurityCaseStepCheck | undefined;
    settled: SettledStepCheck;
    now: Date;
  }): Promise<boolean> {
    const columns: {
      state: SecurityCaseStepCheckState;
      evidence: JSONObject;
      checkedAt: Date;
      stateSince: Date;
      nextCheckAt: Date;
    } = {
      state: data.settled.state,
      evidence: data.settled.evidence as unknown as JSONObject,
      checkedAt: data.now,
      stateSince: data.settled.stateSince,
      nextCheckAt: data.settled.nextCheckAt,
    };

    if (data.row?.id) {
      return await SecurityCaseStepCheckService.compareAndSetColumnsByIdWithoutHooks(
        {
          id: data.row.id,
          data: columns as unknown as PartialEntity<SecurityCaseStepCheck>,
          expectedData: {
            checkedAt: (data.row.checkedAt || null) as unknown as Date,
          } as PartialEntity<SecurityCaseStepCheck>,
        },
      );
    }

    const check: SecurityCaseStepCheck = new SecurityCaseStepCheck();
    check.projectId = data.projectId;
    check.securityCaseId = data.securityCaseId;
    check.stepKey = data.stepKey;
    check.state = columns.state;
    check.evidence = columns.evidence;
    check.checkedAt = columns.checkedAt;
    check.stateSince = columns.stateSince;
    check.nextCheckAt = columns.nextCheckAt;

    try {
      await SecurityCaseStepCheckService.create({
        data: check,
        props: { isRoot: true },
      });
      return true;
    } catch (error) {
      // One check a step of a case: another worker wrote this one first.
      logger.debug(
        `SecurityCaseStepCheckRunner: the check of ${data.stepKey} on case ${data.securityCaseId.toString()} was written by another worker: ${String(error)}`,
      );
      return false;
    }
  }

  // A step that stopped holding: on the case's timeline, and to the people on it.
  private static async sayRegressed(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    step: ResponseStep;
    evidence: SecurityCaseStepCheckEvidence;
    now: Date;
  }): Promise<void> {
    const line: string = wordStepCheckSentence({
      sentence: data.evidence.sentence,
      translator: ENGLISH,
      writeTime: writeTimelineTime,
    });
    const stepText: string =
      data.step.aiText ||
      data.step.ruleText ||
      (typeof data.step.text.template === "string"
        ? ENGLISH.translateTemplate(
            data.step.text.template,
            data.step.text.values,
          )
        : "");

    await SecurityCaseFeedService.createSecurityCaseFeedItem({
      projectId: data.projectId,
      securityCaseId: data.securityCaseId,
      feedInfoInMarkdown: stepCheckRegressedMarkdown({ line }).toString(),
      moreInformationInMarkdown: stepText
        ? stepCheckRegressedDetailMarkdown({ step: stepText }).toString()
        : undefined,
      eventType: SecurityCaseFeedEventType.StepCheck,
      displayColor: Red500,
      postedAt: data.now,
    });

    await SecurityCaseNotifications.stepRegressed({
      projectId: data.projectId,
      securityCaseId: data.securityCaseId,
      stepKey: data.step.key,
      stepTitle: stepText,
    });
  }
}
