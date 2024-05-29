import LocalStorage from '../LocalStorage';
import Navigation from '../Navigation';
import PermissionUtil from '../Permission';
import User from '../User';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import Headers from 'Common/Types/API/Headers';
import Hostname from 'Common/Types/API/Hostname';
import Protocol from 'Common/Types/API/Protocol';
import Route from 'Common/Types/API/Route';
import URL from 'Common/Types/API/URL';
import Dictionary from 'Common/Types/Dictionary';
import APIException from 'Common/Types/Exception/ApiException';
import Exception from 'Common/Types/Exception/Exception';
import JSONFunctions from 'Common/Types/JSONFunctions';
import {
    UserGlobalAccessPermission,
    UserTenantAccessPermission,
} from 'Common/Types/Permission';
import API from 'Common/Utils/API';
import Cookies from 'universal-cookie';

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
                    JSONFunctions.parseJSONObject(headers['global-permissions'])
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
                    JSONFunctions.parseJSONObject(
                        headers['project-permissions']
                    )
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
        // 405 Status - Tenant not found. If Project was deleted.
        // 401 Status - User is not logged in.
        if (
            error instanceof HTTPErrorResponse &&
            (error.statusCode === 401 || error.statusCode === 405)
        ) {
            const loginRoute: Route = this.getLoginRoute();

            const cookies: Cookies = new Cookies();
            cookies.remove('admin-data', { path: '/' });
            cookies.remove('data', { path: '/' });
            User.clear();

            if (Navigation.getQueryStringByName('token')) {
                Navigation.navigate(loginRoute.addRouteParam('sso', 'true'), {
                    forceNavigate: true,
                });
            } else {
                Navigation.navigate(loginRoute, {
                    forceNavigate: true,
                });
            }
        }

        return error;
    }

    protected static getLoginRoute(): Route {
        return new Route('/accounts/login');
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

        return err?.toString() || 'Server Error. Please try again';
    }
}

export default BaseAPI;
