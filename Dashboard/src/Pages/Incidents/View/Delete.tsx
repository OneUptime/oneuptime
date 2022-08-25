import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ModelDelete from 'CommonUI/src/Components/ModelDelete/ModelDelete';
import ObjectID from 'Common/Types/ObjectID';
import Incident from 'Model/Models/Incident';

const IncidentDelete: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = new ObjectID(
        Navigation.getLastParam(1)?.toString().substring(1) || ''
    );

    return (
        <Page
            title={'Incidents'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route,
                        modelId
                    ),
                },
                {
                    title: 'Incidents',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.INCIDENTS] as Route,
                        modelId
                    ),
                },
                {
                    title: 'View Incident',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.INCIDENT_VIEW] as Route,
                        modelId
                    ),
                },
                {
                    title: 'Delete Incident',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.INCIDENT_VIEW_DELETE] as Route,
                        modelId
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <ModelDelete
                modelType={Incident}
                modelId={modelId}
                onDeleteSuccess={() => {
                    Navigation.navigate(RouteMap[PageMap.INCIDENTS] as Route);
                }}
            />
        </Page>
    );
};

export default IncidentDelete;
