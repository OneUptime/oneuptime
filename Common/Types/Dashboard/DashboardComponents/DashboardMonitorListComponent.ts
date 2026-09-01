import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardMonitorListComponent extends BaseComponent {
  componentType: DashboardComponentType.MonitorList;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    maxRows?: number | undefined;
    viewMode?: "list" | "honeycomb" | "timeline" | undefined;
    /*
     * Which rows the State Timeline's hover card shows. Stored as plain
     * strings because that is what the MultiSelectDropdown editor writes;
     * MonitorStateTimelineTooltipFieldUtil.resolveFields is what turns them
     * back into known fields, dropping anything it does not recognise.
     */
    timelineTooltipFields?: Array<string> | undefined;
    statusFilter?: string | undefined;
    monitorStatusIds?: Array<string> | undefined;
    monitorTypes?: Array<string> | undefined;
    labelIds?: Array<string> | undefined;
  };
}
