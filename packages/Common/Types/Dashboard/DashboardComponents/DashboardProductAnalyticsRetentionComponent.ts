import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

/*
 * A retention table saved on a RUM application's User Retention page
 * (issue #6630), drawn with the dashboard's time range: its cohorts, the
 * share of each that came back in each period after, and All cohorts.
 */
export default interface DashboardProductAnalyticsRetentionComponent
  extends BaseComponent {
  componentType: DashboardComponentType.ProductAnalyticsRetention;
  componentId: ObjectID;
  arguments: {
    /*
     * The saved retention table's id (RumProductAnalyticsSavedView), held
     * as a string: the EntityDropdown editor writes the raw `_id`, and the
     * config round-trips through JSON.
     */
    savedViewId?: string | undefined;
    // Header above the table; the saved table's name when left empty.
    title?: string | undefined;
  };
}
