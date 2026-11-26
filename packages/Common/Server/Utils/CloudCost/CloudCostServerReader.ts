import CloudCost from "../../../Models/AnalyticsModels/CloudCost";
import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import CloudApp from "../../../Models/DatabaseModels/CloudApp";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import AggregateBy from "../../../Types/BaseDatabase/AggregateBy";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { CloudCostAllocationResult } from "../../../Types/Cloud/CloudCostAllocation";
import { CloudCostBasis } from "../../../Types/Cloud/CloudCostBasis";
import {
  CloudCostBreakdownReader,
  CloudCostPlatformLists,
  toCloudCostPlatformLists,
} from "../../../Types/Cloud/CloudCostBreakdowns";
import { CloudResourceKind } from "../../../Types/Cloud/CloudResourceKind";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import CloudAccountService from "../../Services/CloudAccountService";
import CloudAppService from "../../Services/CloudAppService";
import CloudCostService from "../../Services/CloudCostService";
import CloudResourceService from "../../Services/CloudResourceService";
import AggregateByWithProps from "../../Types/AnalyticsDatabase/AggregateBy";
import CloudCostAllocation from "./CloudCostAllocation";

/*
 * THE COST BREAKDOWNS, READ ON THE SERVER (#11009).
 *
 * The breakdowns Cloud > Costs works out (Types/Cloud/CloudCostBreakdowns),
 * read here as whoever the figures are for: the caller of the API, or the
 * person a scheduled report is sent to. The costs are summed by
 * CloudCostService.aggregateBy - the read behind /aggregate, the one the
 * page calls - with that person's props, so a grant limited by labels
 * reads only the accounts it reaches, and one who may not read the costs
 * reads nothing. A cost view's groups are read through its allocation, as
 * the page's breakdown by group is.
 */

export interface CloudCostServerReaderOptions {
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
  // Today, for a read of the month so far (tests set it).
  now?: Date | undefined;
}

export function getCloudCostServerReader(
  options: CloudCostServerReaderOptions,
): CloudCostBreakdownReader {
  return {
    aggregate: async (
      aggregateBy: AggregateBy<CloudCost>,
    ): Promise<AggregatedResult> => {
      const asked: AggregateByWithProps<CloudCost> = {
        ...aggregateBy,
        props: options.props,
      };

      return await CloudCostService.aggregateBy(asked);
    },
    readAllocation: async (data: {
      viewId: ObjectID;
      startDate: Date;
      endDate: Date;
      currency: string;
      basis?: CloudCostBasis | undefined;
      cloudAccountIds?: Array<ObjectID> | undefined;
    }): Promise<CloudCostAllocationResult> => {
      return await CloudCostAllocation.read({
        projectId: options.projectId,
        viewId: data.viewId,
        startDate: data.startDate,
        endDate: data.endDate,
        currency: data.currency,
        basis: data.basis,
        cloudAccountIds: data.cloudAccountIds,
        props: options.props,
        now: options.now,
      });
    },
    readPlatformLists: async (): Promise<CloudCostPlatformLists> => {
      const [environments, apps]: [Array<CloudResource>, Array<CloudApp>] =
        await Promise.all([
          CloudResourceService.findBy({
            query: {
              projectId: options.projectId,
              cloudResourceKind: CloudResourceKind.Environment,
            },
            select: {
              _id: true,
              name: true,
              cloudPlatform: true,
              cloudProvider: true,
              cloudAccountId: true,
              cloudRegion: true,
            },
            sort: { name: SortOrder.Ascending },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            props: options.props,
          }),
          CloudAppService.findBy({
            query: { projectId: options.projectId },
            select: {
              _id: true,
              name: true,
              cloudResourceId: true,
              groupName: true,
            },
            sort: { name: SortOrder.Ascending },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            props: options.props,
          }),
        ]);

      return toCloudCostPlatformLists({
        environments: environments.map((environment: CloudResource) => {
          return {
            _id: environment._id,
            name: environment.name,
            cloudPlatform: environment.cloudPlatform,
            cloudProvider: environment.cloudProvider,
            cloudAccountId: environment.cloudAccountId,
            cloudRegion: environment.cloudRegion,
          };
        }),
        apps: apps.map((app: CloudApp) => {
          return {
            _id: app._id,
            name: app.name,
            cloudResourceId: app.cloudResourceId,
            groupName: app.groupName,
          };
        }),
      });
    },
  };
}

// The project's accounts a person may read, by their OneUptime ID.
export async function readCloudCostAccounts(data: {
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
}): Promise<Array<CloudAccount>> {
  return await CloudAccountService.findBy({
    query: { projectId: data.projectId },
    select: {
      _id: true,
      name: true,
      accountId: true,
      provider: true,
      providerAccountName: true,
      costSummary: true,
      savingsSummary: true,
      cloudConnectionId: true,
    },
    sort: { name: SortOrder.Ascending },
    skip: 0,
    limit: LIMIT_PER_PROJECT,
    props: data.props,
  });
}
