import IncomingMonitorRequest from "Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import ServerMonitorResponse from "Common/Types/Monitor/ServerMonitor/ServerMonitorResponse";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import LogMonitorResponse from "Common/Types/Monitor/LogMonitor/LogMonitorResponse";
import TraceMonitorResponse from "Common/Types/Monitor/TraceMonitor/TraceMonitorResponse";
import MetricMonitorResponse from "../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";

type DataToProcess =
  | ProbeMonitorResponse
  | IncomingMonitorRequest
  | ServerMonitorResponse
  | LogMonitorResponse
  | TraceMonitorResponse
  | MetricMonitorResponse;

export default DataToProcess;
