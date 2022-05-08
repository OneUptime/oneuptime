import { BACKEND_HOSTNAME, API_PROTOCOL } from '../../Config';
import User from '../User';
import history from '../History';
import Headers from 'Common/Types/API/Headers';
import API from 'Common/Utils/API';
import APIException from 'Common/Types/Exception/ApiException';
import HTTPErrorResponse from 'Common/Types/API/ErrorResponse';
import Cookies from 'universal-cookie';

class BackendAPI extends API {
    public constructor() {
        super(API_PROTOCOL, BACKEND_HOSTNAME);
    }

    protected static override getHeaders(): Headers {
        let defaultHeaders: Headers = this.getDefaultHeaders();

        const headers: Headers = {};
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
            const cookies: Cookies = new Cookies();
            cookies.remove('admin-data', { path: '/' });
            cookies.remove('data', { path: '/' });
            User.clear();
            history.push('/login');
        }

        return error;
    }
}

export default new BackendAPI();
