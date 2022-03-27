import React from 'react';

import qs from 'query-string';
import PropTypes from 'prop-types';
import store from '../store';
import Cookies from 'universal-cookie';
import { DASHBOARD_URL, ADMIN_DASHBOARD_URL } from '../config';

interface ComponentProps {
    location: object;
}

class SsoLoginPage extends React.Component<ComponentProps> {
    constructor(props: ComponentProps) {
        super(props);
    }

    override componentDidMount() {

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

            return (window.location.href = newURL);
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

            return (window.location.href = `${user.redirect}?accessToken=${user.tokens.jwtAccessToken}`);
        } else if (user.role === 'master-admin') {

            window.location.href = ADMIN_DASHBOARD_URL;
        } else {

            window.location.href = DASHBOARD_URL;
        }
    }
    override render() {
        return <div />;
    }
}


SsoLoginPage.displayName = 'SsoLoginPage';


SsoLoginPage.propTypes = {
    location: PropTypes.object.isRequired,
};

export default SsoLoginPage;
