import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import ObjectID from "Common/Types/ObjectID";
import UptimePrecision from "Common/Types/StatusPage/UptimePrecision";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * What a status page bulk add puts on the page: monitors (Add Multiple
 * Monitors) or monitor groups (Add Multiple Monitor Groups). Each one becomes
 * a resource named and described as it is.
 */
export interface BulkAddStatusPageTarget {
  _id?: string | undefined;
  name?: string | undefined;
  description?: string | undefined;
}

/**
 * Options that are shared by every resource a bulk add creates. These are
 * the same options the single resource form offers, minus display name and
 * description, which are copied from each monitor (or monitor group).
 */
export interface BulkAddStatusPageResourceOptions {
  displayTooltip?: string | undefined;
  showCurrentStatus?: boolean | undefined;
  showUptimePercent?: boolean | undefined;
  uptimePercentPrecision?: UptimePrecision | undefined;
  showStatusHistoryChart?: boolean | undefined;
}

export type CreateStatusPageResourceFunction = (
  resource: StatusPageResource,
) => Promise<void>;

/*
 * Where on the status page the new resources go, and how they are shown:
 * the same for every one of them.
 */
export interface BulkAddStatusPagePlacement {
  projectId: ObjectID;
  statusPageId: ObjectID;
  statusPageGroupId?: ObjectID | undefined;
  rowAxisValue?: string | undefined;
  columnAxisValue?: string | undefined;
  resourceOptions?: BulkAddStatusPageResourceOptions | undefined;
  createResource?: CreateStatusPageResourceFunction | undefined;
}

export interface BulkAddStatusPageResourcesOptions<
  TTarget extends BulkAddStatusPageTarget,
> extends BulkAddStatusPagePlacement {
  targets: Array<TTarget>;
  /*
   * What a target is called at the start of a sentence, for the reason a
   * target without an ID or a name fails: "Monitor", "Monitor group".
   */
  targetName: string;
  // Points the new resource at the target: its monitor, or its monitor group.
  setTarget: (resource: StatusPageResource, targetId: ObjectID) => void;
  /*
   * The targets the status page already lists. Anything in here is reported
   * as skipped instead of being added a second time - see
   * BulkAddStatusPageMonitors (issue #3420) - and the server refuses the
   * duplicate anyway.
   */
  existingTargetIds?: Array<ObjectID | string> | undefined;
}

export interface BulkAddStatusPageResourceFailure<TTarget> {
  target: TTarget;
  error: unknown;
}

export interface BulkAddStatusPageResourcesResult<TTarget> {
  succeeded: Array<TTarget>;
  failed: Array<BulkAddStatusPageResourceFailure<TTarget>>;
  // Selected, but already on the status page: left as they are.
  skipped: Array<TTarget>;
}

const createResourceWithModelAPI: CreateStatusPageResourceFunction = async (
  resource: StatusPageResource,
): Promise<void> => {
  await ModelAPI.create<StatusPageResource>({
    model: resource,
    modelType: StatusPageResource,
  });
};

type ToIdSetFunction = (
  ids: Array<ObjectID | string> | undefined,
) => Set<string>;

const toIdSet: ToIdSetFunction = (
  ids: Array<ObjectID | string> | undefined,
): Set<string> => {
  const idSet: Set<string> = new Set<string>();

  for (const value of ids || []) {
    const id: string = value ? value.toString() : "";

    if (id) {
      idSet.add(id);
    }
  }

  return idSet;
};

type BuildResourceFunction = (data: {
  placement: BulkAddStatusPagePlacement;
  displayName: string;
  displayDescription: string | undefined;
}) => StatusPageResource;

/*
 * One new resource, placed and set up as the bulk add says. Its name and
 * description are its monitor's (or monitor group's); the caller points it
 * at what it shows.
 */
const buildResource: BuildResourceFunction = (data: {
  placement: BulkAddStatusPagePlacement;
  displayName: string;
  displayDescription: string | undefined;
}): StatusPageResource => {
  const placement: BulkAddStatusPagePlacement = data.placement;
  const resource: StatusPageResource = new StatusPageResource();
  resource.projectId = placement.projectId;
  resource.statusPageId = placement.statusPageId;
  resource.displayName = data.displayName;

  if (data.displayDescription !== undefined) {
    resource.displayDescription = data.displayDescription;
  }

  if (placement.statusPageGroupId) {
    resource.statusPageGroupId = placement.statusPageGroupId;
  }

  if (placement.rowAxisValue) {
    resource.rowAxisValue = placement.rowAxisValue;
  }

  if (placement.columnAxisValue) {
    resource.columnAxisValue = placement.columnAxisValue;
  }

  const resourceOptions: BulkAddStatusPageResourceOptions =
    placement.resourceOptions || {};

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
    resource.uptimePercentPrecision = resourceOptions.uptimePercentPrecision;
  }

  if (resourceOptions.showStatusHistoryChart !== undefined) {
    resource.showStatusHistoryChart = resourceOptions.showStatusHistoryChart;
  }

  return resource;
};

/**
 * Creates one status page resource for every distinct target in the order it
 * was selected, skipping the targets the status page already lists. The
 * status page resource service assigns display order during each create, so
 * these requests intentionally run sequentially to avoid concurrent creates
 * receiving the same order.
 */
export const bulkAddStatusPageResources: <
  TTarget extends BulkAddStatusPageTarget,
>(
  options: BulkAddStatusPageResourcesOptions<TTarget>,
) => Promise<BulkAddStatusPageResourcesResult<TTarget>> = async <
  TTarget extends BulkAddStatusPageTarget,
>(
  options: BulkAddStatusPageResourcesOptions<TTarget>,
): Promise<BulkAddStatusPageResourcesResult<TTarget>> => {
  const result: BulkAddStatusPageResourcesResult<TTarget> = {
    succeeded: [],
    failed: [],
    skipped: [],
  };
  const processedTargetIds: Set<string> = new Set<string>();
  const existingTargetIds: Set<string> = toIdSet(options.existingTargetIds);
  const createResource: CreateStatusPageResourceFunction =
    options.createResource || createResourceWithModelAPI;

  for (const target of options.targets) {
    try {
      const targetId: ObjectID | null = target._id
        ? new ObjectID(target._id)
        : null;

      if (!targetId) {
        throw new Error(`${options.targetName} ID is required.`);
      }

      if (!target.name) {
        throw new Error(`${options.targetName} name is required.`);
      }

      const targetIdString: string = targetId.toString();

      if (processedTargetIds.has(targetIdString)) {
        continue;
      }

      processedTargetIds.add(targetIdString);

      /*
       * Already on the page: not an error and not a create. The target keeps
       * the resource it has, with whatever display name and options someone
       * gave it, and the caller is told it was left alone.
       */
      if (existingTargetIds.has(targetIdString)) {
        result.skipped.push(target);
        continue;
      }

      const resource: StatusPageResource = buildResource({
        placement: options,
        displayName: target.name,
        displayDescription: target.description,
      });

      options.setTarget(resource, targetId);

      await createResource(resource);
      result.succeeded.push(target);
    } catch (error) {
      result.failed.push({ target, error });
    }
  }

  return result;
};

export default bulkAddStatusPageResources;
