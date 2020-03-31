import * as types from '../constants/logout';
import Cookies from 'universal-cookie';
import { ACCOUNTS_URL } from '../config';
// Three possible states for our logout process as well.
// Since we are using JWTs, we just need to remove the token
// from localStorage. These actions are more useful if we
// were calling the API to log the user out

export function requestLogout() {
    return {
        type: types.LOGOUT_REQUEST,
        isFetching: true,
        isAuthenticated: true,
    };
}

export function receiveLogout() {
    return {
        type: types.LOGOUT_SUCCESS,
        isFetching: false,
        isAuthenticated: false,
    };
}

// Logs the user out
export function logoutUser() {
    return dispatch => {
        dispatch(requestLogout());
        const cookies = new Cookies();
        cookies.remove('admin-data', { path: '/' });
        cookies.remove('data', { path: '/' });
        localStorage.clear();
        dispatch(receiveLogout());
        window.location = ACCOUNTS_URL;
    };
}
