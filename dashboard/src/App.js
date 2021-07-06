import React from 'react';
import { Router, Route, Redirect, Switch } from 'react-router-dom';
import store, { history, isServer } from './store';
import { connect } from 'react-redux';
import { allRoutes } from './routes';
import NotFound from './components/404';
import './components/Dashboard';
import BackboneModals from './containers/BackboneModals';
import Socket from './components/basic/Socket';
import ReactGA from 'react-ga';
import { User, ACCOUNTS_URL } from './config';
import Cookies from 'universal-cookie';
import 'font-awesome/css/font-awesome.min.css';
import { loadPage } from './actions/page';
import { setUserId, setUserProperties, identify, logEvent } from './analytics';
import { SHOULD_LOG_ANALYTICS } from './config';
import Dashboard from './components/Dashboard';

if (!isServer) {
    history.listen(location => {
        ReactGA.set({ page: location.pathname });
        ReactGA.pageview(location.pathname);
    });
}

const cookies = new Cookies();
const userData = cookies.get('data');

if (userData !== undefined) {
    User.setUserId(userData.id);
    User.setAccessToken(userData.tokens.jwtAccessToken);
    User.setEmail(userData.email);
    User.setName(userData.name);
    User.setCardRegistered(userData.cardRegistered);
    if (SHOULD_LOG_ANALYTICS) {
        setUserId(userData.id);
        identify(userData.id);
        setUserProperties({
            Name: userData.name,
            Created: new Date(),
            Email: userData.email,
        });
        logEvent('PAGE VIEW: DASHBOARD');
    }
} else {
    // store original destination url
    const redirectTo = window.location.href;
    window.location = ACCOUNTS_URL + `/login?redirectTo=${redirectTo}`;
    store.dispatch(loadPage('Home'));
}

if (User.isLoggedIn()) {
    const id = User.getUserId();
    if (SHOULD_LOG_ANALYTICS) {
        setUserId(id);
    }
}

const App = () => (
    <div style={{ height: '100%' }}>
        <Socket />
        <Router history={history}>
            <Dashboard>
                <Switch>
                    {allRoutes
                        .filter(route => route.visible)
                        .map((route, index) => {
                            return (
                                <Route
                                    exact={route.exact}
                                    path={route.path}
                                    key={index}
                                    render={props => (
                                        <route.component
                                            icon={route.icon}
                                            {...props}
                                        />
                                    )}
                                />
                            );
                        })}
                    <Route
                        path={'/dashboard/:404_path'}
                        key={'404'}
                        component={NotFound}
                    />
                    <Redirect to="/dashboard/project/project" />
                </Switch>
            </Dashboard>
        </Router>
        <BackboneModals />
    </div>
);

App.displayName = 'App';

function mapStateToProps(state) {
    return state.login;
}

export default connect(mapStateToProps)(App);
