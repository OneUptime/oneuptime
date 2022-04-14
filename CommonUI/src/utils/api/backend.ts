import { BACKEND_HOSTNAME, API_PROTOCOL } from '../config';
import User from '../user';
import history from '../history';
import Headers from 'Common/Types/api/headers';
import API from 'Common/utils/api';
import APIException from 'Common/Types/Exception/apiException';
import HTTPErrorResponse from 'Common/Types/api/errorResponse';
import Cookies from 'universal-cookie';

class BackendAPI extends API {
    constructor() {
        super(API_PROTOCOL, BACKEND_HOSTNAME);
    }

    protected static override getHeaders(): Headers {
        let defaultHeaders: Headers = this.getDefaultHeaders();

        const headers: Headers: $TSFixMe = {};
        if (User.isLoggedIn()) {
            headers['Authorization'] = 'Basic ' + User.getAccessToken();
        }

        defaultHeaders = {
            ...defaultHeaders,
            ...headers,
        };

        return defaultHeaders;
    }

    protected static override handleError(
        error: HTTPErrorResponse | APIException
    ): HTTPErrorResponse | APIException {
        if (error instanceof HTTPErrorResponse && error.statusCode === 401) {
            const cookies = new Cookies();
            cookies.remove('admin-data', { path: '/' });
            cookies.remove('data', { path: '/' });
            User.clear();
            history.push('/login');
        }

        return error;
    }
}

export default new BackendAPI();
