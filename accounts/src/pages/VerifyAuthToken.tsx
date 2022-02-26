import React, { Component } from 'react';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { ButtonSpinner } from '../components/basic/Loader';
import { verifyAuthToken } from '../actions/login';
import { bindActionCreators } from 'redux';
import { RenderField } from '../components/basic/RenderField';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { Link } from 'react-router-dom';

import { ACCOUNTS_URL } from '../config';

const errorStyle = { color: '#c23d4b' };

export class VerifyAuthToken extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'props' because it is a read-only... Remove this comment to see the full error message
        this.props = props;
    }

    componentDidMount() {
        document.body.id = 'login';
        document.body.style.overflow = 'auto';
    }

    submitForm = (values: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'login' does not exist on type 'Readonly<... Remove this comment to see the full error message
        const email = this.props.login.user.email;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'verifyAuthToken' does not exist on type ... Remove this comment to see the full error message
        this.props.verifyAuthToken({ ...values, email });
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'login' does not exist on type 'Readonly<... Remove this comment to see the full error message
        if (!this.props.login.user.email)
            // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'Location'... Remove this comment to see the full error message
            window.location = ACCOUNTS_URL + '/login';
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'login' does not exist on type 'Readonly<... Remove this comment to see the full error message
        const { error } = this.props.login.authToken;
        let header;

        if (error) {
            header = <span style={errorStyle}>{error}</span>;
        } else {
            header = <span>Two Factor Auth token.</span>;
        }

        return (
            <div id="wrap" style={{ paddingTop: 0 }}>
                <div id="header">
                    <h1>
                        <a href="/">OneUptime</a>
                    </h1>
                </div>
                <div id="main-body" className="box css">
                    <div className="inner">
                        <form
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
                            onSubmit={this.props.handleSubmit(this.submitForm)}
                            className="request-reset"
                        >
                            <div className="request-reset-step">
                                <div className="title">
                                    <h2>{header}</h2>
                                </div>

                                <p className="error-message hidden" />
                                <p className="message">
                                    Enter your auth token below to login.
                                </p>
                                <div>
                                    <p className="text">
                                        <span>
                                            <label htmlFor="token">
                                                Verification Token
                                            </label>
                                            <Field
                                                component={RenderField}
                                                type="text"
                                                name="token"
                                                id="token"
                                                placeholder="Token"
                                            />
                                        </span>
                                    </p>
                                    <p className="submit">
                                        <button
                                            type="submit"
                                            className="button blue medium"
                                            disabled={
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'login' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                                this.props.login.authToken
                                                    .requesting
                                            }
                                        >
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'login' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                            {!this.props.login.authToken
                                                .requesting && (
                                                <span>Verify token</span>
                                            )}
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'login' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                            {this.props.login.authToken
                                                .requesting && (
                                                <ButtonSpinner />
                                            )}
                                        </button>
                                    </p>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
                <div className="below-box">
                    <p>
                        Don&#39;t have your app authenticator?{' '}
                        <Link to="/accounts/user-auth/backup">
                            Use Backup code
                        </Link>
                        .
                    </p>
                </div>
                <div id="footer_spacer" />
                <div id="bottom">
                    <ul>
                        <li>
                            <Link to="/accounts/login">Sign In</Link>
                        </li>
                        <li>
                            <a href="http://oneuptime.com/legal/privacy">
                                Privacy Policy
                            </a>
                        </li>
                        <li>
                            <a href="http://oneuptime.com/support">Support</a>
                        </li>
                        <li className="last">
                            <a href="https://hackerbay.io">© HackerBay, Inc.</a>
                        </li>
                    </ul>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
VerifyAuthToken.displayName = 'VerifyAuthToken';

function validate(values: $TSFixMe) {
    const errors = {};
    if (!values.token) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'token' does not exist on type '{}'.
        errors.token = 'Please provide token.';
    }
    return errors;
}

const verifyAuthTokenForm = reduxForm({
    form: 'verifyAuthToken',
    validate,
})(VerifyAuthToken);

const mapStateToProps = (state: $TSFixMe) => {
    return { login: state.login };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators({ verifyAuthToken }, dispatch);

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
VerifyAuthToken.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    verifyAuthToken: PropTypes.func.isRequired,
    login: PropTypes.object,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(verifyAuthTokenForm);
