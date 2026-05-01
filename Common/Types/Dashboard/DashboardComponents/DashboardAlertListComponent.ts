import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardAlertListComponent extends BaseComponent {
  componentType: DashboardComponentType.AlertList;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    /*
     * Which collection to render: alerts (raised by monitors) or incidents
     * (declared by humans/automation). Sticking these in one panel keeps the
     * dashboard story simple — the underlying model is just "things that
     * need attention right now."
     */
    source?: "alerts" | "incidents" | undefined;
    severityFilter?: string | undefined;
    stateFilter?: "open" | "resolved" | "all" | undefined;
    maxRows?: number | undefined;
  };
}
