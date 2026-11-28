/*
 * THE SERVICES A PAGE OF TELEMETRY ROWS NAMES, READ BY THEIR IDS (#10764).
 *
 * The hook lives in Common since #11072, where the shared logs explorer
 * (Common/UI/Components/LogsViewer) reads the services its rows name the
 * same way. The Dashboard's explorers import it from here, as before.
 */
export {
  TELEMETRY_ROW_SERVICE_SELECT,
  useTelemetryServicesOnPage,
} from "Common/UI/Utils/TelemetryServicesOnPage";
export type { TelemetryServicesOnPage } from "Common/UI/Utils/TelemetryServicesOnPage";
