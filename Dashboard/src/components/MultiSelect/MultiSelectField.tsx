import React from 'react';

import Select from 'react-select';

import { PropTypes } from 'prop-types';

const styles = {
    control: (provided: $TSFixMe) => ({
        ...provided,
        border: '1px solid hsl(0,0%,80%) !important',
        boxShadow: 'unset !important',
        minHeight: 'unset'
    }),
    option: (provided: $TSFixMe) => ({
        ...provided,
        backgroundColor: 'unset',

        ':hover': {
            ...provided[':hover'],
            backgroundColor: 'black',
            color: 'white',
        }
    }),
    menu: (provided: $TSFixMe) => ({
        ...provided,
        zIndex: 5
    }),
    multiValueLabel: (styles: $TSFixMe) => ({
        ...styles,
        color: 'white',
        backgroundColor: 'black',
        borderRadius: '5px 0 0 5px'
    }),
    multiValueRemove: (styles: $TSFixMe) => ({
        ...styles,
        color: 'white',
        backgroundColor: 'black',
        borderRadius: '0 5px 5px 0',
        cursor: 'pointer',

        ':hover': {
            backgroundColor: 'black',
            color: 'white',
        }
    }),
};

interface MultiSelectFieldProps {
    meta: object;
    input: object;
    options?: unknown[];
    classNamePrefix?: string;
    className?: string;
    placeholder?: string;
}

const MultiSelectField: Function = ({
    options,
    className,
    classNamePrefix,
    input,
    meta,
    placeholder
}: MultiSelectFieldProps) => {
    return (
        <div>
            <div>
                <Select
                    {...input}
                    closeMenuOnSelect={false}
                    onBlur={() => input.onBlur()}
                    value={input.value || []} // requires value to be an array
                    isMulti
                    options={options}
                    className={className}
                    classNamePrefix={classNamePrefix}
                    placeholder={placeholder}
                    styles={styles}
                />
            </div>
            {meta.touched && meta.error && (
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
                        <span style={{ color: 'red' }}>{meta.error}</span>
                    </div>
                </div>
            )}
        </div>
    );
};

MultiSelectField.displayName = 'MultiSelectField';

MultiSelectField.propTypes = {
    meta: PropTypes.object.isRequired,
    input: PropTypes.object.isRequired,
    options: PropTypes.array,
    classNamePrefix: PropTypes.string,
    className: PropTypes.string,
    placeholder: PropTypes.string,
};

export default MultiSelectField;
