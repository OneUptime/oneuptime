import React from 'react';

import { Route, Redirect, Switch } from 'react-router-dom';
import routes from '../routes';

const { allRoutes }: $TSFixMe = routes;

const PublicPage: Function = () => {
    return (
        <Switch>
            {allRoutes

                .filter((route) => {
                    return route.isPublic;
                })
                .map((route, index) => {
                    return (
                        <Route
                            component={route.component}
                            exact={route.exact}
                            path={route.path}
                            key={index}
                        />
                    );
                })}
            <Redirect to="/login" />
        </Switch>
    );
};

PublicPage.displayName = 'PublicPage';

export default PublicPage;
