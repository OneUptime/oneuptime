import DisabledWarning from '../../../Components/Monitor/DisabledWarning';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import Route from 'Common/Types/API/Route';
import ObjectID from 'Common/Types/ObjectID';
import ModelDelete from 'CommonUI/src/Components/ModelDelete/ModelDelete';
import Navigation from 'CommonUI/src/Utils/Navigation';
import Monitor from 'Model/Models/Monitor';
import React, { Fragment, FunctionComponent, ReactElement } from 'react';

const MonitorDelete: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    return (
        <Fragment>
            <DisabledWarning monitorId={modelId} />
            <ModelDelete
                modelType={Monitor}
                modelId={modelId}
                onDeleteSuccess={() => {
                    Navigation.navigate(
                        RouteUtil.populateRouteParams(
                            RouteMap[PageMap.MONITORS] as Route,
                            { modelId }
                        )
                    );
                }}
            />
        </Fragment>
    );
};

export default MonitorDelete;
