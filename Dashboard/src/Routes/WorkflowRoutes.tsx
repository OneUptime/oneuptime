import Loader from '../Components/Loader/Loader';
import ComponentProps from '../Pages/PageComponentProps';
import WorkflowsLayout from '../Pages/Workflow/Layout';
import WorkflowViewLayout from '../Pages/Workflow/View/Layout';
import PageMap from '../Utils/PageMap';
import RouteMap, { RouteUtil, WorkflowRoutePath } from '../Utils/RouteMap';
import Route from 'Common/Types/API/Route';
import React, {
    FunctionComponent,
    LazyExoticComponent,
    ReactElement,
    Suspense,
    lazy,
} from 'react';
import { Route as PageRoute, Routes } from 'react-router-dom';

// Lazy Pages
const Workflows: LazyExoticComponent<FunctionComponent<ComponentProps>> = lazy(
    () => {
        return import('../Pages/Workflow/Workflows');
    }
);
const WorkflowsVariables: LazyExoticComponent<
    FunctionComponent<ComponentProps>
> = lazy(() => {
    return import('../Pages/Workflow/Variable');
});
const WorkflowsLogs: LazyExoticComponent<FunctionComponent<ComponentProps>> =
    lazy(() => {
        return import('../Pages/Workflow/Logs');
    });
const WorkflowLogs: LazyExoticComponent<FunctionComponent<ComponentProps>> =
    lazy(() => {
        return import('../Pages/Workflow/View/Logs');
    });
const WorkflowDelete: LazyExoticComponent<FunctionComponent<ComponentProps>> =
    lazy(() => {
        return import('../Pages/Workflow/View/Delete');
    });
const WorkflowBuilder: LazyExoticComponent<FunctionComponent<ComponentProps>> =
    lazy(() => {
        return import('../Pages/Workflow/View/Builder');
    });
const WorkflowOverview: LazyExoticComponent<FunctionComponent<ComponentProps>> =
    lazy(() => {
        return import('../Pages/Workflow/View/Index');
    });
const WorkflowVariables: LazyExoticComponent<
    FunctionComponent<ComponentProps>
> = lazy(() => {
    return import('../Pages/Workflow/View/Variable');
});
const WorkflowSettings: LazyExoticComponent<FunctionComponent<ComponentProps>> =
    lazy(() => {
        return import('../Pages/Workflow/View/Settings');
    });

const WorkflowRoutes: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <Routes>
            <PageRoute path="/" element={<WorkflowsLayout {...props} />}>
                <PageRoute
                    index
                    element={
                        <Suspense fallback={Loader}>
                            <Workflows
                                {...props}
                                pageRoute={RouteMap[PageMap.WORKFLOWS] as Route}
                            />
                        </Suspense>
                    }
                />

                <PageRoute
                    path={WorkflowRoutePath[PageMap.WORKFLOWS_VARIABLES] || ''}
                    element={
                        <Suspense fallback={Loader}>
                            <WorkflowsVariables
                                {...props}
                                pageRoute={
                                    RouteMap[
                                        PageMap.WORKFLOWS_VARIABLES
                                    ] as Route
                                }
                            />
                        </Suspense>
                    }
                />

                <PageRoute
                    path={WorkflowRoutePath[PageMap.WORKFLOWS_LOGS] || ''}
                    element={
                        <Suspense fallback={Loader}>
                            <WorkflowsLogs
                                {...props}
                                pageRoute={
                                    RouteMap[PageMap.WORKFLOWS_LOGS] as Route
                                }
                            />
                        </Suspense>
                    }
                />
            </PageRoute>

            <PageRoute
                path={WorkflowRoutePath[PageMap.WORKFLOW_VIEW] || ''}
                element={<WorkflowViewLayout {...props} />}
            >
                <PageRoute
                    index
                    element={
                        <Suspense fallback={Loader}>
                            <WorkflowOverview
                                {...props}
                                pageRoute={
                                    RouteMap[PageMap.WORKFLOW_VIEW] as Route
                                }
                            />
                        </Suspense>
                    }
                />
                <PageRoute
                    path={RouteUtil.getLastPathForKey(
                        PageMap.WORKFLOW_VIEW_SETTINGS
                    )}
                    element={
                        <Suspense fallback={Loader}>
                            <WorkflowSettings
                                {...props}
                                pageRoute={
                                    RouteMap[
                                        PageMap.WORKFLOW_VIEW_SETTINGS
                                    ] as Route
                                }
                            />
                        </Suspense>
                    }
                />

                <PageRoute
                    path={RouteUtil.getLastPathForKey(
                        PageMap.WORKFLOW_VARIABLES
                    )}
                    element={
                        <Suspense fallback={Loader}>
                            <WorkflowVariables
                                {...props}
                                pageRoute={
                                    RouteMap[
                                        PageMap.WORKFLOW_VARIABLES
                                    ] as Route
                                }
                            />
                        </Suspense>
                    }
                />

                <PageRoute
                    path={RouteUtil.getLastPathForKey(PageMap.WORKFLOW_BUILDER)}
                    element={
                        <Suspense fallback={Loader}>
                            <WorkflowBuilder
                                {...props}
                                pageRoute={
                                    RouteMap[PageMap.WORKFLOW_BUILDER] as Route
                                }
                            />
                        </Suspense>
                    }
                />

                <PageRoute
                    path={RouteUtil.getLastPathForKey(PageMap.WORKFLOW_LOGS)}
                    element={
                        <Suspense fallback={Loader}>
                            <WorkflowLogs
                                {...props}
                                pageRoute={
                                    RouteMap[PageMap.WORKFLOW_LOGS] as Route
                                }
                            />
                        </Suspense>
                    }
                />

                <PageRoute
                    path={RouteUtil.getLastPathForKey(PageMap.WORKFLOW_DELETE)}
                    element={
                        <Suspense fallback={Loader}>
                            <WorkflowDelete
                                {...props}
                                pageRoute={
                                    RouteMap[PageMap.WORKFLOW_DELETE] as Route
                                }
                            />
                        </Suspense>
                    }
                />
            </PageRoute>
        </Routes>
    );
};

export default WorkflowRoutes;
