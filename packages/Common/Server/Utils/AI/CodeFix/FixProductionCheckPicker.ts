import CodeFixTaskType from "../../../../Types/AI/CodeFixTaskType";
import FixProductionCheck, {
  FixProductionCheckHelper,
} from "../../../../Types/AI/FixProductionCheck";
import ObjectID from "../../../../Types/ObjectID";
import logger from "../../Logger";
import DataSecurityFixTarget, {
  DataSecurityFixTargetRead,
} from "./DataSecurityFixTarget";

/*
 * WHICH CHECK A MERGED FIX PULL REQUEST IS WATCHED WITH, when it merges
 * (AIAgent:SyncPullRequestStates writes it with fieldsWhenMerged).
 *
 * Its recipe picks most (FixProductionCheckHelper.forTaskType): an
 * exception's fix, a slow operation's, an incident's root cause, a
 * telemetry improvement. A fix of a Data Security issue is told apart by
 * what its task names (DataSecurityFixTarget, #10368) - a request in Code
 * asked from an issue is watched as that issue's fix: a telemetry leak in
 * the code that writes it, or a store's configuration - so its recipe
 * alone, a request in Code, would not watch it.
 *
 * A task's reading that fails falls back to its recipe's check: the fix
 * is still followed when its recipe has one, never lost.
 */
export default class FixProductionCheckPicker {
  public static async forRun(data: {
    aiRunId: ObjectID;
    taskType: CodeFixTaskType;
  }): Promise<FixProductionCheck | null> {
    try {
      const target: DataSecurityFixTargetRead | null =
        await DataSecurityFixTarget.read(data.aiRunId);

      if (target) {
        return target.check;
      }
    } catch (error) {
      logger.error(
        `Fix verification: could not read which Data Security issues run ${data.aiRunId.toString()} fixes; it is watched by its recipe: ${error}`,
      );
    }

    return FixProductionCheckHelper.forTaskType(data.taskType);
  }
}
