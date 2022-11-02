import React, { FunctionComponent, useState } from 'react';
import Route from 'Common/Types/API/Route';
import {
    Routes,
    Route as PageRoute,
    useNavigate,
    useLocation,
    useParams,
} from 'react-router-dom';
import MasterPage from './Components/MasterPage/MasterPage';

import PageNotFound from './Pages/NotFound/PageNotFound';
import Overview from './Pages/Overview/Overview';
import IncidentList from './Pages/Incidents/List';
import IncidentDetail from './Pages/Incidents/Detail';
import AnnouncementList from './Pages/Announcement/List';
import AnnouncementDetail from './Pages/Announcement/Detail';
import ScheduledEventList from './Pages/ScheduledEvent/List';
import ScheduledEventDetail from './Pages/ScheduledEvent/Detail';
import Subscribe from './Pages/Subscribe/Subscribe';

import RouteMap from './Utils/RouteMap';
import PageMap from './Utils/PageMap';

import 'CommonUI/src/Styles/theme.scss';
import Navigation from 'CommonUI/src/Utils/Navigation';
import { JSONFunctions, JSONObject } from 'Common/Types/JSON';

const App: FunctionComponent = () => {
    Navigation.setNavigateHook(useNavigate());
    Navigation.setLocation(useLocation());
    Navigation.setParams(useParams());

    // js.
    const [javascript, setJavaScript] = useState<string | null>(null);

    const onPageLoadComplete: Function = (): void => {
        if (javascript) {
            eval(javascript);
        }
    };

    return (
        <MasterPage
            onLoadComplete={(masterpage: JSONObject) => {
                const javascript: string | null = JSONFunctions.getJSONValueInPath(
                    masterpage || {},
                    'statusPage.customJavaScript'
                ) as string | null;
                if (javascript) {
                    setJavaScript(javascript);
                }
            }}
        >
            <Routes>
                {/* Live */}

                <PageRoute
                    path={RouteMap[PageMap.OVERVIEW]?.toString()}
                    element={
                        <Overview
                            pageRoute={RouteMap[PageMap.OVERVIEW] as Route}
                            onLoadComplete={() => {
                                onPageLoadComplete();
                            }}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.SCHEDULED_EVENT_DETAIL]?.toString()}
                    element={
                        <ScheduledEventDetail
                            pageRoute={
                                RouteMap[
                                    PageMap.SCHEDULED_EVENT_DETAIL
                                ] as Route
                            }
                            onLoadComplete={() => {
                                onPageLoadComplete();
                            }}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.SCHEDULED_EVENT_LIST]?.toString()}
                    element={
                        <ScheduledEventList
                            pageRoute={
                                RouteMap[PageMap.SCHEDULED_EVENT_LIST] as Route
                            }
                            onLoadComplete={() => {
                                onPageLoadComplete();
                            }}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.INCIDENT_DETAIL]?.toString()}
                    element={
                        <IncidentDetail
                            pageRoute={
                                RouteMap[PageMap.INCIDENT_DETAIL] as Route
                            }
                            onLoadComplete={() => {
                                onPageLoadComplete();
                            }}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.INCIDENT_LIST]?.toString()}
                    element={
                        <IncidentList
                            pageRoute={RouteMap[PageMap.INCIDENT_LIST] as Route}
                            onLoadComplete={() => {
                                onPageLoadComplete();
                            }}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.ANNOUNCEMENT_DETAIL]?.toString()}
                    element={
                        <AnnouncementDetail
                            pageRoute={
                                RouteMap[PageMap.ANNOUNCEMENT_DETAIL] as Route
                            }
                            onLoadComplete={() => {
                                onPageLoadComplete();
                            }}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.ANNOUNCEMENT_LIST]?.toString()}
                    element={
                        <AnnouncementList
                            pageRoute={
                                RouteMap[PageMap.ANNOUNCEMENT_LIST] as Route
                            }
                            onLoadComplete={() => {
                                onPageLoadComplete();
                            }}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.SUBSCRIBE]?.toString()}
                    element={
                        <Subscribe
                            pageRoute={RouteMap[PageMap.SUBSCRIBE] as Route}
                            onLoadComplete={() => {
                                onPageLoadComplete();
                            }}
                        />
                    }
                />

                {/* Preview */}

                <PageRoute
                    path={RouteMap[PageMap.PREVIEW_OVERVIEW]?.toString()}
                    element={
                        <Overview
                            onLoadComplete={() => {
                                onPageLoadComplete();
                            }}
                            pageRoute={
                                RouteMap[PageMap.PREVIEW_OVERVIEW] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.PREVIEW_SUBSCRIBE]?.toString()}
                    element={
                        <Subscribe
                            onLoadComplete={() => {
                                onPageLoadComplete();
                            }}
                            pageRoute={
                                RouteMap[PageMap.PREVIEW_SUBSCRIBE] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[
                        PageMap.PREVIEW_SCHEDULED_EVENT_DETAIL
                    ]?.toString()}
                    element={
                        <ScheduledEventDetail
                            onLoadComplete={() => {
                                onPageLoadComplete();
                            }}
                            pageRoute={
                                RouteMap[
                                    PageMap.PREVIEW_SCHEDULED_EVENT_DETAIL
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[
                        PageMap.PREVIEW_SCHEDULED_EVENT_LIST
                    ]?.toString()}
                    element={
                        <ScheduledEventList
                            onLoadComplete={() => {
                                onPageLoadComplete();
                            }}
                            pageRoute={
                                RouteMap[
                                    PageMap.PREVIEW_SCHEDULED_EVENT_LIST
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.PREVIEW_INCIDENT_DETAIL]?.toString()}
                    element={
                        <IncidentDetail
                            onLoadComplete={() => {
                                onPageLoadComplete();
                            }}
                            pageRoute={
                                RouteMap[
                                    PageMap.PREVIEW_INCIDENT_DETAIL
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.PREVIEW_INCIDENT_LIST]?.toString()}
                    element={
                        <IncidentList
                            onLoadComplete={() => {
                                onPageLoadComplete();
                            }}
                            pageRoute={
                                RouteMap[PageMap.PREVIEW_INCIDENT_LIST] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[
                        PageMap.PREVIEW_ANNOUNCEMENT_DETAIL
                    ]?.toString()}
                    element={
                        <AnnouncementDetail
                            onLoadComplete={() => {
                                onPageLoadComplete();
                            }}
                            pageRoute={
                                RouteMap[
                                    PageMap.PREVIEW_ANNOUNCEMENT_DETAIL
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[
                        PageMap.PREVIEW_ANNOUNCEMENT_LIST
                    ]?.toString()}
                    element={
                        <AnnouncementList
                            onLoadComplete={() => {
                                onPageLoadComplete();
                            }}
                            pageRoute={
                                RouteMap[
                                    PageMap.PREVIEW_ANNOUNCEMENT_LIST
                                ] as Route
                            }
                        />
                    }
                />

                {/* 👇️ only match this when no other routes match */}

                <PageRoute
                    path="*"
                    element={
                        <PageNotFound
                            onLoadComplete={() => {
                                onPageLoadComplete();
                            }}
                            pageRoute={RouteMap[PageMap.NOT_FOUND] as Route}
                        />
                    }
                />
            </Routes>
        </MasterPage>
    );
};

export default App;
