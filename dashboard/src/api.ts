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

export function postApi(url: $TSFixMe, data: $TSFixMe) {
    if (User.isLoggedIn())
        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        headers['Authorization'] = 'Basic ' + User.getAccessToken();
    const deffered = Q.defer();

    axios({
        method: 'POST',
        url: `${baseURL}/${url}`,
        headers,
        data,
    })
        .then(function(response) {
            deffered.resolve(response);
        })
        .catch(function(error) {
            if (error && error.response && error.response.status === 401) {
                const cookies = new Cookies();
                cookies.remove('admin-data', { path: '/' });
                cookies.remove('data', { path: '/' });
                User.clear();

                // store original destination url
                const redirectTo = window.location.href;

                // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'Location'... Remove this comment to see the full error message
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

export function getApi(url: $TSFixMe) {
    if (User.isLoggedIn())
        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        headers['Authorization'] = 'Basic ' + User.getAccessToken();
    const deffered = Q.defer();
    axios({
        method: 'GET',
        url: `${baseURL}/${url}`,
        headers,
    })
        .then(function(response) {
            deffered.resolve(response);
        })
        .catch(function(error) {
            if (error && error.response && error.response.status === 401) {
                const cookies = new Cookies();
                cookies.remove('admin-data', { path: '/' });
                cookies.remove('data', { path: '/' });
                User.clear();

                // store original destination url
                const redirectTo = window.location.href;

                // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'Location'... Remove this comment to see the full error message
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

export function putApi(url: $TSFixMe, data: $TSFixMe) {
    if (User.isLoggedIn())
        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        headers['Authorization'] = 'Basic ' + User.getAccessToken();
    const deffered = Q.defer();
    axios({
        method: 'PUT',
        url: `${baseURL}/${url}`,
        headers,
        data,
    })
        .then(function(response) {
            deffered.resolve(response);
        })
        .catch(function(error) {
            if (error && error.response && error.response.status === 401) {
                const cookies = new Cookies();
                cookies.remove('admin-data', { path: '/' });
                cookies.remove('data', { path: '/' });
                User.clear();

                // store original destination url
                const redirectTo = window.location.href;

                // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'Location'... Remove this comment to see the full error message
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

export function deleteApi(url: $TSFixMe, data: $TSFixMe) {
    if (User.isLoggedIn())
        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        headers['Authorization'] = 'Basic ' + User.getAccessToken();
    const deffered = Q.defer();
    axios({
        method: 'DELETE',
        url: `${baseURL}/${url}`,
        headers,
        data,
    })
        .then(function(response) {
            deffered.resolve(response);
        })
        .catch(function(error) {
            if (error && error.response && error.response.status === 401) {
                const cookies = new Cookies();
                cookies.remove('admin-data', { path: '/' });
                cookies.remove('data', { path: '/' });
                User.clear();

                // store original destination url
                const redirectTo = window.location.href;

                // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'Location'... Remove this comment to see the full error message
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
