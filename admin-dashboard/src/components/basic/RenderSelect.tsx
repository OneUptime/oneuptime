import React, { useState, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';
import Select from './react-select-oneuptime';

const RenderSelect = ({
    input,
    placeholder,
    className,
    disabled,
    style,
    meta,
    options = [{ value: '', label: 'Select' }],
    message,
    id,
    autoFocus
}: $TSFixMe) => {
    const filteredOpt = useRef();
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'opt' implicitly has an 'any' type.
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
        <span style={{ height: '28px', width: '250px', ...style }}>
            <div style={{ display: 'flex' }}>
                <Select
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ name: any; value: { value: any; label: any... Remove this comment to see the full error message
                    name={input.name}
                    value={value}
                    onChange={handleChange}
                    placeholder={placeholder}
                    className={className}
                    id={id}
                    isDisabled={disabled || false}
                    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'opt' implicitly has an 'any' type.
                    options={options.filter(opt =>
                        opt.show !== undefined ? opt.show : true
                    )}
                    autoFocus={autoFocus}
                />
                {message && message.length && (
                    <>
                        <span
                            style={{
                                marginLeft: '5px',
                                display: 'flex',
                                alignItems: 'center',
                            }}
                        >
                            {message}
                        </span>
                        <br />
                    </>
                )}
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
        </span>
    );
};

RenderSelect.displayName = 'RenderSelect';

RenderSelect.propTypes = {
    input: PropTypes.object.isRequired,
    placeholder: PropTypes.string,
    className: PropTypes.string,
    meta: PropTypes.object.isRequired,
    disabled: PropTypes.bool,
    style: PropTypes.object,
    options: PropTypes.array.isRequired,
    message: PropTypes.string,
    id: PropTypes.string,
    autoFocus: PropTypes.bool,
};

RenderSelect.defaultProps = {
    autoFocus: false,
};

export { RenderSelect };
