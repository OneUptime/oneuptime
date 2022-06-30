import React, { FunctionComponent } from 'react';
import Route from 'Common/Types/API/Route';
import {
    Routes,
    Route as PageRoute,
    useNavigate,
    useLocation,
} from 'react-router-dom';
import MasterPage from './Components/MasterPage/MasterPage';
// Pages
import Init from './Pages/Init/Init';
import Home from './Pages/Home/Home';

import StatusPages from './Pages/StatusPages/StatusPages';
import Incidents from './Pages/Incidents/Incidents';
import Logs from './Pages/Logs/Logs';
import Navigation from 'CommonUI/src/Utils/Navigation';
import RouteMap from './Utils/RouteMap';
import PageMap from './Utils/PageMap';
import { ACCOUNTS_URL } from 'CommonUI/src/Config';
// Settings Pages
import Settings from './Pages/Settings/Settings';
import SettingsDangerZone from './Pages/Settings/DangerZone';
import SettingsApiKeys from './Pages/Settings/APIKeys';
import SettingsCreateAPIKey from './Pages/Settings/CreateAPIKey';
// Import CSS
import 'CommonUI/src/Styles/theme.scss';
import User from 'CommonUI/src/Utils/User';

const App: FunctionComponent = () => {
    Navigation.setNavigateHook(useNavigate());
    Navigation.setLocation(useLocation());

    if (!User.isLoggedIn()) {
        Navigation.navigate(ACCOUNTS_URL);
    }

    return (
        <MasterPage>
            <Routes>
                <PageRoute
                    path={RouteMap[PageMap.INIT]?.toString()}
                    element={
                        <Init pageRoute={RouteMap[PageMap.INIT] as Route} />
                    }
                />
                <PageRoute
                    path={RouteMap[PageMap.HOME]?.toString()}
                    element={
                        <Home pageRoute={RouteMap[PageMap.HOME] as Route} />
                    }
                />
                <PageRoute
                    path={RouteMap[PageMap.MONITORS]?.toString()}
                    element={
                        <Init pageRoute={RouteMap[PageMap.MONITORS] as Route} />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.STATUS_PAGE]?.toString()}
                    element={
                        <StatusPages
                            pageRoute={RouteMap[PageMap.STATUS_PAGE] as Route}
                        />
                    }
                />
                <PageRoute
                    path={RouteMap[PageMap.INCIDENTS]?.toString()}
                    element={
                        <Incidents
                            pageRoute={RouteMap[PageMap.INCIDENTS] as Route}
                        />
                    }
                />
                <PageRoute
                    path={RouteMap[PageMap.LOGS]?.toString()}
                    element={
                        <Logs pageRoute={RouteMap[PageMap.LOGS] as Route} />
                    }
                />

                {/* Settings Routes */}

                <PageRoute
                    path={RouteMap[PageMap.SETTINGS]?.toString()}
                    element={
                        <Settings
                            pageRoute={RouteMap[PageMap.SETTINGS] as Route}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.SETTINGS_DANGERZONE]?.toString()}
                    element={
                        <SettingsDangerZone
                            pageRoute={
                                RouteMap[PageMap.SETTINGS_DANGERZONE] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.SETTINGS_APIKEYS]?.toString()}
                    element={
                        <SettingsApiKeys
                            pageRoute={
                                RouteMap[PageMap.SETTINGS_APIKEYS] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.SETTINGS_CREATE_APIKEY]?.toString()}
                    element={
                        <SettingsCreateAPIKey
                            pageRoute={
                                RouteMap[PageMap.SETTINGS_APIKEYS] as Route
                            }
                        />
                    }
                />
            </Routes>
        </MasterPage>
    );
};

export default App;
