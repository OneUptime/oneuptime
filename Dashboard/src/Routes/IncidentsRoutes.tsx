import Loader from '../Components/Loader/Loader';
import Layout from '../Pages/Incidents/Layout';
import IncidentViewLayout from '../Pages/Incidents/View/Layout';
import ComponentProps from '../Pages/PageComponentProps';
import PageMap from '../Utils/PageMap';
import RouteMap, { IncidentsRoutePath, RouteUtil } from '../Utils/RouteMap';
import Route from 'Common/Types/API/Route';
import React, {
    FunctionComponent,
    LazyExoticComponent,
    Suspense,
    lazy,
} from 'react';
import { Route as PageRoute, Routes } from 'react-router-dom';

// Pages
const Incidents: LazyExoticComponent<FunctionComponent<ComponentProps>> = lazy(
    () => {
        return import('../Pages/Incidents/Incidents');
    }
);
const IncidentView: LazyExoticComponent<FunctionComponent<ComponentProps>> =
    lazy(() => {
        return import('../Pages/Incidents/View/Index');
    });
const IncidentViewDelete: LazyExoticComponent<
    FunctionComponent<ComponentProps>
> = lazy(() => {
    return import('../Pages/Incidents/View/Delete');
});
const IncidentViewStateTimeline: LazyExoticComponent<
    FunctionComponent<ComponentProps>
> = lazy(() => {
    return import('../Pages/Incidents/View/StateTimeline');
});
const IncidentInternalNote: LazyExoticComponent<
    FunctionComponent<ComponentProps>
> = lazy(() => {
    return import('../Pages/Incidents/View/InternalNote');
});
const IncidentPublicNote: LazyExoticComponent<
    FunctionComponent<ComponentProps>
> = lazy(() => {
    return import('../Pages/Incidents/View/PublicNote');
});
const UnresolvedIncidents: LazyExoticComponent<
    FunctionComponent<ComponentProps>
> = lazy(() => {
    return import('../Pages/Incidents/Unresolved');
});
const IncidentViewCustomFields: LazyExoticComponent<
    FunctionComponent<ComponentProps>
> = lazy(() => {
    return import('../Pages/Incidents/View/CustomFields');
});
const IncidentViewOwner: LazyExoticComponent<
    FunctionComponent<ComponentProps>
> = lazy(() => {
    return import('../Pages/Incidents/View/Owners');
});

const IncidentsRoutes: FunctionComponent<ComponentProps> = (
    props: ComponentProps
) => {
    return (
        <Routes>
            <PageRoute path="/" element={<Layout {...props} />}>
                <PageRoute
                    path={IncidentsRoutePath[PageMap.INCIDENTS] || ''}
                    element={
                        <Suspense fallback={Loader}>
                            <Incidents
                                {...props}
                                pageRoute={RouteMap[PageMap.INCIDENTS] as Route}
                            />
                        </Suspense>
                    }
                />

                <PageRoute
                    path={
                        IncidentsRoutePath[PageMap.UNRESOLVED_INCIDENTS] || ''
                    }
                    element={
                        <Suspense fallback={Loader}>
                            <UnresolvedIncidents
                                {...props}
                                pageRoute={
                                    RouteMap[
                                        PageMap.UNRESOLVED_INCIDENTS
                                    ] as Route
                                }
                            />
                        </Suspense>
                    }
                />
            </PageRoute>

            <PageRoute
                path={IncidentsRoutePath[PageMap.INCIDENT_VIEW] || ''}
                element={<IncidentViewLayout {...props} />}
            >
                <PageRoute
                    index
                    element={
                        <Suspense fallback={Loader}>
                            <IncidentView
                                {...props}
                                pageRoute={
                                    RouteMap[PageMap.INCIDENT_VIEW] as Route
                                }
                            />
                        </Suspense>
                    }
                />
                <PageRoute
                    path={RouteUtil.getLastPathForKey(
                        PageMap.INCIDENT_VIEW_DELETE
                    )}
                    element={
                        <Suspense fallback={Loader}>
                            <IncidentViewDelete
                                {...props}
                                pageRoute={
                                    RouteMap[
                                        PageMap.INCIDENT_VIEW_DELETE
                                    ] as Route
                                }
                            />
                        </Suspense>
                    }
                />

                <PageRoute
                    path={RouteUtil.getLastPathForKey(
                        PageMap.INCIDENT_VIEW_STATE_TIMELINE
                    )}
                    element={
                        <Suspense fallback={Loader}>
                            <IncidentViewStateTimeline
                                {...props}
                                pageRoute={
                                    RouteMap[
                                        PageMap.INCIDENT_VIEW_STATE_TIMELINE
                                    ] as Route
                                }
                            />
                        </Suspense>
                    }
                />

                <PageRoute
                    path={RouteUtil.getLastPathForKey(
                        PageMap.INCIDENT_INTERNAL_NOTE
                    )}
                    element={
                        <Suspense fallback={Loader}>
                            <IncidentInternalNote
                                {...props}
                                pageRoute={
                                    RouteMap[
                                        PageMap.INCIDENT_INTERNAL_NOTE
                                    ] as Route
                                }
                            />
                        </Suspense>
                    }
                />

                <PageRoute
                    path={RouteUtil.getLastPathForKey(
                        PageMap.INCIDENT_VIEW_CUSTOM_FIELDS
                    )}
                    element={
                        <Suspense fallback={Loader}>
                            <IncidentViewCustomFields
                                {...props}
                                pageRoute={
                                    RouteMap[
                                        PageMap.INCIDENT_VIEW_CUSTOM_FIELDS
                                    ] as Route
                                }
                            />
                        </Suspense>
                    }
                />

                <PageRoute
                    path={RouteUtil.getLastPathForKey(
                        PageMap.INCIDENT_PUBLIC_NOTE
                    )}
                    element={
                        <Suspense fallback={Loader}>
                            <IncidentPublicNote
                                {...props}
                                pageRoute={
                                    RouteMap[
                                        PageMap.INCIDENT_PUBLIC_NOTE
                                    ] as Route
                                }
                            />
                        </Suspense>
                    }
                />

                <PageRoute
                    path={RouteUtil.getLastPathForKey(
                        PageMap.INCIDENT_VIEW_OWNERS
                    )}
                    element={
                        <Suspense fallback={Loader}>
                            <IncidentViewOwner
                                {...props}
                                pageRoute={
                                    RouteMap[
                                        PageMap.INCIDENT_VIEW_OWNERS
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

export default IncidentsRoutes;
