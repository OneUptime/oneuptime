import axios from 'axios';
import {
    API_URL,
    User
} from './config';

const headers = {
    'Access-Control-Allow-Origin': '*',
    'Accept': 'application/json',
    'Content-Type': 'application/json;charset=UTF-8'
};


export function postApi(url, data) {
    if (User.isLoggedIn()) {
        headers['Authorization'] = 'Basic ' + User.getAccessToken();
    }

    var promise = new Promise((resolve, reject) => {
        axios({
            method: 'POST',
            url: `${API_URL}/${url}`,
            headers,
            data
        })
            .then(function (response) {
                resolve(response);
            })
            .catch(function (error) {
                reject(error);
            });
    })
    return promise;
}

export function getApi(url) {
    if (User.isLoggedIn()) {
        headers['Authorization'] = 'Basic ' + User.getAccessToken();
    }

    var promise = new Promise((resolve, reject) => {
        axios({
            method: 'GET',
            url: `${API_URL}/${url}`,
            headers
        })
            .then(function (response) {
                resolve(response);
            })
            .catch(function (error) {
                reject(error);
            });
    })
    return promise;
}