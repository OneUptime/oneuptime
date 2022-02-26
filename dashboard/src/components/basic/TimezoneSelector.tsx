import React, { useState, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';
import Select from './Select';
import { Zones } from './TimezoneArray';

const errorStyle = {
    color: 'red',
    topMargin: '5px',
};

const TimezoneSelector = ({
    input,
    placeholder,
    style,
    meta: { touched, error },
    id,
    disabled
}: $TSFixMe) => {
    const options = [{ value: '', label: 'Select Timezone...' }].concat(
        Zones.map((zone: $TSFixMe) => ({
            value: zone.value,
            label: zone.name
        }))
    );

    const filteredOpt = useRef();
    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ value: string; label: string; }[]' is not ... Remove this comment to see the full error message
    filteredOpt.current = options.filter(opt => opt.value === input.value);

    const [value, setValue] = useState({
        value: input.value,
        label:
            // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
            filteredOpt.current.length > 0
                // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
                ? filteredOpt.current[0].label
                : placeholder,
    });

    useEffect(() => {
        setValue({
            value: input.value,
            label:
                // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
                filteredOpt.current.length > 0
                    // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
                    ? filteredOpt.current[0].label
                    : placeholder,
        });
    }, [input, placeholder]);

    const handleChange = (option: $TSFixMe) => {
        setValue(option);
        if (input.onChange) {
            input.onChange(option.value);
        }
    };

    return (
        <span>
            <div style={{ ...style, height: '28px', marginTop: '5px' }}>
                <Select
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ name: any; value: { value: any; label: any... Remove this comment to see the full error message
                    name={input.name}
                    value={value}
                    onChange={handleChange}
                    className="db-select-nw"
                    id={id}
                    placeholder={placeholder}
                    isDisabled={disabled}
                    options={options.filter(opt =>
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'show' does not exist on type '{ value: s... Remove this comment to see the full error message
                        opt.show !== undefined ? opt.show : true
                    )}
                />
            </div>
            {touched && error && <span style={errorStyle}>{error}</span>}
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
    disabled: PropTypes.bool,
};

export default TimezoneSelector;
