import React, { FunctionComponent } from 'react';
import Route from 'Common/Types/API/Route';
import {
    Routes,
    Route as PageRoute,
} from 'react-router-dom';
import MasterPage from './Components/MasterPage/MasterPage';



import PageNotFound from "./Pages/NotFound/PageNotFound";
import Overview from "./Pages/NotFound/Overview";

import RouteMap from './Utils/RouteMap';
import PageMap from './Utils/PageMap';


const App: FunctionComponent = () => {

    return (
        <MasterPage

        >
            <Routes>

                <PageRoute
                    path="*"
                    element={
                        <Overview
                            pageRoute={RouteMap[PageMap.OVERVIEW] as Route}
                        />
                    }
                />

                <PageRoute
                    path="*"
                    element={
                        <Overview
                            pageRoute={RouteMap[PageMap.PREVIEW] as Route}
                        />
                    }
                />

                {/* 👇️ only match this when no other routes match */}
                <PageRoute
                    path="*"
                    element={
                        <PageNotFound
                            pageRoute={RouteMap[PageMap.NOT_FOUND] as Route}
                        />
                    }
                />
            </Routes>
        </MasterPage>
    );
};

export default App;
