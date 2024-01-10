import Route from 'Common/Types/API/Route';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ModelDelete from 'CommonUI/src/Components/ModelDelete/ModelDelete';
import ObjectID from 'Common/Types/ObjectID';
import Incident from 'Model/Models/Incident';

const IncidentDelete: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    return (
        <ModelDelete
            modelType={Incident}
            modelId={modelId}
            onDeleteSuccess={() => {
                Navigation.navigate(
                    RouteUtil.populateRouteParams(
                        RouteMap[PageMap.INCIDENTS] as Route,
                        { modelId }
                    )
                );
            }}
        />
    );
};

export default IncidentDelete;
