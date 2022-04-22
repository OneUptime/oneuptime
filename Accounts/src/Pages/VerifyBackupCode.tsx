import React, { Component } from 'react';
import PropTypes from 'prop-types';

import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { ButtonSpinner } from '../components/basic/Loader';
import { verifyBackupCode } from '../actions/login';
import { bindActionCreators, Dispatch } from 'redux';
import { RenderField } from '../components/basic/RenderField';

import { Link } from 'react-router-dom';
import { ACCOUNTS_URL } from '../config';

const errorStyle: $TSFixMe = { color: '#c23d4b' };

interface ComponentProps {
    handleSubmit: Function;
    verifyBackupCode?: Function;
    login?: object;
}

export class VerifyBackupCode extends Component<ComponentProps>{
    public static displayName = '';
    public static propTypes = {};
    constructor(props: ComponentProps) {
        super(props);
    }

    override componentDidMount() {
        document.body.id = 'login';
        document.body.style.overflow = 'auto';
    }

    submitForm = (values: $TSFixMe) => {

        const email: $TSFixMe = this.props.login.user.email;

        this.props.verifyBackupCode({ ...values, email });
    };

    override render() {

        if (!this.props.login.user.email)

            window.location.href = ACCOUNTS_URL + '/login';

        const { backupCode }: $TSFixMe = this.props.login;
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


VerifyBackupCode.displayName = 'VerifyBackupCode';

function validate(values: $TSFixMe) {
    const errors: $TSFixMe = {};
    if (!values.code) {
        errors.code = 'Please provide a backup code.';
    }
    return errors;
}

const verifyBackupCodeForm: $TSFixMe = reduxForm({
    form: 'verifyBackupCode',
    validate,
})(VerifyBackupCode);

const mapStateToProps: Function = (state: RootState) => {
    return { login: state.login };
};

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators({ verifyBackupCode }, dispatch);


VerifyBackupCode.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    verifyBackupCode: PropTypes.func,
    login: PropTypes.object,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(verifyBackupCodeForm);
