import axios from 'axios';
import { API_URL, User } from './config';

const headers = {
    'Access-Control-Allow-Origin': '*',
    Accept: 'application/json',
    'Content-Type': 'application/json;charset=UTF-8',
};

export function postApi(url: $TSFixMe, data: $TSFixMe) {
    if (User.isLoggedIn()) {
        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        headers['Authorization'] = 'Basic ' + User.getAccessToken();
    }

    const promise = new Promise((resolve, reject) => {
        axios({
            method: 'POST',
            url: `${API_URL}/${url}`,
            headers,
            data,
        })
            .then(function(response) {
                resolve(response);
            })
            .catch(function(error) {
                reject(error);
            });
    });
    return promise;
}

export function getApi(url: $TSFixMe) {
    if (User.isLoggedIn()) {
        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        headers['Authorization'] = 'Basic ' + User.getAccessToken();
    }

    const promise = new Promise((resolve, reject) => {
        axios({
            method: 'GET',
            url: `${API_URL}/${url}`,
            headers,
        })
            .then(function(response) {
                resolve(response);
            })
            .catch(function(error) {
                reject(error);
            });
    });
    return promise;
}

export function putApi(url: $TSFixMe, data: $TSFixMe) {
    if (User.isLoggedIn()) {
        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        headers['Authorization'] = 'Basic ' + User.getAccessToken();
    }

    const promise = new Promise((resolve, reject) => {
        axios({
            method: 'PUT',
            url: `${API_URL}/${url}`,
            headers,
            data,
        })
            .then(function(response) {
                resolve(response);
            })
            .catch(function(error) {
                reject(error);
            });
    });
    return promise;
}
