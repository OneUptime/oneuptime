import React from 'react';
import PropTypes from 'prop-types'
import { Link } from 'react-router-dom';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import LoginForm from '../components/auth/LoginForm';
import { loginUser, loginError } from '../actions/login';
import MessageBox from '../components/MessageBox';

class LoginPage extends React.Component {

	constructor(props) {
		super(props);
		this.props = props;
	}

	componentDidMount() {
		document.body.id = 'login';
		document.body.style.overflow = 'auto';
	}

	submitHandler = (values) => {
		let thisObj = this;
		this.props.loginUser(values).then((user) => {
			if (user && user.data && user.data.id) {
				if(window.location.href.indexOf('localhost') <= -1){
					thisObj.context.mixpanel.identify(user.data.id);
				}
			}
		})
	}

	render() {

		return (
			<div id="wrap">
				<div id="header">
					<h1>
						<a aria-hidden={false} href="/">Fyipe</a>
					</h1>
				</div>

				{/* LOGIN BOX */}
				{!this.props.login.success && this.props.login.error && this.props.login.error === 'Verify your email first.' ? <MessageBox title={'Your email is not verified.'} message={'An email is on its way to you with new verification link. Please don&apos;t forget to check spam. '} /> : <LoginForm onSubmit={this.submitHandler} {...this.props} />}

				{/* FOOTER */}
				<div className="below-box">
					<p>
						Don&#39;t have an account? <Link to="/register">Sign up</Link>.
					</p>
				</div>

				{/* END FOOTER */}
				<div id="footer_spacer" />
				<div id="bottom">
					<ul>
						<li>
							<Link to="/forgot-password">Forgot Password</Link>
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
		);
	}
}

const mapStateToProps = state => {
	return {
		login: state.login
	};
};

const mapDispatchToProps = dispatch => bindActionCreators(
	{ loginUser, loginError }, dispatch);

LoginPage.propTypes = {
	loginUser: PropTypes.func.isRequired,
	login: PropTypes.object,
	success: PropTypes.bool,
	error: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.bool,
	]),
	location: PropTypes.object,
}

LoginPage.displayName = 'LoginPage'

export default connect(mapStateToProps, mapDispatchToProps)(LoginPage);
