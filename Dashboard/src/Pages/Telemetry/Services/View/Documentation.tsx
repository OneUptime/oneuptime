import React, { Fragment, FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../../../PageComponentProps';
import TelemetryDocumentation from '../../../../Components/Telemetry/Documentation';

const TelemetryDocumentationPage: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    return (
        <Fragment>
            <TelemetryDocumentation />
        </Fragment>
    );
};

export default TelemetryDocumentationPage;
