import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import Workflow from 'CommonUI/src/Components/Workflow/Workflow';
import Card from 'CommonUI/src/Components/Card/Card';
import IconProp from 'Common/Types/Icon/IconProp';
import { Edge, Node } from 'reactflow';

const Delete: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const initialNodes: Array<Node> = [
        {
            id: '1',
            type: 'node',
            position: { x: 100, y: 100 },
            data: {
                id: 'slack-1',
                title: 'Slack',
                description: 'Open a channel',
                icon: IconProp.Add,
                isTrigger: true,
            },
        },
        {
            id: '3',
            type: 'node',
            position: { x: 100, y: 300 },
            data: {
                id: 'slack-2',
                title: 'Slack',
                description: 'Open a channel',
                icon: IconProp.Add,
                isTrigger: false,
            },
        },
        {
            id: '2',
            type: 'addNewNode',
            position: { x: 100, y: 500 },
            data: {
                id: 'slack-3',
                title: 'Slack',
                description: 'Open a channel',
                icon: IconProp.Add,
                isTrigger: true,
            },
        },
    ];

    const initialEdges: Array<Edge> = [
        {
            id: 'e1-2',
            source: '1',
            target: '3',
        },
    ];

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
            <Card
                title={'Workflow Builder'}
                description={'Workflow builder for OneUptime'}
            >
                <Workflow
                    initialNodes={initialNodes}
                    initialEdges={initialEdges}
                />
            </Card>
        </Page>
    );
};

export default Delete;
