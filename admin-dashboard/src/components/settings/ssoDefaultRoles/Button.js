import React from 'react';
import PropTypes from 'prop-types';

const Button = ({ id, onClick = () => {}, text, shortcut }) => (
    <button
        id={id}
        className="bs-Button bs-ButtonLegacy ActionIconParent"
        type="button"
        onClick={onClick}
        style={{
            marginLeft: '8px',
            paddingTop: 3,
            paddingBottom: 3,
        }}
    >
        <span className="bs-FileUploadButton bs-Button--icon bs-Button--new keycode__wrapper">
            <span>{text}</span>
            <span className="new-btn__keycode">{shortcut}</span>
        </span>
    </button>
);

Button.displayName = 'Button';

Button.propTypes = {
    text: PropTypes.string,
    shortcut: PropTypes.string,
    id: PropTypes.string,
    onClick: PropTypes.func,
};


export default Button;
