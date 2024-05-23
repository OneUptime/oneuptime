
import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import ProbeMonitorResponse from 'Common/Types/Probe/ProbeMonitorResponse';
import Probe from 'Model/Models/Probe';
import ProbePicker from './ProbePicker';
import MonitorType from 'Common/Types/Monitor/MonitorType';
import MetricInfo from './MetricsInfo';
import IncomingMonitorRequest from 'Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest';

export interface ComponentProps {
    probeMonitorResponse?: Array<ProbeMonitorResponse> | undefined;
    incomingMonitorRequest?: IncomingMonitorRequest | undefined;
    probes?: Array<Probe>;
    monitorType: MonitorType;
}

const Metrics: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {


    const [selectedProbe, setSelectedProbe] = React.useState<Probe | undefined>(undefined);

    useEffect(() => {
        // slect first probe if exists

        if (props.probes && props.probes.length > 0) {
            setSelectedProbe(props.probes[0]);
        }
    }, [props.probes]);

    return (
        <div>

            {props.probes && props.probes.length > 0 && selectedProbe && <ProbePicker probes={props.probes} selectedProbe={selectedProbe} onProbeSelected={(probe: Probe) => {
                setSelectedProbe(probe);
            }} />}

            <MetricInfo
                monitorType={props.monitorType}
                probeMonitorResponse={props.probeMonitorResponse?.find((response: ProbeMonitorResponse) => response.probeId === selectedProbe?.id)}
                incomingMonitorRequest={props.incomingMonitorRequest}
            />

        </div>
    );
};

export default Metrics;
