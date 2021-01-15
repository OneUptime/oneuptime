import axios from 'axios';
import Cookies from 'universal-cookie';
import {
    API_URL,
    LICENSING_URL,
    ACCOUNTS_URL,
    HELM_CHART_URL,
    API_DOCS_URL,
    DASHBOARD_URL,
    PROBE_URL,
} from './config';
import { User } from './config';
const baseURL = API_URL;
const licensingURL = LICENSING_URL;

const Q = require('q');

const headers = {
    'Access-Control-Allow-Origin': '*',
    Accept: 'application/json',
    'Content-Type': 'application/json;charset=UTF-8',
};

export function postApi(url, data, licensing) {
    if (User.isLoggedIn())
        headers['Authorization'] = 'Basic ' + User.getAccessToken();
    const deffered = Q.defer();

    axios({
        method: 'POST',
        url: `${licensing ? licensingURL : baseURL}/${url}`,
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
                window.location = ACCOUNTS_URL + '/login';
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

export function getApi(url, licensing) {
    if (User.isLoggedIn())
        headers['Authorization'] = 'Basic ' + User.getAccessToken();
    const deffered = Q.defer();
    axios({
        method: 'GET',
        url: `${licensing ? licensingURL : baseURL}/${url}`,
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
                window.location = ACCOUNTS_URL + '/login';
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
                window.location = ACCOUNTS_URL + '/login';
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
                window.location = ACCOUNTS_URL + '/login';
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

export function getApiDocs(url) {
    if (User.isLoggedIn())
        headers['Authorization'] = 'Basic ' + User.getAccessToken();
    const deffered = Q.defer();
    axios({
        method: 'GET',
        url: `${API_DOCS_URL}/${url}`,
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
                window.location = ACCOUNTS_URL + '/login';
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

export function getApiHelm(url) {
    if (User.isLoggedIn())
        headers['Authorization'] = 'Basic ' + User.getAccessToken();
    const deffered = Q.defer();
    axios({
        method: 'GET',
        url: `${HELM_CHART_URL}/${url}`,
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
                window.location = ACCOUNTS_URL + '/login';
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

export function getApiDashboard(url) {
    if (User.isLoggedIn())
        headers['Authorization'] = 'Basic ' + User.getAccessToken();
    const deffered = Q.defer();
    axios({
        method: 'GET',
        url: `${DASHBOARD_URL}/api/${url}`,
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
                window.location = ACCOUNTS_URL + '/login';
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

export function getApiProbe(url) {
    if (User.isLoggedIn())
        headers['Authorization'] = 'Basic ' + User.getAccessToken();
    const deffered = Q.defer();
    axios({
        method: 'GET',
        url: `${PROBE_URL}/${url}`,
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
                window.location = ACCOUNTS_URL + '/login';
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
