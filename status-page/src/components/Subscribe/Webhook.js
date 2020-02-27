import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { userData, validationError } from '../../actions/subscribe';
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
        if (this.state.endpoint && this.state.endpoint.length) {
            if (this.state.email && this.state.email.length) {
                const validemail = this.validation(this.state.email);
                if (validemail) {
                    const values = this.state;
                    values.method = 'webhook';
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
        event.preventDefault();
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
    render() {
        return (
            <div>
                <div className="directions">
                    Get webhook notifications when an incident is{' '}
                    <strong>created</strong>.
                </div>
                <form id="subscribe-form-webhook" onSubmit={this.handleSubmit}>
                    <input
                        type="text"
                        name="endpoint"
                        onChange={this.handleChange}
                        id="endpoint-webhooks"
                        placeholder="http://www.yourdomain.com/endpoint/here"
                        className="input-full"
                    />
                    <p className="small" style={{ margin: '-5px 0px 5px 4px' }}>
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
                    <input
                        type="submit"
                        value="Subscribe"
                        className="subscribe-btn-full"
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
});

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            userData,
            validationError,
        },
        dispatch
    );

Webhook.propTypes = {
    userData: PropTypes.func,
    validationError: PropTypes.func,
    subscribed: PropTypes.object,
    error: PropTypes.string,
};

export default connect(mapStateToProps, mapDispatchToProps)(Webhook);
