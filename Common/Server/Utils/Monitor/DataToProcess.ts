import IncomingMonitorRequest from "Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import ServerMonitorResponse from "Common/Types/Monitor/ServerMonitor/ServerMonitorResponse";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import LogMonitorResponse from "Common/Types/Monitor/LogMonitor/LogMonitorResponse";
import TraceMonitorResponse from "Common/Types/Monitor/TraceMonitor/TraceMonitorResponse";

type DataToProcess =
  | ProbeMonitorResponse
  | IncomingMonitorRequest
  | ServerMonitorResponse
  | LogMonitorResponse
  | TraceMonitorResponse;

export default DataToProcess;
