import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import Workflow, {
    getPlaceholderTriggerNode,
} from 'CommonUI/src/Components/Workflow/Workflow';
import Card from 'CommonUI/src/Components/Card/Card';
import { Edge, Node } from 'reactflow';
import { JSONObject } from 'Common/Types/JSON';
import ModelAPI from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import WorkflowModel from 'Model/Models/Workflow';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import ConfirmModal from 'CommonUI/src/Components/Modal/ConfirmModal';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import ComponentLoader from 'CommonUI/src/Components/ComponentLoader/ComponentLoader';

const Delete: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [saveStatus, setSaveStatus] = useState<string>('');
    const [saveTimeout, setSaveTimeout] = useState<ReturnType<
        typeof setTimeout
    > | null>(null);
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
    const [nodes, setNodes] = useState<Array<Node>>([]);
    const [edges, setEdges] = useState<Array<Edge>>([]);
    const [error, setError] = useState<string>('');

    const loadGraph = async () => {
        try {
            setIsLoading(true);
            const workflow: WorkflowModel | null = await ModelAPI.getItem(
                WorkflowModel,
                modelId,
                {
                    graph: true,
                },
                {}
            );

            if (workflow) {
                if (workflow.graph && (workflow.graph as JSONObject)['nodes']) {
                    if (
                        ((workflow.graph as JSONObject)['nodes'] as Array<Node>)
                            .length === 0
                    ) {
                        // add a placeholder trigger node.
                        setNodes([getPlaceholderTriggerNode()]);
                    } else {
                        setNodes(
                            (workflow.graph as JSONObject)[
                                'nodes'
                            ] as Array<Node>
                        );
                    }
                } else {
                    // add a placeholder trigger node.
                    setNodes([getPlaceholderTriggerNode()]);
                }

                if (workflow.graph && (workflow.graph as JSONObject)['edges']) {
                    setEdges(
                        (workflow.graph as JSONObject)['edges'] as Array<Edge>
                    );
                } else {
                    setEdges([]);
                }
            } else {
                setError('Workflow not found');
            }
        } catch (err) {
            try {
                setError(
                    (err as HTTPErrorResponse).message ||
                        'Server Error. Please try again'
                );
            } catch (e) {
                setError('Server Error. Please try again');
            }
        }

        setIsLoading(false);
    };

    const saveGraph = async (nodes: Array<Node>, edges: Array<Edge>) => {
        setSaveStatus('Saving...');

        if (saveTimeout) {
            clearTimeout(saveTimeout);
            setSaveTimeout(null);
        }

        setSaveTimeout(
            setTimeout(async () => {
                try {
                    const graph: JSONObject = {
                        nodes,
                        edges,
                    };

                    await ModelAPI.updateById(WorkflowModel, modelId, {
                        graph,
                    });

                    setSaveStatus('Changes Saved.');
                } catch (err) {
                    try {
                        setError(
                            (err as HTTPErrorResponse).message ||
                                'Server Error. Please try again'
                        );
                    } catch (e) {
                        setError('Server Error. Please try again');
                    }

                    setSaveStatus('Save Error.');
                }

                if (saveTimeout) {
                    clearTimeout(saveTimeout);
                    setSaveTimeout(null);
                }
            }, 1000)
        );
    };

    useEffect(() => {
        loadGraph();
    }, []);

    // const initialNodes: Array<Node> = [
    //     {
    //         id: '1',
    //         type: 'node',
    //         position: { x: 100, y: 100 },
    //         data: {
    //             id: 'slack-1',
    //             title: 'Slack',
    //             description: 'Open a channel',
    //             icon: IconProp.Add,
    //             isTrigger: true,
    //         },
    //     },
    //     {
    //         id: '3',
    //         type: 'node',
    //         position: { x: 100, y: 300 },
    //         data: {
    //             id: 'slack-2',
    //             title: 'Slack',
    //             description: 'Open a channel',
    //             icon: IconProp.Add,
    //             isTrigger: false,
    //         },
    //     },
    //     {
    //         id: '2',
    //         type: 'addNewNode',
    //         position: { x: 100, y: 500 },
    //         data: {
    //             id: 'slack-3',
    //             title: 'Slack',
    //             description: 'Open a channel',
    //             icon: IconProp.Add,
    //             isTrigger: true,
    //         },
    //     },
    // ];

    // const initialEdges: Array<Edge> = [
    //     {
    //         id: 'e1-2',
    //         source: '1',
    //         target: '3',
    //     },
    // ];

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
            <>
                <Card
                    title={'Workflow Builder'}
                    description={'Workflow builder for OneUptime'}
                    rightElement={
                        <p className="text-sm text-gray-400">{saveStatus}</p>
                    }
                >
                    {isLoading ? <ComponentLoader /> : <></>}

                    {!isLoading ? (
                        <Workflow
                            initialNodes={nodes}
                            initialEdges={edges}
                            onWorkflowUpdated={(
                                nodes: Array<Node>,
                                edges: Array<Edge>
                            ) => {
                                setNodes(nodes);
                                setEdges(edges);
                                saveGraph(nodes, edges);
                            }}
                        />
                    ) : (
                        <></>
                    )}
                </Card>
                {error && (
                    <ConfirmModal
                        title={`Error`}
                        description={`${error}`}
                        submitButtonText={'Close'}
                        onSubmit={() => {
                            setError('');
                        }}
                        submitButtonType={ButtonStyleType.NORMAL}
                    />
                )}
            </>
        </Page>
    );
};

export default Delete;
