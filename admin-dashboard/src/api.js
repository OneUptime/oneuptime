import axios from 'axios';
import {
    API_URL
} from './config';
import {
    User
} from './config';
import { history } from './store';
var baseURL = API_URL;

var Q = require('q');

var headers = {
    'Access-Control-Allow-Origin': '*',
    'Accept': 'application/json',
    'Content-Type': 'application/json;charset=UTF-8'
};



export function postApi(url, data) {
    if (User.isLoggedIn())
        headers['Authorization'] = 'Basic ' + User.getAccessToken()
    var deffered = Q.defer();

    axios({
        method: 'POST',
        url: `${baseURL}/${url}`,
        headers,
        data
    })
        .then(function (response) {
            deffered.resolve(response);
        })
        .catch(function (error) {
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
}

export function getApi(url) {
    if (User.isLoggedIn())
        headers['Authorization'] = 'Basic ' + User.getAccessToken()
    var deffered = Q.defer();
    axios({
        method: 'GET',
        url: `${baseURL}/${url}`,
        headers
    })
        .then(function (response) {
            deffered.resolve(response);
        })
        .catch(function (error) {
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
}


export function putApi(url, data) {
    if (User.isLoggedIn())
        headers['Authorization'] = 'Basic ' + User.getAccessToken()
    var deffered = Q.defer();
    axios({
        method: 'PUT',
        url: `${baseURL}/${url}`,
        headers,
        data
    })
        .then(function (response) {
            deffered.resolve(response);
        })
        .catch(function (error) {
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
}

export function deleteApi(url, data) {
    if (User.isLoggedIn())
        headers['Authorization'] = 'Basic ' + User.getAccessToken()
    var deffered = Q.defer();
    axios({
        method: 'DELETE',
        url: `${baseURL}/${url}`,
        headers,
        data
    })
        .then(function (response) {
            deffered.resolve(response);
        })
        .catch(function (error) {
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
}
