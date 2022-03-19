import axios from 'axios';
import Cookies from 'universal-cookie';
import { API_URL, ACCOUNTS_URL } from './config';
import { User } from './config';
const baseURL = API_URL;

import Q from 'q';

const headers = {
    'Access-Control-Allow-Origin': '*',
    Accept: 'application/json',
    'Content-Type': 'application/json;charset=UTF-8',
};

export const postApi = (url: $TSFixMe, data: $TSFixMe) => {
    if (User.isLoggedIn())
        headers['Authorization'] = 'Basic ' + User.getAccessToken();
    const deffered = Q.defer();

    axios({
        method: 'POST',
        url: `${baseURL}/${url}`,
        headers,
        data,
    })
        .then(response => {
            deffered.resolve(response);
        })
        .then(error => {
            if (error && error.response && error.response.status === 401) {
                const cookies = new Cookies();
                cookies.remove('admin-data', { path: '/' });
                cookies.remove('data', { path: '/' });
                User.clear();

                // store original destination url
                const redirectTo = window.location.href;

                window.location =
                    ACCOUNTS_URL + `/login?redirectTo=${redirectTo}`;
            }
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            deffered.reject(error);
        });
    return deffered.promise;
}

export const getApi = (url: $TSFixMe) => {
    if (User.isLoggedIn())
        headers['Authorization'] = 'Basic ' + User.getAccessToken();
    const deffered = Q.defer();
    axios({
        method: 'GET',
        url: `${baseURL}/${url}`,
        headers,
    })
        .then(response => {
            deffered.resolve(response);
        })
        .then(error => {
            if (error && error.response && error.response.status === 401) {
                const cookies = new Cookies();
                cookies.remove('admin-data', { path: '/' });
                cookies.remove('data', { path: '/' });
                User.clear();

                // store original destination url
                const redirectTo = window.location.href;

                window.location =
                    ACCOUNTS_URL + `/login?redirectTo=${redirectTo}`;
            }
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            deffered.reject(error);
        });

    return deffered.promise;
}

export const putApi = (url: $TSFixMe, data: $TSFixMe) => {
    if (User.isLoggedIn())
        headers['Authorization'] = 'Basic ' + User.getAccessToken();
    const deffered = Q.defer();
    axios({
        method: 'PUT',
        url: `${baseURL}/${url}`,
        headers,
        data,
    })
        .then(response => {
            deffered.resolve(response);
        })
        .then(error => {
            if (error && error.response && error.response.status === 401) {
                const cookies = new Cookies();
                cookies.remove('admin-data', { path: '/' });
                cookies.remove('data', { path: '/' });
                User.clear();

                // store original destination url
                const redirectTo = window.location.href;

                window.location =
                    ACCOUNTS_URL + `/login?redirectTo=${redirectTo}`;
            }
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            deffered.reject(error);
        });

    return deffered.promise;
}

export const deleteApi = (url: $TSFixMe, data: $TSFixMe) => {
    if (User.isLoggedIn())
        headers['Authorization'] = 'Basic ' + User.getAccessToken();
    const deffered = Q.defer();
    axios({
        method: 'DELETE',
        url: `${baseURL}/${url}`,
        headers,
        data,
    })
        .then(response => {
            deffered.resolve(response);
        })
        .then(error => {
            if (error && error.response && error.response.status === 401) {
                const cookies = new Cookies();
                cookies.remove('admin-data', { path: '/' });
                cookies.remove('data', { path: '/' });
                User.clear();

                // store original destination url
                const redirectTo = window.location.href;

                window.location =
                    ACCOUNTS_URL + `/login?redirectTo=${redirectTo}`;
            }
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            deffered.reject(error);
        });

    return deffered.promise;
}
