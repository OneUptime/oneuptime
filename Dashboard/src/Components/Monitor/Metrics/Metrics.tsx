import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import ProbeMonitorResponse from 'Common/Types/Probe/ProbeMonitorResponse';
import Probe from 'Model/Models/Probe';
import ProbePicker from './ProbePicker';
import MonitorType, {
    MonitorTypeHelper,
} from 'Common/Types/Monitor/MonitorType';
import MetricInfo from './MetricsInfo';
import IncomingMonitorRequest from 'Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest';
import Card from 'CommonUI/src/Components/Card/Card';
import { MonitorStepProbeResponse } from 'Model/Models/MonitorProbe';

export interface ComponentProps {
    probeMonitorResponses?: Array<MonitorStepProbeResponse> | undefined;
    incomingMonitorRequest?: IncomingMonitorRequest | undefined;
    probes?: Array<Probe>;
    monitorType: MonitorType;
}

const Metrics: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [selectedProbe, setSelectedProbe] = React.useState<Probe | undefined>(
        undefined
    );

    useEffect(() => {
        // slect first probe if exists

        if (props.probes && props.probes.length > 0) {
            setSelectedProbe(props.probes[0]);
        }
    }, [props.probes]);

    if (props.monitorType === MonitorType.Manual) {
        return <></>;
    }

    const probeResponses: Array<ProbeMonitorResponse> = [];

    for (const probeResponse of props.probeMonitorResponses || []) {
        for (const monitorStepId in probeResponse) {
            const probeMonitorResponse = probeResponse[
                monitorStepId
            ] as ProbeMonitorResponse;
            if (
                probeMonitorResponse.probeId?.toString() ===
                selectedProbe?.id?.toString()
            ) {
                probeResponses.push(probeMonitorResponse);
            }
        }
    }

    return (
        <Card
            title="Current Metrics"
            description="Here is how your monitor is performing at this moment."
            rightElement={
                MonitorTypeHelper.isProbableMonitors(props.monitorType) &&
                props.probes &&
                props.probes.length > 0 &&
                selectedProbe ? (
                    <ProbePicker
                        probes={props.probes}
                        selectedProbe={selectedProbe}
                        onProbeSelected={(probe: Probe) => {
                            setSelectedProbe(probe);
                        }}
                    />
                ) : (
                    <></>
                )
            }
        >
            <div>
                <MetricInfo
                    monitorType={props.monitorType}
                    probeMonitorResponses={probeResponses}
                    incomingMonitorRequest={props.incomingMonitorRequest}
                />
            </div>
        </Card>
    );
};

export default Metrics;
