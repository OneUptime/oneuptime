import MonitorType, {
    MonitorTypeHelper,
} from 'Common/Types/Monitor/MonitorType';
import ProbeMonitorResponse from 'Common/Types/Probe/ProbeMonitorResponse';
import IncomingMonitorRequest from 'Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest';
import React, { FunctionComponent, ReactElement } from 'react';
import WebsiteMonitorMetricView from './WebsiteMonitorMetricView';
import IncomingRequestMonitorView from './IncomingRequestMonitorRequestView';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import PingMonitorView from './PingMonitorView';
import SSLCertificateMonitorView from './SSLCertificateMonitorViedw';

export interface ComponentProps {
    monitorType: MonitorType;
    probeMonitorResponses?: Array<ProbeMonitorResponse> | undefined; // this is an array because of multiple monitor steps.
    incomingMonitorRequest?: IncomingMonitorRequest | undefined;
}

const MetricInfo: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    type GetProbeableMonitorMetricsInfo = (
        probeMonitorResponse: ProbeMonitorResponse,
        key: number
    ) => ReactElement;

    const getProbableMonitorMetricsInfo: GetProbeableMonitorMetricsInfo = (
        probeMonitorResponse: ProbeMonitorResponse,
        key: number
    ): ReactElement => {
        if (!probeMonitorResponse) {
            return (
                <ErrorMessage
                    error={
                        'No metrics available for the selected probe. Should be few minutes for metrics to show up. '
                    }
                />
            );
        }

        if (
            props.monitorType === MonitorType.Website ||
            props.monitorType === MonitorType.API
        ) {
            return (
                <WebsiteMonitorMetricView
                    key={key}
                    probeMonitorResponse={probeMonitorResponse}
                />
            );
        }

        if (
            props.monitorType === MonitorType.Ping ||
            props.monitorType === MonitorType.IP ||
            props.monitorType === MonitorType.Port
        ) {
            return (
                <PingMonitorView
                    key={key}
                    probeMonitorResponse={probeMonitorResponse}
                />
            );
        }

        if (props.monitorType === MonitorType.SSLCertificate) {
            return (
                <SSLCertificateMonitorView
                    key={key}
                    probeMonitorResponse={probeMonitorResponse}
                />
            );
        }

        return <></>;
    };

    if (
        MonitorTypeHelper.isProbableMonitors(props.monitorType) &&
        (!props.probeMonitorResponses ||
            props.probeMonitorResponses.length === 0)
    ) {
        return (
            <ErrorMessage
                error={
                    'No metrics available for the selected probe. Should be few minutes for metrics to show up. '
                }
            />
        );
    }

    if (
        !props.incomingMonitorRequest &&
        props.monitorType === MonitorType.IncomingRequest
    ) {
        return (
            <ErrorMessage
                error={
                    'No metrics available for the selected probe. Should be few minutes for metrics to show up. '
                }
            />
        );
    }

    return (
        <div>
            {props.probeMonitorResponses &&
                props.probeMonitorResponses.map(
                    (
                        probeMonitorResponse: ProbeMonitorResponse,
                        index: number
                    ) => {
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
