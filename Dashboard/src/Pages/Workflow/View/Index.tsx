import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import Workflow from '../../../Components/Workflow/Workflow';

const Delete: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    return (
        <Page
            title={'Workflow'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route,
                        modelId
                    ),
                },
                {
                    title: 'Workflows',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.WORKFLOWS] as Route,
                        modelId
                    ),
                },
                {
                    title: 'View Workflow',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.WORKFLOW_VIEW] as Route,
                        modelId
                    ),
                },
                {
                    title: 'Builder',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.WORKFLOW_BUILDER] as Route,
                        modelId
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >


            <Workflow name="Workflow" />

        </Page>
    );
};

export default Delete;
