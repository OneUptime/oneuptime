import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import Call from './Call';
import Message from './Message';
import Webhook from './Webhook';
import Monitors from './Monitors';
import { openSubscribeMenu, selectedMenu } from '../../actions/subscribe';
import ShouldRender from '../ShouldRender';

import ClickOutHandler from 'react-onclickout';
import { API_URL } from '../../config';

interface SubscribeBoxProps {
    openSubscribeMenu?: Function;
    selectedMenu?: Function;
    openSelectedBox?: boolean;
    select?: number;
    subscribed?: object;
    requesting?: boolean;
    statusPage?: object;
    theme?: boolean;
    handleCloseButtonClick?: Function;
}

class SubscribeBox extends Component<ComponentProps> {
    constructor(props: $TSFixMe) {
        super(props);
        this.subscribebutton = this.subscribebutton.bind(this);
        this.selectbutton = this.selectbutton.bind(this);
    }
    subscribebutton = () => {

        if (this.props.theme) {

            this.props.handleCloseButtonClick();
        } else {

            this.props.openSubscribeMenu();
        }
    };
    selectbutton = (data: $TSFixMe) => {

        this.props.selectedMenu(data);
    };
    override render() {

        const { statusPage } = this.props;
        const {
            enableRSSFeed,
            smsNotification,
            webhookNotification,
            emailNotification,
            selectIndividualMonitors,
        } = statusPage;

        const theme = this.props.theme;
        return (
            <div className="subscribe-overlay">
                <ClickOutHandler

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

                                    disabled={this.props.subscribed.requesting}
                                    onClick={() => this.selectbutton(1)}
                                    className={

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

                                    disabled={this.props.subscribed.requesting}
                                    onClick={() => this.selectbutton(2)}
                                    className={

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

                                    disabled={this.props.subscribed.requesting}
                                    onClick={() => this.selectbutton(3)}
                                    className={

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

                                    disabled={this.props.subscribed.requesting}
                                    onClick={() => this.selectbutton(4)}
                                    className={

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

                                    !this.props.openSelectedBox &&

                                    this.props.select === 1 &&
                                    emailNotification
                                }
                            >
                                <Message

                                    handleCloseButtonClick={

                                        this.props.handleCloseButtonClick
                                    }
                                    theme={theme}
                                />
                            </ShouldRender>
                            <ShouldRender
                                if={

                                    !this.props.openSelectedBox &&

                                    this.props.select === 2 &&
                                    smsNotification
                                }
                            >
                                <Call

                                    handleCloseButtonClick={

                                        this.props.handleCloseButtonClick
                                    }
                                    theme={theme}
                                />
                            </ShouldRender>
                            <ShouldRender
                                if={

                                    !this.props.openSelectedBox &&

                                    this.props.select === 3 &&
                                    webhookNotification
                                }
                            >
                                <Webhook

                                    handleCloseButtonClick={

                                        this.props.handleCloseButtonClick
                                    }
                                    theme={theme}
                                />
                            </ShouldRender>
                            <ShouldRender
                                if={

                                    !this.props.openSelectedBox &&

                                    this.props.select === 4 &&
                                    enableRSSFeed
                                }
                            >
                                <div className="directions">
                                    Get the{' '}
                                    <a
                                        href={`${API_URL}/StatusPage/${statusPage._id}/rss`}
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

                                    this.props.openSelectedBox &&
                                    selectIndividualMonitors
                                }
                            >
                                <Monitors

                                    handleCloseButtonClick={

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


SubscribeBox.displayName = 'SubscribeBox';

const mapStateToProps = (state: RootState) => ({
    select: state.subscribe.selectedMenu,
    subscribed: state.subscribe.subscribed,
    openSelectedBox: state.subscribe.openSelectedBox,
    statusPage: state.status.statusPage
});

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators({ openSubscribeMenu, selectedMenu }, dispatch);


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
