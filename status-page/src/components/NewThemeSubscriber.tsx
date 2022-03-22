import React, { useState, useRef, useEffect } from 'react';
import SubscribeBox from './Subscribe/SubscribeBox';

import { Translate } from 'react-auto-translate';

const NewThemeSubscriber = () => {
    const [isShown, setIsShown] = useState(false);
    const popupRef = useRef();
    const subRef = useRef();

    const handleToggleButtonClick = () => {
        setIsShown(prevState => !prevState);
    };
    const handleCloseButtonClick = () => {
        setIsShown(false);
    };
    useEffect(() => {
        const listener = (event: $TSFixMe) => {

            if (!popupRef.current || popupRef.current.contains(event.target)) {
                return;
            }

            if (isShown && subRef.current.contains(event.target)) {
                return;
            } else {

                handleCloseButtonClick(event);
            }
        };
        document.addEventListener('mousedown', listener);
        document.addEventListener('touchstart', listener);
        return () => {
            document.removeEventListener('mousedown', listener);
            document.removeEventListener('touchstart', listener);
        };
    });

    return (
        <div className="popup-menu-container" id="subscriber-button">
            <button

                ref={subRef}
                className="subscribe_btn"
                onClick={handleToggleButtonClick}
            >
                <Translate>subscribe to updates</Translate>
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
