import Route from 'Common/Types/API/Route';
import ModelPage from 'CommonUI/src/Components/Page/ModelPage';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ModelDelete from 'CommonUI/src/Components/ModelDelete/ModelDelete';
import ObjectID from 'Common/Types/ObjectID';
import ScheduledMaintenance from 'Model/Models/ScheduledMaintenance';

const IncidentDelete: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    return (
        <ModelPage
            title="Scheduled Event"
            modelType={ScheduledMaintenance}
            modelId={modelId}
            modelNameField="title"
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'Scheduled Maintenance Events',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'View Scheduled Maintenance Event',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SCHEDULED_MAINTENANCE_VIEW] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'Delete Scheduled Maintenance',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[
                            PageMap.SCHEDULED_MAINTENANCE_VIEW_DELETE
                        ] as Route,
                        { modelId }
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <ModelDelete
                modelType={ScheduledMaintenance}
                modelId={modelId}
                onDeleteSuccess={() => {
                    Navigation.navigate(
                        RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS] as Route
                    );
                }}
            />
        </ModelPage>
    );
};

export default IncidentDelete;
