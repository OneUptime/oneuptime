import IncomingMonitorRequest from "../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import IncomingEmailMonitorRequest from "../../../Types/Monitor/IncomingEmailMonitor/IncomingEmailMonitorRequest";
import ServerMonitorResponse from "../../../Types/Monitor/ServerMonitor/ServerMonitorResponse";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import LogMonitorResponse from "../../../Types/Monitor/LogMonitor/LogMonitorResponse";
import SecurityEventsMonitorResponse from "../../../Types/Monitor/SecurityEventsMonitor/SecurityEventsMonitorResponse";
import TraceMonitorResponse from "../../../Types/Monitor/TraceMonitor/TraceMonitorResponse";
import MetricMonitorResponse from "../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import ExceptionMonitorResponse from "../../../Types/Monitor/ExceptionMonitor/ExceptionMonitorResponse";
import ProfileMonitorResponse from "../../../Types/Monitor/ProfileMonitor/ProfileMonitorResponse";

type DataToProcess =
  | ProbeMonitorResponse
  | IncomingMonitorRequest
  | IncomingEmailMonitorRequest
  | ServerMonitorResponse
  | LogMonitorResponse
  | SecurityEventsMonitorResponse
  | TraceMonitorResponse
  | MetricMonitorResponse
  | ExceptionMonitorResponse
  | ProfileMonitorResponse;

export default DataToProcess;
