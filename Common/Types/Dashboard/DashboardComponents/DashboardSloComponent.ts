import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

/**
 * Which of the SLO's three tracked numbers the widget renders.
 *
 * These values are persisted inside the dashboard's JSON config, so they
 * must never be renamed — only added to.
 */
export enum SloWidgetMetric {
  Sli = "Sli",
  ErrorBudgetRemaining = "ErrorBudgetRemaining",
  BurnRate = "BurnRate",
}

/**
 * Tile renders the single current number (read from the SLO row that the
 * evaluation worker keeps up to date). Chart renders the SloHistory
 * series for the same metric over the dashboard's selected time range.
 */
export enum SloWidgetDisplayType {
  Tile = "Tile",
  Chart = "Chart",
}

export default interface DashboardSloComponent extends BaseComponent {
  componentType: DashboardComponentType.Slo;
  componentId: ObjectID;
  arguments: {
    /*
     * ObjectID of the ServiceLevelObjective, held as a string because the
     * EntityDropdown argument editor writes the raw `_id` and the whole
     * component tree round-trips through the dashboard's JSON config.
     * The renderer wraps it in `new ObjectID(...)` before querying.
     */
    serviceLevelObjectiveId?: string | undefined;
    sloMetric?: SloWidgetMetric | undefined;
    displayType?: SloWidgetDisplayType | undefined;
    widgetTitle?: string | undefined;
  };
}
