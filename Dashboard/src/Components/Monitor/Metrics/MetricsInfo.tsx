import MonitorType from 'Common/Types/Monitor/MonitorType';
import ProbeMonitorResponse from 'Common/Types/Probe/ProbeMonitorResponse';
import IncomingMonitorRequest from 'Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest';
import React, { FunctionComponent, ReactElement } from 'react';
import WebsiteMonitorMetricView from './WebsiteMonitorMetricView';
import IncomingRequestMonitorView from './IncomingRequestMonitorRequestView';

export interface ComponentProps {
    monitorType: MonitorType;
    probeMonitorResponses?: Array<ProbeMonitorResponse> | undefined; // this is an array because of multiple monitor steps.
    incomingMonitorRequest?: IncomingMonitorRequest | undefined;
}

const MetricInfo: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const getProbableMonitorMetricsInfo = (
        probeMonitorResponse: ProbeMonitorResponse,
        key: number
    ): ReactElement => {
        return probeMonitorResponse &&
            (props.monitorType === MonitorType.Website ||
                props.monitorType === MonitorType.API) ? (
            <WebsiteMonitorMetricView
                key={key}
                probeMonitorResponse={probeMonitorResponse}
            />
        ) : (
            <></>
        );
    };

    return (
        <div>
            {props.probeMonitorResponses &&
                props.probeMonitorResponses.map(
                    (probeMonitorResponse, index) => {
                        return getProbableMonitorMetricsInfo(
                            probeMonitorResponse,
                            index
                        );
                    }
                )}

            {props.incomingMonitorRequest &&
            props.monitorType === MonitorType.IncomingRequest ? (
                <IncomingRequestMonitorView
                    incomingMonitorRequest={props.incomingMonitorRequest}
                />
            ) : (
                <></>
            )}
        </div>
    );
};

export default MetricInfo;
