import React, { Component, Fragment } from 'react';
class NotFound extends Component {
    render() {
        return (React.createElement(Fragment, null,
            React.createElement("div", { className: "db-World-root" },
                React.createElement("div", { className: "db-World-wrapper Box-root Flex-flex Flex-direction--column" },
                    React.createElement("div", null,
                        React.createElement("div", { id: "app-loading", style: {
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
                            } },
                            React.createElement("div", null, "The page you requested does not exist.")))))));
    }
}
NotFound.displayName = '';
NotFound.propTypes = {};
NotFound.displayName = 'NotFound';
export default NotFound;
