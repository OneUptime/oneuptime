import React, { Component } from 'react';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { Translate } from 'react-auto-translate';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { translateLanguage } from '../actions/status';

import { openLanguageMenu } from '../actions/subscribe';

// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutHandler from 'react-onclickout';

class LanguageBox extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        this.translateButton = this.translateButton.bind(this);
        this.state = {
            language: 'english',
        };
    }
    translateButton = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleCloseButtonClick' does not exist o... Remove this comment to see the full error message
        this.props.handleCloseButtonClick();
    };
    handleChange = (event: $TSFixMe) => {
        this.setState({
            ...this.state,
            language: event.target.value,
        });
    };
    handleTranslate = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'translateLanguage' does not exist on typ... Remove this comment to see the full error message
        this.props.translateLanguage(this.state.language);
        this.translateButton();
    };
    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
        const { statusPage } = this.props;
        const languages = statusPage.multipleLanguages;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'theme' does not exist on type 'Readonly<... Remove this comment to see the full error message
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
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'language' does not exist on type 'Readon... Remove this comment to see the full error message
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
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'theme' does not exist on type 'Readonly<... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
LanguageBox.displayName = 'LanguageBox';

const mapStateToProps = (state: $TSFixMe) => ({
    select: state.subscribe.selectedMenu,
    subscribed: state.subscribe.subscribed,
    statusPage: state.status.statusPage
});

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators({ openLanguageMenu, translateLanguage }, dispatch);

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
LanguageBox.propTypes = {
    statusPage: PropTypes.object,
    theme: PropTypes.bool,
    handleCloseButtonClick: PropTypes.func,
    translateLanguage: PropTypes.func,
};

export default connect(mapStateToProps, mapDispatchToProps)(LanguageBox);
