import axios from 'axios';
import { API_URL, User } from './config';

const headers = {
    'Access-Control-Allow-Origin': '*',
    Accept: 'application/json',
    'Content-Type': 'application/json;charset=UTF-8',
};

export const postApi = (url: $TSFixMe, data: $TSFixMe) => {
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

export const getApi = (url: $TSFixMe) => {
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

export const putApi = (url: $TSFixMe, data: $TSFixMe) => {
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
