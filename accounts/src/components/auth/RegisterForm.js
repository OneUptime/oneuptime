import React, { Component } from 'react'
import { reduxForm } from 'redux-form'
import UserForm from './UserForm';
import CardForm from './CardForm';
import { connect } from 'react-redux';
import { signupError, signupSuccess, signupUser, incrementStep, decrementStep, resetSignup, saveUserState, saveCardState, isUserInvited } from '../../actions/register'
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';

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
              if (window.location.href.indexOf('localhost') <= -1) {
                thisObj.context.mixpanel.identify(user.data.id);
                thisObj.context.mixpanel.people.set({
                  '$first_name': user.data.name,
                  '$created': new Date(),
                  '$email': user.data.email
                });
                thisObj.context.mixpanel.track('user registered', { 'First Time': 'TRUE', 'id': user.data.id });
              }
            }
          })
      } else {
        thisObj.props.incrementStep();
      }
    }, function (error) {
      return error
    });
  }

  cardFormSubmitted = (values) => {
    var thisObj = this;
    this.props.saveCardState(values);
    this.props.signupUser({ ...this.props.register.user, ...values, planId: this.props.planId })
      .then((user) => {
        if (user && user.data && user.data.id) {
          if (window.location.href.indexOf('localhost') <= -1) {
            thisObj.context.mixpanel.identify(user.data.id);
            thisObj.context.mixpanel.people.set({
              '$first_name': user.data.name,
              '$created': new Date(),
              '$email': user.data.email
            });
            thisObj.context.mixpanel.track('user registered', { 'First Time': 'TRUE', 'id': user.data.id });
          }
        }
      })
  }

  render() {

    return (
      <div>
        {this.props.register.step === 1 && <UserForm submitForm={this.userFormSubmitted} error={this.props.register.error} location={this.props.location} />}
        {this.props.register.step === 2 && <CardForm planId={this.props.planId} submitForm={this.cardFormSubmitted} error={this.props.register.error} />}
      </div>
    )
  }

}

RegisterForm.displayName = 'RegisterForm'

let registerForm = reduxForm({
  form: 'RegisterForm'
})(RegisterForm);


const mapDispatchToProps = (dispatch) => {
  return bindActionCreators({
    signupError,
    signupSuccess,
    signupUser,
    incrementStep,
    decrementStep,
    resetSignup,
    saveUserState,
    saveCardState,
    isUserInvited,
  }, dispatch);
};

function mapStateToProps(state) {
  return {
    register: state.register
  };
}

RegisterForm.contextTypes = {
  mixpanel: PropTypes.object.isRequired
};

RegisterForm.propTypes = {
  signupUser: PropTypes.func.isRequired,
  saveCardState: PropTypes.func.isRequired,
  //incrementStep: PropTypes.func.isRequired,
  saveUserState: PropTypes.func.isRequired,
  isUserInvited: PropTypes.func.isRequired,
  register: PropTypes.object.isRequired,
  planId: PropTypes.string.isRequired,
  location: PropTypes.object.isRequired
}

export default connect(mapStateToProps, mapDispatchToProps)(registerForm);
