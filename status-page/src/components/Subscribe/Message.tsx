import React, { Component } from 'react';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { Translate } from 'react-auto-translate';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import {
    userData,
    validationError,
    subscribeUser,
    openSubscribeMenu,
    userDataReset,
} from '../../actions/subscribe';
import ShouldRender from '../ShouldRender';

class Message extends Component {
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statuspage' does not exist on type 'Read... Remove this comment to see the full error message
            this.props.statuspage &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statuspage' does not exist on type 'Read... Remove this comment to see the full error message
            this.props.statuspage.projectId &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statuspage' does not exist on type 'Read... Remove this comment to see the full error message
            this.props.statuspage.projectId._id;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statuspage' does not exist on type 'Read... Remove this comment to see the full error message
        const statusPageId = this.props.statuspage._id;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statuspage' does not exist on type 'Read... Remove this comment to see the full error message
        const selectIndividualMonitors = this.props.statuspage
            .selectIndividualMonitors;

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'email' does not exist on type 'Readonly<... Remove this comment to see the full error message
        if (this.state.email && this.state.email.length) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'email' does not exist on type 'Readonly<... Remove this comment to see the full error message
            const validemail = this.validation(this.state.email);
            if (validemail) {
                const values = this.state;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'method' does not exist on type 'Readonly... Remove this comment to see the full error message
                values.method = 'email';

                if (!selectIndividualMonitors) {
                    const monitors: $TSFixMe = [];
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscribeUser' does not exist on type 'R... Remove this comment to see the full error message
                    return this.props.subscribeUser(
                        values,
                        monitors,
                        projectId,
                        statusPageId
                    );
                }

                // @ts-expect-error ts-migrate(2339) FIXME: Property 'userData' does not exist on type 'Readon... Remove this comment to see the full error message
                this.props.userData(values);
            } else {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'validationError' does not exist on type ... Remove this comment to see the full error message
                this.props.validationError(
                    'Please enter a valid email address.'
                );
            }
        } else {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'validationError' does not exist on type ... Remove this comment to see the full error message
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
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'userDataReset' does not exist on type 'R... Remove this comment to see the full error message
        this.props.userDataReset();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'openSubscribeMenu' does not exist on typ... Remove this comment to see the full error message
        this.props.openSubscribeMenu();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleCloseButtonClick' does not exist o... Remove this comment to see the full error message
        this.props.handleCloseButtonClick();
    };
    render() {
        return (
            <div>
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscribed' does not exist on type 'Read... Remove this comment to see the full error message
                {this.props.subscribed &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscribed' does not exist on type 'Read... Remove this comment to see the full error message
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
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscribed' does not exist on type 'Read... Remove this comment to see the full error message
                        this.props.subscribed && this.props.subscribed.success
                            ? this.handleClose
                            : this.handleSubmit
                    }
                >
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscribed' does not exist on type 'Read... Remove this comment to see the full error message
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
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscribed' does not exist on type 'Read... Remove this comment to see the full error message
                            this.props.subscribed &&
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscribed' does not exist on type 'Read... Remove this comment to see the full error message
                            this.props.subscribed.success
                                ? 'Close'
                                : 'Subscribe'
                        }
                        className={
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'theme' does not exist on type 'Readonly<... Remove this comment to see the full error message
                            this.props.theme
                                ? 'subscribe-btn-full bs-theme-btn'
                                : 'subscribe-btn-full'
                        }
                        id="subscribe-btn-email"
                    ></input>
                </form>
                <ShouldRender
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscribed' does not exist on type 'Read... Remove this comment to see the full error message
                    if={this.props.subscribed && this.props.subscribed.error}
                >
                    <div className="validation-error">
                        <span className="validation-error-icon"></span>
                        <span className="error-text">
                            <Translate>
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscribed' does not exist on type 'Read... Remove this comment to see the full error message
                                {this.props.subscribed &&
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscribed' does not exist on type 'Read... Remove this comment to see the full error message
                                    this.props.subscribed.error}
                            </Translate>
                        </span>
                    </div>
                </ShouldRender>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
Message.displayName = 'Message';

const mapStateToProps = (state: $TSFixMe) => ({
    userDetails: state.subscribe.userDetails,
    subscribed: state.subscribe.subscribed,
    statuspage: state.status.statusPage
});

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        userData,
        validationError,
        subscribeUser,
        openSubscribeMenu,
        userDataReset,
    },
    dispatch
);

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
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
