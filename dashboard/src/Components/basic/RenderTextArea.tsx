import React from 'react';
import PropTypes from 'prop-types';

export interface ComponentProps {
    input: object;
    placeholder: string;
    type?: string;
    className?: string;
    maxlength?: number;
    meta: object;
    rows?: string;
    disabled?: boolean;
    style: object;
    initialValue?: string;
    id: string;
}

const RenderTextArea = ({
    input,
    placeholder,
    type,
    meta,
    className,
    maxlength,
    rows,
    disabled,
    style,
    id,
    initialValue
}: RenderTextAreaProps) => (
    <span style={{ display: 'block', width: '100%' }}>
        <textarea
            id={id || 'feedback-textarea'}
            {...input}
            type={type}
            rows={rows}
            placeholder={placeholder}
            maxLength={maxlength}
            className={className}
            disabled={disabled || false}
            style={style || {}}
            defaultValue={initialValue}
        />
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
                    <span style={{ color: 'red' }}>{meta.error}</span>
                </div>
            </div>
        )}
    </span>
);

RenderTextArea.displayName = 'RenderTextArea';

RenderTextArea.propTypes = {
    input: PropTypes.object.isRequired,
    placeholder: PropTypes.string.isRequired,
    type: PropTypes.string,
    className: PropTypes.string,
    maxlength: PropTypes.number,
    meta: PropTypes.object.isRequired,
    rows: PropTypes.string,
    disabled: PropTypes.bool,
    style: PropTypes.object.isRequired,
    initialValue: PropTypes.string,
    id: PropTypes.string.isRequired,
};

export { RenderTextArea };
