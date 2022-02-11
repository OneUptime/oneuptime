import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { logEvent } from '../../analytics';
import { SHOULD_LOG_ANALYTICS } from '../../config';

class ErrorBoundary extends Component {
    componentDidCatch(error, info) {
        if (SHOULD_LOG_ANALYTICS) {
            logEvent('PAGE VIEW: ACCOUNTS ERROR', { error, info });
        }
    }

    render() {
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
                <div>
                    An unexpected error has occured. Please reload the page to
                    continue
                </div>
            </div>
        );
    }
}

ErrorBoundary.displayName = 'ErrorBoundary';

ErrorBoundary.propTypes = {
};

export default ErrorBoundary;
