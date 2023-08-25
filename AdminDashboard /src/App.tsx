import React, { useState, useEffect } from 'react';
import Route from 'Common/Types/API/Route';
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
import { ACCOUNTS_URL } from 'CommonUI/src/Config';

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

   


    return (
       <></>
    );
};

export default App;
