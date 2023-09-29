import React from 'react';
import {
    Routes,
    Route as PageRoute,
    useNavigate,
    useLocation,
    useParams,
} from 'react-router-dom';
import Navigation from 'CommonUI/src/Utils/Navigation';
import User from 'CommonUI/src/Utils/User';
import URL from 'Common/Types/API/URL';
import { ACCOUNTS_URL, DASHBOARD_URL } from 'CommonUI/src/Config';
import MasterPage from './Components/MasterPage/MasterPage';
import RouteMap from './Utils/RouteMap';
import PageMap from './Utils/PageMap';
import Init from './Pages/Init/Init';
import Projects from './Pages/Projects/Index';
import Users from './Pages/Users/Index';
import Logout from './Pages/Logout/Logout';

// Settings Pages.
import SettingsEmail from './Pages/Settings/SMTP/Index';
import SettingsCallSMS from './Pages/Settings/CallSMS/Index';
import SettingsProbes from './Pages/Settings/Probes/Index';
import SettingsAuthentication from './Pages/Settings/Authentication/Index';
import SettingsAPIKey from './Pages/Settings/APIKey/Index';

const App: () => JSX.Element = () => {
    Navigation.setNavigateHook(useNavigate());
    Navigation.setLocation(useLocation());
    Navigation.setParams(useParams());

    if (!User.isLoggedIn()) {
        if (Navigation.getQueryStringByName('sso_token')) {
            Navigation.navigate(
                URL.fromString(ACCOUNTS_URL.toString()).addQueryParam(
                    'sso',
                    'true'
                )
            );
        } else {
            Navigation.navigate(URL.fromString(ACCOUNTS_URL.toString()));
        }
    }

    if (!User.isMasterAdmin()) {
        Navigation.navigate(URL.fromString(DASHBOARD_URL.toString()));
    }

    return (
        <MasterPage>
            <Routes>
                <PageRoute
                    path={RouteMap[PageMap.INIT]?.toString() || ''}
                    element={<Init />}
                />

                <PageRoute
                    path={RouteMap[PageMap.PROJECTS]?.toString() || ''}
                    element={<Projects />}
                />

                <PageRoute
                    path={RouteMap[PageMap.USERS]?.toString() || ''}
                    element={<Users />}
                />

                <PageRoute
                    path={RouteMap[PageMap.LOGOUT]?.toString() || ''}
                    element={<Logout />}
                />

                <PageRoute
                    path={RouteMap[PageMap.SETTINGS]?.toString() || ''}
                    element={<SettingsAuthentication />}
                />

                <PageRoute
                    path={RouteMap[PageMap.SETTINGS_SMTP]?.toString() || ''}
                    element={<SettingsEmail />}
                />

                <PageRoute
                    path={
                        RouteMap[PageMap.SETTINGS_CALL_AND_SMS]?.toString() ||
                        ''
                    }
                    element={<SettingsCallSMS />}
                />

                <PageRoute
                    path={RouteMap[PageMap.SETTINGS_PROBES]?.toString() || ''}
                    element={<SettingsProbes />}
                />

                <PageRoute
                    path={
                        RouteMap[PageMap.SETTINGS_AUTHENTICATION]?.toString() ||
                        ''
                    }
                    element={<SettingsAuthentication />}
                />

                <PageRoute
                    path={RouteMap[PageMap.SETTINGS_API_KEY]?.toString() || ''}
                    element={<SettingsAPIKey />}
                />
            </Routes>
        </MasterPage>
    );
};

export default App;
