import React, { useState, useRef, useEffect } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import LanguageBox from './LanguageBox';
import { Translate } from 'react-auto-translate';
import ShouldRender from './ShouldRender';
import { openLanguageMenu } from '../actions/subscribe';

const SelectLanguage = ({ theme, languageMenu, openLanguageMenu }) => {
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
        openLanguageMenu();
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
            id="language-button"
            style={{ marginLeft: 10 }}
        >
            <button
                className={!theme ? 'bs-Button-subscribe' : 'subscribe_btn '}
                onClick={handleToggleButtonClick}
                style={
                    {
                        //backgroundColor: 'transparent',
                    }
                }
            >
                <Translate>Language</Translate>
            </button>
            {theme ? (
                <div
                    className={`popup-menu ${isShown ? 'shown' : ''}`}
                    ref={popupReff}
                >
                    <LanguageBox
                        theme={theme}
                        handleCloseButtonClick={handleCloseButtonClick}
                    />
                </div>
            ) : (
                <ShouldRender if={languageMenu}>
                    <LanguageBox
                        theme={theme}
                        handleCloseButtonClick={handleCloseButtonClick}
                    />
                </ShouldRender>
            )}
        </div>
    );
};

SelectLanguage.displayName = 'SelectLanguage';
SelectLanguage.propTypes = {
    theme: PropTypes.bool,
    languageMenu: PropTypes.bool,
    openLanguageMenu: PropTypes.func,
};

const mapDispatchToProps = dispatch =>
    bindActionCreators({ openLanguageMenu }, dispatch);
export default connect(null, mapDispatchToProps)(SelectLanguage);
