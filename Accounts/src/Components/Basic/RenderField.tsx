import React from 'react';
import PropTypes from 'prop-types';

const errorStyle: $TSFixMe = {
    color: '#c23d4b',
    width: '222px',
};

interface RenderFieldProps {
    initialValue?: string;
    input: object;
    placeholder?: string;
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
    style
}: RenderFieldProps) => (
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
        {meta.error && meta.touched && (
            <span id={`${id}_error`} style={errorStyle}>
                {meta.error}
            </span>
        )}
    </span>
);

RenderField.displayName = 'RenderField';

RenderField.propTypes = {
    initialValue: PropTypes.string,
    input: PropTypes.object.isRequired,
    placeholder: PropTypes.string,
    type: PropTypes.string.isRequired,
    className: PropTypes.string,
    id: PropTypes.string,
    meta: PropTypes.object.isRequired,
    rows: PropTypes.string,
    disabled: PropTypes.bool,
    style: PropTypes.object,
};

export { RenderField };
