import React, { Component } from 'react';
import PropTypes from 'prop-types'
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { Validate } from '../../config';
import { FlatLoader } from '../basic/Loader.js';
import { changePasswordError, changePasswordSuccess, changePassword, resetChangePassword } from '../../actions/changePassword';
import { bindActionCreators } from 'redux';
import { RenderField } from '../basic/RenderField';
import { Link } from 'react-router-dom'

export class ChangePasswordForm extends Component {

  submitForm =(values)=> {
    values.token = this.props.token || '';
    this.props.changePassword(values);
  }

  render() {
    return (
      <div id="main-body" className="box css">
        <div className="inner">
          <form onSubmit={this.props.handleSubmit(this.submitForm)} className="request-reset">
            <div className="request-reset-step step" >
              <div className="title">
                <h2>
                  <span > {this.props.changePasswordState.error ? <span className="error" >{this.props.changePasswordState.error}</span> : 'Reset Password'} </span>
                </h2>
              </div>

              <p className="error-message hidden" />


              {this.props.changePasswordState.success && <p className="message"> Your password is changed. Please <Link to="/login"> click here to login </Link> </p>}
              {!this.props.changePasswordState.success && <p className="message"> Enter your email address below and we will send you a link to
                                reset your password. </p>}


              {!this.props.changePasswordState.success && <div> <p className="text">
                <span>
                  <label htmlFor="password">  Password </label>
                  <Field
                    component={RenderField}
                    type="password"
                    name="password"
                    id="password"
                    placeholder="Password"
                  />
                </span>
              </p>
                <p className="text">
                  <span>
                    <label htmlFor="confirmPassword">  Confirm Password </label>
                    <Field
                      component={RenderField}
                      type="password"
                      name="confirmPassword"
                      id="confirmPassword"
                      placeholder="Confirm Password"
                    />
                  </span>
                </p>
                <p className="submit">
                  <button type="submit" className="button blue medium" disabled={this.props.changePasswordState.requesting}>
                    {!this.props.changePasswordState.requesting && <span>Change Password</span>}
                    {this.props.changePasswordState.requesting && <FlatLoader />}
                  </button>
                </p> </div>}
            </div>


          </form>
        </div>
      </div>
    )
  }
}

ChangePasswordForm.displayName = 'ChangePasswordForm'

function validate(values) {
  const errors = {};
  if (!Validate.text(values.password)) {
    errors.password = 'Password is required.'
  }
  if (!Validate.text(values.confirmPassword)) {
    errors.confirmPassword = 'Confirm Password is invalid.'
  }
  return errors;
}

const changePasswordForm = reduxForm({
  form: 'changePasswordForm', // a unique identifier for this form
  validate
})(ChangePasswordForm);


const mapDispatchToProps = (dispatch) => {
  return bindActionCreators({
    changePasswordError, changePasswordSuccess, changePassword, resetChangePassword
  }, dispatch);
};

function mapStateToProps(state) {
  return {
    changePasswordState: state.changePassword
  };
}

ChangePasswordForm.propTypes = {
  changePassword: PropTypes.func.isRequired,
  handleSubmit: PropTypes.func.isRequired,
  changePasswordState: PropTypes.object.isRequired,
  token: PropTypes.any
}

export default connect(mapStateToProps, mapDispatchToProps)(changePasswordForm);
