import * as types from '../constants/security';
import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ErrorPayload from 'CommonUI/src/payload-types/error';
// Add Container Security
export const addContainerSecurityRequest: Function = (): void => {
    return {
        type: types.ADD_CONTAINER_SECURITY_REQUEST,
    };
};

export const addContainerSecuritySuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.ADD_CONTAINER_SECURITY_SUCCESS,
        payload,
    };
};

export const addContainerSecurityFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.ADD_CONTAINER_SECURITY_FAILURE,
        payload: error,
    };
};

export const addContainerSecurity: $TSFixMe = ({
    projectId,
    componentId,
    data,
}: $TSFixMe) => {
    return async (dispatch: Dispatch) => {
        dispatch(addContainerSecurityRequest());

        try {
            const response: $TSFixMe = await BackendAPI.post(
                `security/${projectId}/${componentId}/container`,
                data
            );

            dispatch(addContainerSecuritySuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(addContainerSecurityFailure(errorMsg));
        }
    };
};

// Get a Container Security
export const getContainerSecurityRequest: Function = (): void => {
    return {
        type: types.GET_CONTAINER_SECURITY_REQUEST,
    };
};

export const getContainerSecuritySuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.GET_CONTAINER_SECURITY_SUCCESS,
        payload,
    };
};

export const getContainerSecurityFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.GET_CONTAINER_SECURITY_FAILURE,
        payload: error,
    };
};

export const getContainerSecurity: $TSFixMe = ({
    projectId,
    componentId,
    containerSecurityId,
}: $TSFixMe) => {
    return async (dispatch: Dispatch) => {
        dispatch(getContainerSecurityRequest());

        try {
            const response: $TSFixMe = await BackendAPI.get(
                `security/${projectId}/${componentId}/container/${containerSecurityId}`
            );

            dispatch(getContainerSecuritySuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(getContainerSecurityFailure(errorMsg));
        }
    };
};

export const getContainerSecurityBySlug: $TSFixMe = ({
    projectId,
    componentId,
    containerSecuritySlug,
}: $TSFixMe) => {
    return async (dispatch: Dispatch) => {
        dispatch(getContainerSecurityRequest());

        try {
            const response: $TSFixMe = await BackendAPI.get(
                `security/${projectId}/${componentId}/containerSecuritySlug/${containerSecuritySlug}`
            );

            dispatch(getContainerSecuritySuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(getContainerSecurityFailure(errorMsg));
        }
    };
};

// Get all Container Security
export const getContainerSecuritiesRequest: Function = (
    fetchingPage: $TSFixMe
): void => {
    return {
        type: types.GET_CONTAINER_SECURITIES_REQUEST,
        payload: fetchingPage,
    };
};

export const getContainerSecuritiesSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.GET_CONTAINER_SECURITIES_SUCCESS,
        payload,
    };
};

export const getContainerSecuritiesFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.GET_CONTAINER_SECURITIES_FAILURE,
        payload: error,
    };
};

export const getContainerSecurities: $TSFixMe = ({
    projectId,
    componentId,
    skip = 0,
    limit = 0,
    fetchingPage = false,
}: $TSFixMe) => {
    return async (dispatch: Dispatch) => {
        dispatch(getContainerSecuritiesRequest(fetchingPage));

        try {
            const response: $TSFixMe = await BackendAPI.get(
                `security/${projectId}/${componentId}/container?skip=${skip}&limit=${limit}`
            );

            dispatch(getContainerSecuritiesSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(getContainerSecuritiesFailure(errorMsg));
        }
    };
};

// Delete Container Security
export const deleteContainerSecurityRequest: Function = (): void => {
    return {
        type: types.DELETE_CONTAINER_SECURITY_REQUEST,
    };
};

export const deleteContainerSecuritySuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.DELETE_CONTAINER_SECURITY_SUCCESS,
        payload,
    };
};

export const deleteContainerSecurityFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.DELETE_CONTAINER_SECURITY_FAILURE,
        payload: error,
    };
};

export const deleteContainerSecurity: $TSFixMe = ({
    projectId,
    componentId,
    containerSecurityId,
}: $TSFixMe) => {
    return async (dispatch: Dispatch) => {
        dispatch(deleteContainerSecurityRequest());

        try {
            const response: $TSFixMe =
                await delete `security/${projectId}/${componentId}/container/${containerSecurityId}`;

            dispatch(deleteContainerSecuritySuccess(response.data));

            // update the list of container securities
            dispatch(getContainerSecurities({ projectId, componentId }));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(deleteContainerSecurityFailure(errorMsg));
        }
    };
};

// Scan Container Security
export const scanContainerSecurityRequest: Function = (): void => {
    return {
        type: types.SCAN_CONTAINER_SECURITY_REQUEST,
    };
};

export const scanContainerSecuritySuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.SCAN_CONTAINER_SECURITY_SUCCESS,
        payload,
    };
};

export const scanContainerSecurityFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.SCAN_CONTAINER_SECURITY_FAILURE,
        payload: error,
    };
};

export const scanContainerSecurity: $TSFixMe = ({
    projectId,
    containerSecurityId,
}: $TSFixMe) => {
    return async (dispatch: Dispatch) => {
        dispatch(scanContainerSecurityRequest());
        dispatch(setActiveContainerSecurity(containerSecurityId));

        try {
            await BackendAPI.post(
                `security/${projectId}/container/scan/${containerSecurityId}`
            );
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(scanContainerSecurityFailure(errorMsg));
        }
    };
};

// Get a particular Container Security Log
export const getContainerSecurityLogRequest: Function = (): void => {
    return {
        type: types.GET_CONTAINER_SECURITY_LOG_REQUEST,
    };
};

export const getContainerSecurityLogSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.GET_CONTAINER_SECURITY_LOG_SUCCESS,
        payload,
    };
};

export const getContainerSecurityLogFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.GET_CONTAINER_SECURITY_LOG_FAILURE,
        payload: error,
    };
};

export const getContainerSecurityLog: $TSFixMe = ({
    projectId,
    componentId,
    containerSecurityId,
}: $TSFixMe) => {
    return async (dispatch: Dispatch) => {
        dispatch(getContainerSecurityLogRequest());

        try {
            const response: $TSFixMe = await BackendAPI.get(
                `securityLog/${projectId}/${componentId}/container/logs/${containerSecurityId}`
            );

            dispatch(getContainerSecurityLogSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(getContainerSecurityLogFailure(errorMsg));
        }
    };
};

export const getContainerSecurityLogBySlug: $TSFixMe = ({
    projectId,
    componentId,
    containerSecuritySlug,
}: $TSFixMe) => {
    return async (dispatch: Dispatch) => {
        dispatch(getContainerSecurityLogRequest());

        try {
            const response: $TSFixMe = await BackendAPI.get(
                `securityLog/${projectId}/${componentId}/containerSecuritySlug/logs/${containerSecuritySlug}`
            );

            dispatch(getContainerSecurityLogSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(getContainerSecurityLogFailure(errorMsg));
        }
    };
};

// Get Container Security Logs in a component
export const getContainerSecurityLogsRequest: Function = (): void => {
    return {
        type: types.GET_CONTAINER_SECURITY_LOGS_REQUEST,
    };
};

export const getContainerSecurityLogsSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.GET_CONTAINER_SECURITY_LOGS_SUCCESS,
        payload,
    };
};

export const getContainerSecurityLogsFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.GET_CONTAINER_SECURITY_LOGS_FAILURE,
        payload: error,
    };
};

export const getContainerSecurityLogs: $TSFixMe = ({
    projectId,
    componentId,
}: $TSFixMe) => {
    return async (dispatch: Dispatch) => {
        dispatch(getContainerSecurityLogsRequest());

        try {
            const response: $TSFixMe = await BackendAPI.get(
                `securityLog/${projectId}/${componentId}/container/logs`
            );

            dispatch(getContainerSecurityLogsSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(getContainerSecurityLogsFailure(errorMsg));
        }
    };
};

// Edit container security
export const editContainerSecurityRequest: Function = (): void => {
    return {
        type: types.EDIT_CONTAINER_SECURITY_REQUEST,
    };
};

export const editContainerSecuritySuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.EDIT_CONTAINER_SECURITY_SUCCESS,
        payload,
    };
};

export const editContainerSecurityFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.EDIT_CONTAINER_SECURITY_FAILURE,
        payload: error,
    };
};

export function editContainerSecurity({
    projectId,
    componentId,
    containerSecurityId,
    data,
}: $TSFixMe) {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.put(
            `security/${projectId}/${componentId}/container/${containerSecurityId}`,
            data
        );
        dispatch(editContainerSecurityRequest());

        promise.then(
            (response: $TSFixMe): void => {
                dispatch(editContainerSecuritySuccess(response.data));
            },
            (error: $TSFixMe): void => {
                const errorMsg: $TSFixMe =
                    error.response && error.response.data
                        ? error.response.data
                        : error.data
                        ? error.data
                        : error.message
                        ? error.message
                        : 'Network Error';
                dispatch(editContainerSecurityFailure(errorMsg));
            }
        );

        return promise;
    };
}

// Add Application Security
export const addApplicationSecurityRequest: Function = (): void => {
    return {
        type: types.ADD_APPLICATION_SECURITY_REQUEST,
    };
};

export const addApplicationSecuritySuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.ADD_APPLICATION_SECURITY_SUCCESS,
        payload,
    };
};

export const addApplicationSecurityFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.ADD_APPLICATION_SECURITY_FAILURE,
        payload: error,
    };
};

export const addApplicationSecurity: $TSFixMe = ({
    projectId,
    componentId,
    data,
}: $TSFixMe) => {
    return async (dispatch: Dispatch) => {
        dispatch(addApplicationSecurityRequest());

        try {
            const response: $TSFixMe = await BackendAPI.post(
                `security/${projectId}/${componentId}/application`,
                data
            );

            dispatch(addApplicationSecuritySuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(addApplicationSecurityFailure(errorMsg));
        }
    };
};

// Get an Application Security
export const getApplicationSecurityRequest: Function = (): void => {
    return {
        type: types.GET_APPLICATION_SECURITY_REQUEST,
    };
};

export const getApplicationSecuritySuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.GET_APPLICATION_SECURITY_SUCCESS,
        payload,
    };
};

export const getApplicationSecurityFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.GET_APPLICATION_SECURITY_FAILURE,
        payload: error,
    };
};

export const getApplicationSecurity: $TSFixMe = ({
    projectId,
    componentId,
    applicationSecurityId,
}: $TSFixMe) => {
    return async (dispatch: Dispatch) => {
        dispatch(getApplicationSecurityRequest());

        try {
            const response: $TSFixMe = await BackendAPI.get(
                `security/${projectId}/${componentId}/application/${applicationSecurityId}`
            );

            dispatch(getApplicationSecuritySuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(getApplicationSecurityFailure(errorMsg));
        }
    };
};

export const getApplicationSecurityBySlug: $TSFixMe = ({
    projectId,
    componentId,
    applicationSecuritySlug,
}: $TSFixMe) => {
    return async (dispatch: Dispatch) => {
        dispatch(getApplicationSecurityRequest());

        try {
            const response: $TSFixMe = await BackendAPI.get(
                `security/${projectId}/${componentId}/applicationSecuritySlug/${applicationSecuritySlug}`
            );

            dispatch(getApplicationSecuritySuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(getApplicationSecurityFailure(errorMsg));
        }
    };
};

// Get all Application Security
export const getApplicationSecuritiesRequest: Function = (
    fetchingPage: $TSFixMe
): void => {
    return {
        type: types.GET_APPLICATION_SECURITIES_REQUEST,
        payload: fetchingPage,
    };
};

export const getApplicationSecuritiesSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.GET_APPLICATION_SECURITIES_SUCCESS,
        payload,
    };
};

export const getApplicationSecuritiesFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.GET_APPLICATION_SECURITIES_FAILURE,
        payload: error,
    };
};

export const getApplicationSecurities: $TSFixMe = ({
    projectId,
    componentId,
    skip = 0,
    limit = 0,
    fetchingPage = false,
}: $TSFixMe) => {
    return async (dispatch: Dispatch) => {
        dispatch(getApplicationSecuritiesRequest(fetchingPage));

        try {
            const response: $TSFixMe = await BackendAPI.get(
                `security/${projectId}/${componentId}/application?skip=${skip}&limit=${limit}`
            );

            dispatch(getApplicationSecuritiesSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(getApplicationSecuritiesFailure(errorMsg));
        }
    };
};

// Delete Application Security
export const deleteApplicationSecurityRequest: Function = (): void => {
    return {
        type: types.DELETE_APPLICATION_SECURITY_REQUEST,
    };
};

export const deleteApplicationSecuritySuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.DELETE_APPLICATION_SECURITY_SUCCESS,
        payload,
    };
};

export const deleteApplicationSecurityFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.DELETE_APPLICATION_SECURITY_FAILURE,
        payload: error,
    };
};

export const deleteApplicationSecurity: $TSFixMe = ({
    projectId,
    componentId,
    applicationSecurityId,
}: $TSFixMe) => {
    return async (dispatch: Dispatch) => {
        dispatch(deleteApplicationSecurityRequest());

        try {
            const response: $TSFixMe =
                await delete `security/${projectId}/${componentId}/application/${applicationSecurityId}`;

            dispatch(deleteApplicationSecuritySuccess(response.data));

            // update the list of application securities
            dispatch(getApplicationSecurities({ projectId, componentId }));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(deleteApplicationSecurityFailure(errorMsg));
        }
    };
};

// Scan Application Security
export const scanApplicationSecurityRequest: Function = (): void => {
    return {
        type: types.SCAN_APPLICATION_SECURITY_REQUEST,
    };
};

export const scanApplicationSecuritySuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.SCAN_APPLICATION_SECURITY_SUCCESS,
        payload,
    };
};

export const scanApplicationSecurityFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.SCAN_APPLICATION_SECURITY_FAILURE,
        payload: error,
    };
};

export const scanApplicationSecurity: $TSFixMe = ({
    projectId,
    applicationSecurityId,
}: $TSFixMe) => {
    return async (dispatch: Dispatch) => {
        dispatch(scanApplicationSecurityRequest());
        dispatch(setActiveApplicationSecurity(applicationSecurityId));
        try {
            await BackendAPI.post(
                `security/${projectId}/application/scan/${applicationSecurityId}`
            );
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(scanApplicationSecurityFailure(errorMsg));
        }
    };
};

// Get a particular Application Security Log
export const getApplicationSecurityLogRequest: Function = (): void => {
    return {
        type: types.GET_APPLICATION_SECURITY_LOG_REQUEST,
    };
};

export const getApplicationSecurityLogSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.GET_APPLICATION_SECURITY_LOG_SUCCESS,
        payload,
    };
};

export const getApplicationSecurityLogFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.GET_APPLICATION_SECURITY_LOG_FAILURE,
        payload: error,
    };
};

export const getApplicationSecurityLog: $TSFixMe = ({
    projectId,
    componentId,
    applicationSecurityId,
}: $TSFixMe) => {
    return async (dispatch: Dispatch) => {
        dispatch(getApplicationSecurityLogRequest());

        try {
            const response: $TSFixMe = await BackendAPI.get(
                `securityLog/${projectId}/${componentId}/application/logs/${applicationSecurityId}`
            );

            dispatch(getApplicationSecurityLogSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(getApplicationSecurityLogFailure(errorMsg));
        }
    };
};

export const getApplicationSecurityLogBySlug: $TSFixMe = ({
    projectId,
    componentId,
    applicationSecuritySlug,
}: $TSFixMe) => {
    return async (dispatch: Dispatch) => {
        dispatch(getApplicationSecurityLogRequest());

        try {
            const response: $TSFixMe = await BackendAPI.get(
                `securityLog/${projectId}/${componentId}/applicationSecuritySlug/logs/${applicationSecuritySlug}`
            );

            dispatch(getApplicationSecurityLogSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(getApplicationSecurityLogFailure(errorMsg));
        }
    };
};

// Get Application Security Logs in a component
export const getApplicationSecurityLogsRequest: Function = (): void => {
    return {
        type: types.GET_APPLICATION_SECURITY_LOGS_REQUEST,
    };
};

export const getApplicationSecurityLogsSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.GET_APPLICATION_SECURITY_LOGS_SUCCESS,
        payload,
    };
};

export const getApplicationSecurityLogsFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.GET_APPLICATION_SECURITY_LOGS_FAILURE,
        payload: error,
    };
};

export const getApplicationSecurityLogs: $TSFixMe = ({
    projectId,
    componentId,
}: $TSFixMe) => {
    return async (dispatch: Dispatch) => {
        dispatch(getApplicationSecurityLogsRequest());

        try {
            const response: $TSFixMe = await BackendAPI.get(
                `securityLog/${projectId}/${componentId}/application/logs`
            );

            dispatch(getApplicationSecurityLogsSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(getApplicationSecurityLogsFailure(errorMsg));
        }
    };
};

// Edit application security
export const editApplicationSecurityRequest: Function = (): void => {
    return {
        type: types.EDIT_APPLICATION_SECURITY_REQUEST,
    };
};

export const editApplicationSecuritySuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.EDIT_APPLICATION_SECURITY_SUCCESS,
        payload,
    };
};

export const editApplicationSecurityFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.EDIT_APPLICATION_SECURITY_FAILURE,
        payload: error,
    };
};

export function editApplicationSecurity({
    projectId,
    componentId,
    applicationSecurityId,
    data,
}: $TSFixMe) {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.put(
            `security/${projectId}/${componentId}/application/${applicationSecurityId}`,
            data
        );
        dispatch(editApplicationSecurityRequest());

        promise.then(
            (response: $TSFixMe): void => {
                dispatch(editApplicationSecuritySuccess(response.data));
            },
            (error: $TSFixMe): void => {
                const errorMsg: $TSFixMe =
                    error.response && error.response.data
                        ? error.response.data
                        : error.data
                        ? error.data
                        : error.message
                        ? error.message
                        : 'Network Error';
                dispatch(editApplicationSecurityFailure(errorMsg));
            }
        );

        return promise;
    };
}

export const setActiveApplicationSecurity: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.SET_ACTIVE_APPLICATION_SECURITY,
        payload,
    };
};

export const setActiveContainerSecurity: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.SET_ACTIVE_CONTAINER_SECURITY,
        payload,
    };
};
