import React, { useState, useRef, useEffect } from 'react';
import SubscribeBox from './Subscribe/SubscribeBox';

const NewThemeSubscriber = () => {
    const [isShown, setIsShown] = useState(false);
    const popupRef = useRef();
    const documentClickHandler = useRef();

    useEffect(() => {
        documentClickHandler.current = e => {
            if (popupRef.current && popupRef.current.contains(e.target)) return;
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
        <div className="popup-menu-container">
            <button className="subscribe_btn" onClick={handleToggleButtonClick}>
                subscribe to updates
            </button>
            <div
                className={`popup-menu ${isShown ? 'shown' : ''}`}
                ref={popupRef}
            >
                <SubscribeBox
                    theme={true}
                    handleCloseButtonClick={handleCloseButtonClick}
                />
            </div>
        </div>
    );
};

NewThemeSubscriber.displayName = 'NewThemeSubscriber';

export default NewThemeSubscriber;
