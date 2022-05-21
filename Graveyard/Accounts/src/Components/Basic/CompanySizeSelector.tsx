import React from 'react';
import PropTypes from 'prop-types';
import { companySize } from './CompanySizeList';

const errorStyle: $TSFixMe = {
    color: 'red',
    topMargin: '5px',
};

interface CompanySizeSelectorProps {
    meta: object;
    input: object;
    id?: string;
}

const CompanySizeSelector: Function = ({
    input,
    id,
    meta: { touched, error }
}: CompanySizeSelectorProps) => (
    <span>
        <select {...input} className="selector" id={id}>
            <option value="">Select Company Size...</option>
            {companySize.map(val => (
                <option value={val.name} key={val.code}>
                    {val.name}
                </option>
            ))}
        </select>
        {touched && error && <span style={errorStyle}>{error}</span>}
    </span>
);

CompanySizeSelector.displayName = 'CompanySizeSelector';

CompanySizeSelector.propTypes = {
    meta: PropTypes.object.isRequired,
    input: PropTypes.object.isRequired,
    id: PropTypes.string,
};

export default CompanySizeSelector;
