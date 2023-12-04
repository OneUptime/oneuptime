import React, { FunctionComponent } from 'react';
import ComponentProps from '../Pages/PageComponentProps';
import { Routes, Route as PageRoute } from 'react-router';
import RouteMap, { IncidentsRoutePath } from '../Utils/RouteMap';
import PageMap from '../Utils/PageMap';

// Pages

import Incidents from '../Pages/Incidents/Incidents';
import IncidentView from '../Pages/Incidents/View/Index';
import IncidentViewDelete from '../Pages/Incidents/View/Delete';
import IncidentViewStateTimeline from '../Pages/Incidents/View/StateTimeline';
import IncidentInternalNote from '../Pages/Incidents/View/InternalNote';
import IncidentPublicNote from '../Pages/Incidents/View/PublicNote';
import UnresolvedIncidents from '../Pages/Incidents/Unresolved';
import IncidentViewCustomFields from '../Pages/Incidents/View/CustomFields';
import IncidentViewOwner from '../Pages/Incidents/View/Owners';
import Route from 'Common/Types/API/Route';

const IncidentsRoutes: FunctionComponent<ComponentProps> = (
    props: ComponentProps
) => {
    return (
        <Routes>
            <PageRoute
                path={IncidentsRoutePath[PageMap.INCIDENTS] || ''}
                element={
                    <Incidents
                        {...props}
                        pageRoute={RouteMap[PageMap.INCIDENTS] as Route}
                    />
                }
            />

            <PageRoute
                path={IncidentsRoutePath[PageMap.UNRESOLVED_INCIDENTS] || ''}
                element={
                    <UnresolvedIncidents
                        {...props}
                        pageRoute={
                            RouteMap[PageMap.UNRESOLVED_INCIDENTS] as Route
                        }
                    />
                }
            />

            <PageRoute
                path={IncidentsRoutePath[PageMap.INCIDENT_VIEW] || ''}
                element={
                    <IncidentView
                        {...props}
                        pageRoute={RouteMap[PageMap.INCIDENT_VIEW] as Route}
                    />
                }
            />

            <PageRoute
                path={IncidentsRoutePath[PageMap.INCIDENT_VIEW_DELETE] || ''}
                element={
                    <IncidentViewDelete
                        {...props}
                        pageRoute={
                            RouteMap[PageMap.INCIDENT_VIEW_DELETE] as Route
                        }
                    />
                }
            />

            <PageRoute
                path={
                    IncidentsRoutePath[PageMap.INCIDENT_VIEW_STATE_TIMELINE] ||
                    ''
                }
                element={
                    <IncidentViewStateTimeline
                        {...props}
                        pageRoute={
                            RouteMap[
                                PageMap.INCIDENT_VIEW_STATE_TIMELINE
                            ] as Route
                        }
                    />
                }
            />

            <PageRoute
                path={IncidentsRoutePath[PageMap.INCIDENT_INTERNAL_NOTE] || ''}
                element={
                    <IncidentInternalNote
                        {...props}
                        pageRoute={
                            RouteMap[PageMap.INCIDENT_INTERNAL_NOTE] as Route
                        }
                    />
                }
            />

            <PageRoute
                path={
                    IncidentsRoutePath[PageMap.INCIDENT_VIEW_CUSTOM_FIELDS] ||
                    ''
                }
                element={
                    <IncidentViewCustomFields
                        {...props}
                        pageRoute={
                            RouteMap[
                                PageMap.INCIDENT_VIEW_CUSTOM_FIELDS
                            ] as Route
                        }
                    />
                }
            />

            <PageRoute
                path={IncidentsRoutePath[PageMap.INCIDENT_PUBLIC_NOTE] || ''}
                element={
                    <IncidentPublicNote
                        {...props}
                        pageRoute={
                            RouteMap[PageMap.INCIDENT_PUBLIC_NOTE] as Route
                        }
                    />
                }
            />

            <PageRoute
                path={IncidentsRoutePath[PageMap.INCIDENT_VIEW_OWNERS] || ''}
                element={
                    <IncidentViewOwner
                        {...props}
                        pageRoute={
                            RouteMap[PageMap.INCIDENT_VIEW_OWNERS] as Route
                        }
                    />
                }
            />
        </Routes>
    );
};

export default IncidentsRoutes;
