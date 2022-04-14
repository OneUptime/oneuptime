import React, { Component } from 'react';

import { Translate } from 'react-auto-translate';
import PropTypes from 'prop-types';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import { translateLanguage } from '../actions/status';

import { openLanguageMenu } from '../actions/subscribe';


import ClickOutHandler from 'react-onclickout';

interface LanguageBoxProps {
    statusPage?: object;
    theme?: boolean;
    handleCloseButtonClick?: Function;
    translateLanguage?: Function;
}

class LanguageBox extends Component<ComponentProps> {
    constructor(props: $TSFixMe) {
        super(props);
        this.translateButton = this.translateButton.bind(this);
        this.state = {
            language: 'english',
        };
    }
    translateButton = () => {

        this.props.handleCloseButtonClick();
    };
    handleChange = (event: $TSFixMe) => {
        this.setState({
            ...this.state,
            language: event.target.value,
        });
    };
    handleTranslate = () => {

        this.props.translateLanguage(this.state.language);
        this.translateButton();
    };
    override render() {

        const { statusPage } = this.props;
        const languages = statusPage.multipleLanguages;

        const theme = this.props.theme;
        return (
            <div className="subscribe-overlay">
                <ClickOutHandler onClickOut={() => this.translateButton()}>
                    <div
                        className={'white box subscribe-box'}
                        style={{
                            height: 'auto',
                            width: '300px',
                            marginLeft: theme && '-100px',
                        }}
                    >
                        <div
                            className="btn-group"
                            style={{
                                background: '#fff',
                            }}
                        >
                            <button
                                id="updates-dropdown-atom-btn"
                                style={{
                                    cursor: 'default',
                                    background: '#fff',
                                }}
                                className="icon-container"
                            >
                                <div
                                    style={{
                                        display: 'flex',

                                        alignItems: 'center',
                                        marginLeft: 15,
                                    }}
                                    className="title-wrapper"
                                >
                                    <span
                                        className="title"
                                        style={{
                                            fontSize: 16,
                                        }}
                                    >
                                        Choose Language
                                    </span>
                                </div>
                            </button>

                            <button
                                id="updates-dropdown-close-btn"
                                onClick={() => this.translateButton()}
                                className="icon-container"
                                style={{
                                    width: '70px',
                                    background: '#fff',
                                }}
                            >
                                <div
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'center',
                                        alignItems: 'center',
                                    }}
                                >
                                    <span className="sub-icon icon-close"></span>
                                </div>
                            </button>
                        </div>
                        <div
                            className={
                                theme
                                    ? 'subscribe-box-inner bs-new-bg'
                                    : 'subscribe-box-inner'
                            }
                            style={{ paddingTop: 0 }}
                        >
                            <select

                                value={this.state.language}
                                onChange={this.handleChange}
                                name="country"
                                className="select-full"
                            >
                                {languages.map((language: $TSFixMe) => <option
                                    value={language.toLowerCase()}
                                    key={language}
                                >
                                    {language}
                                </option>)}
                            </select>
                            <div style={{ marginTop: 10 }}>
                                <button
                                    className={

                                        this.props.theme
                                            ? 'subscribe-btn-full bs-theme-btn'
                                            : 'subscribe-btn-full'
                                    }
                                    id="subscribe-btn-sms"
                                    onClick={() => this.handleTranslate()}
                                >
                                    <Translate>Translate Page</Translate>
                                </button>
                            </div>
                        </div>
                    </div>
                </ClickOutHandler>
            </div>
        );
    }
}


LanguageBox.displayName = 'LanguageBox';

const mapStateToProps: Function = (state: RootState) => ({
    select: state.subscribe.selectedMenu,
    subscribed: state.subscribe.subscribed,
    statusPage: state.status.statusPage
});

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators({ openLanguageMenu, translateLanguage }, dispatch);


LanguageBox.propTypes = {
    statusPage: PropTypes.object,
    theme: PropTypes.bool,
    handleCloseButtonClick: PropTypes.func,
    translateLanguage: PropTypes.func,
};

export default connect(mapStateToProps, mapDispatchToProps)(LanguageBox);
