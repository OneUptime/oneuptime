import IncomingMonitorRequest from "Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import ServerMonitor from "Common/Types/Monitor/ServerMonitor/ServerMonitor";
import ProbeMonitor from "Common/Types/Monitor/Monitor";

type DataToProcess =
  | ProbeMonitor
  | IncomingMonitorRequest
  | ServerMonitor;

export default DataToProcess;
