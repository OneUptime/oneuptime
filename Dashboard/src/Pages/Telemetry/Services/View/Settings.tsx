import React, { Fragment, FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../../../PageComponentProps';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import TelemetryService from 'Model/Models/TelemetryService';
import ResetObjectID from 'CommonUI/src/Components/ResetObjectID/ResetObjectID';

const ServiceDelete: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    return (
        <Fragment>
            <ResetObjectID<TelemetryService>
                modelType={TelemetryService}
                fieldName={'telemetryServiceToken'}
                title={'Reset Service Token'}
                description={'Reset the service token to a new value.'}
                modelId={modelId}
            />
        </Fragment>
    );
};

export default ServiceDelete;
