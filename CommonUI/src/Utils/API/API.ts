import User from '../User';
import Headers from 'Common/Types/API/Headers';
import API from 'Common/Utils/API';
import APIException from 'Common/Types/Exception/ApiException';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import Cookies from 'universal-cookie';
import Protocol from 'Common/Types/API/Protocol';
import Hostname from 'Common/Types/API/Hostname';
import Route from 'Common/Types/API/Route';
import URL from 'Common/Types/API/URL';
import Navigation from '../Navigation';
import Dictionary from 'Common/Types/Dictionary';
import PermissionUtil from '../Permission';
import JSONFunctions from 'Common/Types/JSONFunctions';
import {
    UserGlobalAccessPermission,
    UserTenantAccessPermission,
} from 'Common/Types/Permission';
import LocalStorage from '../LocalStorage';
import Exception from 'Common/Types/Exception/Exception';

class BaseAPI extends API {
    public constructor(protocol: Protocol, hostname: Hostname, route?: Route) {
        super(protocol, hostname, route);
    }

    public static fromURL(url: URL): BaseAPI {
        return new BaseAPI(url.protocol, url.hostname, url.route);
    }

    protected static override async onResponseSuccessHeaders(
        headers: Dictionary<string>
    ): Promise<Dictionary<string>> {
        if (headers && headers['global-permissions']) {
            PermissionUtil.setGlobalPermissions(
                JSONFunctions.deserialize(
                    JSONFunctions.parse(headers['global-permissions'])
                ) as UserGlobalAccessPermission
            );
        }

        if (headers && headers['global-permissions-hash']) {
            LocalStorage.setItem(
                'global-permissions-hash',
                headers['global-permissions-hash']
            );
        }

        if (headers && headers['project-permissions']) {
            PermissionUtil.setProjectPermissions(
                JSONFunctions.deserialize(
                    JSONFunctions.parse(headers['project-permissions'])
                ) as UserTenantAccessPermission
            );
        }

        if (headers && headers['project-permissions-hash']) {
            LocalStorage.setItem(
                'project-permissions-hash',
                headers['project-permissions-hash']
            );
        }

        return Promise.resolve(headers);
    }

    protected static override getHeaders(): Headers {
        let defaultHeaders: Headers = this.getDefaultHeaders();

        const headers: Headers = {};
        if (User.isLoggedIn()) {
            headers['Authorization'] = 'Basic ' + User.getAccessToken();
        }

        const globalPermissionsHash: string = LocalStorage.getItem(
            'global-permissions-hash'
        ) as string;
        if (globalPermissionsHash) {
            headers['global-permissions-hash'] = globalPermissionsHash;
        }

        const projectPermissionsHash: string = LocalStorage.getItem(
            'project-permissions-hash'
        ) as string;

        if (projectPermissionsHash) {
            headers['project-permissions-hash'] = projectPermissionsHash;
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
            Navigation.navigate(new Route('/accounts/login'));
        }

        return error;
    }

    public static getFriendlyMessage(
        err: HTTPErrorResponse | Exception | unknown
    ): string {
        if (err instanceof HTTPErrorResponse) {
            if (err.statusCode === 502) {
                return 'Error connecting to server. Please try again in few minutes.';
            }

            if (err.statusCode === 504) {
                return 'Error connecting to server. Please try again in few minutes.';
            }

            return err.message;
        }
        return 'Server Error. Please try again';
    }
}

export default BaseAPI;
