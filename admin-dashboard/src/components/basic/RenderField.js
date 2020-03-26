import React from 'react';
import PropTypes from 'prop-types';

const RenderField = ({
    input,
    placeholder,
    type,
    meta,
    className,
    id,
    disabled,
    initialValue,
    style,
}) => (
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
                    <span className="field-error" style={{ color: 'red' }}>
                        {meta.error}
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
    type: PropTypes.string.isRequired,
    className: PropTypes.string,
    id: PropTypes.string,
    meta: PropTypes.object.isRequired,
    rows: PropTypes.string,
    disabled: PropTypes.bool,
    style: PropTypes.object,
};

export { RenderField };
