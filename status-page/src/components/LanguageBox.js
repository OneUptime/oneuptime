import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
//import Call from './Subscribe/Call';
//import Message from './Subscribe/Message';
import { translateLanguage } from '../actions/status';

import { openSubscribeMenu, selectedMenu } from '../actions/subscribe';
//import ShouldRender from './ShouldRender';
//import ClickOutHandler from 'react-onclickout';

class LanguageBox extends Component {
    constructor(props) {
        super(props);
        this.subscribebutton = this.subscribebutton.bind(this);
        //this.selectbutton = this.selectbutton.bind(this);
        this.state = {
            language: 'english',
        };
    }
    subscribebutton = () => {
        if (this.props.theme) {
            this.props.handleCloseButtonClick();
        } else {
            this.props.openSubscribeMenu();
        }
    };
    handleChange = event => {
        // eslint-disable-next-line no-console
        this.setState({
            ...this.state,
            language: event.target.value,
        });
    };
    handleTranslate = () => {
        this.props.translateLanguage(this.state.language);
    };
    render() {
        //const { statusPage } = this.props;
        //const { emailNotification } = statusPage;
        const theme = this.props.theme;
        // eslint-disable-next-line no-console
        console.log(theme);
        return (
            <div className="subscribe-overlay">
                <div
                    className={
                        !theme ? 'white box subscribe-box' : 'bs-theme-shadow'
                    }
                    style={{
                        height: 'auto',
                        width: '300px',
                        marginLeft: theme && '-100px',
                    }}
                >
                    <div className="btn-group">
                        <button
                            id="updates-dropdown-close-btn"
                            onClick={() => this.subscribebutton()}
                            //disabled={this.props.subscribed.requesting}
                            className="icon-container"
                        >
                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'flex-end',
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
                    >
                        <select
                            value={this.state.language}
                            onChange={this.handleChange}
                            name="country"
                            className="select-full"
                        >
                            <option value="english">English</option>
                            <option value="dutch">Dutch</option>
                            <option value="french">French</option>
                            <option value="spanish">Spanish</option>
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
                                Translate Page
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

LanguageBox.displayName = 'LanguageBox';

const mapStateToProps = state => ({
    select: state.subscribe.selectedMenu,
    subscribed: state.subscribe.subscribed,
    statusPage: state.status.statusPage,
});

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        { openSubscribeMenu, selectedMenu, translateLanguage },
        dispatch
    );

LanguageBox.propTypes = {
    openSubscribeMenu: PropTypes.func,
    //statusPage: PropTypes.object,
    //language: PropTypes.object,
    theme: PropTypes.bool,
    handleCloseButtonClick: PropTypes.func,
    translateLanguage: PropTypes.func,
};

export default connect(mapStateToProps, mapDispatchToProps)(LanguageBox);
