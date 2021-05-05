import React from 'react';
import PropTypes from 'prop-types';

const RenderSearchField = ({
    input,
    placeholder,
    type,
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
    handleBlur,
}) => (
    <div style={{ width: '100%', ...parentStyle }} id="search-input-container">
        <img
            src="/dashboard/assets/icons/search-solid.svg"
            id="search-input-img"
            alt="search-icon"
        />
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
    </div>
);

RenderSearchField.displayName = 'RenderSearchField';

RenderSearchField.propTypes = {
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

RenderSearchField.defaultProps = {
    required: false,
    autoFocus: false,
};

export { RenderSearchField };
