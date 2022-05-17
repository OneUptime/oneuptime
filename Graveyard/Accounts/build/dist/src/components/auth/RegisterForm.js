import React, { Component } from 'react';
import { reduxForm } from 'redux-form';
import UserForm from './UserForm';
import CardForm from './CardForm';
import { connect } from 'react-redux';
import { Fade } from 'react-awesome-reveal';
import queryString from 'query-string';
import { signupUser, incrementStep, decrementStep, saveUserState, isUserInvited, } from '../../actions/register';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import { IS_SAAS_SERVICE } from '../../config';
export class RegisterForm extends Component {
    constructor(props) {
        super(props);
        this.userFormSubmitted = (values) => {
            const thisObj = this;
            const token = queryString.parse(thisObj.props.location.search).token;
            values.token = token;
            this.props.saveUserState(values);
            this.props.isUserInvited(values).then(function (value) {
                if (value.data) {
                    thisObj.props.signupUser(Object.assign(Object.assign({}, values), { planId: thisObj.props.planId, token }));
                }
                else {
                    if (!IS_SAAS_SERVICE) {
                        thisObj.props.signupUser(values);
                    }
                    else {
                        thisObj.props.incrementStep();
                    }
                }
            }, function (error) {
                return error;
            });
        };
    }
    render() {
        const { step } = this.props.register;
        return (React.createElement(Fade, null,
            React.createElement("div", null,
                step === 1 && (React.createElement(UserForm, { submitForm: this.userFormSubmitted, error: this.props.register.error, location: this.props.location })),
                step === 2 && (React.createElement(CardForm, { planId: this.props.planId, error: this.props.register.error })))));
    }
}
RegisterForm.displayName = '';
RegisterForm.propTypes = {};
RegisterForm.displayName = 'RegisterForm';
const registerForm = reduxForm({
    form: 'RegisterForm',
})(RegisterForm);
const mapDispatchToProps = (dispatch) => {
    return bindActionCreators({
        signupUser,
        incrementStep,
        decrementStep,
        saveUserState,
        isUserInvited,
    }, dispatch);
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
