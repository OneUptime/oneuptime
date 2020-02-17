import React from 'react';
import PropTypes from 'prop-types'

const errorStyle = {
    color:'#c23d4b',
    width: '222px'
}

const RenderField = ({ input, placeholder, type, meta, className, id, disabled, initialValue, style }) => (

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
        {meta.error &&
            meta.touched &&
            <span style={errorStyle}>
                {meta.error}
        </span>}
    </span>
)   

RenderField.displayName = 'RenderField'

RenderField.propTypes = {
    initialValue: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.bool,
    ]),
    input: PropTypes.object.isRequired,
    placeholder: PropTypes.string,
    type: PropTypes.string.isRequired,
    className: PropTypes.string,
    id: PropTypes.string,
    meta: PropTypes.object.isRequired,
    rows: PropTypes.string,
    disabled: PropTypes.bool,
    style: PropTypes.object
}

export {RenderField}



