import MetricView from '../../../../../../Components/Metrics/MetricView';
import PageComponentProps from '../../../../../PageComponentProps';
import URL from 'Common/Types/API/URL';
import ObjectID from 'Common/Types/ObjectID';
import Navigation from 'CommonUI/src/Utils/Navigation';
import React, { FunctionComponent, ReactElement } from 'react';

const MetricViewPage: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const metricName: string = URL.decode(Navigation.getLastParamAsString());
    const serviceId: ObjectID = Navigation.getLastParamAsObjectID(2);

    return (
        <MetricView
            serviceId={serviceId}
            metricName={metricName}
        />
    );
};

export default MetricViewPage;
