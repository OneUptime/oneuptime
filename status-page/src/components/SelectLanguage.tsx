import React, { useRef, useEffect } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import LanguageBox from './LanguageBox';
import ShouldRender from './ShouldRender';
import { openLanguageMenu } from '../actions/subscribe';

const SelectLanguage = ({
    isShown,
    setIsShown,
    theme
}: $TSFixMe) => {
    const popupReff = useRef();
    const documentClickHandler = useRef();

    useEffect(() => {
        // @ts-expect-error ts-migrate(2322) FIXME: Type '(e: $TSFixMe) => void' is not assignable to ... Remove this comment to see the full error message
        documentClickHandler.current = (e: $TSFixMe) => {
            // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
            if (popupReff.current && popupReff.current.contains(e.target))
                return;
            setIsShown(false);
            removeDocumentClickHandler();
        };
    }, []);

    const removeDocumentClickHandler = () => {
        // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
        document.removeEventListener('click', documentClickHandler.current);
    };

    const handleCloseButtonClick = () => {
        setIsShown(false);
        removeDocumentClickHandler();
    };

    return (
        <div
            className="popup-menu-container"
            id="language-button"
            style={{ marginLeft: 10 }}
        >
            <ShouldRender if={isShown}>
                <LanguageBox
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ theme: any; handleCloseButtonClick: () => ... Remove this comment to see the full error message
                    theme={theme}
                    handleCloseButtonClick={handleCloseButtonClick}
                />
            </ShouldRender>
        </div>
    );
};

SelectLanguage.displayName = 'SelectLanguage';
SelectLanguage.propTypes = {
    isShown: PropTypes.bool,
    setIsShown: PropTypes.func,
    theme: PropTypes.bool,
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators({ openLanguageMenu }, dispatch);
export default connect(null, mapDispatchToProps)(SelectLanguage);
