import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { ButtonSpinner } from '../components/basic/Loader';
import { verifyBackupCode } from '../actions/login';
import { bindActionCreators } from 'redux';
import { RenderField } from '../components/basic/RenderField';
import { Link } from 'react-router-dom';
import { identify, setUserId, logEvent } from '../analytics';
import { IS_DEV } from '../config';

const errorStyle = { color: '#c23d4b' };

export class VerifyBackupCode extends Component {
    constructor(props) {
        super(props);
        this.props = props;
    }

    componentDidMount() {
        document.body.id = 'login';
        document.body.style.overflow = 'auto';
    }

    submitForm = values => {
        this.props.verifyBackupCode(values).then(user => {
            if (user && user.data && user.data.id) {
                if (!IS_DEV) {
                    identify(user.data.id);
                    setUserId(user.data.id);
                    logEvent('Log in user', { id: user.data.id });
                }
            }
        });
    };

    render() {
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
                        <a href="/">Fyipe</a>
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
                <div id="footer_spacer" />
                <div id="bottom">
                    <ul>
                        <li>
                            <Link to="/login">Sign In</Link>
                        </li>
                        <li>
                            <a href="http://fyipe.com/legal/privacy">
                                Privacy Policy
                            </a>
                        </li>
                        <li>
                            <a href="http://fyipe.com/support">Support</a>
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

function validate(values) {
    const errors = {};
    if (!values.code) {
        errors.code = 'Please provide a backup code.';
    }
    return errors;
}

const verifyBackupCodeForm = reduxForm({
    form: 'verifyBackupCode',
    validate,
})(VerifyBackupCode);

const mapStateToProps = state => {
    return { login: state.login };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators({ verifyBackupCode }, dispatch);

VerifyBackupCode.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    verifyBackupCode: PropTypes.func,
    login: PropTypes.object,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(verifyBackupCodeForm);
