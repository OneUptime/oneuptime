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

const CountrySelector = ({ input, meta: { touched, error } }) => (
    <span>
        <select
            {...input}
            className="selector"
            id="country"
            style={{ width: 222 }}
        >
            <option style={selectorStyle} value="">
                Select Country...
            </option>
            {countries.map(val => (
                <option style={selectorStyle} value={val.name} key={val.code}>
                    {val.name}
                </option>
            ))}
        </select>
        {touched && error && <span style={errorStyle}>{error}</span>}
    </span>
);

CountrySelector.displayName = 'CountrySelector';

CountrySelector.propTypes = {
    meta: PropTypes.object.isRequired,
    input: PropTypes.object.isRequired,
};

export default CountrySelector;
