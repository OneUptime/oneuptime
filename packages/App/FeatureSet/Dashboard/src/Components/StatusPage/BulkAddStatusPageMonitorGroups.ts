import bulkAddStatusPageResources, {
  BulkAddStatusPagePlacement,
  BulkAddStatusPageResourceFailure,
  BulkAddStatusPageResourcesResult,
} from "./BulkAddStatusPageResources";
import MonitorGroup from "Common/Models/DatabaseModels/MonitorGroup";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import ObjectID from "Common/Types/ObjectID";

export interface BulkAddStatusPageMonitorGroupFailure {
  monitorGroup: MonitorGroup;
  error: unknown;
}

export interface BulkAddStatusPageMonitorGroupsResult {
  succeeded: Array<MonitorGroup>;
  failed: Array<BulkAddStatusPageMonitorGroupFailure>;
  /**
   * Monitor groups that were selected but are already on the status page.
   * They are left alone rather than added a second time - see
   * `existingMonitorGroupIds`.
   */
  skipped: Array<MonitorGroup>;
}

export interface BulkAddStatusPageMonitorGroupsOptions
  extends BulkAddStatusPagePlacement {
  monitorGroups: Array<MonitorGroup>;
  /**
   * Monitor groups the status page already lists, in any group of it. A
   * status page lists a monitor group once - the server refuses a second
   * resource for one - so these are reported as skipped instead of failing
   * one by one (issue #6544).
   */
  existingMonitorGroupIds?: Array<ObjectID | string> | undefined;
}

/**
 * Add Multiple Monitor Groups (issue #6544): one status page resource for
 * every distinct monitor group, in the order they were picked, each named
 * and described as its monitor group is, skipping the monitor groups the
 * status page already lists - what Add Multiple Monitors does for monitors
 * (BulkAddStatusPageMonitors), one create after another.
 */
export const bulkAddStatusPageMonitorGroups: (
  options: BulkAddStatusPageMonitorGroupsOptions,
) => Promise<BulkAddStatusPageMonitorGroupsResult> = async (
  options: BulkAddStatusPageMonitorGroupsOptions,
): Promise<BulkAddStatusPageMonitorGroupsResult> => {
  const result: BulkAddStatusPageResourcesResult<MonitorGroup> =
    await bulkAddStatusPageResources<MonitorGroup>({
      ...options,
      targets: options.monitorGroups,
      targetName: "Monitor group",
      setTarget: (
        resource: StatusPageResource,
        monitorGroupId: ObjectID,
      ): void => {
        resource.monitorGroupId = monitorGroupId;
      },
      existingTargetIds: options.existingMonitorGroupIds,
    });

  return {
    succeeded: result.succeeded,
    skipped: result.skipped,
    failed: result.failed.map(
      (
        failure: BulkAddStatusPageResourceFailure<MonitorGroup>,
      ): BulkAddStatusPageMonitorGroupFailure => {
        return { monitorGroup: failure.target, error: failure.error };
      },
    ),
  };
};

export default bulkAddStatusPageMonitorGroups;
