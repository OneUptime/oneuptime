import React, { useRef, useEffect } from 'react';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import LanguageBox from './LanguageBox';
import ShouldRender from './ShouldRender';
import { openLanguageMenu } from '../actions/subscribe';

interface SelectLanguageProps {
    isShown?: boolean;
    setIsShown?: Function;
    theme?: boolean;
}

const SelectLanguage: Function = ({
    isShown,
    setIsShown,
    theme
}: SelectLanguageProps) => {
    const popupReff = useRef();
    const documentClickHandler = useRef();

    useEffect(() => {

        documentClickHandler.current = (e: $TSFixMe) => {

            if (popupReff.current && popupReff.current.contains(e.target))
                return;
            setIsShown(false);
            removeDocumentClickHandler();
        };
    }, []);

    const removeDocumentClickHandler: Function = () => {

        document.removeEventListener('click', documentClickHandler.current);
    };

    const handleCloseButtonClick: Function = () => {
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

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators({ openLanguageMenu }, dispatch);
export default connect(null, mapDispatchToProps)(SelectLanguage);
