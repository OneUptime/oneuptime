/**
 * From gist
 */

import React from 'react';
import PropTypes from 'prop-types';
import Select from '../../components/basic/Select';

/**
 * onChange from Redux Form Field has to be called explicity.
 */
function singleChangeHandler(func: $TSFixMe) {
    return function handleSingleChange(value: $TSFixMe) {
        func(value ? value.value : '');
    };
}

/**
 * onBlur from Redux Form Field has to be called explicity.
 */
function multiChangeHandler(func: $TSFixMe) {
    return function handleMultiHandler(values: $TSFixMe) {
        func(values.map((value: $TSFixMe) => value.value));
    };
}

/**
 * For single select, Redux Form keeps the value as a string, while React Select
 * wants the value in the form { value: "grape", label: "Grape" }
 *
 * * For multi select, Redux Form keeps the value as array of strings, while React Select
 * wants the array of values in the form [{ value: "grape", label: "Grape" }]
 */
function transformValue(value: $TSFixMe, options: $TSFixMe, isMulti: $TSFixMe) {
    if (isMulti && typeof value === 'string') return [];

    const filteredOptions = options.filter((option: $TSFixMe) => {
        return isMulti
            ? value && value.indexOf(option.value) !== -1
            : option.value === value;
    });

    return isMulti ? filteredOptions : filteredOptions[0];
}

interface RFReactSelectProps {
    input: {
        name: string,
        value: string,
        onBlur: Function,
        onChange: Function,
        onFocus: Function
    };
    options: unknown[];
    isMulti?: boolean;
    disabled?: boolean;
    className?: string;
    placeholder?: string;
    labelKey?: string;
    valueKey?: string;
}

const RFReactSelect = ({
    input,
    options,
    valueKey,
    labelKey,
    isMulti,
    className,
    placeholder,
    disabled
}: RFReactSelectProps) => {
    const { name, value, onBlur, onChange, onFocus } = input;
    const transformedValue = transformValue(value, options, isMulti);
    return (
        <Select

            valueKey={valueKey || 'value'}
            labelKey={labelKey || 'name'}
            placeholder={placeholder}
            name={name}
            value={transformedValue}
            isMulti={isMulti}
            isDisabled={disabled}
            options={options}
            onChange={
                isMulti
                    ? multiChangeHandler(onChange)
                    : singleChangeHandler(onChange)
            }
            onBlur={() => onBlur(value)}
            onFocus={onFocus}
            className={className}
        />
    );
};
RFReactSelect.displayName = 'RFReactSelect';

RFReactSelect.defaultProps = {
    multi: false,
    className: '',
};

RFReactSelect.propTypes = {
    input: PropTypes.shape({
        name: PropTypes.string.isRequired,
        value: PropTypes.string.isRequired,
        onBlur: PropTypes.func.isRequired,
        onChange: PropTypes.func.isRequired,
        onFocus: PropTypes.func.isRequired,
    }).isRequired,
    options: PropTypes.array.isRequired,
    isMulti: PropTypes.bool,
    disabled: PropTypes.bool,
    className: PropTypes.string,
    placeholder: PropTypes.string,
    labelKey: PropTypes.string,
    valueKey: PropTypes.string,
};

export default RFReactSelect;
