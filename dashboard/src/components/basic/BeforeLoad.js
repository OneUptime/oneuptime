import React from 'react';
import PropTypes from 'prop-types';
import { User, getQueryVar } from '../../config'

class BeforeLoad extends React.Component {
    constructor(props) {
        super(props);
        const isAuthenticated = User.isLoggedIn();
        const initialUrl = sessionStorage.getItem('initialUrl');
        this.isAuthenticated = isAuthenticated;
        const redirectTo = getQueryVar('redirectTo', initialUrl);
        let counter = getQueryVar('counter',initialUrl) || 0;
        if (redirectTo) this.redirect = redirectTo;
        if (isAuthenticated) {
            if (redirectTo) {
                sessionStorage.removeItem('initialUrl');
                const accessToken = User.getAccessToken();
                window.location = `${redirectTo}?accessToken=${accessToken}&counter=${parseInt(counter, 10 )+1}`
            }
        }
    }
    render() {
        if (this.isAuthenticated && this.redirect) {
            return (
                <div id="app-loading" style={{ 'position': 'fixed', 'top': '0', 'bottom': '0', 'left': '0', 'right': '0', 'backgroundColor': '#fbfbfb', 'zIndex': '999', 'display': 'flex', 'justifyContent': 'center', 'alignItems': 'center' }}>
                    <div>Redirecting please wait...</div>
                </div>
            )
        }
        return this.props.children;
    }
}

BeforeLoad.displayName = 'BeforeLoad';

BeforeLoad.propTypes = {
    children: PropTypes.any
}

export default BeforeLoad;