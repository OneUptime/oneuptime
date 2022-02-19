import React, { Component } from 'react';


import PropTypes from 'prop-types';

class ErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { error: null, hasError: false };
    }


    static getDerivedStateFromError(error) {
        // Update state so the next render will show the fallback UI.
        return { hasError: true, error };
    }

    render() {
        if (this.state.hasError || this.state.error) {
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
                        An unexpected error has occured. Please reload the page
                        to continue
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

ErrorBoundary.displayName = 'ErrorBoundary';

ErrorBoundary.propTypes = {
    children: PropTypes.any,
};

export default ErrorBoundary;
