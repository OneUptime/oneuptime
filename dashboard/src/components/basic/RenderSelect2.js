import React, { useState } from 'react';
import PropTypes from 'prop-types'
import Select from 'react-select-fyipe';

const RenderSelect = ({ input, placeholder, className, disabled, style, meta, options = [{ value: '', label: 'Select' }], message, id }) => {
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
            <div style={{ ...style, height: '28px' }}>
                <Select
                    name={input.name}
                    value={value}
                    onChange={handleChange}
                    placeholder={placeholder}
                    className={className}
                    id={id}
                    isDisabled={disabled || false}
                    options={options.filter(opt => opt.show !== undefined ? opt.show : true)}
                />
            </div>
            {message && message.length && <><span style={{ marginLeft: '5px' }}>{message}</span><br /></>}
            {
                meta.touched && meta.error &&
                <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart" style={{ marginTop: '5px' }}>
                    <div className="Box-root Margin-right--8" style={{ marginTop: '2px' }}>
                        <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex">
                        </div>
                    </div>
                    <div className="Box-root">
                        <span style={{ color: 'red' }}>
                            {meta.error}
                        </span>
                    </div>
                </div>
            }
        </span >
    );
};

RenderSelect.displayName = 'RenderSelect'

RenderSelect.propTypes = {
    input: PropTypes.object.isRequired,
    placeholder: PropTypes.string,
    className: PropTypes.string,
    meta: PropTypes.object.isRequired,
    disabled: PropTypes.bool,
    style: PropTypes.object,
    options: PropTypes.oneOfType([PropTypes.array, PropTypes.string]),
    message: PropTypes.string,
    id: PropTypes.string
}

export { RenderSelect }