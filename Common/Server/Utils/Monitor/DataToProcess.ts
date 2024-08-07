import IncomingMonitorRequest from "Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import ServerMonitorResponse from "Common/Types/Monitor/ServerMonitor/ServerMonitorResponse";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import LogMonitorResponse from "Common/Types/Monitor/LogMonitor/LogMonitorResponse";

type DataToProcess =
  | ProbeMonitorResponse
  | IncomingMonitorRequest
  | ServerMonitorResponse
  | LogMonitorResponse;

export default DataToProcess;
