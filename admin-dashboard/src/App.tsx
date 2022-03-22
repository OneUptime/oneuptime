import React, { Suspense } from 'react';

import { Router, Route, Redirect, Switch } from 'react-router-dom';
import { history } from './store';
import { connect } from 'react-redux';
import { allRoutes } from './routes';
import BackboneModals from './containers/BackboneModals';
import { User, ACCOUNTS_URL } from './config';
import Cookies from 'universal-cookie';
import 'font-awesome/css/font-awesome.min.css';
import Dashboard from './components/Dashboard';
import { LoadingState } from './components/basic/Loader';

const cookies = new Cookies();
const userData = cookies.get('admin-data');

if (userData !== undefined) {
    User.setUserId(userData.id);
    User.setAccessToken(userData.tokens.jwtAccessToken);
    User.setEmail(userData.email);
    User.setName(userData.name);
} else {

    window.location = ACCOUNTS_URL;
}

const App = () => {
    return (
        <div style={{ height: '100%' }}>
            <Router history={history}>
                <Dashboard>
                    <Suspense fallback={<LoadingState />}>
                        <Switch>
                            {allRoutes
                                .filter(route => route.visible)
                                .map((route, index) => {
                                    return (
                                        <Route
                                            exact
                                            path={route.path}
                                            key={index}
                                            component={route.component}
                                        />
                                    );
                                })}
                            <Redirect to="admin/users" />
                        </Switch>
                    </Suspense>
                </Dashboard>
            </Router>
            <BackboneModals />
        </div>
    );
};

App.displayName = 'App';

function mapStateToProps(state: $TSFixMe) {
    return state.login;
}

export default connect(mapStateToProps)(App);
