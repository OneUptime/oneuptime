import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardMonitorStatusComponent extends BaseComponent {
  componentType: DashboardComponentType.MonitorStatus;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    /*
     * Optional comma-separated label filter so a panel can scope to a single
     * service's monitors. Empty/undefined means "all monitors in the project."
     */
    labelFilter?: string | undefined;
    // Optional comma-separated monitor name filter (substring match on each).
    nameContains?: string | undefined;
    // Layout density: "grid" (LED tiles) or "list" (one row per monitor).
    layout?: "grid" | "list" | undefined;
    maxRows?: number | undefined;
  };
}
