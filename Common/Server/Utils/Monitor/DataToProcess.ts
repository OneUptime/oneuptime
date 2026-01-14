import IncomingMonitorRequest from "../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import IncomingEmailMonitorRequest from "../../../Types/Monitor/IncomingEmailMonitor/IncomingEmailMonitorRequest";
import ServerMonitorResponse from "../../../Types/Monitor/ServerMonitor/ServerMonitorResponse";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import LogMonitorResponse from "../../../Types/Monitor/LogMonitor/LogMonitorResponse";
import TraceMonitorResponse from "../../../Types/Monitor/TraceMonitor/TraceMonitorResponse";
import MetricMonitorResponse from "../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import ExceptionMonitorResponse from "../../../Types/Monitor/ExceptionMonitor/ExceptionMonitorResponse";

type DataToProcess =
  | ProbeMonitorResponse
  | IncomingMonitorRequest
  | IncomingEmailMonitorRequest
  | ServerMonitorResponse
  | LogMonitorResponse
  | TraceMonitorResponse
  | MetricMonitorResponse
  | ExceptionMonitorResponse;

export default DataToProcess;
