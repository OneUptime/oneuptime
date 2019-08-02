
import {
	postApi
} from '../api';
import * as types from '../constants/login'
import { User, DASHBOARD_URL, DOMAIN_URL } from '../config.js';
import errors from '../errors'
import { getQueryVar } from '../config'

import Cookies from 'universal-cookie';

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
	if (user.redirect) return window.location = `${user.redirect}?accessToken=${user.tokens.jwtAccessToken}`;
	//save user session details.
	User.setUserId(user.id);
	User.setAccessToken(user.tokens.jwtAccessToken);
	User.setEmail(user.email);
	User.setName(user.name);
	User.setCardRegistered(user.cardRegistered);

	//share localStorage with dashboard app
	const cookies = new Cookies();
	var userData = user;
	cookies.set('data', userData, { path: '/', maxAge: 30, domain: DOMAIN_URL });
	
	window.location = DASHBOARD_URL
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
	const redirect = getQueryVar('redirectTo', initialUrl)
	values.redirect = redirect;
	return function (dispatch) {

		var promise = postApi('user/login', values);
		dispatch(loginRequest(promise));

		promise.then(function (user) {
			dispatch(loginSuccess(user.data));
		}, function (error) {
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
