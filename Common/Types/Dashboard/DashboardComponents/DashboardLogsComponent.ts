import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardLogsComponent extends BaseComponent {
  componentType: DashboardComponentType.Logs;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    telemetryServiceIdsCsv?: string | undefined;
    logQueryJson?: string | undefined;
  };
}
