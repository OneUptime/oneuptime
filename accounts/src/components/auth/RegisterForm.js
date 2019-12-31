import React, { Component } from 'react'
import { reduxForm } from 'redux-form'
import UserForm from './UserForm';
import CardForm from './CardForm';
import { connect } from 'react-redux';
import { signupUser, incrementStep, decrementStep, saveUserState, isUserInvited } from '../../actions/register'
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import { setUserId, setUserProperties, identify, logEvent } from '../../analytics';
import { IS_DEV } from '../../config';

export class RegisterForm extends Component {

  constructor(props) {
    super(props);
    this.props = props;
  }

  userFormSubmitted = (values) => {
    let thisObj = this;
    this.props.saveUserState(values);
    this.props.isUserInvited(values).then(function (value) {
      if (value.data) {
        thisObj.props.signupUser({...values, planId: thisObj.props.planId })
          .then((user) => {
            if (user && user.data && user.data.id) {
              if (!IS_DEV) {
                setUserId(user.data.id);
                identify(user.data.id);
                setUserProperties({
                  'Name': user.data.name,
                  'Created': new Date(),
                  'Email': user.data.email
                });
                logEvent('Sign up completed for invited user', { 'First Time': 'TRUE', 'id': user.data.id });
              }
            }
          })
      } else {
        thisObj.props.incrementStep();
        if (!IS_DEV) {
          setUserId(values.email);
          identify(values.email);
          setUserProperties({
            'Name': values.name,
            'Created': new Date(),
            'Email': values.email,
            'CompanyName': values.companyName,
            'CompanyPhoneNumber': values.companyPhoneNumber
          });
          logEvent('Sign up step one completed', { 'First Time': 'TRUE' });
        }
      }
    }, function (error) {
      return error
    });
  }

  render() {
    const { step } = this.props.register;
    return (
      <div>
        { step === 1 && <UserForm submitForm={this.userFormSubmitted} error={this.props.register.error} location={this.props.location} />}
        { step === 2 && <CardForm planId={this.props.planId} error={this.props.register.error} />}
      </div>
    )
  }

}

RegisterForm.displayName = 'RegisterForm';

let registerForm = reduxForm({
  form: 'RegisterForm'
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
    register: state.register
  };
}
RegisterForm.propTypes = {
  saveUserState: PropTypes.func.isRequired,
  isUserInvited: PropTypes.func.isRequired,
  register: PropTypes.object.isRequired,
  planId: PropTypes.string.isRequired,
  location: PropTypes.object.isRequired
}

export default connect(mapStateToProps, mapDispatchToProps)(registerForm);
