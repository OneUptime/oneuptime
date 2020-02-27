import React, { useState, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';
import Select from '../../components/basic/react-select-fyipe';

const RenderRotationFrequency = ({
    input,
    placeholder,
    className,
    disabled,
    style,
    meta,
    options = [{ value: '', label: 'Select' }],
    message,
    id,
}) => {
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
            <div style={{ height: '28px', width: '250px', ...style }}>
                <span>
                    <Select
                        name={input.name}
                        value={value}
                        onChange={handleChange}
                        placeholder={placeholder}
                        className={className}
                        id={id}
                        isDisabled={disabled || false}
                        options={options.filter(opt =>
                            opt.show !== undefined ? opt.show : true
                        )}
                    />
                </span>
            </div>

            {message && message.length && (
                <>
                    <span style={{ marginLeft: '5px' }}>{message}</span>
                    <br />
                </>
            )}
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
        </span>
    );
};

RenderRotationFrequency.displayName = 'RenderRotationFrequency';

RenderRotationFrequency.propTypes = {
    input: PropTypes.object.isRequired,
    placeholder: PropTypes.string,
    className: PropTypes.string,
    meta: PropTypes.object.isRequired,
    disabled: PropTypes.bool,
    style: PropTypes.object,
    options: PropTypes.array.isRequired,
    message: PropTypes.string,
    id: PropTypes.string,
};

export { RenderRotationFrequency };
