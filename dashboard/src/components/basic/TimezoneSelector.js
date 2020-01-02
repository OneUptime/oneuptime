import React, { useState, useRef, useEffect } from 'react';
import PropTypes from 'prop-types'
import Select from 'react-select-fyipe';
import { Zones } from './TimezoneArray';

let errorStyle = {
    color: 'red',
    topMargin: '5px'
};

const TimezoneSelector = ({ input, placeholder, style, meta: { touched, error }, id,disabled }) => {
    const options = [{ value: '', label: 'Select Timezone...' }].concat(Zones.map(zone => (
        { value: zone.value, label: zone.name }
    )));

    const filteredOpt = useRef();
    filteredOpt.current = options.filter(opt => opt.value === input.value);

    const [value, setValue] = useState({
        value: input.value, label: filteredOpt.current.length > 0 ?
            filteredOpt.current[0].label : placeholder
    });

    useEffect(() => {
        setValue({
            value: input.value, label: filteredOpt.current.length > 0 ?
                filteredOpt.current[0].label : placeholder
        });
    }, [input, placeholder]);

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
                    placeholder={placeholder}
                    isDisabled={disabled}
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
    id: PropTypes.string,
    disabled:PropTypes.bool
};

export default TimezoneSelector;