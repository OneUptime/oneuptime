import React, { FunctionComponent } from 'react';
import Route from 'Common/Types/API/Route';
import {
    Routes,
    Route as PageRoute,
    useNavigate,
    useLocation,
} from 'react-router-dom';
import TopBar from './Components/TopBar/TopBar';
import NavBar from './Components/NavBar/NavBar';
import './App.scss';

// Pages
import Init from './Pages/Init/Init';
import Monitors from './Pages/Monitors/Monitors';
import Home from './Pages/Home/Home';
import Settings from './Pages/Settings/Settings';
import StatusPages from './Pages/StatusPages/StatusPages';
import Incidents from './Pages/Incidents/Incidents';
import Logs from './Pages/Logs/Logs';
import Navigation from 'CommonUI/src/Utils/Navigation';
import RouteMap from './Utils/RouteMap';
import PageMap from './Utils/PageMap';

const App: FunctionComponent = () => {
    Navigation.setNavigateHook(useNavigate());
    Navigation.setLocation(useLocation());

    return (
        <div className="App">
            <TopBar />
            <NavBar />
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
                        <Monitors
                            pageRoute={RouteMap[PageMap.MONITORS] as Route}
                        />
                    }
                />
                <PageRoute
                    path={RouteMap[PageMap.SETTINGS]?.toString()}
                    element={
                        <Settings
                            pageRoute={RouteMap[PageMap.SETTINGS] as Route}
                        />
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
            </Routes>
        </div>
    );
};

export default App;
