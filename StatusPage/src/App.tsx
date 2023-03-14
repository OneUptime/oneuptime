import React, { FunctionComponent, useState, useEffect } from 'react';
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
import Subscribe from './Pages/Subscribe/EmailSubscribe';

// Accounts.
import Login from './Pages/Accounts/Login';
import Sso from './Pages/Accounts/SSO';
import ForgotPassword from './Pages/Accounts/ForgotPassword';
import ResetPassword from './Pages/Accounts/ResetPassword';

import RouteMap from './Utils/RouteMap';
import PageMap from './Utils/PageMap';

import Navigation from 'CommonUI/src/Utils/Navigation';
import { JSONObject } from 'Common/Types/JSON';
import JSONFunctions from 'Common/Types/JSONFunctions';
import RouteParams from './Utils/RouteParams';
import ObjectID from 'Common/Types/ObjectID';

// Logout.
import Logout from './Pages/Accounts/Logout';

const App: FunctionComponent = () => {
    Navigation.setNavigateHook(useNavigate());
    Navigation.setLocation(useLocation());
    Navigation.setParams(useParams());

    const [isPreview, setIsPreview] = useState<boolean>(false);
    const [statusPageName, setStatusPageName] = useState<string>('');
    const [statusPageLogoFileId, setStatusPageLogoFileId] =
        useState<string>('');
    const [statusPageId, setStatusPageId] = useState<string>('');
    const [isPrivateStatusPage, setIsPrivateStatusPage] =
        useState<boolean>(false);

    const [hasEnabledSSO, setHasEnabledSSO] = useState<boolean>(false);
    const [forceSSO, setForceSSO] = useState<boolean>(false);

    useEffect(() => {
        setIsPreview(isPreviewPage());
    }, []);

    // js.
    const [javascript, setJavaScript] = useState<string | null>(null);

    const onPageLoadComplete: Function = (): void => {
        if (javascript) {
            // run custom javascipt.
            new Function(javascript)();
        }
    };

    const isPreviewPage: Function = (): boolean => {
        const id: string | null = Navigation.getParamByName(
            RouteParams.StatusPageId,
            RouteMap[PageMap.PREVIEW_OVERVIEW]!
        );

        if (id) {
            return true;
        }

        return false;
    };

    return (
        <MasterPage
            isPreview={isPreview}
            isPrivateStatusPage={isPrivateStatusPage}
            onLoadComplete={(masterpage: JSONObject) => {
                document.title =
                    (JSONFunctions.getJSONValueInPath(
                        masterpage || {},
                        'statusPage.pageTitle'
                    ) as string | null) || 'Status Page';

                document
                    .querySelector('meta[name="description"]')
                    ?.setAttribute(
                        'content',
                        (JSONFunctions.getJSONValueInPath(
                            masterpage || {},
                            'statusPage.pageDescription'
                        ) as string | null) || ''
                    );

                const javascript: string | null =
                    JSONFunctions.getJSONValueInPath(
                        masterpage || {},
                        'statusPage.customJavaScript'
                    ) as string | null;
                if (javascript) {
                    setJavaScript(javascript);
                }

                const statusPageName: string | null =
                    JSONFunctions.getJSONValueInPath(
                        masterpage || {},
                        'statusPage.pageTitle'
                    ) as string | null;

                const isPrivateStatusPage: boolean =
                    !JSONFunctions.getJSONValueInPath(
                        masterpage || {},
                        'statusPage.isPublicStatusPage'
                    ) as boolean;

                setIsPrivateStatusPage(isPrivateStatusPage);

                const statusPageId: string | null =
                    JSONFunctions.getJSONValueInPath(
                        masterpage || {},
                        'statusPage._id'
                    ) as string | null;

                setStatusPageId(statusPageId || '');

                setStatusPageName(statusPageName || 'Status Page');

                const fileId: string | null = JSONFunctions.getJSONValueInPath(
                    masterpage || {},
                    'statusPage.logoFileId'
                ) as string | null;

                setStatusPageLogoFileId(fileId || '');

                setHasEnabledSSO(
                    JSONFunctions.getJSONValueInPath(
                        masterpage || {},
                        'hasEnabledSSO'
                    ) as boolean
                );

                setForceSSO(
                    JSONFunctions.getJSONValueInPath(
                        masterpage || {},
                        'statusPage.requireSsoForLogin'
                    ) as boolean
                );
            }}
        >
            <Routes>
                {/* Live */}

                <PageRoute
                    path={RouteMap[PageMap.OVERVIEW]?.toString() || ''}
                    element={
                        <Overview
                            pageRoute={RouteMap[PageMap.OVERVIEW] as Route}
                            onLoadComplete={() => {
                                onPageLoadComplete();
                            }}
                            isPreviewPage={isPreview}
                            isPrivatePage={isPrivateStatusPage}
                            statusPageId={new ObjectID(statusPageId)}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.LOGIN]?.toString() || ''}
                    element={
                        <Login
                            isPreviewPage={isPreview}
                            isPrivatePage={isPrivateStatusPage}
                            statusPageName={statusPageName}
                            logoFileId={new ObjectID(statusPageLogoFileId)}
                            statusPageId={new ObjectID(statusPageId)}
                            forceSSO={forceSSO}
                            hasEnabledSSOConfig={hasEnabledSSO}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.SSO]?.toString() || ''}
                    element={
                        <Sso
                            isPreviewPage={isPreview}
                            isPrivatePage={isPrivateStatusPage}
                            statusPageName={statusPageName}
                            logoFileId={new ObjectID(statusPageLogoFileId)}
                            statusPageId={new ObjectID(statusPageId)}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.RESET_PASSWORD]?.toString() || ''}
                    element={
                        <ResetPassword
                            isPreviewPage={isPreview}
                            isPrivatePage={isPrivateStatusPage}
                            statusPageName={statusPageName}
                            logoFileId={new ObjectID(statusPageLogoFileId)}
                            statusPageId={new ObjectID(statusPageId)}
                            forceSSO={forceSSO}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.FORGOT_PASSWORD]?.toString() || ''}
                    element={
                        <ForgotPassword
                            isPreviewPage={isPreview}
                            isPrivatePage={isPrivateStatusPage}
                            statusPageName={statusPageName}
                            logoFileId={new ObjectID(statusPageLogoFileId)}
                            statusPageId={new ObjectID(statusPageId)}
                            forceSSO={forceSSO}
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[PageMap.SCHEDULED_EVENT_DETAIL]?.toString() ||
                        ''
                    }
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
                            isPreviewPage={isPreview}
                            isPrivatePage={isPrivateStatusPage}
                            statusPageId={new ObjectID(statusPageId)}
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[PageMap.SCHEDULED_EVENT_LIST]?.toString() || ''
                    }
                    element={
                        <ScheduledEventList
                            pageRoute={
                                RouteMap[PageMap.SCHEDULED_EVENT_LIST] as Route
                            }
                            onLoadComplete={() => {
                                onPageLoadComplete();
                            }}
                            isPreviewPage={isPreview}
                            isPrivatePage={isPrivateStatusPage}
                            statusPageId={new ObjectID(statusPageId)}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.INCIDENT_DETAIL]?.toString() || ''}
                    element={
                        <IncidentDetail
                            pageRoute={
                                RouteMap[PageMap.INCIDENT_DETAIL] as Route
                            }
                            onLoadComplete={() => {
                                onPageLoadComplete();
                            }}
                            isPreviewPage={isPreview}
                            isPrivatePage={isPrivateStatusPage}
                            statusPageId={new ObjectID(statusPageId)}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.INCIDENT_LIST]?.toString() || ''}
                    element={
                        <IncidentList
                            pageRoute={RouteMap[PageMap.INCIDENT_LIST] as Route}
                            onLoadComplete={() => {
                                onPageLoadComplete();
                            }}
                            isPreviewPage={isPreview}
                            isPrivatePage={isPrivateStatusPage}
                            statusPageId={new ObjectID(statusPageId)}
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[PageMap.ANNOUNCEMENT_DETAIL]?.toString() || ''
                    }
                    element={
                        <AnnouncementDetail
                            pageRoute={
                                RouteMap[PageMap.ANNOUNCEMENT_DETAIL] as Route
                            }
                            onLoadComplete={() => {
                                onPageLoadComplete();
                            }}
                            isPreviewPage={isPreview}
                            isPrivatePage={isPrivateStatusPage}
                            statusPageId={new ObjectID(statusPageId)}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.ANNOUNCEMENT_LIST]?.toString() || ''}
                    element={
                        <AnnouncementList
                            pageRoute={
                                RouteMap[PageMap.ANNOUNCEMENT_LIST] as Route
                            }
                            onLoadComplete={() => {
                                onPageLoadComplete();
                            }}
                            isPreviewPage={isPreview}
                            isPrivatePage={isPrivateStatusPage}
                            statusPageId={new ObjectID(statusPageId)}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.SUBSCRIBE_EMAIL]?.toString() || ''}
                    element={
                        <Subscribe
                            pageRoute={
                                RouteMap[PageMap.SUBSCRIBE_EMAIL] as Route
                            }
                            onLoadComplete={() => {
                                onPageLoadComplete();
                            }}
                            isPreviewPage={isPreview}
                            isPrivatePage={isPrivateStatusPage}
                            statusPageId={new ObjectID(statusPageId)}
                        />
                    }
                />

                {/* Preview */}

                <PageRoute
                    path={RouteMap[PageMap.PREVIEW_OVERVIEW]?.toString() || ''}
                    element={
                        <Overview
                            onLoadComplete={() => {
                                onPageLoadComplete();
                            }}
                            isPreviewPage={isPreview}
                            isPrivatePage={isPrivateStatusPage}
                            pageRoute={
                                RouteMap[PageMap.PREVIEW_OVERVIEW] as Route
                            }
                            statusPageId={new ObjectID(statusPageId)}
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[PageMap.PREVIEW_SUBSCRIBE_EMAIL]?.toString() ||
                        ''
                    }
                    element={
                        <Subscribe
                            onLoadComplete={() => {
                                onPageLoadComplete();
                            }}
                            isPreviewPage={isPreview}
                            isPrivatePage={isPrivateStatusPage}
                            pageRoute={
                                RouteMap[
                                    PageMap.PREVIEW_SUBSCRIBE_EMAIL
                                ] as Route
                            }
                            statusPageId={new ObjectID(statusPageId)}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.PREVIEW_LOGOUT]?.toString() || ''}
                    element={
                        <Logout
                            isPreviewPage={isPreview}
                            statusPageId={new ObjectID(statusPageId)}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.LOGOUT]?.toString() || ''}
                    element={
                        <Logout
                            isPreviewPage={isPreview}
                            statusPageId={new ObjectID(statusPageId)}
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.PREVIEW_SCHEDULED_EVENT_DETAIL
                        ]?.toString() || ''
                    }
                    element={
                        <ScheduledEventDetail
                            onLoadComplete={() => {
                                onPageLoadComplete();
                            }}
                            isPreviewPage={isPreview}
                            isPrivatePage={isPrivateStatusPage}
                            pageRoute={
                                RouteMap[
                                    PageMap.PREVIEW_SCHEDULED_EVENT_DETAIL
                                ] as Route
                            }
                            statusPageId={new ObjectID(statusPageId)}
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.PREVIEW_SCHEDULED_EVENT_LIST
                        ]?.toString() || ''
                    }
                    element={
                        <ScheduledEventList
                            onLoadComplete={() => {
                                onPageLoadComplete();
                            }}
                            isPreviewPage={isPreview}
                            isPrivatePage={isPrivateStatusPage}
                            pageRoute={
                                RouteMap[
                                    PageMap.PREVIEW_SCHEDULED_EVENT_LIST
                                ] as Route
                            }
                            statusPageId={new ObjectID(statusPageId)}
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[PageMap.PREVIEW_INCIDENT_DETAIL]?.toString() ||
                        ''
                    }
                    element={
                        <IncidentDetail
                            onLoadComplete={() => {
                                onPageLoadComplete();
                            }}
                            isPreviewPage={isPreview}
                            isPrivatePage={isPrivateStatusPage}
                            pageRoute={
                                RouteMap[
                                    PageMap.PREVIEW_INCIDENT_DETAIL
                                ] as Route
                            }
                            statusPageId={new ObjectID(statusPageId)}
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[PageMap.PREVIEW_INCIDENT_LIST]?.toString() ||
                        ''
                    }
                    element={
                        <IncidentList
                            onLoadComplete={() => {
                                onPageLoadComplete();
                            }}
                            isPreviewPage={isPreview}
                            isPrivatePage={isPrivateStatusPage}
                            pageRoute={
                                RouteMap[PageMap.PREVIEW_INCIDENT_LIST] as Route
                            }
                            statusPageId={new ObjectID(statusPageId)}
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.PREVIEW_ANNOUNCEMENT_DETAIL
                        ]?.toString() || ''
                    }
                    element={
                        <AnnouncementDetail
                            onLoadComplete={() => {
                                onPageLoadComplete();
                            }}
                            isPreviewPage={isPreview}
                            isPrivatePage={isPrivateStatusPage}
                            pageRoute={
                                RouteMap[
                                    PageMap.PREVIEW_ANNOUNCEMENT_DETAIL
                                ] as Route
                            }
                            statusPageId={new ObjectID(statusPageId)}
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.PREVIEW_ANNOUNCEMENT_LIST
                        ]?.toString() || ''
                    }
                    element={
                        <AnnouncementList
                            onLoadComplete={() => {
                                onPageLoadComplete();
                            }}
                            isPreviewPage={isPreview}
                            isPrivatePage={isPrivateStatusPage}
                            pageRoute={
                                RouteMap[
                                    PageMap.PREVIEW_ANNOUNCEMENT_LIST
                                ] as Route
                            }
                            statusPageId={new ObjectID(statusPageId)}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.PREVIEW_LOGIN]?.toString() || ''}
                    element={
                        <Login
                            isPreviewPage={isPreview}
                            isPrivatePage={isPrivateStatusPage}
                            statusPageName={statusPageName}
                            logoFileId={new ObjectID(statusPageLogoFileId)}
                            statusPageId={new ObjectID(statusPageId)}
                            forceSSO={forceSSO}
                            hasEnabledSSOConfig={hasEnabledSSO}
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[PageMap.PREVIEW_RESET_PASSWORD]?.toString() ||
                        ''
                    }
                    element={
                        <ResetPassword
                            isPreviewPage={isPreview}
                            isPrivatePage={isPrivateStatusPage}
                            statusPageName={statusPageName}
                            logoFileId={new ObjectID(statusPageLogoFileId)}
                            statusPageId={new ObjectID(statusPageId)}
                            forceSSO={forceSSO}
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[PageMap.PREVIEW_FORGOT_PASSWORD]?.toString() ||
                        ''
                    }
                    element={
                        <ForgotPassword
                            isPreviewPage={isPreview}
                            isPrivatePage={isPrivateStatusPage}
                            statusPageName={statusPageName}
                            logoFileId={new ObjectID(statusPageLogoFileId)}
                            statusPageId={new ObjectID(statusPageId)}
                            forceSSO={forceSSO}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.PREVIEW_SSO]?.toString() || ''}
                    element={
                        <Sso
                            isPreviewPage={isPreview}
                            isPrivatePage={isPrivateStatusPage}
                            statusPageName={statusPageName}
                            logoFileId={new ObjectID(statusPageLogoFileId)}
                            statusPageId={new ObjectID(statusPageId)}
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
                            isPreviewPage={isPreview}
                            isPrivatePage={isPrivateStatusPage}
                            pageRoute={RouteMap[PageMap.NOT_FOUND] as Route}
                        />
                    }
                />
            </Routes>
        </MasterPage>
    );
};

export default App;
