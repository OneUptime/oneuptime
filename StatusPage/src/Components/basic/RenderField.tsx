import React from 'react';
import PropTypes from 'prop-types';

const errorStyle: $TSFixMe = {
    color: 'red',
    topMargin: '5px',
    lineHeight: '200%',
    fontSize: '14px',
    fontWeight: '350',
};

interface RenderFieldProps {
    initialValue?: string | boolean;
    input: object;
    placeholder: string;
    type: string;
    className?: string;
    id?: string;
    meta: object;
    rows?: string;
    disabled?: boolean;
    style?: object;
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
}: RenderFieldProps) => {
    return (
        <span>
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
                />
            </span>
            <br />
            {meta.error && meta.touched && (
                <span style={errorStyle}>{meta.error}</span>
            )}
        </span>
    );
};

RenderField.displayName = 'RenderField';

RenderField.propTypes = {
    initialValue: PropTypes.oneOfType([PropTypes.string, PropTypes.bool]),
    input: PropTypes.object.isRequired,
    placeholder: PropTypes.string.isRequired,
    type: PropTypes.string.isRequired,
    className: PropTypes.string,
    id: PropTypes.string,
    meta: PropTypes.object.isRequired,
    rows: PropTypes.string,
    disabled: PropTypes.bool,
    style: PropTypes.object,
};

export { RenderField };
