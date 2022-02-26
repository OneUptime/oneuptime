import React, { Component } from 'react';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { ButtonSpinner } from '../components/basic/Loader';
import { verifyBackupCode } from '../actions/login';
import { bindActionCreators } from 'redux';
import { RenderField } from '../components/basic/RenderField';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { Link } from 'react-router-dom';
import { ACCOUNTS_URL } from '../config';

const errorStyle = { color: '#c23d4b' };

export class VerifyBackupCode extends Component {
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
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'verifyBackupCode' does not exist on type... Remove this comment to see the full error message
        this.props.verifyBackupCode({ ...values, email });
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'login' does not exist on type 'Readonly<... Remove this comment to see the full error message
        if (!this.props.login.user.email)
            // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'Location'... Remove this comment to see the full error message
            window.location = ACCOUNTS_URL + '/login';
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'login' does not exist on type 'Readonly<... Remove this comment to see the full error message
        const { backupCode } = this.props.login;
        let header;

        if (backupCode.error) {
            header = <span style={errorStyle}>{backupCode.error}</span>;
        } else {
            header = <span>Backup Code.</span>;
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
                                    Enter your backup code below to login.
                                </p>
                                <div>
                                    <p className="text">
                                        <span>
                                            <label htmlFor="code">
                                                Backup Code
                                            </label>
                                            <Field
                                                component={RenderField}
                                                type="text"
                                                name="code"
                                                id="code"
                                                placeholder="Backup Code"
                                            />
                                        </span>
                                    </p>
                                    <p className="submit">
                                        <button
                                            type="submit"
                                            className="button blue medium"
                                            disabled={backupCode.requesting}
                                        >
                                            {!backupCode.requesting && (
                                                <span>Verify Code</span>
                                            )}
                                            {backupCode.requesting && (
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
                        Have a google app authenticator?{' '}
                        <Link to="/accounts/user-auth/token">
                            Enter Auth Token
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
VerifyBackupCode.displayName = 'VerifyBackupCode';

function validate(values: $TSFixMe) {
    const errors = {};
    if (!values.code) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type '{}'.
        errors.code = 'Please provide a backup code.';
    }
    return errors;
}

const verifyBackupCodeForm = reduxForm({
    form: 'verifyBackupCode',
    validate,
})(VerifyBackupCode);

const mapStateToProps = (state: $TSFixMe) => {
    return { login: state.login };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators({ verifyBackupCode }, dispatch);

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
VerifyBackupCode.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    verifyBackupCode: PropTypes.func,
    login: PropTypes.object,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(verifyBackupCodeForm);
