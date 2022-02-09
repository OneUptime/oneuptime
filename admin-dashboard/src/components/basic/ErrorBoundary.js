import React, { Component } from 'react';
import PropTypes from 'prop-types';

class ErrorBoundary extends Component {
    componentDidCatch(error, info) {
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('An Error has occurred', {
                error,
                info,
            });
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

ErrorBoundary.contextTypes = {
    mixpanel: PropTypes.object.isRequired,
};

ErrorBoundary.propTypes = {
    children: PropTypes.any,
};

export default ErrorBoundary;
