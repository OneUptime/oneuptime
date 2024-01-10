import Route from 'Common/Types/API/Route';
import React, { Fragment, FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ModelDelete from 'CommonUI/src/Components/ModelDelete/ModelDelete';
import ObjectID from 'Common/Types/ObjectID';
import MonitorGroup from 'Model/Models/MonitorGroup';

const MonitorGroupDelete: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    return (
        <Fragment>
            <ModelDelete
                modelType={MonitorGroup}
                modelId={modelId}
                onDeleteSuccess={() => {
                    Navigation.navigate(
                        RouteUtil.populateRouteParams(
                            RouteMap[PageMap.MONITOR_GROUPS] as Route,
                            { modelId }
                        )
                    );
                }}
            />
        </Fragment>
    );
};

export default MonitorGroupDelete;
