import React, { useEffect } from 'react';
import { Router, Route, Redirect, Switch } from 'react-router-dom';
import { history, isServer } from './store';
import { connect } from 'react-redux';
import { allRoutes } from './routes';
import BackboneModals from './containers/BackboneModals';
import { DASHBOARD_URL, ADMIN_DASHBOARD_URL, IS_SAAS_SERVICE } from './config';
import queryString from 'query-string';
import ReactGA from 'react-ga';
import Cookies from 'universal-cookie';
import { saveStatusPage, checkIfMasterAdminExists } from './actions/login';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';

const cookies = new Cookies();

if (!isServer) {
    history.listen(location => {
        ReactGA.set({ page: location.pathname });
        ReactGA.pageview(location.pathname);
    });
}

const isStatusPageLogin =
    queryString.parse(window.location.search).statusPage === 'true';
const statusPageURL = queryString.parse(window.location.search).statusPageURL;
const userIsLoggedIn = cookies.get('data') || cookies.get('admin-data');

if (userIsLoggedIn) {
    const {
        userId,
        tokens: { jwtAccessToken },
    } = userIsLoggedIn;
    window.location = cookies.get('admin-data')
        ? ADMIN_DASHBOARD_URL
        : isStatusPageLogin
        ? `${statusPageURL}?userId=${userId}&accessToken=${jwtAccessToken}`
        : DASHBOARD_URL;
}

const App = ({
    masterAdmin: { exists },
    checkIfMasterAdminExists,
    saveStatusPage,
}) => {
    useEffect(() => {
        if (!IS_SAAS_SERVICE && exists === null) {
            checkIfMasterAdminExists();
        }
    }, [exists, checkIfMasterAdminExists]);

    if (isStatusPageLogin && statusPageURL) {
        saveStatusPage({
            isStatusPageLogin,
            statusPageURL,
        });
    }

    return (
        <div style={{ height: '100%' }}>
            <Router history={history}>
                <Switch>
                    {allRoutes
                        .filter(route => route.visible)
                        .map((route, index) => {
                            return (
                                <Route
                                    exact={route.exact}
                                    path={route.path}
                                    key={index}
                                    component={route.component}
                                />
                            );
                        })}

                    <Redirect to="/accounts/login" />
                </Switch>
            </Router>
            <BackboneModals />
        </div>
    );
};

App.displayName = 'App';

App.propTypes = {
    saveStatusPage: PropTypes.func.isRequired,
    checkIfMasterAdminExists: PropTypes.func.isRequired,
    masterAdmin: PropTypes.object,
};

function mapStateToProps(state) {
    return state.login;
}
function mapDispatchToProps(dispatch) {
    return bindActionCreators(
        { saveStatusPage, checkIfMasterAdminExists },
        dispatch
    );
}

export default connect(mapStateToProps, mapDispatchToProps)(App);
