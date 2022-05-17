import React from 'react';
import PropTypes from 'prop-types';
export default function MessageBox(props) {
    return (React.createElement("div", { id: "main-body", className: "box css" },
        React.createElement("div", { className: "inner" },
            React.createElement("div", { id: "success-step", className: "request-reset-step step" },
                React.createElement("div", { className: "title" },
                    React.createElement("h2", { style: { marginBottom: 0 } }, props.title)),
                React.createElement("p", { className: "message" },
                    props.message,
                    props.children)))));
}
MessageBox.displayName = 'MessageBox';
MessageBox.propTypes = {
    title: PropTypes.string,
    message: PropTypes.string,
    children: PropTypes.node,
};
