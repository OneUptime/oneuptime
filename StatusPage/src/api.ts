import axios from 'axios';
import { API_URL, User } from './config';

const headers: $TSFixMe = {
    'Access-Control-Allow-Origin': '*',
    Accept: 'application/json',
    'Content-Type': 'application/json;charset=UTF-8',
};

export const post: Function = (url: URL, data: $TSFixMe): void => {
    if (User.isLoggedIn()) {
        headers['Authorization'] = 'Basic ' + User.getAccessToken();
    }

    const promise: Promise = new Promise(
        (resolve: Function, reject: Function): $TSFixMe => {
            axios({
                method: 'POST',
                url: `${API_URL}/${url}`,
                headers,
                data,
            })
                .then((response: $TSFixME) => {
                    resolve(response);
                })
                .then((error: Error) => {
                    reject(error);
                });
        }
    );
    return promise;
};

export const get: Function = (url: URL): void => {
    if (User.isLoggedIn()) {
        headers['Authorization'] = 'Basic ' + User.getAccessToken();
    }

    const promise: Promise = new Promise(
        (resolve: Function, reject: Function): $TSFixMe => {
            axios({
                method: 'GET',
                url: `${API_URL}/${url}`,
                headers,
            })
                .then((response: $TSFixME) => {
                    resolve(response);
                })
                .then((error: Error) => {
                    reject(error);
                });
        }
    );
    return promise;
};

export const put: Function = (url: URL, data: $TSFixMe): void => {
    if (User.isLoggedIn()) {
        headers['Authorization'] = 'Basic ' + User.getAccessToken();
    }

    const promise: Promise = new Promise(
        (resolve: Function, reject: Function): $TSFixMe => {
            axios({
                method: 'PUT',
                url: `${API_URL}/${url}`,
                headers,
                data,
            })
                .then((response: $TSFixME) => {
                    resolve(response);
                })
                .then((error: Error) => {
                    reject(error);
                });
        }
    );
    return promise;
};
