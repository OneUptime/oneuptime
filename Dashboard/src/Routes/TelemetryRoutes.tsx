import React, {
    FunctionComponent,
    LazyExoticComponent,
    ReactElement,
    Suspense,
    lazy,
} from 'react';
import { Routes, Route as PageRoute } from 'react-router-dom';
import Route from 'Common/Types/API/Route';
import RouteMap, { RouteUtil, TelemetryRouthPath } from '../Utils/RouteMap';
import PageMap from '../Utils/PageMap';
import ComponentProps from '../Pages/PageComponentProps';
import Loader from '../Components/Loader/Loader';
import TelemetryServiceViewLayout from '../Pages/Telemetry/Services/View/Layout';

// Lazy Pages
const TelemetryServices: LazyExoticComponent<
    FunctionComponent<ComponentProps>
> = lazy(() => {
    return import('../Pages/Telemetry/Services');
});
const TelemetryServiceView: LazyExoticComponent<
    FunctionComponent<ComponentProps>
> = lazy(() => {
    return import('../Pages/Telemetry/Services/View/Index');
});
const TelemetryServiceViewDelete: LazyExoticComponent<
    FunctionComponent<ComponentProps>
> = lazy(() => {
    return import('../Pages/Telemetry/Services/View/Delete');
});

const TelemetryServiceViewLogs: LazyExoticComponent<
    FunctionComponent<ComponentProps>
> = lazy(() => {
    return import('../Pages/Telemetry/Services/View/Logs/Index');
});

const TelemetryServiceViewTraces: LazyExoticComponent<
    FunctionComponent<ComponentProps>
> = lazy(() => {
    return import('../Pages/Telemetry/Services/View/Traces/Index');
});

const TelemetryServiceViewTrace: LazyExoticComponent<
    FunctionComponent<ComponentProps>
> = lazy(() => {
    return import('../Pages/Telemetry/Services/View/Traces/View/Index');
});

const TelemetryServiceViewMetrics: LazyExoticComponent<
    FunctionComponent<ComponentProps>
> = lazy(() => {
    return import('../Pages/Telemetry/Services/View/Metrics/Index');
});
const TelemetryServiceViewDashboard: LazyExoticComponent<
    FunctionComponent<ComponentProps>
> = lazy(() => {
    return import('../Pages/Telemetry/Services/View/Dashboard/Index');
});

const TelemetryServicesViewSettings: LazyExoticComponent<
    FunctionComponent<ComponentProps>
> = lazy(() => {
    return import('../Pages/Telemetry/Services/View/Settings');
});

const TelemetryServicesViewDocumentation: LazyExoticComponent<
    FunctionComponent<ComponentProps>
> = lazy(() => {
    return import('../Pages/Telemetry/Services/View/Documentation');
});

const TelemetryRoutes: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <Routes>
            <PageRoute
                index
                element={
                    <Suspense fallback={Loader}>
                        <TelemetryServices
                            {...props}
                            pageRoute={RouteMap[PageMap.TELEMETRY] as Route}
                        />
                    </Suspense>
                }
            />

            <PageRoute
                path={TelemetryRouthPath[PageMap.TELEMETRY_SERVICES] || ''}
                element={
                    <Suspense fallback={Loader}>
                        <TelemetryServices
                            {...props}
                            pageRoute={
                                RouteMap[PageMap.TELEMETRY_SERVICES] as Route
                            }
                        />
                    </Suspense>
                }
            />

            <PageRoute
                path={TelemetryRouthPath[PageMap.TELEMETRY_SERVICES_VIEW] || ''}
                element={<TelemetryServiceViewLayout {...props} />}
            >
                <PageRoute
                    index
                    element={
                        <Suspense fallback={Loader}>
                            <TelemetryServiceView
                                {...props}
                                pageRoute={
                                    RouteMap[
                                        PageMap.TELEMETRY_SERVICES_VIEW
                                    ] as Route
                                }
                            />
                        </Suspense>
                    }
                />
                <PageRoute
                    path={RouteUtil.getLastPathForKey(
                        PageMap.TELEMETRY_SERVICES_VIEW_DELETE
                    )}
                    element={
                        <Suspense fallback={Loader}>
                            <TelemetryServiceViewDelete
                                {...props}
                                pageRoute={
                                    RouteMap[
                                        PageMap.TELEMETRY_SERVICES_VIEW_DELETE
                                    ] as Route
                                }
                            />
                        </Suspense>
                    }
                />
                <PageRoute
                    path={RouteUtil.getLastPathForKey(
                        PageMap.TELEMETRY_SERVICES_VIEW_LOGS
                    )}
                    element={
                        <Suspense fallback={Loader}>
                            <TelemetryServiceViewLogs
                                {...props}
                                pageRoute={
                                    RouteMap[
                                        PageMap.TELEMETRY_SERVICES_VIEW_LOGS
                                    ] as Route
                                }
                            />
                        </Suspense>
                    }
                />

                <PageRoute
                    path={RouteUtil.getLastPathForKey(
                        PageMap.TELEMETRY_SERVICES_VIEW_TRACE, 2
                    )}
                    element={
                        <Suspense fallback={Loader}>
                            <TelemetryServiceViewTrace
                                {...props}
                                pageRoute={
                                    RouteMap[
                                        PageMap.TELEMETRY_SERVICES_VIEW_TRACE
                                    ] as Route
                                }
                            />
                        </Suspense>
                    }
                />

                <PageRoute
                    path={RouteUtil.getLastPathForKey(
                        PageMap.TELEMETRY_SERVICES_VIEW_TRACES
                    )}
                    element={
                        <Suspense fallback={Loader}>
                            <TelemetryServiceViewTraces
                                {...props}
                                pageRoute={
                                    RouteMap[
                                        PageMap.TELEMETRY_SERVICES_VIEW_TRACES
                                    ] as Route
                                }
                            />
                        </Suspense>
                    }
                />

                <PageRoute
                    path={RouteUtil.getLastPathForKey(
                        PageMap.TELEMETRY_SERVICES_VIEW_METRICS
                    )}
                    element={
                        <Suspense fallback={Loader}>
                            <TelemetryServiceViewMetrics
                                {...props}
                                pageRoute={
                                    RouteMap[
                                        PageMap.TELEMETRY_SERVICES_VIEW_METRICS
                                    ] as Route
                                }
                            />
                        </Suspense>
                    }
                />

                <PageRoute
                    path={RouteUtil.getLastPathForKey(
                        PageMap.TELEMETRY_SERVICES_VIEW_DASHBOARDS
                    )}
                    element={
                        <Suspense fallback={Loader}>
                            <TelemetryServiceViewDashboard
                                {...props}
                                pageRoute={
                                    RouteMap[
                                        PageMap
                                            .TELEMETRY_SERVICES_VIEW_DASHBOARDS
                                    ] as Route
                                }
                            />
                        </Suspense>
                    }
                />

                <PageRoute
                    path={RouteUtil.getLastPathForKey(
                        PageMap.TELEMETRY_SERVICES_VIEW_SETTINGS
                    )}
                    element={
                        <Suspense fallback={Loader}>
                            <TelemetryServicesViewSettings
                                {...props}
                                pageRoute={
                                    RouteMap[
                                        PageMap.TELEMETRY_SERVICES_VIEW_SETTINGS
                                    ] as Route
                                }
                            />
                        </Suspense>
                    }
                />

                <PageRoute
                    path={RouteUtil.getLastPathForKey(
                        PageMap.TELEMETRY_SERVICES_VIEW_DOCUMENTATION
                    )}
                    element={
                        <Suspense fallback={Loader}>
                            <TelemetryServicesViewDocumentation
                                {...props}
                                pageRoute={
                                    RouteMap[
                                        PageMap
                                            .TELEMETRY_SERVICES_VIEW_DOCUMENTATION
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

export default TelemetryRoutes;
