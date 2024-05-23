import OneUptimeDate from 'Common/Types/Date';
import ProbeMonitorResponse from 'Common/Types/Probe/ProbeMonitorResponse';
import Button, { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import Detail from 'CommonUI/src/Components/Detail/Detail';
import Field from 'CommonUI/src/Components/Detail/Field';
import InfoCard from 'CommonUI/src/Components/InfoCard/InfoCard';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    probeMonitorResponse: ProbeMonitorResponse;
}

const WebsiteMonitorMetricView: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {


    const [showMoreDetails, setShowMoreDetails] = React.useState<boolean>(false);

    let responseTimeInMs: number =
        props.probeMonitorResponse?.responseTimeInMs || 0;

    if (responseTimeInMs > 0) {
        responseTimeInMs = Math.round(responseTimeInMs);
    }



    const fields: Array<Field<ProbeMonitorResponse>> = [
        {
            key: 'responseHeaders',
            title: 'Response Headers',
            description: 'Response headers of the request.',
            fieldType: FieldType.JSON
        },
       
    ]

    if(props.probeMonitorResponse?.responseBody){
        fields.push({
            key: 'responseBody',
            title: 'Response Body',
            description: 'Response body of the request.',
            fieldType: FieldType.JSON
        })
    }

    return (
        <div className="space-y-5">
            <div className="flex space-x-3">
                <InfoCard
                    className="w-1/3 shadow-none border-2 border-gray-100 "
                    title="Response Staus Code"
                    value={
                        props.probeMonitorResponse?.responseCode?.toString() || '-'
                    }
                />
                <InfoCard
                    className="w-1/3 shadow-none border-2 border-gray-100 "
                    title="Response Time (in ms)"
                    value={responseTimeInMs ? responseTimeInMs + ' ms' : '-'}
                />
                <InfoCard
                    className="w-1/3 shadow-none border-2 border-gray-100 "
                    title="Monitored At"
                    value={
                        props.probeMonitorResponse?.monitoredAt
                            ? OneUptimeDate.getDateAsLocalFormattedString(
                                props.probeMonitorResponse.monitoredAt
                            )
                            : '-'
                    }
                />
            </div>

            {showMoreDetails && <div>
                <Detail<ProbeMonitorResponse>
                    id={'website-monitor-metric-detail'}
                    item={props.probeMonitorResponse}
                    fields={fields}
                    showDetailsInNumberOfColumns={1}
                />
            </div>}

            {!showMoreDetails && <div className='-ml-2'>
                <Button buttonStyle={ButtonStyleType.SECONDARY_LINK} title='Show More Details' onClick={() => setShowMoreDetails(true)} />
            </div>}

            {/* Hide details button */}

            {showMoreDetails && <div className='-ml-3'>
                <Button buttonStyle={ButtonStyleType.SECONDARY_LINK} title='Hide Details' onClick={() => setShowMoreDetails(false)} />
            </div>}
        </div>
    );
};

export default WebsiteMonitorMetricView;
