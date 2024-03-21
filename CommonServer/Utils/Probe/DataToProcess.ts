import IncomingMonitorRequest from 'Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest';
import ServerMonitorResponse from 'Common/Types/Monitor/ServerMonitor/ServerMonitorResponse';
import ProbeMonitorResponse from 'Common/Types/Probe/ProbeMonitorResponse';

type DataToProcess =
    | ProbeMonitorResponse
    | IncomingMonitorRequest
    | ServerMonitorResponse;

export default DataToProcess;
