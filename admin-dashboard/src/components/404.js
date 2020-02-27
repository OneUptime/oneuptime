import React, { Component, Fragment } from 'react';

class NotFound extends Component {
    render() {
        return (
            <Fragment>
                <div className="db-World-root">
                    <div className="db-World-wrapper Box-root Flex-flex Flex-direction--column">
                        <div>
                            <div
                                id="app-loading"
                                style={{
                                    position: 'fixed',
                                    top: '0',
                                    bottom: '0',
                                    left: '0',
                                    right: '0',
                                    zIndex: '1',
                                    display: 'flex',
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                    fontSize: '20px',
                                    flexDirection: 'column',
                                }}
                            >
                                <div>
                                    The page you requested does not exist.
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </Fragment>
        );
    }
}

NotFound.displayName = 'NotFound';

export default NotFound;
