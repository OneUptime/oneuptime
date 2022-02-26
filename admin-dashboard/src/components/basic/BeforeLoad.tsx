import React from 'react';
import PropTypes from 'prop-types';
import { User, getQueryVar } from '../../config';

class BeforeLoad extends React.Component {
    isAuthenticated: $TSFixMe;
    redirect: $TSFixMe;
    constructor(props: $TSFixMe) {
        super(props);
        const isAuthenticated = User.isLoggedIn();
        const initialUrl = sessionStorage.getItem('initialUrl');
        this.isAuthenticated = isAuthenticated;
        const redirectTo = getQueryVar('redirectTo', initialUrl);
        const counter = getQueryVar('counter', initialUrl) || 0;
        if (redirectTo) this.redirect = redirectTo;
        if (isAuthenticated) {
            if (redirectTo) {
                sessionStorage.removeItem('initialUrl');
                const accessToken = User.getAccessToken();
                // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'Location'... Remove this comment to see the full error message
                window.location = `${redirectTo}?accessToken=${accessToken}&counter=${parseInt(
                    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'string | 0' is not assignable to... Remove this comment to see the full error message
                    counter,
                    10
                ) + 1}`;
            }
        }
    }
    render() {
        if (this.isAuthenticated && this.redirect) {
            return (
                <div
                    id="app-loading"
                    style={{
                        position: 'fixed',
                        top: '0',
                        bottom: '0',
                        left: '0',
                        right: '0',
                        backgroundColor: '#fdfdfd',
                        zIndex: '999',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                    }}
                >
                    <div>Redirecting please wait...</div>
                </div>
            );
        }
        return this.props.children;
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
BeforeLoad.displayName = 'BeforeLoad';

// @ts-expect-error ts-migrate(2551) FIXME: Property 'contextTypes' does not exist on type 'ty... Remove this comment to see the full error message
BeforeLoad.contextTypes = {};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
BeforeLoad.propTypes = {
    children: PropTypes.any,
};

export default BeforeLoad;
