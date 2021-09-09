import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { logEvent } from '../../analytics';
import { SHOULD_LOG_ANALYTICS } from '../../config';
import * as Sentry from '@sentry/react';

class ErrorBoundary extends Component {
    componentDidCatch(error, info) {
        if (SHOULD_LOG_ANALYTICS) {
            logEvent('PAGE VIEW: ACCOUNTS ERROR', { error, info });
        }
    }

    render() {
        const fallback = (
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
                <div>
                    An unexpected error has occured. Please reload the page to
                    continue
                </div>
            </div>
        );

        return (
            <Sentry.ErrorBoundary fallback={fallback}>
                {this.props.children}
            </Sentry.ErrorBoundary>
        );
    }
}

ErrorBoundary.displayName = 'ErrorBoundary';

ErrorBoundary.propTypes = {
    children: PropTypes.any,
};

export default ErrorBoundary;
