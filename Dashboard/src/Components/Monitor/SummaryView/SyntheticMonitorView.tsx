import SyntheticMonitorResponse from 'Common/Types/Monitor/SyntheticMonitors/SyntheticMonitorResponse';
import ProbeMonitorResponse from 'Common/Types/Probe/ProbeMonitorResponse';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import React, { FunctionComponent, ReactElement } from 'react';
import SyntheticMonitorItemView from './SyntheticMonitorItemView';

export interface ComponentProps {
    probeMonitorResponse: ProbeMonitorResponse;
}

const SyntheticMonitorView: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    if (
        !props.probeMonitorResponse ||
        !props.probeMonitorResponse.syntheticMonitorResponse
    ) {
        return (
            <ErrorMessage error="No summary available for the selected probe. Should be few minutes for summary to show up. " />
        );
    }

    const syntheticMonitorResponses: Array<SyntheticMonitorResponse> =
        props.probeMonitorResponse.syntheticMonitorResponse;

    return (
        <div>
            {syntheticMonitorResponses &&
                syntheticMonitorResponses.map(
                    (syntheticMonitorResponse: SyntheticMonitorResponse, index: number) => {
                        return (
                            <SyntheticMonitorItemView
                                key={index}
                                syntheticMonitorResponse={
                                    syntheticMonitorResponse
                                }
                                monitoredAt={
                                    props.probeMonitorResponse.monitoredAt
                                }
                            />
                        );
                    }
                )}
        </div>
    );
};

export default SyntheticMonitorView;
