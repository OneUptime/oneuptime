import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

/*
 * What the clouds cost (#11009), for the dashboard's time range: a total
 * against the period before, a breakdown (by service, Region, account,
 * resource or cost group), or each day's spend - over every account, one
 * account, a cost group or a cost view - read as the viewer may read the
 * costs, by the code Cloud > Costs draws with (CloudCostBreakdowns).
 */
export default interface DashboardCloudCostComponent extends BaseComponent {
  componentType: DashboardComponentType.CloudCost;
  componentId: ObjectID;
  arguments: {
    // What it draws: "total", "breakdown" or "trend".
    display?: string | undefined;
    // What it is over: AllAccounts, Account, CostGroup or CostView.
    scope?: string | undefined;
    /*
     * The account, cost group or cost view it is over, by id, held as a
     * string: the EntityDropdown editor writes the raw `_id`.
     */
    cloudAccountId?: string | undefined;
    cloudCostGroupId?: string | undefined;
    cloudCostViewId?: string | undefined;
    // A breakdown's dimension: service, region, cloudAccountId, resourceId.
    breakdownBy?: string | undefined;
    // billed, amortized or net; the project's when left empty.
    basis?: string | undefined;
    // Header above it; what it is over when left empty.
    title?: string | undefined;
  };
}
