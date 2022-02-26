import React, { useState, useRef, useEffect } from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import Select from './Select';

const errorStyle = {
    color: 'red',
    topMargin: '5px',
};

const ComponentSelector = ({
    input,
    className,
    disabled,
    meta: { touched, error },
    components,
    style,
    id
}: $TSFixMe) => {
    const options = [{ value: '', label: 'Select Component' }].concat(
        components.map((component: $TSFixMe) => {
            return {
                value: component._id,
                label: component.name,
            };
        })
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
                : 'Select Component',
    });

    useEffect(() => {
        setValue({
            value: input.value,
            label:
                // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
                filteredOpt.current.length > 0
                    // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
                    ? filteredOpt.current[0].label
                    : 'Select Component',
        });
    }, [input]);

    const handleChange = (option: $TSFixMe) => {
        setValue(option);
        if (input.onChange) {
            input.onChange(option.value);
        }
    };

    return (
        <span>
            <div style={{ ...style, height: '28px' }}>
                <Select
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ name: any; value: { value: any; label: any... Remove this comment to see the full error message
                    name={input.name}
                    value={value}
                    onChange={handleChange}
                    className={className}
                    id={id}
                    isDisabled={disabled || false}
                    options={options}
                />
            </div>
            {touched && error && <span style={errorStyle}>{error}</span>}
        </span>
    );
};

ComponentSelector.displayName = 'ComponentSelector';

function mapStateToProps(state: $TSFixMe) {
    return {
        currentProject: state.project.currentProject,
    };
}

ComponentSelector.propTypes = {
    input: PropTypes.object.isRequired,
    className: PropTypes.string,
    meta: PropTypes.object.isRequired,
    disabled: PropTypes.bool,
    style: PropTypes.object,
    id: PropTypes.string,
    components: PropTypes.array.isRequired,
};

export default connect(mapStateToProps)(ComponentSelector);
