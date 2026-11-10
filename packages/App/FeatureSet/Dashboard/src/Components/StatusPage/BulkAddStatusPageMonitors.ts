import bulkAddStatusPageResources, {
  BulkAddStatusPagePlacement,
  BulkAddStatusPageResourceFailure,
  BulkAddStatusPageResourceOptions,
  BulkAddStatusPageResourcesResult,
} from "./BulkAddStatusPageResources";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import ObjectID from "Common/Types/ObjectID";

export interface BulkAddStatusPageMonitorFailure {
  monitor: Monitor;
  error: unknown;
}

export interface BulkAddStatusPageMonitorsResult {
  succeeded: Array<Monitor>;
  failed: Array<BulkAddStatusPageMonitorFailure>;
  /**
   * Monitors that were selected but are already on the status page. They are
   * left alone rather than added a second time - see `existingMonitorIds`.
   */
  skipped: Array<Monitor>;
}

/**
 * Options that are shared by every resource this bulk add creates. These are
 * the same options the single resource form offers, minus display name and
 * description which are copied from each monitor.
 */
export type BulkAddStatusPageMonitorResourceOptions =
  BulkAddStatusPageResourceOptions;

export interface BulkAddStatusPageMonitorsOptions
  extends BulkAddStatusPagePlacement {
  monitors: Array<Monitor>;
  /**
   * Monitors the status page already lists. Selecting monitors by label
   * re-selects every monitor carrying that label, including the ones already
   * added, so adding by label has to be idempotent: anything in here is
   * reported as skipped instead of being added a second time (issue #3420).
   */
  existingMonitorIds?: Array<ObjectID | string> | undefined;
}

/**
 * Creates one status page resource for every distinct monitor in the order it
 * was selected, skipping the monitors the status page already lists. The
 * resources are created one after another (bulkAddStatusPageResources says
 * why); Add Multiple Monitor Groups does the same for monitor groups
 * (BulkAddStatusPageMonitorGroups).
 */
export const bulkAddStatusPageMonitors: (
  options: BulkAddStatusPageMonitorsOptions,
) => Promise<BulkAddStatusPageMonitorsResult> = async (
  options: BulkAddStatusPageMonitorsOptions,
): Promise<BulkAddStatusPageMonitorsResult> => {
  const result: BulkAddStatusPageResourcesResult<Monitor> =
    await bulkAddStatusPageResources<Monitor>({
      ...options,
      targets: options.monitors,
      targetName: "Monitor",
      setTarget: (resource: StatusPageResource, monitorId: ObjectID): void => {
        resource.monitorId = monitorId;
      },
      existingTargetIds: options.existingMonitorIds,
    });

  return {
    succeeded: result.succeeded,
    skipped: result.skipped,
    failed: result.failed.map(
      (
        failure: BulkAddStatusPageResourceFailure<Monitor>,
      ): BulkAddStatusPageMonitorFailure => {
        return { monitor: failure.target, error: failure.error };
      },
    ),
  };
};

export default bulkAddStatusPageMonitors;
