import axios from 'axios';
import { API_URL, User } from './config';

const headers = {
    'Access-Control-Allow-Origin': '*',
    Accept: 'application/json',
    'Content-Type': 'application/json;charset=UTF-8',
};

export const post = (url: URL, data: $TSFixMe) => {
    if (User.isLoggedIn()) {
        headers['Authorization'] = 'Basic ' + User.getAccessToken();
    }

    const promise = new Promise((resolve, reject) => {
        axios({
            method: 'POST',
            url: `${API_URL}/${url}`,
            headers,
            data,
        })
            .then(response => {
                resolve(response);
            })
            .then(error => {
                reject(error);
            });
    });
    return promise;
};

export const get = (url: URL) => {
    if (User.isLoggedIn()) {
        headers['Authorization'] = 'Basic ' + User.getAccessToken();
    }

    const promise = new Promise((resolve, reject) => {
        axios({
            method: 'GET',
            url: `${API_URL}/${url}`,
            headers,
        })
            .then(response => {
                resolve(response);
            })
            .then(error => {
                reject(error);
            });
    });
    return promise;
};

export const put = (url: URL, data: $TSFixMe) => {
    if (User.isLoggedIn()) {
        headers['Authorization'] = 'Basic ' + User.getAccessToken();
    }

    const promise = new Promise((resolve, reject) => {
        axios({
            method: 'PUT',
            url: `${API_URL}/${url}`,
            headers,
            data,
        })
            .then(response => {
                resolve(response);
            })
            .then(error => {
                reject(error);
            });
    });
    return promise;
};
