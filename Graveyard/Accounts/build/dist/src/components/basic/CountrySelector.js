import React from 'react';
import PropTypes from 'prop-types';
import { countries } from './CountryList';
const errorStyle = {
    color: '#c23d4b',
    topMargin: '5px',
};
const selectorStyle = {
    color: '#000000',
};
const CountrySelector = ({ input, meta: { touched, error } }) => (React.createElement("span", null,
    React.createElement("select", Object.assign({}, input, { className: "selector", id: "country", style: { width: 222 } }),
        React.createElement("option", { style: selectorStyle, value: "" }, "Select Country..."),
        countries.map(val => (React.createElement("option", { style: selectorStyle, value: val.name, key: val.code }, val.name)))),
    touched && error && React.createElement("span", { style: errorStyle }, error)));
CountrySelector.displayName = 'CountrySelector';
CountrySelector.propTypes = {
    meta: PropTypes.object.isRequired,
    input: PropTypes.object.isRequired,
};
export default CountrySelector;
