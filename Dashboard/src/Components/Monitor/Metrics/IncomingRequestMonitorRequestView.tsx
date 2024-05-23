import OneUptimeDate from 'Common/Types/Date';
import IncomingMonitorRequest from 'Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest';
import InfoCard from 'CommonUI/src/Components/InfoCard/InfoCard';
import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    incomingMonitorRequest: IncomingMonitorRequest;
}

const IncomingRequestMonitorView: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div className="flex space-x-3 justify-between">
            <InfoCard
                title="Request Received At"
                value={
                    props.incomingMonitorRequest?.incomingRequestReceivedAt
                        ? OneUptimeDate.getDateAsLocalFormattedString(
                              props.incomingMonitorRequest
                                  .incomingRequestReceivedAt
                          )
                        : '-'
                }
            />
        </div>
    );
};

export default IncomingRequestMonitorView;
