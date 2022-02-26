import React from 'react';
import PropTypes from 'prop-types';
import ShouldRender from './ShouldRender';
import { BookmarkIcon, CancelIcon } from '../svg';

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
    iconLeft,
    iconRight,
    iconLeftStyle,
    frame,
    onFrameClick,
    handleIconClick,
    display
}: $TSFixMe) => (
    <div style={{ width: '100%', ...parentStyle }} id="search-input-container">
        <ShouldRender if={iconLeft}>
            <img
                src="/dashboard/assets/icons/search-solid.svg"
                id="search-input-img"
                alt="search-icon"
                style={iconLeftStyle || {}}
            />
        </ShouldRender>
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
        <ShouldRender if={frame}>
            <div
                className="bs-search-log bs-search-frame"
                onClick={onFrameClick}
            >
                <BookmarkIcon />
            </div>
        </ShouldRender>
        <ShouldRender if={iconRight}>
            <ShouldRender if={!display}>
                <div className="bs-search-log bs-search-icon">
                    <img
                        src="/dashboard/assets/icons/search-solid.svg"
                        id="search-input-img-2"
                        alt="search-icon"
                    />
                </div>
            </ShouldRender>
            <ShouldRender if={display}>
                <div
                    className="bs-search-log bs-search-icon bs-cursor-log"
                    onClick={handleIconClick}
                >
                    <CancelIcon />
                </div>
            </ShouldRender>
        </ShouldRender>
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
    iconLeft: PropTypes.bool,
    iconRight: PropTypes.bool,
    frame: PropTypes.bool,
    onFrameClick: PropTypes.func,
    handleIconClick: PropTypes.func,
    display: PropTypes.string,
    iconLeftStyle: PropTypes.object,
};

RenderSearchField.defaultProps = {
    required: false,
    autoFocus: false,
};

export { RenderSearchField };
