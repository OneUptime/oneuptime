import React, { Component } from 'react';
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

class Webhook extends Component {
    constructor(props) {
        super(props);
        this.state = {};

        this.handleChange = this.handleChange.bind(this);
        this.handleSubmit = this.handleSubmit.bind(this);
    }
    handleChange = event => {
        const value = event.target.value;
        const name = event.target.name;
        this.setState({ [name]: value });
    };

    handleSubmit = event => {
        event.preventDefault();

        const projectId =
            this.props.statuspage &&
            this.props.statuspage.projectId &&
            this.props.statuspage.projectId._id;
        const statusPageId = this.props.statuspage._id;
        const selectIndividualMonitors = this.props.statuspage
            .selectIndividualMonitors;

        if (this.state.endpoint && this.state.endpoint.length) {
            if (this.state.email && this.state.email.length) {
                const validemail = this.validation(this.state.email);
                if (validemail) {
                    const values = this.state;
                    values.method = 'webhook';

                    if (!selectIndividualMonitors) {
                        const monitors = [];
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

    validation = email => {
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
    handleClose = () => {
        this.props.userDataReset();
        this.props.openSubscribeMenu();
    };
    render() {
        return (
            <div>
                {this.props.subscribed &&
                this.props.subscribed.success ? null : (
                    <div className="directions">
                        Get webhook notifications when an incident is{' '}
                        <b>created</b>.
                    </div>
                )}
                <form
                    id="subscribe-form-webhook"
                    onSubmit={
                        this.props.subscribed && this.props.subscribed.success
                            ? this.handleClose
                            : this.handleSubmit
                    }
                >
                    {this.props.subscribed && this.props.subscribed.success ? (
                        <div style={{ textAlign: 'center', margin: '15px 0' }}>
                            <span id="monitor-subscribe-success-message">
                                You have subscribed to this status page
                                successfully
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
                                The URL we should send the updates to.
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
                                We will send you email if your endpoint fails.
                            </p>
                        </>
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
                        id="subscribe-btn-webhook"
                    />
                </form>
                <ShouldRender
                    if={this.props.subscribed && this.props.subscribed.error}
                >
                    <div className="validation-error">
                        <span className="validation-error-icon"></span>
                        <span className="error-text">
                            {this.props.subscribed &&
                                this.props.subscribed.error}
                        </span>
                    </div>
                </ShouldRender>
            </div>
        );
    }
}

Webhook.displayName = 'Webhook';

const mapStateToProps = state => ({
    userDetails: state.subscribe.userDetails,
    subscribed: state.subscribe.subscribed,
    statuspage: state.status.statusPage,
});

const mapDispatchToProps = dispatch =>
    bindActionCreators(
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
};

export default connect(mapStateToProps, mapDispatchToProps)(Webhook);
