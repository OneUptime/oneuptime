import axios from 'axios';
import { API_URL } from './config';
import { User } from './config';
import { history } from './store';
const baseURL = API_URL;

import Q from 'q';

const headers = {
    'Access-Control-Allow-Origin': '*',
    Accept: 'application/json',
    'Content-Type': 'application/json;charset=UTF-8',
};

export const postApi = (url: string, data: $TSFixMe) => {
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
                User.clear();
                history.push('/login');
            }
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            deffered.reject(error);
        });
    return deffered.promise;
};

export const getApi = (url: string) => {
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
                User.clear();
                history.push('/login');
            }
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            deffered.reject(error);
        });

    return deffered.promise;
};

export const putApi = (url: string, data: $TSFixMe) => {
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
                User.clear();
                history.push('/login');
            }
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            deffered.reject(error);
        });

    return deffered.promise;
};

export const deleteApi = (url: string, data: $TSFixMe) => {
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
                User.clear();
                history.push('/login');
            }
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            deffered.reject(error);
        });

    return deffered.promise;
};
