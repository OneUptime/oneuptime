import React, { Component } from 'react';
import PropTypes from 'prop-types';

import { Translate } from 'react-auto-translate';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import {
    userData,
    validationError,
    subscribeUser,
    openSubscribeMenu,
    userDataReset,
} from '../../actions/subscribe';
import ShouldRender from '../ShouldRender';

interface WebhookProps {
    userData?: Function;
    validationError?: Function;
    subscribed?: object;
    error?: string;
    statuspage?: object;
    subscribeUser?: Function;
    openSubscribeMenu?: Function;
    userDataReset?: Function;
    theme?: boolean;
    handleCloseButtonClick?: Function;
}

class Webhook extends Component<ComponentProps> {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = {};

        this.handleChange = this.handleChange.bind(this);
        this.handleSubmit = this.handleSubmit.bind(this);
    }
    handleChange = (event: $TSFixMe) => {
        const value: $TSFixMe = event.target.value;
        const name: $TSFixMe = event.target.name;
        this.setState({ [name]: value });
    };

    handleSubmit = (event: $TSFixMe) => {
        event.preventDefault();

        const projectId: $TSFixMe =

            this.props.statuspage &&

            this.props.statuspage.projectId &&

            this.props.statuspage.projectId._id;

        const statusPageId: $TSFixMe = this.props.statuspage._id;

        const selectIndividualMonitors: $TSFixMe = this.props.statuspage
            .selectIndividualMonitors;


        if (this.state.endpoint && this.state.endpoint.length) {

            if (this.state.email && this.state.email.length) {

                const validemail: $TSFixMe = this.validation(this.state.email);
                if (validemail) {
                    const values: $TSFixMe = this.state;

                    values.method = 'webhook';

                    if (!selectIndividualMonitors) {
                        const monitors: $TSFixMe = [];

                        return this.props.subscribeUser(
                            values,
                            monitors,
                            projectId,
                            statusPageId
                        );
                    }


                    this.props.userData(values);
                } else {

                    this.props.validationError(
                        'Please enter a valid email address.'
                    );
                }
            } else {

                this.props.validationError('Please enter your email address.');
            }
        } else {

            this.props.validationError('Please enter your endpoint.');
        }
    };

    validation = (email: $TSFixMe) => {
        if (
            email.match(
                /^([a-zA-Z0-9_.-])+@(([a-zA-Z0-9-])+\.)+([a-zA-Z0-9]{2,4})+$/
            )
        ) {
            return true;
        } else {
            return false;
        }
    };
    handleClose = (event: $TSFixMe) => {
        event.preventDefault();

        this.props.userDataReset();

        this.props.openSubscribeMenu();

        this.props.handleCloseButtonClick();
    };
    override render() {
        return (
            <div>

                {
                    this.props.subscribed &&

                        this.props.subscribed.success ? null : (
                        <div className="directions">
                            <Translate>
                                Get webhook notifications when an incident is
                            </Translate>{' '}
                            <b>
                                <Translate>created</Translate>
                            </b>
                            .
                        </div>
                    )
                }
                < form
                    id="subscribe-form-webhook"
                    onSubmit={

                        this.props.subscribed && this.props.subscribed.success
                            ? this.handleClose
                            : this.handleSubmit
                    }
                >

                    {
                        this.props.subscribed && this.props.subscribed.success ? (
                            <div style={{ textAlign: 'center', margin: '15px 0' }}>
                                <span
                                    className="subscriber-success"
                                    id="monitor-subscribe-success-message"
                                >
                                    <Translate>
                                        You have subscribed to this status page
                                        successfully
                                    </Translate>
                                </span>
                            </div>
                        ) : (
                            <>
                                <input
                                    type="text"
                                    name="endpoint"
                                    onChange={this.handleChange}
                                    id="endpoint-webhooks"
                                    placeholder="http://www.yourdomain.com/endpoint/here"
                                    className="input-full"
                                />
                                <p
                                    className="small"
                                    style={{ margin: '-5px 0px 5px 4px' }}
                                >
                                    <Translate>
                                        The URL we should send the updates to.
                                    </Translate>
                                </p>
                                <input
                                    type="text"
                                    name="email"
                                    onChange={this.handleChange}
                                    id="email-webhooks"
                                    placeholder="Email Address"
                                    className="input-full"
                                />
                                <p
                                    className="small"
                                    style={{ margin: '-5px 0px 10px 4px' }}
                                >
                                    <Translate>
                                        We will send you email if your endpoint
                                        fails.
                                    </Translate>
                                </p>
                            </>
                        )
                    }
                    < input
                        type="submit"
                        value={

                            this.props.subscribed &&

                                this.props.subscribed.success
                                ? 'Close'
                                : 'Subscribe'
                        }
                        className={

                            this.props.theme
                                ? 'subscribe-btn-full bs-theme-btn'
                                : 'subscribe-btn-full'
                        }
                        id="subscribe-btn-webhook"
                    />
                </form >
                <ShouldRender

                    if={this.props.subscribed && this.props.subscribed.error}
                >
                    <div className="validation-error">
                        <span className="validation-error-icon"></span>
                        <span className="error-text">
                            <Translate>

                                {this.props.subscribed &&

                                    this.props.subscribed.error}
                            </Translate>
                        </span>
                    </div>
                </ShouldRender>
            </div >
        );
    }
}


Webhook.displayName = 'Webhook';

const mapStateToProps: Function = (state: RootState) => ({
    userDetails: state.subscribe.userDetails,
    subscribed: state.subscribe.subscribed,
    statuspage: state.status.statusPage
});

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators(
    {
        userData,
        validationError,
        subscribeUser,
        openSubscribeMenu,
        userDataReset,
    },
    dispatch
);


Webhook.propTypes = {
    userData: PropTypes.func,
    validationError: PropTypes.func,
    subscribed: PropTypes.object,
    error: PropTypes.string,
    statuspage: PropTypes.object,
    subscribeUser: PropTypes.func,
    openSubscribeMenu: PropTypes.func,
    userDataReset: PropTypes.func,
    theme: PropTypes.bool,
    handleCloseButtonClick: PropTypes.func,
};

export default connect(mapStateToProps, mapDispatchToProps)(Webhook);
