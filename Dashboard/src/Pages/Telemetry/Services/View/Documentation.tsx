import TelemetryDocumentation from '../../../../Components/Telemetry/Documentation';
import PageComponentProps from '../../../PageComponentProps';
import React, { Fragment, FunctionComponent, ReactElement } from 'react';

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
