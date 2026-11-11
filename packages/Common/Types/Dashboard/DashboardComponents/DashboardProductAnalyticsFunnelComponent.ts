import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

/*
 * A funnel saved on a RUM application's Funnels page (issue #6630), drawn
 * with the dashboard's time range: how many people did each step, and how
 * many dropped off before the next.
 */
export default interface DashboardProductAnalyticsFunnelComponent
  extends BaseComponent {
  componentType: DashboardComponentType.ProductAnalyticsFunnel;
  componentId: ObjectID;
  arguments: {
    /*
     * The saved funnel's id (RumProductAnalyticsSavedView), held as a
     * string: the EntityDropdown editor writes the raw `_id`, and the
     * config round-trips through JSON.
     */
    savedViewId?: string | undefined;
    // Header above the funnel; the saved funnel's name when left empty.
    title?: string | undefined;
  };
}
