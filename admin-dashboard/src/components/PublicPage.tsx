import React from 'react';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { Route, Redirect, Switch } from 'react-router-dom';
import routes from '../routes';

const { allRoutes } = routes;

const PublicPage = () => (
    <Switch>
        {allRoutes
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'isPublic' does not exist on type '{ titl... Remove this comment to see the full error message
            .filter(route => route.isPublic)
            .map((route, index) => (
                <Route
                    component={route.component}
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'exact' does not exist on type '{ title: ... Remove this comment to see the full error message
                    exact={route.exact}
                    path={route.path}
                    key={index}
                />
            ))}
        <Redirect to="/login" />
    </Switch>
);

PublicPage.displayName = 'PublicPage';

export default PublicPage;
