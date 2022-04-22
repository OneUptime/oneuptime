import React, { Component } from 'react';

import { reduxForm } from 'redux-form';
import UserForm from './UserForm';
import CardForm from './CardForm';
import { connect } from 'react-redux';

import { Fade } from 'react-awesome-reveal';

import queryString from 'query-string';
import {
    signupUser,
    incrementStep,
    decrementStep,
    saveUserState,
    isUserInvited,
} from '../../actions/register';
import { bindActionCreators, Dispatch } from 'redux';
import PropTypes from 'prop-types';

import { IS_SAAS_SERVICE } from '../../config';

interface RegisterFormProps {
    saveUserState: Function;
    isUserInvited: Function;
    register: object;
    planId?: string;
    location: object;
}

export class RegisterForm extends Component<RegisterFormProps>{
    public static displayName = '';
    public static propTypes = {};
    constructor(props: $TSFixMe) {
        super(props);
    }

    userFormSubmitted = (values: $TSFixMe) => {
        const thisObj: $TSFixMe = this;

        const token: $TSFixMe = queryString.parse(thisObj.props.location.search).token;
        values.token = token;

        this.props.saveUserState(values);

        this.props.isUserInvited(values).then(
            function (value: $TSFixMe) {
                if (value.data) {

                    thisObj.props.signupUser({
                        ...values,

                        planId: thisObj.props.planId,
                        token,
                    });
                } else {
                    if (!IS_SAAS_SERVICE) {

                        thisObj.props.signupUser(values);
                    } else {

                        thisObj.props.incrementStep();
                    }
                }
            },
            function (error: $TSFixMe) {
                return error;
            }
        );
    };

    override render() {

        const { step }: $TSFixMe = this.props.register;
        return (
            <Fade>
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
            </Fade>
        );
    }
}


RegisterForm.displayName = 'RegisterForm';

const registerForm: $TSFixMe = reduxForm({
    form: 'RegisterForm',
})(RegisterForm);

const mapDispatchToProps: Function = (dispatch: Dispatch) => {
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

function mapStateToProps(state: RootState) {
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
