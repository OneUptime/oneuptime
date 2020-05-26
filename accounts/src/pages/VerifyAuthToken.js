import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { ButtonSpinner } from '../components/basic/Loader';
import { verifyAuthToken } from '../actions/login';
import { bindActionCreators } from 'redux';
import { RenderField } from '../components/basic/RenderField';
import { Link } from 'react-router-dom';
import { identify, setUserId, logEvent } from '../analytics';
import { SHOULD_LOG_ANALYTICS } from '../config';

const errorStyle = { color: '#c23d4b' };

export class VerifyAuthToken extends Component {
    constructor(props) {
        super(props);
        this.props = props;
    }

    componentDidMount() {
        document.body.id = 'login';
        document.body.style.overflow = 'auto';
        if (SHOULD_LOG_ANALYTICS) {
            logEvent('PAGE VIEW: VERIFY TOKEN');
        }
    }

    submitForm = values => {
        this.props.verifyAuthToken(values).then(user => {
            if (user && user.data && user.data.id) {
                if (SHOULD_LOG_ANALYTICS) {
                    identify(user.data.id);
                    setUserId(user.data.id);
                    logEvent('EVENT: USER LOG IN');
                }
            }
        });
    };

    render() {
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
                                                this.props.login.authToken
                                                    .requesting
                                            }
                                        >
                                            {!this.props.login.authToken
                                                .requesting && (
                                                <span>Verify token</span>
                                            )}
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

VerifyAuthToken.displayName = 'VerifyAuthToken';

function validate(values) {
    const errors = {};
    if (!values.token) {
        errors.token = 'Please provide token.';
    }
    return errors;
}

const verifyAuthTokenForm = reduxForm({
    form: 'verifyAuthToken',
    validate,
})(VerifyAuthToken);

const mapStateToProps = state => {
    return { login: state.login };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators({ verifyAuthToken }, dispatch);

VerifyAuthToken.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    verifyAuthToken: PropTypes.func.isRequired,
    login: PropTypes.object,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(verifyAuthTokenForm);
