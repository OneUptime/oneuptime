import React, { Component } from 'react';

import { Translate } from 'react-auto-translate';
import PropTypes from 'prop-types';
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

interface MessageProps {
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

class Message extends Component<MessageProps> {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = { email: '' };

        this.handleChange = this.handleChange.bind(this);
        this.handleSubmit = this.handleSubmit.bind(this);
    }

    handleChange = (event: $TSFixMe) => {
        this.setState({ email: event.target.value });
    };
    handleSubmit = (event: $TSFixMe) => {
        event.preventDefault();

        const projectId =

            this.props.statuspage &&

            this.props.statuspage.projectId &&

            this.props.statuspage.projectId._id;

        const statusPageId = this.props.statuspage._id;

        const selectIndividualMonitors = this.props.statuspage
            .selectIndividualMonitors;


        if (this.state.email && this.state.email.length) {

            const validemail = this.validation(this.state.email);
            if (validemail) {
                const values = this.state;

                values.method = 'email';

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

    handleClose = (e: $TSFixMe) => {
        e.preventDefault();

        this.props.userDataReset();

        this.props.openSubscribeMenu();

        this.props.handleCloseButtonClick();
    };
    render() {
        return (
            <div>

                {this.props.subscribed &&

                    this.props.subscribed.success ? null : (
                    <div className="directions">
                        <Translate>
                            {' '}
                            Get email notifications when an incident is
                        </Translate>{' '}
                        <b>
                            <Translate>created</Translate>
                        </b>
                        .
                    </div>
                )}
                <form
                    id="subscribe-form-email"
                    onSubmit={

                        this.props.subscribed && this.props.subscribed.success
                            ? this.handleClose
                            : this.handleSubmit
                    }
                >

                    {this.props.subscribed && this.props.subscribed.success ? (
                        <div
                            style={{
                                textAlign: 'center',
                                margin: '15px 0',
                                color: '#000',
                            }}
                        >
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
                        <input
                            name="email"
                            onChange={this.handleChange}
                            type="text"
                            placeholder="Email Address"
                            className="input-full"
                        />
                    )}
                    <input
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
                        id="subscribe-btn-email"
                    ></input>
                </form>
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
            </div>
        );
    }
}


Message.displayName = 'Message';

const mapStateToProps = (state: $TSFixMe) => ({
    userDetails: state.subscribe.userDetails,
    subscribed: state.subscribe.subscribed,
    statuspage: state.status.statusPage
});

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators(
    {
        userData,
        validationError,
        subscribeUser,
        openSubscribeMenu,
        userDataReset,
    },
    dispatch
);


Message.propTypes = {
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

export default connect(mapStateToProps, mapDispatchToProps)(Message);
