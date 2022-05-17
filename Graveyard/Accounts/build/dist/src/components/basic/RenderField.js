import React from 'react';
import PropTypes from 'prop-types';
const errorStyle = {
    color: '#c23d4b',
    width: '222px',
};
const RenderField = ({ input, placeholder, type, meta, className, id, disabled, initialValue, style }) => (React.createElement("span", null,
    React.createElement("span", null,
        React.createElement("input", Object.assign({}, input, { type: type, placeholder: placeholder, className: className, id: id, disabled: disabled || false, defaultValue: initialValue, style: style || {} }))),
    meta.error && meta.touched && (React.createElement("span", { id: `${id}_error`, style: errorStyle }, meta.error))));
RenderField.displayName = 'RenderField';
RenderField.propTypes = {
    initialValue: PropTypes.string,
    input: PropTypes.object.isRequired,
    placeholder: PropTypes.string,
    type: PropTypes.string.isRequired,
    className: PropTypes.string,
    id: PropTypes.string,
    meta: PropTypes.object.isRequired,
    rows: PropTypes.string,
    disabled: PropTypes.bool,
    style: PropTypes.object,
};
export { RenderField };
