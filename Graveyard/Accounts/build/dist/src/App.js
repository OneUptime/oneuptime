import React, { Suspense, useEffect } from 'react';
import { Router, Route, Redirect, Switch } from 'react-router-dom';
import { history, isApiServer } from './store';
import { connect } from 'react-redux';
import { allRoutes } from './routes';
import BackboneModals from './containers/BackboneModals';
import { DASHBOARD_URL, ADMIN_DASHBOARD_URL, IS_SAAS_SERVICE, User, } from './config';
import queryString from 'query-string';
import ReactGA from 'react-ga';
import Cookies from 'universal-cookie';
import { saveStatusPage, checkIfMasterAdminExists } from './actions/login';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import { LoadingState } from './components/basic/Loader';
const cookies = new Cookies();
if (!isApiServer) {
    history.listen((location) => {
        ReactGA.set({ page: location.pathname });
        ReactGA.pageview(location.pathname);
    });
}
const isStatusPageLogin = queryString.parse(window.location.search).statusPage === 'true';
const statusPageURL = queryString.parse(window.location.search).statusPageURL;
const userIsLoggedIn = cookies.get('data') || cookies.get('admin-data');
const redirectTo = queryString.parse(window.location.search).redirectTo;
if (userIsLoggedIn) {
    const { userId, tokens: { jwtAccessToken }, } = userIsLoggedIn;
    window.location.href = cookies.get('admin-data')
        ? ADMIN_DASHBOARD_URL
        : isStatusPageLogin
            ? `${statusPageURL}?userId=${userId}&accessToken=${jwtAccessToken}`
            : redirectTo
                ? redirectTo
                : DASHBOARD_URL;
}
const App = ({ masterAdmin: { exists }, checkIfMasterAdminExists, saveStatusPage }) => {
    useEffect(() => {
        // store initialUrl in sessionStorage
        User.setInitialUrl(window.location.href);
        // unset initialUrl when unmount
        return () => User.removeInitialUrl();
    }, []);
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
    return (React.createElement("div", { style: { height: '100%' } },
        React.createElement(Router, { history: history },
            React.createElement(Suspense, { fallback: LoadingState },
                React.createElement(Switch, null,
                    allRoutes
                        .filter(route => route.visible)
                        .map((route, index) => {
                        return (React.createElement(Route, { exact: route.exact, path: route.path, key: index, component: route.component }));
                    }),
                    React.createElement(Redirect, { to: "/accounts/login" })))),
        React.createElement(BackboneModals, null)));
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
    return bindActionCreators({ saveStatusPage, checkIfMasterAdminExists }, dispatch);
}
export default connect(mapStateToProps, mapDispatchToProps)(App);
