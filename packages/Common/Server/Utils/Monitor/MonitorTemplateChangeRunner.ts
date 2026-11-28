import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import MonitorTemplateChange from "../../../Models/DatabaseModels/MonitorTemplateChange";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../Types/BaseDatabase/Includes";
import LessThan from "../../../Types/BaseDatabase/LessThan";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../Types/JSON";
import {
  ACTIVE_MONITOR_TEMPLATE_CHANGE_STATUSES,
  MAX_MONITORS_PER_TEMPLATE_CHANGE,
  MONITOR_NOT_REACHED_FAILED,
  MONITOR_NOT_REACHED_STOPPED,
  MONITOR_TEMPLATE_CHANGE_VIEW_LINE_LIMIT,
  MonitorTemplateChangeKind,
  MonitorTemplateChangeLine,
  MonitorTemplateChangeOutcome,
  MonitorTemplateChangeProgress,
  MonitorTemplateChangeResults,
  MonitorTemplateChangeSettings,
  MonitorTemplateChangeStatus,
  MonitorTemplateChangeView,
  MonitorTemplateLinkResult,
  assertMonitorTemplateChangeSettings,
  emptyMonitorTemplateChangeProgress,
  getRetryableMonitorIds,
  isMonitorTemplateChangeActive,
  readMonitorTemplateChangeMonitorIds,
  readMonitorTemplateChangeProgress,
  readMonitorTemplateChangeResults,
  readMonitorTemplateChangeSettings,
} from "../../../Types/Monitor/MonitorTemplateChange";
import ObjectID from "../../../Types/ObjectID";
import Queue, { QueueName } from "../../Infrastructure/Queue";
import Semaphore, { SemaphoreMutex } from "../../Infrastructure/Semaphore";
import MonitorService from "../../Services/MonitorService";
import MonitorTemplateChangeService from "../../Services/MonitorTemplateChangeService";
import MonitorTemplateService from "../../Services/MonitorTemplateService";
import DatabaseRequestType from "../../Types/BaseDatabase/DatabaseRequestType";
import TablePermission from "../../Types/Database/Permissions/TablePermission";
import CallerPlan from "../Billing/CallerPlan";
import logger, { LogAttributes } from "../Logger";
import WorkspaceActionAuthorization from "../Workspace/WorkspaceActionAuthorization";

/*
 * CHANGING MANY MONITORS' TEMPLATE, ON THE SERVER (OneUptime issues #11260,
 * #11266).
 *
 *   start    the dialog asks for a change: the monitors, and what to do -
 *            link them to a template (with its settings or not), or unlink
 *            them (keeping their settings or clearing the template's
 *            criteria), and, for a template's Delete, delete it once its
 *            monitors are unlinked. What can be refused is refused here, at
 *            once and in one sentence - no right to change monitors, a
 *            template the person cannot read, a delete a rule or a policy
 *            would refuse - and the change is recorded and queued.
 *   (worker) changes each monitor, acting as the person, through the same
 *            link and unlink a single monitor goes through
 *            (MonitorTemplateService), and writes how far it got and every
 *            monitor it left out, with why, as it goes - so the dialog shows
 *            progress anyone can trust, and a person who closed it sees
 *            where the change stands when they come back.
 *   stop     stops it before its next monitor; what it changed stays.
 *   retry    a new change of the monitors that failed or were not reached,
 *            and only those. Nothing is done twice: a monitor linked to the
 *            template already, or linked to none, is as asked.
 *
 * ONE CHANGE OF A PROJECT RUNS AT A TIME, as a project's imports do
 * (DiscoveryImportRunner): the worker's job is "run this project's
 * changes", queued once per project, run under the project's lock, oldest
 * change first. Every monitor's write goes through MonitorService as the
 * person, so a change of 10,000 monitors is 10,000 ordinary writes - the
 * permission, the label scope and every check of each - at the pace one
 * worker makes them, with the project's database seeing one change at a
 * time.
 *
 * AS THE PERSON. Each monitor is changed with the person's own permissions,
 * read from the database at the time and again every half a minute, so
 * someone who lost the right to change monitors half-way stops changing
 * them half-way. A monitor they may not change is left out, with why.
 */

export const MONITOR_TEMPLATE_CHANGE_JOB: string =
  "MonitorTemplate:RunTemplateChanges";

// The worker's limit for one job; a job hands over to a fresh one before it.
export const MONITOR_TEMPLATE_CHANGE_JOB_TIMEOUT_MS: number = 60 * 60 * 1000;

/*
 * How long one job works before it queues a fresh job to carry on and ends,
 * well inside the worker's limit, so a long change is never killed mid-way.
 */
export const MONITOR_TEMPLATE_CHANGE_JOB_BUDGET_MS: number = 45 * 60 * 1000;

/*
 * A Running change that has written nothing for this long has lost its
 * worker (a deploy, a crash): the sweep picks it up again where it stopped.
 * A healthy one writes every couple of seconds.
 */
export const MONITOR_TEMPLATE_CHANGE_STALE_RUNNING_MS: number = 5 * 60 * 1000;

// A Queued change whose job never ran is queued again after this long.
export const MONITOR_TEMPLATE_CHANGE_STALE_QUEUED_MS: number = 2 * 60 * 1000;

/*
 * How many times one change is picked up again before it is failed instead:
 * a change that kills its worker every time it runs must not do it for ever.
 */
export const MAX_MONITOR_TEMPLATE_CHANGE_RESUMES: number = 3;

// A change still waiting to start after this long is failed.
export const MONITOR_TEMPLATE_CHANGE_MAX_QUEUED_MS: number = 6 * 60 * 60 * 1000;

// Progress is written at most this often while monitors are changed.
export const MONITOR_TEMPLATE_CHANGE_FLUSH_INTERVAL_MS: number = 1500;

// Whether someone asked the change to stop is read at most this often.
export const MONITOR_TEMPLATE_CHANGE_STOP_CHECK_INTERVAL_MS: number = 1500;

/*
 * How long the person's permissions are trusted before they are read again,
 * so a permission taken away during a change is held to within this long.
 */
export const MONITOR_TEMPLATE_CHANGE_PERMISSION_REFRESH_MS: number = 30 * 1000;

/*
 * Monitors that may fail with the same reason, one after another and with
 * none changed, before the change stops trying: a template whose criteria
 * name a status that no longer exists fails every monitor the same way. The
 * rest are left not reached, so retrying them after the cause is fixed is
 * one press.
 */
export const MAX_CONSECUTIVE_IDENTICAL_CHANGE_FAILURES: number = 10;

// The longest reason a line keeps.
export const MAX_MONITOR_TEMPLATE_CHANGE_REASON_LENGTH: number = 500;

// Why a monitor was not reached: the shared reasons, worded in every language.
export { MONITOR_NOT_REACHED_FAILED, MONITOR_NOT_REACHED_STOPPED };

const LOCK_NAMESPACE: string = "MonitorTemplateChange";

// Long enough for one monitor's write; a dead holder lets go after this.
const PROJECT_LOCK_TIMEOUT_MS: number = 2 * 60 * 1000;

// How many of the template's monitors one read lists, for a change of them all.
const LINKED_MONITORS_READ_PAGE: number = LIMIT_MAX;

export type MonitorTemplateChangeFinish = "done" | "stopped" | "handover";

const WHITESPACE_RUNS: RegExp = /\s+/g;

function toText(error: unknown): string {
  const message: string =
    error instanceof Error ? error.message || "" : String(error ?? "");

  const text: string = message.replace(WHITESPACE_RUNS, " ").trim();

  return (
    text ||
    "The monitor could not be changed. Try again, or ask a Project Admin to check the server's logs."
  ).substring(0, MAX_MONITOR_TEMPLATE_CHANGE_REASON_LENGTH);
}

/*
 * A refusal says what to do and would say it again on a retry: the monitor
 * is left out (Skipped). Anything else might not happen again (Failed).
 */
function isRefusal(error: unknown): boolean {
  return (
    error instanceof BadDataException ||
    error instanceof NotAuthorizedException ||
    error instanceof PaymentRequiredException
  );
}

function isRefusalOfThePerson(error: unknown): boolean {
  return (
    error instanceof NotAuthorizedException ||
    error instanceof PaymentRequiredException
  );
}

// What a worker holds while it changes one change's monitors.
interface ChangeRunState {
  row: MonitorTemplateChange;
  projectId: ObjectID;
  userId: ObjectID;
  props: DatabaseCommonInteractionProps;
  propsReadAt: number;
  settings: MonitorTemplateChangeSettings;
  template: MonitorTemplate | null;
  monitorIds: Array<string>;
  results: MonitorTemplateChangeResults;
  progress: MonitorTemplateChangeProgress;
  lastFlushAt: number;
  lastStopCheckAt: number;
  lastFailureReason: string;
  consecutiveFailures: number;
}

const CHANGE_SELECT: { [key: string]: boolean } = {
  _id: true,
  projectId: true,
  monitorTemplateId: true,
  monitorTemplateName: true,
  status: true,
  settings: true,
  monitorIds: true,
  results: true,
  progress: true,
  error: true,
  stopRequestedAt: true,
  resumeCount: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
  startedAt: true,
  completedAt: true,
};

export default class MonitorTemplateChangeRunner {
  /*
   * The clock the runner reads for its write cadence, its permission
   * refreshes and its time budget. A seam for tests.
   */
  public static now: () => number = (): number => {
    return Date.now();
  };

  // ---- Asking for a change.

  /*
   * Record a change and queue it. `monitorIds` are the monitors picked; or,
   * with `allLinkedToTemplate`, every monitor linked to the template that
   * the person may read - a template's Delete, which clears its criteria
   * from every one of them before it deletes it.
   */
  public static async start(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    monitorTemplateId: unknown;
    settings: unknown;
    monitorIds: unknown;
    allLinkedToTemplate?: unknown;
  }): Promise<MonitorTemplateChange> {
    const userId: ObjectID | undefined = data.props.userId;

    if (!userId) {
      throw new NotAuthorizedException(
        "Changing monitors' template acts as the person who asks for it, so it needs a person signed in to the project.",
      );
    }

    const settings: MonitorTemplateChangeSettings =
      readMonitorTemplateChangeSettings(data.settings);

    const templateId: ObjectID | null = this.readOptionalId(
      data.monitorTemplateId,
      "The template was not found. Reload the page, then try again.",
    );

    assertMonitorTemplateChangeSettings({
      settings: settings,
      hasTemplate: Boolean(templateId),
    });

    this.assertCanChangeMonitors(data.props);

    if (settings.deleteTemplateWhenDone) {
      this.assertCanDeleteTemplates(data.props);
    }

    const template: MonitorTemplate | null = templateId
      ? await MonitorTemplateService.readTemplateToLinkOrUnlink({
          monitorTemplateId: templateId,
          props: data.props,
        })
      : null;

    if (
      template?.projectId &&
      template.projectId.toString() !== data.projectId.toString()
    ) {
      throw new BadDataException(
        "The template was not found. Reload the page, then try again.",
      );
    }

    if (template && settings.deleteTemplateWhenDone) {
      // A delete the template's rules or policies would refuse: said now.
      await MonitorTemplateService.assertNothingProvisionsFrom(template);
    }

    const monitorIds: Array<string> =
      data.allLinkedToTemplate === true && template
        ? await this.readLinkedMonitorIds({
            projectId: data.projectId,
            monitorTemplateId: template.id!,
            props: data.props,
          })
        : this.readMonitorIds(data.monitorIds);

    if (monitorIds.length === 0 && !settings.deleteTemplateWhenDone) {
      throw new BadDataException(
        "Select the monitors to change, then try again.",
      );
    }

    return await this.record({
      projectId: data.projectId,
      userId: userId,
      settings: settings,
      template: template,
      monitorIds: monitorIds,
      retryOfChangeId: null,
    });
  }

  /*
   * Try again what a change did not do: a new change of its failed and
   * unreached monitors, with its settings. Anyone who may change monitors
   * may retry one, as anyone may stop one.
   */
  public static async retry(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    changeId: ObjectID;
  }): Promise<MonitorTemplateChange> {
    const userId: ObjectID | undefined = data.props.userId;

    if (!userId) {
      throw new NotAuthorizedException(
        "Changing monitors' template acts as the person who asks for it, so it needs a person signed in to the project.",
      );
    }

    this.assertCanChangeMonitors(data.props);

    const row: MonitorTemplateChange = await this.findChange({
      changeId: data.changeId,
      projectId: data.projectId,
    });

    if (isMonitorTemplateChangeActive(row.status)) {
      throw new BadDataException(
        "This change is still running. Wait for it to finish, or stop it, then retry what it left.",
      );
    }

    const settings: MonitorTemplateChangeSettings =
      readMonitorTemplateChangeSettings(row.settings);

    if (settings.deleteTemplateWhenDone) {
      this.assertCanDeleteTemplates(data.props);
    }

    const monitorIds: Array<string> = getRetryableMonitorIds(
      readMonitorTemplateChangeResults(row.results),
    );

    const template: MonitorTemplate | null = row.monitorTemplateId
      ? await MonitorTemplateService.readTemplateToLinkOrUnlink({
          monitorTemplateId: row.monitorTemplateId,
          props: data.props,
        })
      : null;

    if (monitorIds.length === 0 && !settings.deleteTemplateWhenDone) {
      throw new BadDataException(
        "Nothing in this change failed or was left out, so there is nothing to retry.",
      );
    }

    if (template && settings.deleteTemplateWhenDone) {
      await MonitorTemplateService.assertNothingProvisionsFrom(template);
    }

    return await this.record({
      projectId: data.projectId,
      userId: userId,
      settings: settings,
      template: template,
      monitorIds: monitorIds,
      retryOfChangeId: row.id!,
    });
  }

  /*
   * Stop a change. A queued one stops at once; a running one stops before
   * its next monitor, within a couple of seconds. What it changed stays.
   */
  public static async stop(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    changeId: ObjectID;
  }): Promise<MonitorTemplateChange> {
    this.assertCanChangeMonitors(data.props);

    const row: MonitorTemplateChange = await this.findChange({
      changeId: data.changeId,
      projectId: data.projectId,
    });

    if (!isMonitorTemplateChangeActive(row.status)) {
      return row;
    }

    if (row.status === MonitorTemplateChangeStatus.Queued) {
      const monitorIds: Array<string> = readMonitorTemplateChangeMonitorIds(
        row.monitorIds,
      );
      const results: MonitorTemplateChangeResults =
        readMonitorTemplateChangeResults(row.results);
      const progress: MonitorTemplateChangeProgress =
        readMonitorTemplateChangeProgress(row.progress);

      this.markNotReached({
        monitorIds: monitorIds,
        results: results,
        progress: progress,
        reason: MONITOR_NOT_REACHED_STOPPED,
      });

      await MonitorTemplateChangeService.updateOneById({
        id: row.id!,
        data: {
          status: MonitorTemplateChangeStatus.Stopped,
          stopRequestedAt: new Date(),
          completedAt: new Date(),
          results: results as never,
          progress: progress as never,
        },
        props: { isRoot: true },
      });
    } else {
      await MonitorTemplateChangeService.updateOneById({
        id: row.id!,
        data: {
          stopRequestedAt: new Date(),
        },
        props: { isRoot: true },
      });
    }

    return await this.findChange({
      changeId: data.changeId,
      projectId: data.projectId,
    });
  }

  private static async record(data: {
    projectId: ObjectID;
    userId: ObjectID;
    settings: MonitorTemplateChangeSettings;
    template: MonitorTemplate | null;
    monitorIds: Array<string>;
    retryOfChangeId: ObjectID | null;
  }): Promise<MonitorTemplateChange> {
    const row: MonitorTemplateChange = new MonitorTemplateChange();
    row.projectId = data.projectId;
    row.status = MonitorTemplateChangeStatus.Queued;
    row.settings = data.settings as unknown as JSONObject;
    row.monitorIds = data.monitorIds;
    row.results = {
      processedCount: 0,
      lines: [],
    } as unknown as JSONObject;
    row.progress = emptyMonitorTemplateChangeProgress(
      data.monitorIds.length,
    ) as unknown as JSONObject;
    row.createdByUserId = data.userId;
    row.resumeCount = 0;

    if (data.template?.id) {
      row.monitorTemplateId = data.template.id;
    }

    if (data.template?.templateName) {
      row.monitorTemplateName = data.template.templateName.substring(0, 100);
    }

    if (data.retryOfChangeId) {
      row.retryOfChangeId = data.retryOfChangeId;
    }

    const created: MonitorTemplateChange =
      await MonitorTemplateChangeService.create({
        data: row,
        props: { isRoot: true },
      });

    await this.enqueue(data.projectId);

    return created;
  }

  /*
   * The monitors linked to the template that the person may read, oldest
   * first: what a template's Delete clears. One the person may not read
   * stays linked, and keeps the template from being deleted (complete).
   */
  private static async readLinkedMonitorIds(data: {
    projectId: ObjectID;
    monitorTemplateId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<string>> {
    const ids: Array<string> = [];

    for (let skip: number = 0; ; skip += LINKED_MONITORS_READ_PAGE) {
      const monitors: Array<Monitor> = await MonitorService.findBy({
        query: {
          projectId: data.projectId,
          monitorTemplateId: data.monitorTemplateId,
        },
        select: { _id: true },
        sort: { createdAt: SortOrder.Ascending, _id: SortOrder.Ascending },
        limit: LINKED_MONITORS_READ_PAGE,
        skip: skip,
        props: data.props,
      });

      for (const monitor of monitors) {
        if (monitor.id) {
          ids.push(monitor.id.toString());
        }
      }

      if (monitors.length < LINKED_MONITORS_READ_PAGE) {
        return ids;
      }
    }
  }

  /*
   * The monitors picked: ids, each once, in the order sent. Refused when
   * there are more than one change takes.
   */
  public static readMonitorIds(value: unknown): Array<string> {
    if (!Array.isArray(value)) {
      throw new BadDataException(
        "Select the monitors to change, then try again.",
      );
    }

    const ids: Array<string> = [];
    const seen: Set<string> = new Set<string>();

    for (const item of value) {
      if (typeof item !== "string" || !ObjectID.isValidUUID(item.trim())) {
        throw new BadDataException(
          "One of the selected monitors was not recognised. Reload the page, select the monitors again, then try again.",
        );
      }

      const id: string = item.trim();
      const key: string = id.toLowerCase();

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      ids.push(id);
    }

    if (ids.length > MAX_MONITORS_PER_TEMPLATE_CHANGE) {
      throw new BadDataException(
        `One change takes at most ${MAX_MONITORS_PER_TEMPLATE_CHANGE} monitors, and ${ids.length} were selected. Narrow the list with a filter, change those, then change the rest.`,
      );
    }

    return ids;
  }

  private static readOptionalId(
    value: unknown,
    message: string,
  ): ObjectID | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    if (typeof value !== "string" || !ObjectID.isValidUUID(value.trim())) {
      throw new BadDataException(message);
    }

    return new ObjectID(value.trim());
  }

  // ---- Permissions.

  public static assertCanChangeMonitors(
    props: DatabaseCommonInteractionProps,
  ): void {
    try {
      TablePermission.checkTableLevelPermissions(
        Monitor,
        props,
        DatabaseRequestType.Update,
      );
    } catch (error) {
      if (isRefusalOfThePerson(error)) {
        throw new NotAuthorizedException(
          "You may not edit monitors in this project, so you cannot change their template. Ask a Project Owner or Project Admin.",
        );
      }

      throw error;
    }
  }

  public static assertCanSeeChanges(
    props: DatabaseCommonInteractionProps,
  ): void {
    try {
      TablePermission.checkTableLevelPermissions(
        Monitor,
        props,
        DatabaseRequestType.Read,
      );
    } catch (error) {
      if (isRefusalOfThePerson(error)) {
        throw new NotAuthorizedException(
          "You may not see this project's monitors, so you cannot see changes of their template.",
        );
      }

      throw error;
    }
  }

  private static assertCanDeleteTemplates(
    props: DatabaseCommonInteractionProps,
  ): void {
    try {
      TablePermission.checkTableLevelPermissions(
        MonitorTemplate,
        props,
        DatabaseRequestType.Delete,
      );
    } catch (error) {
      if (isRefusalOfThePerson(error)) {
        throw new NotAuthorizedException(
          "You may not delete monitor templates in this project. Ask a Project Owner or Project Admin.",
        );
      }

      throw error;
    }
  }

  // ---- The worker's side.

  /*
   * Run the project's changes, oldest first, until none is waiting. Called
   * by the queue job; returns when there is nothing left to do, or when the
   * job's time is up (having queued a fresh job to carry on).
   */
  public static async runProjectChanges(projectId: ObjectID): Promise<void> {
    let lock: SemaphoreMutex;

    try {
      lock = await Semaphore.lock({
        namespace: LOCK_NAMESPACE,
        key: projectId.toString(),
        lockTimeout: PROJECT_LOCK_TIMEOUT_MS,
        acquireTimeout: 1000,
        acquireAttemptsLimit: 1,
      });
    } catch (error) {
      /*
       * Another job holds the project: it runs every change that is
       * waiting, this one's included, and the sweep re-queues anything left
       * behind.
       */
      logger.debug(
        `Monitor template change: project ${projectId.toString()} is already being changed: ${error}`,
      );
      return;
    }

    const jobStartedAt: number = this.now();

    try {
      for (;;) {
        const next: MonitorTemplateChange | null =
          await this.findNextChange(projectId);

        if (!next) {
          return;
        }

        const finish: MonitorTemplateChangeFinish = await this.processChange({
          changeId: next.id!,
          deadline: jobStartedAt + MONITOR_TEMPLATE_CHANGE_JOB_BUDGET_MS,
        });

        if (finish === "handover") {
          await this.enqueue(projectId);
          return;
        }
      }
    } finally {
      try {
        await Semaphore.release(lock);
      } catch {
        logger.error(
          "Monitor template change: a project lock could not be released and will expire on its own.",
        );
      }
    }
  }

  /*
   * Change one change's monitors that are not done yet. Picks up where an
   * earlier worker stopped: a monitor dealt with is not touched again.
   */
  public static async processChange(data: {
    changeId: ObjectID;
    deadline: number;
  }): Promise<MonitorTemplateChangeFinish> {
    const row: MonitorTemplateChange | null =
      await MonitorTemplateChangeService.findOneById({
        id: data.changeId,
        select: CHANGE_SELECT as never,
        props: { isRoot: true },
      });

    if (!row || !row.projectId || !isMonitorTemplateChangeActive(row.status)) {
      return "done";
    }

    let state: ChangeRunState;

    try {
      state = await this.prepare(row);
    } catch (error) {
      await this.failChange(row, this.describeStartFailure(error));
      return "done";
    }

    if (row.status === MonitorTemplateChangeStatus.Queued) {
      await MonitorTemplateChangeService.updateOneById({
        id: row.id!,
        data: {
          status: MonitorTemplateChangeStatus.Running,
          startedAt: new Date(),
        },
        props: { isRoot: true },
      });
    }

    const logAttributes: LogAttributes = {
      projectId: state.projectId.toString(),
    } as LogAttributes;

    while (state.results.processedCount < state.monitorIds.length) {
      if (this.now() >= data.deadline) {
        await this.flush(state, true);
        return "handover";
      }

      if (await this.isStopRequested(state)) {
        this.markNotReached({
          monitorIds: state.monitorIds,
          results: state.results,
          progress: state.progress,
          reason: MONITOR_NOT_REACHED_STOPPED,
        });
        await this.complete(state, MonitorTemplateChangeStatus.Stopped);
        return "stopped";
      }

      try {
        await this.refreshPropsIfDue(state);
      } catch (error) {
        this.markNotReached({
          monitorIds: state.monitorIds,
          results: state.results,
          progress: state.progress,
          reason: MONITOR_NOT_REACHED_FAILED,
        });
        await this.failChange(state.row, this.describeStartFailure(error), {
          results: state.results,
          progress: state.progress,
        });
        return "done";
      }

      const monitorId: string =
        state.monitorIds[state.results.processedCount]!;

      try {
        await this.changeMonitor(state, monitorId);
      } catch (error) {
        // changeMonitor settles its own failures; this one is unexpected.
        logger.error(
          `Monitor template change ${state.row.id?.toString()}: unexpected failure changing monitor ${monitorId}: ${error}`,
          logAttributes,
        );

        this.recordLine(state, {
          monitorId: monitorId,
          outcome: MonitorTemplateChangeOutcome.Failed,
          reason: toText(error),
        });
      }

      state.results.processedCount++;
      state.progress.processed = state.results.processedCount;

      if (this.isSystemicallyFailing(state)) {
        this.markNotReached({
          monitorIds: state.monitorIds,
          results: state.results,
          progress: state.progress,
          reason: MONITOR_NOT_REACHED_FAILED,
        });
        await this.failChange(
          state.row,
          `${MAX_CONSECUTIVE_IDENTICAL_CHANGE_FAILURES} monitors in a row could not be changed, each for the same reason, so the change stopped. Fix it, then retry: ${state.lastFailureReason}`,
          { results: state.results, progress: state.progress },
        );
        return "done";
      }

      await this.flush(state, false);
    }

    if (state.settings.deleteTemplateWhenDone) {
      await this.deleteTemplateIfUnlinked(state);
    }

    await this.complete(state, MonitorTemplateChangeStatus.Completed);

    return "done";
  }

  /*
   * One monitor, through the link or the unlink a single monitor goes
   * through, as the person. What happened is counted, or lined with why.
   */
  private static async changeMonitor(
    state: ChangeRunState,
    monitorId: string,
  ): Promise<void> {
    if (!ObjectID.isValidUUID(monitorId)) {
      this.recordLine(state, {
        monitorId: monitorId,
        outcome: MonitorTemplateChangeOutcome.Skipped,
        reason:
          "This monitor was not recognised. Reload the page, select the monitors again, then try again.",
      });
      return;
    }

    let result: MonitorTemplateLinkResult;

    try {
      result =
        state.settings.kind === MonitorTemplateChangeKind.Link
          ? await MonitorTemplateService.linkMonitor({
              monitorTemplateId: state.template!.id!,
              monitorId: new ObjectID(monitorId),
              props: state.props,
              applyTemplateSettings: state.settings.applyTemplateSettings,
              template: state.template!,
            })
          : await MonitorTemplateService.unlinkMonitor({
              ...(state.template?.id
                ? { monitorTemplateId: state.template.id }
                : {}),
              monitorId: new ObjectID(monitorId),
              props: state.props,
              clearTemplateSettings: state.settings.clearTemplateSettings,
              ...(state.template
                ? { templateName: state.template.templateName || "" }
                : {}),
            });
    } catch (error) {
      const reason: string = toText(error);

      this.recordLine(state, {
        monitorId: monitorId,
        monitorName: await this.readMonitorNameAsPerson(state, monitorId),
        outcome: isRefusal(error)
          ? MonitorTemplateChangeOutcome.Skipped
          : MonitorTemplateChangeOutcome.Failed,
        reason: reason,
      });

      return;
    }

    state.consecutiveFailures = 0;
    state.lastFailureReason = "";

    if (result.outcome === MonitorTemplateChangeOutcome.Changed) {
      state.progress.changed++;
    } else {
      state.progress.unchanged++;
    }

    state.progress.resolvedIncidents += result.resolvedIncidentCount;
    state.progress.resolvedAlerts += result.resolvedAlertCount;
  }

  // A monitor's name for its line, when the person may read it.
  private static async readMonitorNameAsPerson(
    state: ChangeRunState,
    monitorId: string,
  ): Promise<string | undefined> {
    try {
      const monitor: Monitor | null = await MonitorService.findOneById({
        id: new ObjectID(monitorId),
        select: { _id: true, name: true },
        props: state.props,
      });

      return monitor?.name || undefined;
    } catch {
      return undefined;
    }
  }

  private static recordLine(
    state: ChangeRunState,
    line: MonitorTemplateChangeLine,
  ): void {
    state.results.lines.push({
      ...line,
      reason: line.reason.substring(
        0,
        MAX_MONITOR_TEMPLATE_CHANGE_REASON_LENGTH,
      ),
    });

    if (line.outcome === MonitorTemplateChangeOutcome.Skipped) {
      state.progress.skipped++;
      return;
    }

    if (line.outcome === MonitorTemplateChangeOutcome.NotReached) {
      state.progress.notReached++;
      return;
    }

    state.progress.failed++;

    if (line.reason === state.lastFailureReason) {
      state.consecutiveFailures++;
    } else {
      state.lastFailureReason = line.reason;
      state.consecutiveFailures = 1;
    }
  }

  /*
   * The same failure, monitor after monitor, before anything changed: the
   * change itself is what fails (MAX_CONSECUTIVE_IDENTICAL_CHANGE_FAILURES).
   */
  private static isSystemicallyFailing(state: ChangeRunState): boolean {
    return (
      state.progress.changed === 0 &&
      state.consecutiveFailures >= MAX_CONSECUTIVE_IDENTICAL_CHANGE_FAILURES
    );
  }

  /*
   * deleteTemplateWhenDone: the template goes once nothing is linked to it,
   * deleted as the person. A monitor still linked - one the person may not
   * read or change, or one linked meanwhile - keeps it, and the summary
   * says so: the template's Delete would otherwise unlink it with its
   * criteria still on it, which is not what the person chose.
   */
  private static async deleteTemplateIfUnlinked(
    state: ChangeRunState,
  ): Promise<void> {
    const templateId: ObjectID | undefined = state.row.monitorTemplateId;

    if (!templateId) {
      return;
    }

    const stillLinked: number = (
      await MonitorService.countBy({
        query: {
          projectId: state.projectId,
          monitorTemplateId: templateId,
        },
        props: { isRoot: true },
      })
    ).toNumber();

    if (stillLinked > 0) {
      state.results.templateStillLinkedCount = stillLinked;
      return;
    }

    try {
      await MonitorTemplateService.deleteOneById({
        id: templateId,
        props: state.props,
      });

      state.results.isTemplateDeleted = true;
    } catch (error) {
      state.results.templateDeleteError = toText(error);
    }
  }

  // Every monitor not dealt with yet is listed as not reached, with why.
  public static markNotReached(data: {
    monitorIds: Array<string>;
    results: MonitorTemplateChangeResults;
    progress: MonitorTemplateChangeProgress;
    reason: string;
  }): void {
    for (
      let index: number = data.results.processedCount;
      index < data.monitorIds.length;
      index++
    ) {
      data.results.lines.push({
        monitorId: data.monitorIds[index]!,
        outcome: MonitorTemplateChangeOutcome.NotReached,
        reason: data.reason,
      });
      data.progress.notReached++;
    }

    data.results.processedCount = data.monitorIds.length;
    data.progress.processed = data.monitorIds.length;
  }

  /*
   * Picks up changes a dead worker left behind, re-queues ones whose job
   * never ran, and fails ones that cannot go on. Called on a schedule.
   */
  public static async sweep(now: Date = new Date()): Promise<void> {
    const stale: Array<MonitorTemplateChange> =
      await MonitorTemplateChangeService.findBy({
        query: {
          status: new Includes([...ACTIVE_MONITOR_TEMPLATE_CHANGE_STATUSES]),
          updatedAt: new LessThan(
            new Date(now.getTime() - MONITOR_TEMPLATE_CHANGE_STALE_QUEUED_MS),
          ),
        },
        select: {
          _id: true,
          projectId: true,
          status: true,
          resumeCount: true,
          createdAt: true,
          updatedAt: true,
          monitorIds: true,
          results: true,
          progress: true,
        },
        sort: { createdAt: SortOrder.Ascending },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });

    const projectsToRun: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (const row of stale) {
      if (!row.id || !row.projectId) {
        continue;
      }

      const updatedAt: number = row.updatedAt
        ? new Date(row.updatedAt).getTime()
        : 0;
      const createdAt: number = row.createdAt
        ? new Date(row.createdAt).getTime()
        : 0;

      if (row.status === MonitorTemplateChangeStatus.Running) {
        if (
          now.getTime() - updatedAt <
          MONITOR_TEMPLATE_CHANGE_STALE_RUNNING_MS
        ) {
          continue;
        }

        if ((row.resumeCount || 0) >= MAX_MONITOR_TEMPLATE_CHANGE_RESUMES) {
          await this.failChange(
            row,
            "The change stopped before it finished, more often than it is picked up again. What it changed is kept: retry the monitors it did not reach.",
          );
          continue;
        }

        await MonitorTemplateChangeService.updateOneById({
          id: row.id,
          data: { resumeCount: (row.resumeCount || 0) + 1 },
          props: { isRoot: true },
        });

        projectsToRun.set(row.projectId.toString(), row.projectId);
        continue;
      }

      // Queued.
      if (now.getTime() - createdAt > MONITOR_TEMPLATE_CHANGE_MAX_QUEUED_MS) {
        await this.failChange(
          row,
          "The change waited too long to start. Nothing was changed: start it again.",
        );
        continue;
      }

      projectsToRun.set(row.projectId.toString(), row.projectId);
    }

    for (const projectId of projectsToRun.values()) {
      try {
        await this.enqueue(projectId);
      } catch (error) {
        logger.error(
          `Monitor template change: could not queue project ${projectId.toString()} again: ${error}`,
        );
      }
    }
  }

  // ---- Reading changes, for the API.

  public static async findChange(data: {
    changeId: ObjectID;
    projectId: ObjectID;
  }): Promise<MonitorTemplateChange> {
    const row: MonitorTemplateChange | null =
      await MonitorTemplateChangeService.findOneBy({
        query: {
          _id: data.changeId.toString(),
          projectId: data.projectId,
        },
        select: CHANGE_SELECT as never,
        props: { isRoot: true },
      });

    if (!row) {
      throw new BadDataException(
        "This change was not found. Reload the page, then try again.",
      );
    }

    return row;
  }

  // The template's changes that have not finished, newest first.
  public static async findActiveChangesOfTemplate(data: {
    projectId: ObjectID;
    monitorTemplateId: ObjectID;
  }): Promise<Array<MonitorTemplateChange>> {
    return await MonitorTemplateChangeService.findBy({
      query: {
        projectId: data.projectId,
        monitorTemplateId: data.monitorTemplateId,
        status: new Includes([...ACTIVE_MONITOR_TEMPLATE_CHANGE_STATUSES]),
      },
      select: CHANGE_SELECT as never,
      sort: { createdAt: SortOrder.Descending },
      limit: 5,
      skip: 0,
      props: { isRoot: true },
    });
  }

  /*
   * A change as the Dashboard draws it: its counts, and the monitors worth
   * a line - left out, failed, not reached - up to
   * MONITOR_TEMPLATE_CHANGE_VIEW_LINE_LIMIT, or every one with `allLines`.
   */
  public static toView(data: {
    row: MonitorTemplateChange;
    allLines?: boolean | undefined;
  }): MonitorTemplateChangeView {
    const results: MonitorTemplateChangeResults =
      readMonitorTemplateChangeResults(data.row.results);
    const lines: Array<MonitorTemplateChangeLine> = data.allLines
      ? results.lines
      : results.lines.slice(0, MONITOR_TEMPLATE_CHANGE_VIEW_LINE_LIMIT);

    return {
      id: data.row.id!.toString(),
      status: data.row.status || MonitorTemplateChangeStatus.Queued,
      settings: readMonitorTemplateChangeSettings(data.row.settings),
      ...(data.row.monitorTemplateId
        ? { monitorTemplateId: data.row.monitorTemplateId.toString() }
        : {}),
      ...(data.row.monitorTemplateName
        ? { monitorTemplateName: data.row.monitorTemplateName }
        : {}),
      progress: readMonitorTemplateChangeProgress(data.row.progress),
      lines: lines,
      isLinesTruncated: lines.length < results.lines.length,
      ...(data.row.error ? { error: data.row.error } : {}),
      isStopRequested: Boolean(data.row.stopRequestedAt),
      retryableCount: getRetryableMonitorIds(results).length,
      isTemplateDeleted: results.isTemplateDeleted === true,
      ...(results.templateStillLinkedCount
        ? { templateStillLinkedCount: results.templateStillLinkedCount }
        : {}),
      ...(results.templateDeleteError
        ? { templateDeleteError: results.templateDeleteError }
        : {}),
      ...(data.row.createdAt
        ? { createdAt: new Date(data.row.createdAt).toISOString() }
        : {}),
      ...(data.row.startedAt
        ? { startedAt: new Date(data.row.startedAt).toISOString() }
        : {}),
      ...(data.row.completedAt
        ? { completedAt: new Date(data.row.completedAt).toISOString() }
        : {}),
    };
  }

  // ---- Internals.

  private static async enqueue(projectId: ObjectID): Promise<void> {
    await Queue.addJob(
      QueueName.Worker,
      `monitor-template-change-${projectId.toString()}-${ObjectID.generate().toString()}`,
      MONITOR_TEMPLATE_CHANGE_JOB,
      { projectId: projectId.toString() },
      {
        attempts: 1,
        skipExistenceCheck: true,
        deduplication: {
          id: `monitor-template-change-${projectId.toString()}`,
          keepLastIfActive: true,
        },
      },
    );
  }

  private static async findNextChange(
    projectId: ObjectID,
  ): Promise<MonitorTemplateChange | null> {
    const running: MonitorTemplateChange | null =
      await MonitorTemplateChangeService.findOneBy({
        query: {
          projectId: projectId,
          status: MonitorTemplateChangeStatus.Running,
        },
        select: { _id: true },
        sort: { createdAt: SortOrder.Ascending },
        props: { isRoot: true },
      });

    if (running) {
      return running;
    }

    return await MonitorTemplateChangeService.findOneBy({
      query: {
        projectId: projectId,
        status: MonitorTemplateChangeStatus.Queued,
      },
      select: { _id: true },
      sort: { createdAt: SortOrder.Ascending },
      props: { isRoot: true },
    });
  }

  /*
   * What a worker needs to change the monitors: the person's permissions,
   * read now, and the template, read as them.
   */
  private static async prepare(
    row: MonitorTemplateChange,
  ): Promise<ChangeRunState> {
    if (!row.createdByUserId) {
      throw new BadDataException(
        "The person who asked for this change is no longer in OneUptime, so it was stopped. What it changed is kept.",
      );
    }

    const projectId: ObjectID = row.projectId!;
    const props: DatabaseCommonInteractionProps = await this.readPersonProps(
      row.createdByUserId,
      projectId,
    );

    this.assertCanChangeMonitors(props);

    const settings: MonitorTemplateChangeSettings =
      readMonitorTemplateChangeSettings(row.settings);

    let template: MonitorTemplate | null = null;

    if (row.monitorTemplateId) {
      try {
        template = await MonitorTemplateService.readTemplateToLinkOrUnlink({
          monitorTemplateId: row.monitorTemplateId,
          props: props,
        });
      } catch (error) {
        /*
         * An unlink of a template deleted since finds each monitor unlinked
         * already: it goes on. A link has nowhere to go.
         */
        if (settings.kind === MonitorTemplateChangeKind.Link) {
          throw new BadDataException(
            `The template ${row.monitorTemplateName ? `"${row.monitorTemplateName}" ` : ""}was deleted, or you may no longer read it, so no monitor was linked to it. What was changed is kept.`,
          );
        }

        logger.debug(
          `Monitor template change ${row.id?.toString()}: its template is gone (${error}); unlinking what is left.`,
        );
      }
    }

    const monitorIds: Array<string> = readMonitorTemplateChangeMonitorIds(
      row.monitorIds,
    );
    const results: MonitorTemplateChangeResults =
      readMonitorTemplateChangeResults(row.results);
    const progress: MonitorTemplateChangeProgress =
      readMonitorTemplateChangeProgress(row.progress);

    progress.total = monitorIds.length;

    return {
      row: row,
      projectId: projectId,
      userId: row.createdByUserId,
      props: props,
      propsReadAt: this.now(),
      settings: settings,
      template: template,
      monitorIds: monitorIds,
      results: results,
      progress: progress,
      lastFlushAt: this.now(),
      lastStopCheckAt: 0,
      lastFailureReason: "",
      consecutiveFailures: 0,
    };
  }

  private static async readPersonProps(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<DatabaseCommonInteractionProps> {
    return await CallerPlan.withPlan(
      await WorkspaceActionAuthorization.getProjectMemberProps({
        userId: userId,
        projectId: projectId,
      }),
    );
  }

  private static async refreshPropsIfDue(state: ChangeRunState): Promise<void> {
    if (
      this.now() - state.propsReadAt <
      MONITOR_TEMPLATE_CHANGE_PERMISSION_REFRESH_MS
    ) {
      return;
    }

    state.props = await this.readPersonProps(state.userId, state.projectId);
    state.propsReadAt = this.now();

    this.assertCanChangeMonitors(state.props);
  }

  private static async isStopRequested(
    state: ChangeRunState,
  ): Promise<boolean> {
    if (
      this.now() - state.lastStopCheckAt <
      MONITOR_TEMPLATE_CHANGE_STOP_CHECK_INTERVAL_MS
    ) {
      return false;
    }

    state.lastStopCheckAt = this.now();

    const row: MonitorTemplateChange | null =
      await MonitorTemplateChangeService.findOneById({
        id: state.row.id!,
        select: {
          _id: true,
          stopRequestedAt: true,
          status: true,
        },
        props: { isRoot: true },
      });

    return Boolean(
      !row || row.stopRequestedAt || !isMonitorTemplateChangeActive(row.status),
    );
  }

  private static async flush(
    state: ChangeRunState,
    force: boolean,
  ): Promise<void> {
    if (
      !force &&
      this.now() - state.lastFlushAt < MONITOR_TEMPLATE_CHANGE_FLUSH_INTERVAL_MS
    ) {
      return;
    }

    state.lastFlushAt = this.now();

    await MonitorTemplateChangeService.updateOneById({
      id: state.row.id!,
      data: {
        results: state.results as never,
        progress: state.progress as never,
      },
      props: { isRoot: true },
    });
  }

  private static async complete(
    state: ChangeRunState,
    status: MonitorTemplateChangeStatus,
  ): Promise<void> {
    await MonitorTemplateChangeService.updateOneById({
      id: state.row.id!,
      data: {
        status: status,
        results: state.results as never,
        progress: state.progress as never,
        completedAt: new Date(),
      },
      props: { isRoot: true },
    });
  }

  private static async failChange(
    row: MonitorTemplateChange,
    message: string,
    options?:
      | {
          results?: MonitorTemplateChangeResults | undefined;
          progress?: MonitorTemplateChangeProgress | undefined;
        }
      | undefined,
  ): Promise<void> {
    const monitorIds: Array<string> = readMonitorTemplateChangeMonitorIds(
      row.monitorIds,
    );
    const results: MonitorTemplateChangeResults =
      options?.results || readMonitorTemplateChangeResults(row.results);
    const progress: MonitorTemplateChangeProgress =
      options?.progress || readMonitorTemplateChangeProgress(row.progress);

    if (!options?.results) {
      progress.total = monitorIds.length;
      this.markNotReached({
        monitorIds: monitorIds,
        results: results,
        progress: progress,
        reason: MONITOR_NOT_REACHED_FAILED,
      });
    }

    try {
      await MonitorTemplateChangeService.updateOneById({
        id: row.id!,
        data: {
          status: MonitorTemplateChangeStatus.Failed,
          error: message,
          results: results as never,
          progress: progress as never,
          completedAt: new Date(),
        },
        props: { isRoot: true },
      });
    } catch (error) {
      logger.error(
        `Monitor template change ${row.id?.toString()}: could not record that it failed: ${error}`,
      );
    }
  }

  private static describeStartFailure(error: unknown): string {
    if (
      error instanceof NotAuthorizedException &&
      error.message ===
        WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE
    ) {
      return "The person who asked for this change is no longer a member of the project, so it was stopped. What it changed is kept.";
    }

    return toText(error);
  }
}
