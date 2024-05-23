
import OneUptimeDate from 'Common/Types/Date';
import ProbeMonitorResponse from 'Common/Types/Probe/ProbeMonitorResponse';
import InfoCard from 'CommonUI/src/Components/InfoCard/InfoCard';
import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    probeMonitorResponse: ProbeMonitorResponse; 
}

const WebsiteMonitorMetricView: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return <div className='flex space-x-3 justify-between'>
    <InfoCard title='Response Staus Code' value={props.probeMonitorResponse?.responseCode?.toString() || '-'} />
    <InfoCard title='Response Time (in ms)' value={props.probeMonitorResponse?.responseTimeInMs?.toString() || '-'} />
    <InfoCard title='Monitored At' value={props.probeMonitorResponse?.monitoredAt ? OneUptimeDate.getDateAsLocalFormattedString(props.probeMonitorResponse.monitoredAt) : '-'} />
</div>
};

export default WebsiteMonitorMetricView;
