import React from 'react';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'quer... Remove this comment to see the full error message
import qs from 'query-string';
import PropTypes from 'prop-types';
import store from '../store';
import Cookies from 'universal-cookie';
import { DASHBOARD_URL, ADMIN_DASHBOARD_URL } from '../config';

class SsoLoginPage extends React.Component {
    componentDidMount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
        const query = qs.parse(this.props.location.search);
        const user = {
            id: query.id,
            name: query.name,
            email: query.email,
            tokens: {
                jwtAccessToken: query.jwtAccessToken,
                jwtRefreshToken: query.jwtRefreshToken,
            },
            role: query.role,
            redirect: query.redirect,
            cardRegistered: query.cardRegistered,
        };

        const state = store.getState();
        const { statusPageLogin, statusPageURL } = state.login;
        if (statusPageLogin) {
            const newURL = `${statusPageURL}?userId=${user.id}&accessToken=${user.tokens.jwtAccessToken}`;
            // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'Location'... Remove this comment to see the full error message
            return (window.location = newURL);
        }

        //share localStorage with dashboard app
        const cookies = new Cookies();
        cookies.set('data', user, {
            path: '/',
            maxAge: 8640000,
        });

        if (user.role === 'master-admin') {
            //share localStorage with admin dashboard app
            const cookies = new Cookies();
            cookies.set('admin-data', user, {
                path: '/',
                maxAge: 8640000,
            });
        }

        if (user.redirect) {
            // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'Location'... Remove this comment to see the full error message
            return (window.location = `${user.redirect}?accessToken=${user.tokens.jwtAccessToken}`);
        } else if (user.role === 'master-admin') {
            // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'Location'... Remove this comment to see the full error message
            window.location = ADMIN_DASHBOARD_URL;
        } else {
            // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'Location'... Remove this comment to see the full error message
            window.location = DASHBOARD_URL;
        }
    }
    render() {
        return <div />;
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
SsoLoginPage.displayName = 'SsoLoginPage';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
SsoLoginPage.propTypes = {
    location: PropTypes.object.isRequired,
};

export default SsoLoginPage;
