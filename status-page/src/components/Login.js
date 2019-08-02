import React from 'react';
import PropTypes from 'prop-types'
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import LoginForm from './LoginForm';
import { loginUser, loginError } from '../actions/login';
import { Redirect } from 'react-router-dom';

class Login extends React.Component {

	constructor(props) {
        super(props);

        this.submitHandler = this.submitHandler.bind(this);
    }

	componentDidMount() {
		document.body.style.overflow = 'auto';
	}

	submitHandler = (values) => {
		this.props.loginUser(values).then(() => {});
	}

	render() {

		return (
			<div id="login">
			<div id="wrap">
				<div id="header">
					<h1>
						<a aria-hidden={false} href="/">Fyipe</a>
					</h1>
				</div>

				{/* LOGIN BOX */}
				<LoginForm onSubmit={this.submitHandler} {...this.props} />

				{!this.props.loginRequired && <Redirect to="/" />}
				<div id="footer_spacer" />
				<div id="bottom">
					<ul>
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
			</div>
		);
	}
}

let mapStateToProps = state => ({
		loginRequired : state.login.loginRequired,
});

const mapDispatchToProps = dispatch => bindActionCreators(
	{ loginUser, loginError }, dispatch);

Login.propTypes = {
	loginUser: PropTypes.func.isRequired,
	loginRequired:PropTypes.bool,
}

Login.displayName = 'Login'

export default connect(mapStateToProps, mapDispatchToProps)(Login);
