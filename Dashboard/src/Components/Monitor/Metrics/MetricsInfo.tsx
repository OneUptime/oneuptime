
import MonitorType from 'Common/Types/Monitor/MonitorType';
import ProbeMonitorResponse from 'Common/Types/Probe/ProbeMonitorResponse';
import IncomingMonitorRequest from 'Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest';
import React, { FunctionComponent, ReactElement } from 'react';
import WebsiteMonitorMetricView from './WebsiteMonitorMetricView';
import IncomingRequestMonitorView from './IncomingRequestMonitorRequestView';

export interface ComponentProps {
    monitorType: MonitorType;
    probeMonitorResponse?: ProbeMonitorResponse | undefined;
    incomingMonitorRequest?: IncomingMonitorRequest | undefined;
}

const MetricInfo: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    return (
        <div>

            {props.probeMonitorResponse && (props.monitorType === MonitorType.Website || props.monitorType === MonitorType.API) ? <WebsiteMonitorMetricView probeMonitorResponse={props.probeMonitorResponse} /> : <></>}
            {props.incomingMonitorRequest && (props.monitorType === MonitorType.IncomingRequest) ? <IncomingRequestMonitorView incomingMonitorRequest={props.incomingMonitorRequest} /> : <></>}

        </div>
    );
};

export default MetricInfo;
