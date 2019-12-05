import React, { Component } from 'react';
import PropTypes from 'prop-types'
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { Validate } from '../config';
import { FlatLoader } from '../components/basic/Loader';
import { resendToken } from '../actions/resendToken';
import { bindActionCreators } from 'redux';
import { RenderField } from '../components/basic/RenderField';
import { Link } from 'react-router-dom';
import queryString from 'query-string';
import { removeQuery } from '../store';

const errorStyle = {
	color: '#c23d4b'
}
export class ResendTokenForm extends Component {
	state = {
		serverResponse: ''
  }
  
  submitForm = (values) => {
    this.props.resendToken(values);
  }
  
  componentDidMount() {
    document.body.id = 'login';
    document.body.style.overflow = 'auto';
    var query = queryString.parse(this.props.location.search).status;
		if(query === 'Lc5orxwR5nKxTANs8jfNsCvGD8Us9ltq'){
      this.setState({
        serverResponse: 'Verification link expired.'
      });
    }
    else if(query === 'eG5aFRDeZXgOkjEfdhOYbFb2lA3Z0OJm'){
      this.setState({
        serverResponse: 'Invalid Verification link.'
      });
    }
    removeQuery();
  }
  render() {
    const { serverResponse } = this.state;
    const { success } = this.props.resendTokenState;
    const resendTokenError = this.props.resendTokenState.error;
    let header;
    if(success) {
      header = <span>Verification Email Sent</span>
    } else if (resendTokenError) {
      header = <span style={errorStyle}>{resendTokenError}</span>
    } else if (serverResponse) {
      header = <span style={errorStyle}>{serverResponse}</span>
    } else {
      header = <span>Resend verification email.</span>
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
            <form onSubmit={this.props.handleSubmit(this.submitForm)} className="request-reset">
              <div className="request-reset-step" >
                <div className="title">
                  <h2>
                    {header}
                  </h2>
                </div>

                <p className="error-message hidden" />


                {this.props.resendTokenState.success && <p id="resend-verification-success" className="message"> An email is on its way to you with new verification link. Please don&apos;t forget to check spam. </p>}
                {!this.props.resendTokenState.success && <p className="message"> Enter your email address below and we will resend you a verification link to activate your fyipe account.</p>}


                {!this.props.resendTokenState.success && <div> <p className="text">
                  <span>
                    <label htmlFor="email">Your Email</label>
                    <Field
                      component={RenderField}
                      type="email"
                      name="email"
                      id="email"
                      placeholder="Your Email"
                    />
                  </span>
                </p>
                  <p className="submit">
                    <button type="submit" className="button blue medium" disabled={this.props.resendTokenState.requesting}>
                      {!this.props.resendTokenState.requesting && <span>Send Verification Link</span>}
                      {this.props.resendTokenState.requesting && <FlatLoader />}
                    </button>
                  </p> </div>}
              </div>


            </form>
          </div>
        </div>
        <div id="footer_spacer" />
        <div id="bottom">
          <ul>

            <li>
              <Link to="/register">Sign Up</Link>
            </li>
            <li>
              <a href="http://fyipe.com/legal/privacy">Privacy Policy</a>
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
    )
  }
}

ResendTokenForm.displayName = 'ResendTokenForm'

function validate(values) {
  let errors = {};
  if (!Validate.text(values.email)) {
    errors.email = 'Email is required.'
  }
  else if (!Validate.email(values.email)) {
    errors.email = 'Email is invalid.'
  }
  return errors;
}

let resendTokenForm = reduxForm({
  form: 'resendTokenForm',
  validate
})(ResendTokenForm);


const mapDispatchToProps = (dispatch) => {
  return bindActionCreators({
    resendToken
  }, dispatch);
};

function mapStateToProps(state) {
  return {
    resendTokenState: state.resendToken
  };
}

ResendTokenForm.propTypes = {
  handleSubmit: PropTypes.func.isRequired,
  resendTokenState: PropTypes.object.isRequired,
  resendToken: PropTypes.func.isRequired,
  location: PropTypes.object.isRequired
}

export default connect(mapStateToProps, mapDispatchToProps)(resendTokenForm);