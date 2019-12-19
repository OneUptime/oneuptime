
import {
	postApi
} from '../api';
import * as types from '../constants/login'
import { User, DASHBOARD_URL, DOMAIN_URL, ADMIN_DASHBOARD_URL } from '../config.js';
import errors from '../errors'
import { getQueryVar } from '../config';
import { resendToken } from './resendToken';
import Cookies from 'universal-cookie';
import store from '../store';

// There are three possible states for our login
// process and we need actions for each of them

export function loginRequest(promise) {
	return {
		type: types.LOGIN_REQUEST,
		payload: promise
	};
}

export function loginError(error) {
	return {
		type: types.LOGIN_FAILED,
		payload: error
	};
}

export function loginSuccess(user) {
	//save user session details.
	var state = store.getState();
	var { statusPageLogin, statusPageURL } = state.login;
	if (statusPageLogin) {
		var newURL = `${statusPageURL}?userId=${user.id}&accessToken=${user.tokens.jwtAccessToken}`;
		return window.location = newURL;
	}
	User.setUserId(user.id);
	User.setAccessToken(user.tokens.jwtAccessToken);
	User.setEmail(user.email);
	User.setName(user.name);
	User.setCardRegistered(user.cardRegistered);

	//share localStorage with dashboard app
	var cookies = new Cookies();
	var userData = user;
	cookies.set('data', userData, { path: '/', maxAge: 30, domain: DOMAIN_URL });

	if(user.role === 'master-admin'){
		//share localStorage with admin dashboard app
		cookies = new Cookies();
		userData = user;
		cookies.set('admin-data', userData, { path: '/', maxAge: 30, domain: DOMAIN_URL });
	}

	if (user.redirect){
		return window.location = `${user.redirect}?accessToken=${user.tokens.jwtAccessToken}`;
	}else if(user.role === 'master-admin'){
		window.location = ADMIN_DASHBOARD_URL
	}else{
		window.location = DASHBOARD_URL
	}
	
	return {
		type: types.LOGIN_SUCCESS,
		payload: user
	};
}

export const resetLogin = () => {
	return {
		type: types.RESET_LOGIN,
	};
};

// Calls the API to register a user.
export function loginUser(values) {
	const initialUrl =  User.initialUrl();
	const redirect = getQueryVar('redirectTo', initialUrl);
	if(redirect) values.redirect = redirect;
	return function (dispatch) {

		var promise = postApi('user/login', values);
		dispatch(loginRequest(promise));

		promise.then(function (user) {
			dispatch(loginSuccess(user.data));
		}, function (error) {
			if(error.message === 'Verify your email first.'){
				dispatch(resendToken(values));
			}
			if (error && error.response && error.response.data)
				error = error.response.data;
			if (error && error.data) {
				error = error.data;
			}
			if(error && error.message){
				error = error.message;
			}
			else{
				error = 'Network Error';
			}
			dispatch(loginError(errors(error)));
		});
		return promise;
	};
}

export function saveStatusPage(data) {
	return {
		type: types.SAVE_STATUS_PAGE,
		payload: data
	};
}