import React, { useState } from 'react';
import PropTypes from 'prop-types';
import Select from 'react-select-fyipe';
import { Times } from './TimeArray';

const TimeSelector = ({ input, meta: { touched, error }, style }) => {
    const options = [{ value: '', label: 'Select Time...' }].concat(Times.map(time => {
        return {
            value: time,
            label: time
        }
    }));
    const filteredOpt = options.filter(opt => opt.value === input.value);
    const [value, setValue] = useState({ value: input.value, label: filteredOpt.length > 0 ? filteredOpt[0].label : 'Select Time...' });
    const handleChange = (option) => {
        setValue(option);
        if (input.onChange) {
            input.onChange(option.value);
        }
    };

    return (
        <span>
            <div style={{ ...style, height: '28px' }}>
                <Select
                    name={input.name}
                    value={value}
                    onChange={handleChange}
                    className="db-select-nw"
                    options={options.filter(opt => opt.show !== undefined ? opt.show : true)}
                />
            </div>
            {
                touched && error && <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart" style={{ marginTop: '5px' }}>
                    <div className="Box-root Margin-right--8" style={{ marginTop: '2px' }}>
                        <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex">
                        </div>
                    </div>
                    <div className="Box-root">
                        <span style={{ color: 'red' }}>
                            {error}
                        </span>
                    </div>
                </div>
            }
        </span>
    );
};

TimeSelector.displayName = 'TimeSelector';

TimeSelector.propTypes = {
    input: PropTypes.object.isRequired,
    style: PropTypes.object,
    meta: PropTypes.object.isRequired
};

export default TimeSelector;