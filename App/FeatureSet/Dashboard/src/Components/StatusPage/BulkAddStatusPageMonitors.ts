import Monitor from "Common/Models/DatabaseModels/Monitor";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import ObjectID from "Common/Types/ObjectID";
import UptimePrecision from "Common/Types/StatusPage/UptimePrecision";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

export interface BulkAddStatusPageMonitorFailure {
  monitor: Monitor;
  error: unknown;
}

export interface BulkAddStatusPageMonitorsResult {
  succeeded: Array<Monitor>;
  failed: Array<BulkAddStatusPageMonitorFailure>;
}

/**
 * Options that are shared by every resource this bulk add creates. These are
 * the same options the single resource form offers, minus display name and
 * description which are copied from each monitor.
 */
export interface BulkAddStatusPageMonitorResourceOptions {
  displayTooltip?: string | undefined;
  showCurrentStatus?: boolean | undefined;
  showUptimePercent?: boolean | undefined;
  uptimePercentPrecision?: UptimePrecision | undefined;
  showStatusHistoryChart?: boolean | undefined;
}

export interface BulkAddStatusPageMonitorsOptions {
  monitors: Array<Monitor>;
  projectId: ObjectID;
  statusPageId: ObjectID;
  statusPageGroupId?: ObjectID | undefined;
  rowAxisValue?: string | undefined;
  columnAxisValue?: string | undefined;
  resourceOptions?: BulkAddStatusPageMonitorResourceOptions | undefined;
  createResource?:
    | ((resource: StatusPageResource) => Promise<void>)
    | undefined;
}

type CreateResourceFunction = (resource: StatusPageResource) => Promise<void>;

const createResourceWithModelAPI: CreateResourceFunction = async (
  resource: StatusPageResource,
): Promise<void> => {
  await ModelAPI.create<StatusPageResource>({
    model: resource,
    modelType: StatusPageResource,
  });
};

/**
 * Creates one status page resource for every distinct monitor in the order it
 * was selected. The status page resource service assigns display order during
 * each create, so these requests intentionally run sequentially to avoid
 * concurrent creates receiving the same order.
 */
export const bulkAddStatusPageMonitors: (
  options: BulkAddStatusPageMonitorsOptions,
) => Promise<BulkAddStatusPageMonitorsResult> = async (
  options: BulkAddStatusPageMonitorsOptions,
): Promise<BulkAddStatusPageMonitorsResult> => {
  const result: BulkAddStatusPageMonitorsResult = {
    succeeded: [],
    failed: [],
  };
  const processedMonitorIds: Set<string> = new Set<string>();
  const createResource: CreateResourceFunction =
    options.createResource || createResourceWithModelAPI;

  for (const monitor of options.monitors) {
    try {
      const monitorId: ObjectID | null = monitor._id
        ? new ObjectID(monitor._id)
        : null;

      if (!monitorId) {
        throw new Error("Monitor ID is required.");
      }

      if (!monitor.name) {
        throw new Error("Monitor name is required.");
      }

      const monitorIdString: string = monitorId.toString();

      if (processedMonitorIds.has(monitorIdString)) {
        continue;
      }

      processedMonitorIds.add(monitorIdString);

      const resource: StatusPageResource = new StatusPageResource();
      resource.projectId = options.projectId;
      resource.statusPageId = options.statusPageId;
      resource.monitorId = monitorId;
      resource.displayName = monitor.name;

      if (monitor.description !== undefined) {
        resource.displayDescription = monitor.description;
      }

      if (options.statusPageGroupId) {
        resource.statusPageGroupId = options.statusPageGroupId;
      }

      if (options.rowAxisValue) {
        resource.rowAxisValue = options.rowAxisValue;
      }

      if (options.columnAxisValue) {
        resource.columnAxisValue = options.columnAxisValue;
      }

      const resourceOptions: BulkAddStatusPageMonitorResourceOptions =
        options.resourceOptions || {};

      if (resourceOptions.displayTooltip) {
        resource.displayTooltip = resourceOptions.displayTooltip;
      }

      if (resourceOptions.showCurrentStatus !== undefined) {
        resource.showCurrentStatus = resourceOptions.showCurrentStatus;
      }

      if (resourceOptions.showUptimePercent !== undefined) {
        resource.showUptimePercent = resourceOptions.showUptimePercent;
      }

      if (resourceOptions.uptimePercentPrecision) {
        resource.uptimePercentPrecision =
          resourceOptions.uptimePercentPrecision;
      }

      if (resourceOptions.showStatusHistoryChart !== undefined) {
        resource.showStatusHistoryChart =
          resourceOptions.showStatusHistoryChart;
      }

      await createResource(resource);
      result.succeeded.push(monitor);
    } catch (error) {
      result.failed.push({ monitor, error });
    }
  }

  return result;
};

export default bulkAddStatusPageMonitors;
