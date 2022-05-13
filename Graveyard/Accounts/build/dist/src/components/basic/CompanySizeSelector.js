import React from 'react';
import PropTypes from 'prop-types';
import { companySize } from './CompanySizeList';
const errorStyle = {
    color: 'red',
    topMargin: '5px',
};
const CompanySizeSelector = ({ input, id, meta: { touched, error } }) => (React.createElement("span", null,
    React.createElement("select", Object.assign({}, input, { className: "selector", id: id }),
        React.createElement("option", { value: "" }, "Select Company Size..."),
        companySize.map(val => (React.createElement("option", { value: val.name, key: val.code }, val.name)))),
    touched && error && React.createElement("span", { style: errorStyle }, error)));
CompanySizeSelector.displayName = 'CompanySizeSelector';
CompanySizeSelector.propTypes = {
    meta: PropTypes.object.isRequired,
    input: PropTypes.object.isRequired,
    id: PropTypes.string,
};
export default CompanySizeSelector;
