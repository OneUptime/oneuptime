import ProjectReferencesService from "./ProjectReferencesService";
import SecurityCaseFeedService from "./SecurityCaseFeedService";
import SecurityCaseService from "./SecurityCaseService";
import SecurityPlaybookService from "./SecurityPlaybookService";
import Model from "../../Models/DatabaseModels/SecurityPlaybookRun";
import SecurityCase from "../../Models/DatabaseModels/SecurityCase";
import { SecurityCaseFeedEventType } from "../../Models/DatabaseModels/SecurityCaseFeed";
import SecurityPlaybook from "../../Models/DatabaseModels/SecurityPlaybook";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import logger from "../Utils/Logger";
import SecurityPlaybookEngine from "../Utils/SecurityPlaybook/SecurityPlaybookEngine";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import WorkspaceSecurityPlaybookApprovalMessages from "../Utils/Workspace/WorkspaceSecurityPlaybookApprovalMessages";
import Includes from "../../Types/BaseDatabase/Includes";
import { Gray500, Indigo500 } from "../../Types/BrandColors";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONArray } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import SecurityPlaybookRunStatus, {
  isFinishedSecurityPlaybookRunStatus,
} from "../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import {
  SecurityPlaybookStep,
  parseSecurityPlaybookSteps,
} from "../../Types/SecurityPlaybook/SecurityPlaybookStep";
import {
  buildPendingStepResults,
  readStepResults,
  SecurityPlaybookStepResult,
  SecurityPlaybookTarget,
} from "../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import SecurityPlaybookTrigger from "../../Types/SecurityPlaybook/SecurityPlaybookTrigger";
import { getSecurityPlaybookAction } from "../../Types/SecurityPlaybook/SecurityPlaybookAction";
import {
  OneStepRunRead,
  isAiStepRunAction,
  isOneStepRunAction,
  readOneStepRun,
} from "../../Types/SecurityPlaybook/SecurityPlaybookOneStepRun";
import QueryHelper from "../Types/Database/QueryHelper";
import {
  playbookCancelledMarkdown,
  playbookStartedMarkdown,
} from "../../Utils/SecurityCase/SecurityCaseMarkdown";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";

// The values one of OneUptime AI's runs acts on, as its step's targets name them.
export function readAiStepRunValues(run: {
  steps?: unknown;
  stepResults?: unknown;
}): Array<string> {
  try {
    const steps: Array<SecurityPlaybookStep> = parseSecurityPlaybookSteps(
      run.steps,
    );
    const result: SecurityPlaybookStepResult | undefined = readStepResults(
      run.stepResults,
      steps,
    )[0];

    return (result?.targets || []).map(
      (target: SecurityPlaybookTarget): string => {
        return target.value;
      },
    );
  } catch {
    return [];
  }
}

export const UNFINISHED_SECURITY_PLAYBOOK_RUN_STATUSES: Array<SecurityPlaybookRunStatus> =
  [
    SecurityPlaybookRunStatus.Queued,
    SecurityPlaybookRunStatus.Running,
    SecurityPlaybookRunStatus.WaitingForApproval,
    // A Page On-Call step waits while OneUptime AI responds first (#10353).
    SecurityPlaybookRunStatus.WaitingForOneUptimeAi,
  ];

// What a one-step run from a case is started with (startOneStepRun).
export interface OneStepRunRequest {
  projectId: ObjectID;
  securityCaseId: ObjectID;
  // The person who asked for it: the run is theirs, and approved by someone else.
  userId: ObjectID;
  // One step of an action a one-step run takes (ONE_STEP_RUN_ACTIONS).
  step: SecurityPlaybookStep;
  // What it acts on, picked by the person and checked by the caller.
  targets: Array<SecurityPlaybookTarget>;
}

// What a step OneUptime AI runs on a case it works is started with (startAiStepRun, #10352).
export interface AiStepRunRequest {
  projectId: ObjectID;
  securityCaseId: ObjectID;
  // One step of an action OneUptime AI takes (AI_STEP_RUN_ACTIONS).
  step: SecurityPlaybookStep;
  // What it acts on, for an action on the case's entities: the responder's pick of the case's own.
  targets?: Array<SecurityPlaybookTarget> | undefined;
}

export class Service extends ProjectReferencesService<Model> {
  /*
   * The one-step runs startOneStepRun is creating: only those are created
   * with no playbook. Only this service adds to it, so a create through the
   * API always names a playbook.
   */
  private readonly oneStepRuns: WeakSet<Model> = new WeakSet<Model>();

  // The runs startAiStepRun is creating: OneUptime AI's, with no playbook either.
  private readonly aiStepRuns: WeakSet<Model> = new WeakSet<Model>();

  public constructor() {
    super(Model);
  }

  /*
   * A person's one-step run from a case (#10342): one containment step on
   * the targets they picked, through the engine as any run - its approval
   * (a step that cuts somebody off waits for someone else's unless the
   * step says a Security Admin let it run), its timeline, its audit and
   * its undo - with no playbook written first. The caller checks the
   * person may run it and that its targets are the case's to act on.
   */
  @CaptureSpan()
  public async startOneStepRun(data: OneStepRunRequest): Promise<Model> {
    if (!isOneStepRunAction(data.step.action)) {
      throw new BadDataException(
        `"${data.step.action}" cannot be run on its own from a case.`,
      );
    }

    // The step as a run reads it back: cleaned, and refused when it cannot run.
    const steps: Array<SecurityPlaybookStep> = parseSecurityPlaybookSteps([
      data.step,
    ]);
    const results: Array<SecurityPlaybookStepResult> =
      buildPendingStepResults(steps);

    results[0] = { ...results[0]!, targets: data.targets };

    const run: Model = new Model();
    run.projectId = data.projectId;
    run.securityCaseId = data.securityCaseId;
    run.playbookName =
      getSecurityPlaybookAction(data.step.action)?.title || data.step.action;
    run.trigger = SecurityPlaybookTrigger.Manual;
    run.triggeredByUserId = data.userId;
    run.steps = steps as unknown as JSONArray;
    run.stepResults = results as unknown as JSONArray;

    this.oneStepRuns.add(run);

    try {
      return await this.create({ data: run, props: { isRoot: true } });
    } finally {
      this.oneStepRuns.delete(run);
    }
  }

  /*
   * ONE STEP OF ONEUPTIME AI'S, ON A CASE IT WORKS (#10352): one step of an
   * action it takes (AI_STEP_RUN_ACTIONS) through the engine, as any run -
   * its approval (a step marked so waits for a person, and a containment
   * step waits unless a Security Admin let OneUptime AI contain on its own,
   * stamped on the step), its protected checks, its timeline, its audit and
   * its undo - with no playbook and no person behind it. Its trigger says
   * it is OneUptime AI's (SecurityPlaybookTrigger.OneUptimeAi), so its
   * changes read as OneUptime AI's and anyone who may approve its step may.
   * The responder decides what to run and on what
   * (Server/Utils/AI/Security/Response), and that the project lets it.
   */
  @CaptureSpan()
  public async startAiStepRun(data: AiStepRunRequest): Promise<Model> {
    if (!isAiStepRunAction(data.step.action)) {
      throw new BadDataException(
        `"${data.step.action}" is not an action OneUptime AI runs on a case.`,
      );
    }

    const steps: Array<SecurityPlaybookStep> = parseSecurityPlaybookSteps([
      data.step,
    ]);
    const results: Array<SecurityPlaybookStepResult> =
      buildPendingStepResults(steps);

    if (data.targets) {
      results[0] = { ...results[0]!, targets: data.targets };
    }

    const run: Model = new Model();
    run.projectId = data.projectId;
    run.securityCaseId = data.securityCaseId;
    run.playbookName =
      getSecurityPlaybookAction(data.step.action)?.title || data.step.action;
    run.trigger = SecurityPlaybookTrigger.OneUptimeAi;
    run.steps = steps as unknown as JSONArray;
    run.stepResults = results as unknown as JSONArray;

    this.aiStepRuns.add(run);

    try {
      return await this.create({ data: run, props: { isRoot: true } });
    } finally {
      this.aiStepRuns.delete(run);
    }
  }

  /*
   * A run names its playbook - except a one-step run from a case (#10342),
   * which has none, and which startOneStepRun alone makes: it names its
   * project and its case, as every run does. So does one of OneUptime AI's.
   */
  protected override checkRequiredFields(data: Model): Model {
    if (!this.oneStepRuns.has(data) && !this.aiStepRuns.has(data)) {
      return super.checkRequiredFields(data);
    }

    if (!data.projectId || !data.securityCaseId) {
      throw new BadDataException("A one-step run names its case.");
    }

    return data;
  }

  /*
   * Creating a run is starting one: name the case and the playbook, and the
   * run gets the playbook's steps as they are now, a pending result for each,
   * and a place in the queue. A person's run is a Manual one, whatever they
   * sent; the launcher names its own trigger.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);
    const data: Model = createBy.data;

    // A one-step run from a case (#10342), as startOneStepRun alone makes one.
    if (createBy.props.isRoot && this.oneStepRuns.has(data)) {
      return await this.readyOneStepRun(createBy);
    }

    // One of OneUptime AI's steps (#10352), as startAiStepRun alone makes one.
    if (createBy.props.isRoot && this.aiStepRuns.has(data)) {
      return await this.readyAiStepRun(createBy);
    }

    if (!data.projectId || !data.securityCaseId || !data.securityPlaybookId) {
      throw new BadDataException("Choose the case and the playbook to run.");
    }

    const playbook: SecurityPlaybook | null =
      await SecurityPlaybookService.findOneBy({
        query: {
          _id: data.securityPlaybookId,
          projectId: data.projectId,
        },
        select: {
          _id: true,
          name: true,
          steps: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!playbook) {
      throw new BadDataException("That playbook does not exist.");
    }

    const steps: Array<SecurityPlaybookStep> = parseSecurityPlaybookSteps(
      playbook.steps,
    );

    if (steps.length === 0) {
      throw new BadDataException(
        "This playbook has no steps yet. Add a step before running it.",
      );
    }

    const securityCase: SecurityCase | null =
      await SecurityCaseService.findOneBy({
        query: {
          _id: data.securityCaseId,
          projectId: data.projectId,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!securityCase) {
      throw new BadDataException("That case does not exist.");
    }

    /*
     * One unfinished run of a playbook on a case at a time: a second click
     * on Run, or a detection joining while the first run waits for approval,
     * must not suspend the same account twice.
     */
    const unfinishedRuns: number = (
      await this.countBy({
        query: {
          projectId: data.projectId,
          securityCaseId: data.securityCaseId,
          securityPlaybookId: data.securityPlaybookId,
          status: new Includes(UNFINISHED_SECURITY_PLAYBOOK_RUN_STATUSES),
        },
        props: {
          isRoot: true,
        },
      })
    ).toNumber();

    if (unfinishedRuns > 0) {
      throw new BadDataException(
        "This playbook is already running on this case. Wait for it to finish, or cancel it first.",
      );
    }

    data.playbookName = playbook.name || "";
    data.steps = steps as unknown as JSONArray;
    data.stepResults = buildPendingStepResults(steps) as unknown as JSONArray;
    data.status = SecurityPlaybookRunStatus.Queued;
    data.currentStepIndex = 0;
    data.threatIntelMatched = false;

    if (createBy.props.isRoot && data.trigger) {
      return { createBy: createBy, carryForward: undefined };
    }

    data.trigger = SecurityPlaybookTrigger.Manual;

    if (createBy.props.userId) {
      RelationIdUtil.stamp(
        data as unknown as Record<string, unknown>,
        ["triggeredByUserId", "triggeredByUser"],
        createBy.props.userId,
      );
    }

    return { createBy: createBy, carryForward: undefined };
  }

  /*
   * One of OneUptime AI's steps as it starts: queued, its step and its
   * targets as startAiStepRun gave them. One unfinished run of an action of
   * OneUptime AI's on a case at a time - on the same targets, for an
   * action on entities: a look that starts it again while it waits for
   * approval must not ask twice.
   */
  private async readyAiStepRun(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const data: Model = createBy.data;

    if (!data.projectId || !data.securityCaseId) {
      throw new BadDataException("OneUptime AI's step names its case.");
    }

    const steps: Array<SecurityPlaybookStep> = parseSecurityPlaybookSteps(
      data.steps,
    );
    const step: SecurityPlaybookStep | undefined = steps[0];

    if (steps.length !== 1 || !step || !isAiStepRunAction(step.action)) {
      throw new BadDataException(
        "OneUptime AI's run is one step of an action it takes.",
      );
    }

    const securityCase: SecurityCase | null =
      await SecurityCaseService.findOneBy({
        query: { _id: data.securityCaseId, projectId: data.projectId },
        select: { _id: true },
        props: { isRoot: true },
      });

    if (!securityCase) {
      throw new BadDataException("That case does not exist.");
    }

    const values: Set<string> = new Set(
      readAiStepRunValues(data).map((value: string): string => {
        return value.trim().toLowerCase();
      }),
    );

    const unfinished: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
        securityCaseId: data.securityCaseId,
        securityPlaybookId: QueryHelper.isNull(),
        trigger: SecurityPlaybookTrigger.OneUptimeAi,
        status: new Includes(UNFINISHED_SECURITY_PLAYBOOK_RUN_STATUSES),
      },
      select: {
        _id: true,
        steps: true,
        stepResults: true,
      },
      skip: 0,
      limit: 100,
      props: { isRoot: true },
    });

    for (const run of unfinished) {
      let other: SecurityPlaybookStep | undefined;

      try {
        other = parseSecurityPlaybookSteps(run.steps)[0];
      } catch {
        other = undefined;
      }

      if (!other || other.action !== step.action) {
        continue;
      }

      const otherValues: Array<string> = readAiStepRunValues(run);
      const isSameTarget: boolean =
        values.size === 0 ||
        otherValues.length === 0 ||
        otherValues.some((value: string): boolean => {
          return values.has(value.trim().toLowerCase());
        });

      if (isSameTarget) {
        throw new BadDataException(
          `OneUptime AI's ${getSecurityPlaybookAction(step.action)?.title || step.action} is already waiting or running on this case.`,
        );
      }
    }

    data.status = SecurityPlaybookRunStatus.Queued;
    data.currentStepIndex = 0;
    data.threatIntelMatched = false;

    return { createBy, carryForward: undefined };
  }

  /*
   * A one-step run as it starts: queued, its step and its targets as
   * startOneStepRun gave them. One unfinished one-step run of an action on
   * an address at a time: a second click on Block while the first waits
   * for approval must not ask twice.
   */
  private async readyOneStepRun(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const data: Model = createBy.data;

    if (!data.projectId || !data.securityCaseId) {
      throw new BadDataException("A one-step run names its case.");
    }

    // None of a playbook: readOneStepRun reads a run with a playbook as none.
    const read: OneStepRunRead | null = readOneStepRun(data);

    if (!read || read.values.length === 0) {
      throw new BadDataException(
        "A one-step run needs one step of an action it can take, and what it acts on.",
      );
    }

    const securityCase: SecurityCase | null =
      await SecurityCaseService.findOneBy({
        query: { _id: data.securityCaseId, projectId: data.projectId },
        select: { _id: true },
        props: { isRoot: true },
      });

    if (!securityCase) {
      throw new BadDataException("That case does not exist.");
    }

    const unfinished: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
        securityCaseId: data.securityCaseId,
        securityPlaybookId: QueryHelper.isNull(),
        status: new Includes(UNFINISHED_SECURITY_PLAYBOOK_RUN_STATUSES),
      },
      select: {
        _id: true,
        securityPlaybookId: true,
        steps: true,
        stepResults: true,
      },
      skip: 0,
      limit: 100,
      props: { isRoot: true },
    });
    const wanted: Set<string> = new Set(
      read.values.map((value: string): string => {
        return value.trim().toLowerCase();
      }),
    );

    for (const run of unfinished) {
      const other: OneStepRunRead | null = readOneStepRun(run);
      const clash: string | undefined = other?.values.find(
        (value: string): boolean => {
          return wanted.has(value.trim().toLowerCase());
        },
      );

      if (other && other.action === read.action && clash) {
        throw new BadDataException(
          `${getSecurityPlaybookAction(read.action)?.title || read.action} is already waiting or running for ${clash} on this case. Wait for it to finish, or cancel it first.`,
        );
      }
    }

    data.status = SecurityPlaybookRunStatus.Queued;
    data.currentStepIndex = 0;
    data.threatIntelMatched = false;

    return { createBy, carryForward: undefined };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (
      !createdItem.id ||
      !createdItem.projectId ||
      !createdItem.securityCaseId
    ) {
      return createdItem;
    }

    if (createdItem.securityPlaybookId) {
      await SecurityPlaybookService.atomicAddToColumnsByIdWithoutHooks({
        id: createdItem.securityPlaybookId,
        add: {
          runCount: 1,
        },
        set: {
          lastRunAt: OneUptimeDate.getCurrentDate(),
        },
      });
    }

    // A one-step run's step says what it did: no playbook started.
    if (createdItem.securityPlaybookId) {
      await SecurityCaseFeedService.createSecurityCaseFeedItem({
        projectId: createdItem.projectId,
        securityCaseId: createdItem.securityCaseId,
        feedInfoInMarkdown: playbookStartedMarkdown({
          playbookName: createdItem.playbookName || "",
          trigger: createdItem.trigger || SecurityPlaybookTrigger.Manual,
        }).toString(),
        eventType: SecurityCaseFeedEventType.PlaybookRun,
        displayColor: Indigo500,
        userId: createdItem.triggeredByUserId,
      });
    }

    try {
      await SecurityPlaybookEngine.enqueueRun(createdItem.id);
    } catch (error) {
      logger.error(
        `SecurityPlaybookRunService: could not queue run ${createdItem.id.toString()}:`,
      );
      logger.error(error);

      // The recovery sweep queues it again; say so rather than nothing.
    }

    return createdItem;
  }

  /*
   * What a person may change on a run is whether it goes on: an unfinished
   * run can be cancelled, and nothing else. Approving and rejecting a step go
   * through the run's own routes (SecurityPlaybookRunAPI), which say who
   * decided.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    if (updateBy.props.isRoot) {
      return { updateBy: updateBy, carryForward: null };
    }

    const status: unknown = updateBy.data.status;

    if (status === undefined) {
      return { updateBy: updateBy, carryForward: null };
    }

    if (status !== SecurityPlaybookRunStatus.Cancelled) {
      throw new BadDataException(
        "A run can only be cancelled. Approve or reject a step waiting for approval from its case.",
      );
    }

    const rows: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        status: true,
      },
    );

    for (const row of rows) {
      if (isFinishedSecurityPlaybookRunStatus(row.status)) {
        throw new BadDataException("This run has already finished.");
      }
    }

    return {
      updateBy,
      carryForward: rows
        .map((row: Model): string => {
          return row.id?.toString() || "";
        })
        .filter((id: string): boolean => {
          return Boolean(id);
        }),
    };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    if (
      onUpdate.updateBy.props.isRoot ||
      onUpdate.updateBy.data.status !== SecurityPlaybookRunStatus.Cancelled
    ) {
      return onUpdate;
    }

    for (const runId of updatedItemIds) {
      try {
        await this.recordCancellation({
          runId,
          userId: onUpdate.updateBy.props.userId,
        });
      } catch (error) {
        logger.error(
          `SecurityPlaybookRunService: could not record the cancellation of run ${runId.toString()}:`,
        );
        logger.error(error);
      }
    }

    return onUpdate;
  }

  // Stamps a cancelled run's end and says so on its case.
  public async recordCancellation(data: {
    runId: ObjectID;
    userId?: ObjectID | undefined;
    reasonInMarkdown?: string | undefined;
  }): Promise<void> {
    await this.updateColumnsByIdWithoutHooks({
      id: data.runId,
      data: {
        completedAt: OneUptimeDate.getCurrentDate(),
      },
    });

    const run: Model | null = await this.findOneById({
      id: data.runId,
      select: {
        projectId: true,
        securityCaseId: true,
        playbookName: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!run?.projectId || !run.securityCaseId) {
      return;
    }

    /*
     * A step that waited for approval, or was approved and had not run:
     * every copy of its message in Slack and Microsoft Teams says the run
     * was cancelled, and asks nobody any more.
     */
    WorkspaceSecurityPlaybookApprovalMessages.refreshInBackground({
      projectId: run.projectId,
      runId: data.runId,
    });

    await SecurityCaseFeedService.createSecurityCaseFeedItem({
      projectId: run.projectId,
      securityCaseId: run.securityCaseId,
      feedInfoInMarkdown: playbookCancelledMarkdown({
        playbookName: run.playbookName || "",
      }).toString(),
      moreInformationInMarkdown: data.reasonInMarkdown,
      eventType: SecurityCaseFeedEventType.PlaybookRun,
      displayColor: Gray500,
      userId: data.userId,
    });
  }
}

export default new Service();
