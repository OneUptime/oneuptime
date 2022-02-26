import React, { useState, useRef, useEffect } from 'react';
import SubscribeBox from './Subscribe/SubscribeBox';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
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
            // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
            if (!popupRef.current || popupRef.current.contains(event.target)) {
                return;
            }
            // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
            if (isShown && subRef.current.contains(event.target)) {
                return;
            } else {
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 0 arguments, but got 1.
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
                // @ts-expect-error ts-migrate(2322) FIXME: Type 'MutableRefObject<undefined>' is not assignab... Remove this comment to see the full error message
                ref={subRef}
                className="subscribe_btn"
                onClick={handleToggleButtonClick}
            >
                <Translate>subscribe to updates</Translate>
            </button>
            <div
                className={`popup-menu ${isShown ? 'shown' : ''}`}
                // @ts-expect-error ts-migrate(2322) FIXME: Type 'MutableRefObject<undefined>' is not assignab... Remove this comment to see the full error message
                ref={popupRef}
            >
                <SubscribeBox
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ theme: boolean; handleCloseButtonClick: ()... Remove this comment to see the full error message
                    theme={true}
                    handleCloseButtonClick={handleCloseButtonClick}
                />
            </div>
        </div>
    );
};

NewThemeSubscriber.displayName = 'NewThemeSubscriber';

export default NewThemeSubscriber;
