import React, { useState } from 'react';
import PropTypes from 'prop-types'
import Select from 'react-select-fyipe';
import { Zones } from './TimezoneArray';

let errorStyle = {
    color: 'red',
    topMargin: '5px'
};

const TimezoneSelector = ({ input, placeholder, style, meta: { touched, error }, id }) => {
    const options = [{ value: '', label: 'Select Timezone...' }].concat(Zones.map(zone => (
        { value: zone.name, label: zone.name }
    )));
    const filteredOpt = options.filter(opt => opt.value === input.value);
    const [value, setValue] = useState({ value: input.value, label: filteredOpt.length > 0 ? filteredOpt[0].label : placeholder });
    const handleChange = (option) => {
        setValue(option);
        if (input.onChange) {
            input.onChange(option.value);
        }
    };

    return (
        <span>
            <div style={{ ...style, height: '28px', marginTop: '5px' }}>
                <Select
                    name={input.name}
                    value={value}
                    onChange={handleChange}
                    className="db-select-nw"
                    id={id}
                    options={options.filter(opt => opt.show !== undefined ? opt.show : true)}
                />
            </div>
            {touched && error && (<span style={errorStyle}>{error}</span>)}
        </span>
    );
};

TimezoneSelector.displayName = 'TimezoneSelector';

TimezoneSelector.propTypes = {
    input: PropTypes.object.isRequired,
    placeholder: PropTypes.string,
    meta: PropTypes.object.isRequired,
    style: PropTypes.object,
    id: PropTypes.string
};

export default TimezoneSelector;