import AIRun from "../../../../Models/DatabaseModels/AIRun";
import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import {
  InfrastructureFixTaskContext,
  getInfrastructureFixTaskContext,
} from "../../../../Types/AI/CodeFixTaskContext";
import CodeFixTaskType, {
  CodeFixTaskTypeHelper,
} from "../../../../Types/AI/CodeFixTaskType";
import FixProductionCheck from "../../../../Types/AI/FixProductionCheck";
import Includes from "../../../../Types/BaseDatabase/Includes";
import {
  DataStoreKind,
  TELEMETRY_DATA_STORE_KINDS,
} from "../../../../Types/DataSecurity/DataStoreKind";
import ObjectID from "../../../../Types/ObjectID";
import AIRunService from "../../../Services/AIRunService";
import DataSecurityIssueService from "../../../Services/DataSecurityIssueService";
import DataStoreService from "../../../Services/DataStoreService";

/*
 * THE DATA SECURITY ISSUES A CODE TASK FIXES (#10368).
 *
 * A merged pull request of a code task is followed to production as a
 * Data Security fix when its task names the issues it is for:
 *
 *   - Fix with AI on an issue (#10362): a task in Code, whose first turn
 *     names the issue (AIRun.triggeredByDataSecurityIssueId). A reply's
 *     pull request is its task's: the first turn holds the issue.
 *   - A group's one pull request (#10370): CodeFixTaskType
 *     .FixInfrastructureCode, whose context lists the stores and issues it
 *     fixes (AIRun.taskContext.infrastructureFix).
 *   - A service's leaks fixed in one pull request (#10367, not built yet):
 *     HOOK - its recipe (FixSensitiveDataInTelemetry) and its context item
 *     for Data Security issues name the issues it is for. Read them in
 *     issueIdsOfTask below and it is followed as every fix here is: a
 *     telemetry issue's fix with the TelemetryLeak check.
 *
 * Which check follows it comes from the issues' stores: a telemetry
 * store's issue is a leak in the code that writes it (TelemetryLeak), any
 * other a store's configuration (StoreConfiguration), however the task
 * was asked. Every read is held to the run's project.
 */

// The most issues one fix is followed for: a group's, at most.
export const MAX_FIX_TARGET_ISSUES: number = 500;

const ROOT: { isRoot: true } = { isRoot: true };

export interface DataSecurityFixTargetRead {
  check: FixProductionCheck;
  issueIds: Array<ObjectID>;
  // The task's first turn: what Code opens.
  taskId: ObjectID;
  // The person who asked for the fix - the pull request's author, to OneUptime.
  askedByUserId?: ObjectID | undefined;
}

// What a run is read with, to tell its task and the issues it names.
export const FIX_TARGET_RUN_SELECT: {
  _id: true;
  projectId: true;
  codeFixTaskType: true;
  codeTaskId: true;
  userId: true;
  triggeredByDataSecurityIssueId: true;
  taskContext: true;
} = {
  _id: true,
  projectId: true,
  codeFixTaskType: true,
  codeTaskId: true,
  userId: true,
  triggeredByDataSecurityIssueId: true,
  taskContext: true,
};

function idOf(record: { id?: ObjectID | null; _id?: unknown }): string {
  return record.id?.toString() || String(record._id || "");
}

export default class DataSecurityFixTarget {
  /*
   * The issues a task names, as ids: a Data Security issue Fix with AI was
   * asked from, or the issues a group's pull request lists.
   */
  public static issueIdsOfTask(task: AIRun): Array<string> {
    const ids: Array<string> = [];
    const taskType: CodeFixTaskType = CodeFixTaskTypeHelper.fromDatabaseValue(
      task.codeFixTaskType,
    );

    if (task.triggeredByDataSecurityIssueId) {
      ids.push(task.triggeredByDataSecurityIssueId.toString());
    }

    if (taskType === CodeFixTaskType.FixInfrastructureCode) {
      const fix: InfrastructureFixTaskContext | null =
        getInfrastructureFixTaskContext(task.taskContext?.infrastructureFix);

      for (const store of fix?.stores || []) {
        ids.push(store.issueId);
      }
    }

    /*
     * #10367: a service's leaks fixed in one pull request names its issues
     * in its own context item. Add them here when its recipe lands.
     */

    return Array.from(
      new Set<string>(
        ids.filter((id: string): boolean => {
          return ObjectID.isValidUUID(id);
        }),
      ),
    ).slice(0, MAX_FIX_TARGET_ISSUES);
  }

  /*
   * The task a run is a turn of: the run itself when it is the first turn,
   * else its task's first turn, in the run's own project. Null when either
   * is gone.
   */
  public static async readTask(aiRunId: ObjectID): Promise<AIRun | null> {
    const run: AIRun | null = await AIRunService.findOneById({
      id: aiRunId,
      select: FIX_TARGET_RUN_SELECT,
      props: ROOT,
    });

    if (!run || !run.projectId) {
      return null;
    }

    if (!run.codeTaskId || run.codeTaskId.toString() === idOf(run)) {
      return run;
    }

    return await AIRunService.findOneBy({
      query: { _id: run.codeTaskId.toString(), projectId: run.projectId },
      select: FIX_TARGET_RUN_SELECT,
      props: ROOT,
    });
  }

  /*
   * The Data Security issues a merged pull request's task is for, and the
   * check that follows it - or null when its task names none that still
   * exists in its project.
   */
  public static async read(
    aiRunId: ObjectID,
  ): Promise<DataSecurityFixTargetRead | null> {
    const task: AIRun | null = await DataSecurityFixTarget.readTask(aiRunId);

    if (!task?.projectId) {
      return null;
    }

    const ids: Array<string> = DataSecurityFixTarget.issueIdsOfTask(task);

    if (ids.length === 0) {
      return null;
    }

    const issues: Array<DataSecurityIssue> =
      await DataSecurityIssueService.findBy({
        query: {
          _id: new Includes(ids),
          projectId: task.projectId,
        } as never,
        select: { _id: true, dataStoreId: true },
        skip: 0,
        limit: MAX_FIX_TARGET_ISSUES,
        props: ROOT,
      });

    if (issues.length === 0) {
      return null;
    }

    const check: FixProductionCheck =
      CodeFixTaskTypeHelper.fromDatabaseValue(task.codeFixTaskType) ===
      CodeFixTaskType.FixInfrastructureCode
        ? FixProductionCheck.StoreConfiguration
        : await DataSecurityFixTarget.checkOfStore({
            projectId: task.projectId,
            dataStoreId: issues[0]!.dataStoreId,
          });

    return {
      check,
      issueIds: issues
        .filter((issue: DataSecurityIssue): boolean => {
          return Boolean(idOf(issue));
        })
        .map((issue: DataSecurityIssue): ObjectID => {
          return new ObjectID(idOf(issue));
        }),
      taskId: new ObjectID(idOf(task)),
      askedByUserId: task.userId || undefined,
    };
  }

  // A telemetry store's issue is a leak in code; any other store's, its configuration.
  public static async checkOfStore(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID | undefined;
  }): Promise<FixProductionCheck> {
    if (!data.dataStoreId) {
      return FixProductionCheck.StoreConfiguration;
    }

    const store: DataStore | null = await DataStoreService.findOneBy({
      query: { _id: data.dataStoreId.toString(), projectId: data.projectId },
      select: { _id: true, kind: true },
      props: ROOT,
    });

    return DataSecurityFixTarget.isTelemetryKind(store?.kind)
      ? FixProductionCheck.TelemetryLeak
      : FixProductionCheck.StoreConfiguration;
  }

  public static isTelemetryKind(kind: string | undefined): boolean {
    return TELEMETRY_DATA_STORE_KINDS.includes(kind as DataStoreKind);
  }
}
