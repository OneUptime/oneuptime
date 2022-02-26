import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import Call from './Call';
import Message from './Message';
import Webhook from './Webhook';
import Monitors from './Monitors';
import { openSubscribeMenu, selectedMenu } from '../../actions/subscribe';
import ShouldRender from '../ShouldRender';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutHandler from 'react-onclickout';
import { API_URL } from '../../config';

class SubscribeBox extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        this.subscribebutton = this.subscribebutton.bind(this);
        this.selectbutton = this.selectbutton.bind(this);
    }
    subscribebutton = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'theme' does not exist on type 'Readonly<... Remove this comment to see the full error message
        if (this.props.theme) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleCloseButtonClick' does not exist o... Remove this comment to see the full error message
            this.props.handleCloseButtonClick();
        } else {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'openSubscribeMenu' does not exist on typ... Remove this comment to see the full error message
            this.props.openSubscribeMenu();
        }
    };
    selectbutton = (data: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'selectedMenu' does not exist on type 'Re... Remove this comment to see the full error message
        this.props.selectedMenu(data);
    };
    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
        const { statusPage } = this.props;
        const {
            enableRSSFeed,
            smsNotification,
            webhookNotification,
            emailNotification,
            selectIndividualMonitors,
        } = statusPage;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'theme' does not exist on type 'Readonly<... Remove this comment to see the full error message
        const theme = this.props.theme;
        return (
            <div className="subscribe-overlay">
                <ClickOutHandler
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'openSubscribeMenu' does not exist on typ... Remove this comment to see the full error message
                    onClickOut={() => this.props.openSubscribeMenu()}
                >
                    <div
                        className={
                            !theme
                                ? 'white box subscribe-box'
                                : 'bs-theme-shadow'
                        }
                        style={{
                            height: 'auto',
                            width: '300px',
                            marginLeft: theme && '-100px',
                        }}
                    >
                        <div className="btn-group">
                            <ShouldRender if={emailNotification}>
                                <button
                                    id="updates-dropdown-email-btn"
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscribed' does not exist on type 'Read... Remove this comment to see the full error message
                                    disabled={this.props.subscribed.requesting}
                                    onClick={() => this.selectbutton(1)}
                                    className={
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'select' does not exist on type 'Readonly... Remove this comment to see the full error message
                                        this.props.select === 1
                                            ? 'icon-container selected'
                                            : 'icon-container'
                                    }
                                >
                                    <div
                                        style={{
                                            display: 'flex',
                                            justifyContent: 'center',
                                            alignItems: 'center',
                                        }}
                                    >
                                        <span className="sub-icon icon-message"></span>
                                    </div>
                                </button>
                            </ShouldRender>
                            <ShouldRender if={smsNotification}>
                                <button
                                    id="updates-dropdown-sms-btn"
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscribed' does not exist on type 'Read... Remove this comment to see the full error message
                                    disabled={this.props.subscribed.requesting}
                                    onClick={() => this.selectbutton(2)}
                                    className={
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'select' does not exist on type 'Readonly... Remove this comment to see the full error message
                                        this.props.select === 2
                                            ? 'icon-container selected'
                                            : 'icon-container'
                                    }
                                >
                                    <div
                                        style={{
                                            display: 'flex',
                                            justifyContent: 'center',
                                            alignItems: 'center',
                                        }}
                                    >
                                        <span className="sub-icon icon-call"></span>
                                    </div>
                                </button>
                            </ShouldRender>
                            <ShouldRender if={webhookNotification}>
                                <button
                                    id="updates-dropdown-webhook-btn"
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscribed' does not exist on type 'Read... Remove this comment to see the full error message
                                    disabled={this.props.subscribed.requesting}
                                    onClick={() => this.selectbutton(3)}
                                    className={
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'select' does not exist on type 'Readonly... Remove this comment to see the full error message
                                        this.props.select === 3
                                            ? 'icon-container selected'
                                            : 'icon-container'
                                    }
                                >
                                    <div
                                        style={{
                                            display: 'flex',
                                            justifyContent: 'center',
                                            alignItems: 'center',
                                        }}
                                    >
                                        <span className="sub-icon icon-webhook"></span>
                                    </div>
                                </button>
                            </ShouldRender>
                            <ShouldRender if={enableRSSFeed}>
                                <button
                                    id="updates-dropdown-atom-btn"
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscribed' does not exist on type 'Read... Remove this comment to see the full error message
                                    disabled={this.props.subscribed.requesting}
                                    onClick={() => this.selectbutton(4)}
                                    className={
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'select' does not exist on type 'Readonly... Remove this comment to see the full error message
                                        this.props.select === 4
                                            ? 'icon-container selected'
                                            : 'icon-container'
                                    }
                                >
                                    <div
                                        style={{
                                            display: 'flex',
                                            justifyContent: 'center',
                                            alignItems: 'center',
                                        }}
                                    >
                                        <span className="sub-icon icon-rss"></span>
                                    </div>
                                </button>
                            </ShouldRender>
                            <button
                                id="updates-dropdown-close-btn"
                                onClick={() => this.subscribebutton()}
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscribed' does not exist on type 'Read... Remove this comment to see the full error message
                                disabled={this.props.subscribed.requesting}
                                className="icon-container"
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
                        >
                            <ShouldRender
                                if={
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'openSelectedBox' does not exist on type ... Remove this comment to see the full error message
                                    !this.props.openSelectedBox &&
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'select' does not exist on type 'Readonly... Remove this comment to see the full error message
                                    this.props.select === 1 &&
                                    emailNotification
                                }
                            >
                                <Message
                                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ handleCloseButtonClick: any; theme: any; }... Remove this comment to see the full error message
                                    handleCloseButtonClick={
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleCloseButtonClick' does not exist o... Remove this comment to see the full error message
                                        this.props.handleCloseButtonClick
                                    }
                                    theme={theme}
                                />
                            </ShouldRender>
                            <ShouldRender
                                if={
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'openSelectedBox' does not exist on type ... Remove this comment to see the full error message
                                    !this.props.openSelectedBox &&
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'select' does not exist on type 'Readonly... Remove this comment to see the full error message
                                    this.props.select === 2 &&
                                    smsNotification
                                }
                            >
                                <Call
                                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ handleCloseButtonClick: any; theme: any; }... Remove this comment to see the full error message
                                    handleCloseButtonClick={
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleCloseButtonClick' does not exist o... Remove this comment to see the full error message
                                        this.props.handleCloseButtonClick
                                    }
                                    theme={theme}
                                />
                            </ShouldRender>
                            <ShouldRender
                                if={
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'openSelectedBox' does not exist on type ... Remove this comment to see the full error message
                                    !this.props.openSelectedBox &&
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'select' does not exist on type 'Readonly... Remove this comment to see the full error message
                                    this.props.select === 3 &&
                                    webhookNotification
                                }
                            >
                                <Webhook
                                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ handleCloseButtonClick: any; theme: any; }... Remove this comment to see the full error message
                                    handleCloseButtonClick={
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleCloseButtonClick' does not exist o... Remove this comment to see the full error message
                                        this.props.handleCloseButtonClick
                                    }
                                    theme={theme}
                                />
                            </ShouldRender>
                            <ShouldRender
                                if={
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'openSelectedBox' does not exist on type ... Remove this comment to see the full error message
                                    !this.props.openSelectedBox &&
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'select' does not exist on type 'Readonly... Remove this comment to see the full error message
                                    this.props.select === 4 &&
                                    enableRSSFeed
                                }
                            >
                                <div className="directions">
                                    Get the{' '}
                                    <a
                                        href={`${API_URL}/status-page/${statusPage._id}/rss`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        style={{
                                            color: theme && '#00bce7',
                                            fontSize: theme && '12px',
                                            fontWeight: theme && '500',
                                        }}
                                    >
                                        RSS feed
                                    </a>
                                </div>
                            </ShouldRender>
                            <ShouldRender
                                if={
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'openSelectedBox' does not exist on type ... Remove this comment to see the full error message
                                    this.props.openSelectedBox &&
                                    selectIndividualMonitors
                                }
                            >
                                <Monitors
                                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ handleCloseButtonClick: any; theme: any; }... Remove this comment to see the full error message
                                    handleCloseButtonClick={
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleCloseButtonClick' does not exist o... Remove this comment to see the full error message
                                        this.props.handleCloseButtonClick
                                    }
                                    theme={theme}
                                />
                            </ShouldRender>
                        </div>
                    </div>
                </ClickOutHandler>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
SubscribeBox.displayName = 'SubscribeBox';

const mapStateToProps = (state: $TSFixMe) => ({
    select: state.subscribe.selectedMenu,
    subscribed: state.subscribe.subscribed,
    openSelectedBox: state.subscribe.openSelectedBox,
    statusPage: state.status.statusPage
});

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators({ openSubscribeMenu, selectedMenu }, dispatch);

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
SubscribeBox.propTypes = {
    openSubscribeMenu: PropTypes.func,
    selectedMenu: PropTypes.func,
    openSelectedBox: PropTypes.bool,
    select: PropTypes.number,
    subscribed: PropTypes.object,
    requesting: PropTypes.bool,
    statusPage: PropTypes.object,
    theme: PropTypes.bool,
    handleCloseButtonClick: PropTypes.func,
};

export default connect(mapStateToProps, mapDispatchToProps)(SubscribeBox);
