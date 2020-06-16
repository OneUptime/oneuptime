import React, { Component } from 'react';
import { reduxForm } from 'redux-form';
import UserForm from './UserForm';
import CardForm from './CardForm';
import { connect } from 'react-redux';
import {
    signupUser,
    incrementStep,
    decrementStep,
    saveUserState,
    isUserInvited,
} from '../../actions/register';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import {
    setUserId,
    setUserProperties,
    identify,
    logEvent,
} from '../../analytics';
import { SHOULD_LOG_ANALYTICS, IS_SAAS_SERVICE } from '../../config';

export class RegisterForm extends Component {
    constructor(props) {
        super(props);
        this.props = props;
    }

    componentDidMount() {
        if (SHOULD_LOG_ANALYTICS) {
            logEvent('PAGE VIEW: SIGN UP');
        }
    }

    userFormSubmitted = values => {
        const thisObj = this;
        this.props.saveUserState(values);
        this.props.isUserInvited(values).then(
            function(value) {
                if (value.data) {
                    thisObj.props
                        .signupUser({ ...values, planId: thisObj.props.planId })
                        .then(user => {
                            if (user && user.data && user.data.id) {
                                if (SHOULD_LOG_ANALYTICS) {
                                    setUserId(user.data.id);
                                    identify(user.data.id);
                                    setUserProperties({
                                        Name: user.data.name,
                                        Created: new Date(),
                                        Email: user.data.email,
                                    });
                                    logEvent('EVENT: SIGNED UP');
                                }
                            }
                        });
                } else {
                    if (!IS_SAAS_SERVICE) {
                        thisObj.props.signupUser(values).then(user => {
                            if (user && user.data && user.data.id) {
                                if (SHOULD_LOG_ANALYTICS) {
                                    setUserId(user.data.id);
                                    identify(user.data.id);
                                    setUserProperties({
                                        Name: user.data.name,
                                        Created: new Date(),
                                        Email: user.data.email,
                                    });
                                    logEvent('EVENT: SIGNED UP');
                                }
                            }
                        });
                    } else {
                        thisObj.props.incrementStep();
                        if (SHOULD_LOG_ANALYTICS) {
                            setUserId(values.email);
                            identify(values.email);
                            setUserProperties({
                                Name: values.name,
                                Created: new Date(),
                                Email: values.email,
                                CompanyName: values.companyName,
                                CompanyPhoneNumber: values.companyPhoneNumber,
                            });
                            logEvent('EVENT: SIGN UP STEP 1 COMPLETE');
                        }
                    }
                }
            },
            function(error) {
                return error;
            }
        );
    };

    render() {
        const { step } = this.props.register;
        return (
            <div>
                {step === 1 && (
                    <UserForm
                        submitForm={this.userFormSubmitted}
                        error={this.props.register.error}
                        location={this.props.location}
                    />
                )}
                {step === 2 && (
                    <CardForm
                        planId={this.props.planId}
                        error={this.props.register.error}
                    />
                )}
            </div>
        );
    }
}

RegisterForm.displayName = 'RegisterForm';

const registerForm = reduxForm({
    form: 'RegisterForm',
})(RegisterForm);

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            signupUser,
            incrementStep,
            decrementStep,
            saveUserState,
            isUserInvited,
        },
        dispatch
    );
};

function mapStateToProps(state) {
    return {
        register: state.register,
    };
}
RegisterForm.propTypes = {
    saveUserState: PropTypes.func.isRequired,
    isUserInvited: PropTypes.func.isRequired,
    register: PropTypes.object.isRequired,
    planId: PropTypes.string,
    location: PropTypes.object.isRequired,
};

export default connect(mapStateToProps, mapDispatchToProps)(registerForm);
