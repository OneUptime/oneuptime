import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

/**
 * Every (non-archived) Service Level Objective in the project with its
 * status, SLI against target, error budget remaining and burn rate — the
 * fleet view an SLO review opens with.
 *
 * Reads the SLO rows the evaluation worker keeps current, least error budget
 * first. A Telemetry Attribute variable on the `sloName` key narrows it to the
 * picked objective, the same way it narrows the `oneuptime.slo.*` charts.
 */
export default interface DashboardSloListComponent extends BaseComponent {
  componentType: DashboardComponentType.SloList;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    maxRows?: number | undefined;
    viewMode?: "list" | "honeycomb" | undefined;
    /*
     * SloStatus values to keep. Unset or empty lists every status, including
     * SLOs the worker has not evaluated yet (whose status is still NULL).
     */
    sloStatuses?: Array<string> | undefined;
    labelIds?: Array<string> | undefined;
    labelVariableId?: string | undefined;
  };
}
