import React, { useRef, useState, useEffect } from 'react';
import { PropTypes } from 'prop-types';
import Select from './react-select-fyipe';

const errorStyle = {
    color: 'red',
    topMargin: '5px',
};

const TeamSelector = ({
    input,
    placeholder,
    meta: { touched, error },
    team,
}) => {
    const options = [{ value: '', label: 'Select team member...' }].concat(
        team.map(member => ({
            value: member.userId,
            label: member.name,
            show: member.role !== 'Owner',
        }))
    );

    const filteredOpt = useRef();
    filteredOpt.current = options.filter(opt => opt.value === input.value);

    const [value, setValue] = useState({
        value: input.value,
        label:
            filteredOpt.current.length > 0
                ? filteredOpt.current[0].label
                : placeholder,
    });

    useEffect(() => {
        setValue({
            value: input.value,
            label:
                filteredOpt.current.length > 0
                    ? filteredOpt.current[0].label
                    : placeholder,
        });
    }, [input, placeholder]);

    const handleChange = option => {
        setValue(option);
        if (input.onChange) {
            input.onChange(option.value);
        }
    };

    return (
        <span>
            <div style={{ height: '28px' }}>
                <Select
                    name={input.name}
                    value={value}
                    onChange={handleChange}
                    className="db-select-nw"
                    options={options.filter(opt =>
                        opt.show !== undefined ? opt.show : true
                    )}
                />
            </div>
            {touched && error && (
                <div
                    className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                    style={{ marginTop: '5px' }}
                >
                    <div
                        className="Box-root Margin-right--8"
                        style={{ marginTop: '2px' }}
                    >
                        <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                    </div>
                    <div className="Box-root">
                        <span style={errorStyle}>{error}</span>
                    </div>
                </div>
            )}
        </span>
    );
};

TeamSelector.displayName = 'TeamSelector';

TeamSelector.propTypes = {
    input: PropTypes.object.isRequired,
    placeholder: PropTypes.string,
    team: PropTypes.array,
    meta: PropTypes.object.isRequired,
};

export default TeamSelector;
