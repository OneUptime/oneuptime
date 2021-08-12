import React, { useState, useRef, useEffect } from 'react';
import LanguageBox from './LanguageBox';
import { Translate } from 'react-auto-translate';

const SelectLanguage = () => {
    const [isShown, setIsShown] = useState(false);
    const popupReff = useRef();
    const documentClickHandler = useRef();

    useEffect(() => {
        documentClickHandler.current = e => {
            if (popupReff.current && popupReff.current.contains(e.target))
                return;
            setIsShown(false);
            removeDocumentClickHandler();
        };
    }, []);

    const removeDocumentClickHandler = () => {
        document.removeEventListener('click', documentClickHandler.current);
    };

    const handleToggleButtonClick = () => {
        if (isShown) return;
        setIsShown(true);
        document.addEventListener('click', documentClickHandler.current);
    };

    const handleCloseButtonClick = () => {
        setIsShown(false);
        removeDocumentClickHandler();
    };

    return (
        <div
            className="popup-menu-container"
            id="subscriber-button"
            style={{ marginLeft: 10 }}
        >
            <button
                className="subscribe_btn"
                onClick={handleToggleButtonClick}
                style={{
                    backgroundColor: 'transparent',
                }}
            >
                <Translate>language</Translate>
            </button>
            <div
                className={`popup-menu ${isShown ? 'shown' : ''}`}
                ref={popupReff}
            >
                <LanguageBox
                    theme={true}
                    handleCloseButtonClick={handleCloseButtonClick}
                />
            </div>
        </div>
    );
};

SelectLanguage.displayName = 'SelectLanguage';

export default SelectLanguage;
