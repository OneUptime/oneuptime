import React, { Component } from 'react';

class ErrorBoundary extends Component {
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

ErrorBoundary.contextTypes = {};

ErrorBoundary.propTypes = {};

export default ErrorBoundary;
