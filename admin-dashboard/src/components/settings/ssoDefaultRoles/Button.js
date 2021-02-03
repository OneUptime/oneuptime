import React from 'react';
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

export default Button;
