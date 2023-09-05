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
    
    if(!User.isMasterAdmin()){
        Navigation.navigate(URL.fromString(DASHBOARD_URL.toString()))
    }

    return (
        <MasterPage>
            <Routes>
                <PageRoute
                    path={RouteMap[PageMap.INIT]?.toString() || ''}
                    element={<Init />}
                />
            </Routes>
        </MasterPage>
    );
};

export default App;
