import Loader from '../Components/Loader/Loader';
import MonitorGroupViewLayout from '../Pages/MonitorGroup/View/Layout';
import ComponentProps from '../Pages/PageComponentProps';
import PageMap from '../Utils/PageMap';
import RouteMap, { MonitorGroupRoutePath, RouteUtil } from '../Utils/RouteMap';
import Route from 'Common/Types/API/Route';
import React, {
    FunctionComponent,
    LazyExoticComponent,
    ReactElement,
    Suspense,
    lazy,
} from 'react';
import { Route as PageRoute, Routes } from 'react-router-dom';

// Pages
const MonitorGroups: LazyExoticComponent<FunctionComponent<ComponentProps>> =
    lazy(() => {
        return import('../Pages/MonitorGroup/MonitorGroups');
    });
const MonitorGroupView: LazyExoticComponent<FunctionComponent<ComponentProps>> =
    lazy(() => {
        return import('../Pages/MonitorGroup/View/Index');
    });
const MonitorGroupViewDelete: LazyExoticComponent<
    FunctionComponent<ComponentProps>
> = lazy(() => {
    return import('../Pages/MonitorGroup/View/Delete');
});
const MonitorGroupViewMonitors: LazyExoticComponent<
    FunctionComponent<ComponentProps>
> = lazy(() => {
    return import('../Pages/MonitorGroup/View/Monitors');
});
const MonitorGroupViewIncidents: LazyExoticComponent<
    FunctionComponent<ComponentProps>
> = lazy(() => {
    return import('../Pages/MonitorGroup/View/Incidents');
});
const MonitorGroupViewOwners: LazyExoticComponent<
    FunctionComponent<ComponentProps>
> = lazy(() => {
    return import('../Pages/MonitorGroup/View/Owners');
});

const MonitorGroupRoutes: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <Routes>
            <PageRoute
                path={MonitorGroupRoutePath[PageMap.MONITOR_GROUPS] || ''}
                element={
                    <Suspense fallback={Loader}>
                        <MonitorGroups
                            {...props}
                            pageRoute={
                                RouteMap[PageMap.MONITOR_GROUPS] as Route
                            }
                        />
                    </Suspense>
                }
            />

            <PageRoute
                path={MonitorGroupRoutePath[PageMap.MONITOR_GROUP_VIEW] || ''}
                element={<MonitorGroupViewLayout {...props} />}
            >
                <PageRoute
                    index
                    element={
                        <Suspense fallback={Loader}>
                            <MonitorGroupView
                                {...props}
                                pageRoute={
                                    RouteMap[
                                        PageMap.MONITOR_GROUP_VIEW
                                    ] as Route
                                }
                            />
                        </Suspense>
                    }
                />
                <PageRoute
                    path={RouteUtil.getLastPathForKey(
                        PageMap.MONITOR_GROUP_VIEW_DELETE
                    )}
                    element={
                        <Suspense fallback={Loader}>
                            <MonitorGroupViewDelete
                                {...props}
                                pageRoute={
                                    RouteMap[
                                        PageMap.MONITOR_GROUP_VIEW_DELETE
                                    ] as Route
                                }
                            />
                        </Suspense>
                    }
                />

                <PageRoute
                    path={RouteUtil.getLastPathForKey(
                        PageMap.MONITOR_GROUP_VIEW_MONITORS
                    )}
                    element={
                        <Suspense fallback={Loader}>
                            <MonitorGroupViewMonitors
                                {...props}
                                pageRoute={
                                    RouteMap[
                                        PageMap.MONITOR_GROUP_VIEW_MONITORS
                                    ] as Route
                                }
                            />
                        </Suspense>
                    }
                />

                <PageRoute
                    path={RouteUtil.getLastPathForKey(
                        PageMap.MONITOR_GROUP_VIEW_INCIDENTS
                    )}
                    element={
                        <Suspense fallback={Loader}>
                            <MonitorGroupViewIncidents
                                {...props}
                                pageRoute={
                                    RouteMap[
                                        PageMap.MONITOR_GROUP_VIEW_INCIDENTS
                                    ] as Route
                                }
                            />
                        </Suspense>
                    }
                />

                <PageRoute
                    path={RouteUtil.getLastPathForKey(
                        PageMap.MONITOR_GROUP_VIEW_OWNERS
                    )}
                    element={
                        <Suspense fallback={Loader}>
                            <MonitorGroupViewOwners
                                {...props}
                                pageRoute={
                                    RouteMap[
                                        PageMap.MONITOR_GROUP_VIEW_OWNERS
                                    ] as Route
                                }
                            />
                        </Suspense>
                    }
                />
            </PageRoute>
        </Routes>
    );
};

export default MonitorGroupRoutes;
