import React from 'react';
import PropTypes from 'prop-types';

export interface ComponentProps {
    initialValue?: string | boolean;
    input: object;
    placeholder?: string;
    type?: string;
    className?: string;
    id?: string;
    meta: object;
    rows?: string;
    disabled?: boolean;
    style?: object;
    required?: boolean;
    autoFocus?: boolean;
    parentStyle?: object;
    autoComplete?: string;
    autofilled?: string;
    handleFocus?: Function;
    handleBlur?: Function;
}

const RenderField: Function = ({
    input,
    placeholder,
    type,
    meta,
    className,
    id,
    disabled,
    initialValue,
    style,
    required,
    autoFocus,
    autofilled,
    parentStyle = {},
    handleFocus,
    handleBlur
}: RenderFieldProps) => (
    <span style={{ width: '100%', ...parentStyle }}>
        <span>
            <input
                {...input}
                type={type}
                placeholder={placeholder}
                className={className}
                id={id}
                disabled={disabled || false}
                defaultValue={initialValue}
                style={style || {}}
                required={required}
                autoFocus={autoFocus}
                autoComplete={autofilled || 'on'}
                onFocus={handleFocus}
                onBlur={handleBlur}
            />
        </span>
        <br />
        {meta.error && meta.touched && (
            <div
                className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                style={{ ...style, marginTop: '5px', alignItems: 'center' }}
            >
                <div
                    className="Box-root Margin-right--8"
                    style={{ marginTop: '2px' }}
                >
                    <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                </div>
                <div className="Box-root">
                    <span id="field-error" style={{ color: 'red' }}>
                        {typeof meta.error === 'object'
                            ? meta.error.domain
                            : meta.error}
                    </span>
                </div>
            </div>
        )}
    </span>
);

RenderField.displayName = 'RenderField';

RenderField.propTypes = {
    initialValue: PropTypes.oneOfType([PropTypes.string, PropTypes.bool]),
    input: PropTypes.object.isRequired,
    placeholder: PropTypes.string,
    type: PropTypes.string,
    className: PropTypes.string,
    id: PropTypes.string,
    meta: PropTypes.object.isRequired,
    rows: PropTypes.string,
    disabled: PropTypes.bool,
    style: PropTypes.object,
    required: PropTypes.bool,
    autoFocus: PropTypes.bool,
    parentStyle: PropTypes.object,
    autoComplete: PropTypes.string,
    autofilled: PropTypes.string,
    handleFocus: PropTypes.func,
    handleBlur: PropTypes.func,
};

RenderField.defaultProps = {
    required: false,
    autoFocus: false,
};

export { RenderField };
