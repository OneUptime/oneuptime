import AIRunService from "../../../Services/AIRunService";
import logger from "../../Logger";
import Realtime from "../../Realtime";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import ObjectID from "../../../../Types/ObjectID";
import ModelEventType from "../../../../Types/Realtime/ModelEventType";
import OldestKeyMap from "../../../../Utils/OldestKeyMap";

/*
 * A TURN'S STEPS REACH THE PAGE AS THEY HAPPEN.
 *
 * A task's conversation in Code, and a turn's Log, used to read the task
 * again every few seconds while AI worked, and saw a step up to eight
 * seconds after the Runner took it (it sent its lines every five seconds,
 * the page read every three). Now every change of a code-fix run is
 * announced as it happens, and the open pages read what is new at once:
 *
 *   - a line the Runner reports (a file read, a command run), its pull
 *     request recorded and its end are each an event appended to the run
 *     (AIRunEventService.appendEventToRun), which announces it;
 *   - a turn someone stops (CodeTaskRuns.stop) is announced too.
 *
 * An announcement is a live update of the AIRun record (Realtime), sent in
 * the run's own room - the turn's Log hears it there - and, for a reply, in
 * its task's room too, so the conversation hears every turn of its task in
 * one place. It names the run and nothing else: who hears it is who may
 * read the run (AIRunService's own read, as every live update is decided),
 * and the page reads what changed through the Code API, which asks who may
 * read the task as it always does. Pages keep a slower read of their own
 * (CodeTaskLiveRules in the Dashboard) for the announcements they miss: a
 * person whose role does not read AI runs, a server without the socket the
 * page listens on.
 *
 * Never throws: an announcement is a convenience, and the write it follows
 * has happened either way.
 */

// The runs whose task is remembered (CodeTaskLive.getTaskIdOf).
export const MAX_REMEMBERED_RUN_TASKS: number = 2000;

export default class CodeTaskLive {
  /*
   * Which task each run is a turn of - the run itself for a task's first
   * turn (null), its codeTaskId for a reply. A run's task never changes, so
   * it is read once per run, not once per line it reports.
   */
  private static runTasks: OldestKeyMap<string, string | null> =
    new OldestKeyMap<string, string | null>();

  /*
   * Tells the open pages of a run that it changed. `codeTaskId` is the
   * run's task when the caller holds the run (null: the run is a task's
   * first turn); left out, it is read.
   */
  @CaptureSpan()
  public static async announce(data: {
    projectId: ObjectID;
    runId: ObjectID;
    codeTaskId?: ObjectID | null | undefined;
  }): Promise<void> {
    try {
      // Nobody listens in a process that holds no socket server (a worker).
      if (!Realtime.isInitialized()) {
        return;
      }

      const taskId: string | null =
        data.codeTaskId !== undefined
          ? data.codeTaskId
            ? data.codeTaskId.toString()
            : null
          : await CodeTaskLive.getTaskIdOf(data.runId);

      for (const recordId of CodeTaskLive.getAnnouncedIds({
        runId: data.runId.toString(),
        taskId,
      })) {
        await AIRunService.onTriggerRealtime(
          new ObjectID(recordId),
          data.projectId,
          ModelEventType.Update,
        );
      }
    } catch (error) {
      logger.debug(
        `Could not announce a change of code-fix run ${data.runId.toString()}: ${error}`,
      );
    }
  }

  /*
   * The records a change of a run is announced as: the run, and the task
   * it is a turn of when that is another run - a reply's.
   */
  public static getAnnouncedIds(data: {
    runId: string;
    taskId: string | null;
  }): Array<string> {
    const ids: Array<string> = [data.runId];

    if (
      data.taskId &&
      data.taskId.toLowerCase() !== data.runId.toLowerCase()
    ) {
      ids.push(data.taskId);
    }

    return ids;
  }

  // The task a run is a turn of: null for a task's first turn (or a run that is gone).
  public static async getTaskIdOf(runId: ObjectID): Promise<string | null> {
    const key: string = runId.toString().toLowerCase();

    if (CodeTaskLive.runTasks.has(key)) {
      return CodeTaskLive.runTasks.get(key) ?? null;
    }

    const run: AIRun | null = await AIRunService.findOneById({
      id: runId,
      select: { _id: true, codeTaskId: true },
      props: { isRoot: true },
    });

    if (!run) {
      // Not kept: a run read before it is written is read again next time.
      return null;
    }

    const taskId: string | null = run.codeTaskId
      ? run.codeTaskId.toString()
      : null;

    CodeTaskLive.remember(key, taskId);

    return taskId;
  }

  // For tests: forget every run's task.
  public static forgetRunTasks(): void {
    CodeTaskLive.runTasks.clear();
  }

  private static remember(key: string, taskId: string | null): void {
    while (CodeTaskLive.runTasks.size >= MAX_REMEMBERED_RUN_TASKS) {
      const oldestKey: string | undefined = CodeTaskLive.runTasks.oldestKey();

      if (oldestKey === undefined) {
        break;
      }

      CodeTaskLive.runTasks.delete(oldestKey);
    }

    CodeTaskLive.runTasks.set(key, taskId);
  }
}
