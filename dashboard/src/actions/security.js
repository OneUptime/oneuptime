import * as types from '../constants/security';
import { postApi, getApi, deleteApi, putApi } from '../api';

// Add Container Security
export const addContainerSecurityRequest = () => ({
    type: types.ADD_CONTAINER_SECURITY_REQUEST,
});

export const addContainerSecuritySuccess = payload => ({
    type: types.ADD_CONTAINER_SECURITY_SUCCESS,
    payload,
});

export const addContainerSecurityFailure = error => ({
    type: types.ADD_CONTAINER_SECURITY_FAILURE,
    payload: error,
});

export const addContainerSecurity = ({
    projectId,
    componentId,
    data,
}) => async dispatch => {
    dispatch(addContainerSecurityRequest());

    try {
        const response = await postApi(
            `security/${projectId}/${componentId}/container`,
            data
        );
        dispatch(addContainerSecuritySuccess(response.data));
    } catch (error) {
        const errorMsg =
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

// Get a Container Security
export const getContainerSecurityRequest = () => ({
    type: types.GET_CONTAINER_SECURITY_REQUEST,
});

export const getContainerSecuritySuccess = payload => ({
    type: types.GET_CONTAINER_SECURITY_SUCCESS,
    payload,
});

export const getContainerSecurityFailure = error => ({
    type: types.GET_CONTAINER_SECURITY_FAILURE,
    payload: error,
});

export const getContainerSecurity = ({
    projectId,
    componentId,
    containerSecurityId,
}) => async dispatch => {
    dispatch(getContainerSecurityRequest());

    try {
        const response = await getApi(
            `security/${projectId}/${componentId}/container/${containerSecurityId}`
        );
        dispatch(getContainerSecuritySuccess(response.data));
    } catch (error) {
        const errorMsg =
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

// Get all Container Security
export const getContainerSecuritiesRequest = () => ({
    type: types.GET_CONTAINER_SECURITIES_REQUEST,
});

export const getContainerSecuritiesSuccess = payload => ({
    type: types.GET_CONTAINER_SECURITIES_SUCCESS,
    payload,
});

export const getContainerSecuritiesFailure = error => ({
    type: types.GET_CONTAINER_SECURITIES_FAILURE,
    payload: error,
});

export const getContainerSecurities = ({
    projectId,
    componentId,
}) => async dispatch => {
    dispatch(getContainerSecuritiesRequest());

    try {
        const response = await getApi(
            `security/${projectId}/${componentId}/container`
        );
        dispatch(getContainerSecuritiesSuccess(response.data));
    } catch (error) {
        const errorMsg =
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

// Delete Container Security
export const deleteContainerSecurityRequest = () => ({
    type: types.DELETE_CONTAINER_SECURITY_REQUEST,
});

export const deleteContainerSecuritySuccess = payload => ({
    type: types.DELETE_CONTAINER_SECURITY_SUCCESS,
    payload,
});

export const deleteContainerSecurityFailure = error => ({
    type: types.DELETE_CONTAINER_SECURITY_FAILURE,
    payload: error,
});

export const deleteContainerSecurity = ({
    projectId,
    componentId,
    containerSecurityId,
}) => async dispatch => {
    dispatch(deleteContainerSecurityRequest());

    try {
        const response = await deleteApi(
            `security/${projectId}/${componentId}/container/${containerSecurityId}`
        );
        dispatch(deleteContainerSecuritySuccess(response.data));

        // update the list of container securities
        dispatch(getContainerSecurities({ projectId, componentId }));
    } catch (error) {
        const errorMsg =
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

// Scan Container Security
export const scanContainerSecurityRequest = () => ({
    type: types.SCAN_CONTAINER_SECURITY_REQUEST,
});

export const scanContainerSecuritySuccess = payload => ({
    type: types.SCAN_CONTAINER_SECURITY_SUCCESS,
    payload,
});

export const scanContainerSecurityFailure = error => ({
    type: types.SCAN_CONTAINER_SECURITY_FAILURE,
    payload: error,
});

export const scanContainerSecurity = ({
    projectId,
    containerSecurityId,
}) => async dispatch => {
    dispatch(scanContainerSecurityRequest());
    dispatch(setActiveContainerSecurity(containerSecurityId));

    try {
        const response = await postApi(
            `security/${projectId}/container/scan/${containerSecurityId}`
        );
        dispatch(scanContainerSecuritySuccess(response.data));
    } catch (error) {
        const errorMsg =
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

// Get a particular Container Security Log
export const getContainerSecurityLogRequest = () => ({
    type: types.GET_CONTAINER_SECURITY_LOG_REQUEST,
});

export const getContainerSecurityLogSuccess = payload => ({
    type: types.GET_CONTAINER_SECURITY_LOG_SUCCESS,
    payload,
});

export const getContainerSecurityLogFailure = error => ({
    type: types.GET_CONTAINER_SECURITY_LOG_FAILURE,
    payload: error,
});

export const getContainerSecurityLog = ({
    projectId,
    componentId,
    containerSecurityId,
}) => async dispatch => {
    dispatch(getContainerSecurityLogRequest());

    try {
        const response = await getApi(
            `securityLog/${projectId}/${componentId}/container/logs/${containerSecurityId}`
        );
        dispatch(getContainerSecurityLogSuccess(response.data));
    } catch (error) {
        const errorMsg =
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

// Get Container Security Logs in a component
export const getContainerSecurityLogsRequest = () => ({
    type: types.GET_CONTAINER_SECURITY_LOGS_REQUEST,
});

export const getContainerSecurityLogsSuccess = payload => ({
    type: types.GET_CONTAINER_SECURITY_LOGS_SUCCESS,
    payload,
});

export const getContainerSecurityLogsFailure = error => ({
    type: types.GET_CONTAINER_SECURITY_LOGS_FAILURE,
    payload: error,
});

export const getContainerSecurityLogs = ({
    projectId,
    componentId,
}) => async dispatch => {
    dispatch(getContainerSecurityLogsRequest());

    try {
        const response = await getApi(
            `securityLog/${projectId}/${componentId}/container/logs`
        );
        dispatch(getContainerSecurityLogsSuccess(response.data));
    } catch (error) {
        const errorMsg =
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

// Edit container security
export const editContainerSecurityRequest = () => ({
    type: types.EDIT_CONTAINER_SECURITY_REQUEST,
});

export const editContainerSecuritySuccess = payload => ({
    type: types.EDIT_CONTAINER_SECURITY_SUCCESS,
    payload,
});

export const editContainerSecurityFailure = error => ({
    type: types.EDIT_CONTAINER_SECURITY_FAILURE,
    payload: error,
});

export const editContainerSecurity = ({
    projectId,
    componentId,
    containerSecurityId,
    data,
}) => async dispatch => {
    dispatch(editContainerSecurityRequest());

    try {
        const response = await putApi(
            `security/${projectId}/${componentId}/container/${containerSecurityId}`,
            data
        );
        dispatch(editContainerSecuritySuccess(response.data));
    } catch (error) {
        const errorMsg =
            error.response && error.response.data
                ? error.response.data
                : error.data
                ? error.data
                : error.message
                ? error.message
                : 'Network Error';
        dispatch(editContainerSecurityFailure(errorMsg));
    }
};

// Add Application Security
export const addApplicationSecurityRequest = () => ({
    type: types.ADD_APPLICATION_SECURITY_REQUEST,
});

export const addApplicationSecuritySuccess = payload => ({
    type: types.ADD_APPLICATION_SECURITY_SUCCESS,
    payload,
});

export const addApplicationSecurityFailure = error => ({
    type: types.ADD_APPLICATION_SECURITY_FAILURE,
    payload: error,
});

export const addApplicationSecurity = ({
    projectId,
    componentId,
    data,
}) => async dispatch => {
    dispatch(addApplicationSecurityRequest());

    try {
        const response = await postApi(
            `security/${projectId}/${componentId}/application`,
            data
        );
        dispatch(addApplicationSecuritySuccess(response.data));
    } catch (error) {
        const errorMsg =
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

// Get an Application Security
export const getApplicationSecurityRequest = () => ({
    type: types.GET_APPLICATION_SECURITY_REQUEST,
});

export const getApplicationSecuritySuccess = payload => ({
    type: types.GET_APPLICATION_SECURITY_SUCCESS,
    payload,
});

export const getApplicationSecurityFailure = error => ({
    type: types.GET_APPLICATION_SECURITY_FAILURE,
    payload: error,
});

export const getApplicationSecurity = ({
    projectId,
    componentId,
    applicationSecurityId,
}) => async dispatch => {
    dispatch(getApplicationSecurityRequest());

    try {
        const response = await getApi(
            `security/${projectId}/${componentId}/application/${applicationSecurityId}`
        );
        dispatch(getApplicationSecuritySuccess(response.data));
    } catch (error) {
        const errorMsg =
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

// Get all Application Security
export const getApplicationSecuritiesRequest = () => ({
    type: types.GET_APPLICATION_SECURITIES_REQUEST,
});

export const getApplicationSecuritiesSuccess = payload => ({
    type: types.GET_APPLICATION_SECURITIES_SUCCESS,
    payload,
});

export const getApplicationSecuritiesFailure = error => ({
    type: types.GET_APPLICATION_SECURITIES_FAILURE,
    payload: error,
});

export const getApplicationSecurities = ({
    projectId,
    componentId,
}) => async dispatch => {
    dispatch(getApplicationSecuritiesRequest());

    try {
        const response = await getApi(
            `security/${projectId}/${componentId}/application`
        );
        dispatch(getApplicationSecuritiesSuccess(response.data));
    } catch (error) {
        const errorMsg =
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

// Delete Application Security
export const deleteApplicationSecurityRequest = () => ({
    type: types.DELETE_APPLICATION_SECURITY_REQUEST,
});

export const deleteApplicationSecuritySuccess = payload => ({
    type: types.DELETE_APPLICATION_SECURITY_SUCCESS,
    payload,
});

export const deleteApplicationSecurityFailure = error => ({
    type: types.DELETE_APPLICATION_SECURITY_FAILURE,
    payload: error,
});

export const deleteApplicationSecurity = ({
    projectId,
    componentId,
    applicationSecurityId,
}) => async dispatch => {
    dispatch(deleteApplicationSecurityRequest());

    try {
        const response = await deleteApi(
            `security/${projectId}/${componentId}/application/${applicationSecurityId}`
        );
        dispatch(deleteApplicationSecuritySuccess(response.data));

        // update the list of application securities
        dispatch(getApplicationSecurities({ projectId, componentId }));
    } catch (error) {
        const errorMsg =
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

// Scan Application Security
export const scanApplicationSecurityRequest = () => ({
    type: types.SCAN_APPLICATION_SECURITY_REQUEST,
});

export const scanApplicationSecuritySuccess = payload => ({
    type: types.SCAN_APPLICATION_SECURITY_SUCCESS,
    payload,
});

export const scanApplicationSecurityFailure = error => ({
    type: types.SCAN_APPLICATION_SECURITY_FAILURE,
    payload: error,
});

export const scanApplicationSecurity = ({
    projectId,
    applicationSecurityId,
}) => async dispatch => {
    dispatch(scanApplicationSecurityRequest());
    dispatch(setActiveApplicationSecurity(applicationSecurityId));

    try {
        const response = await postApi(
            `security/${projectId}/application/scan/${applicationSecurityId}`
        );
        dispatch(scanApplicationSecuritySuccess(response.data));
        dispatch(
            getApplicationSecurities({
                projectId,
                componentId: response.data.componentId,
            })
        );
    } catch (error) {
        const errorMsg =
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

// Get a particular Application Security Log
export const getApplicationSecurityLogRequest = () => ({
    type: types.GET_APPLICATION_SECURITY_LOG_REQUEST,
});

export const getApplicationSecurityLogSuccess = payload => ({
    type: types.GET_APPLICATION_SECURITY_LOG_SUCCESS,
    payload,
});

export const getApplicationSecurityLogFailure = error => ({
    type: types.GET_APPLICATION_SECURITY_LOG_FAILURE,
    payload: error,
});

export const getApplicationSecurityLog = ({
    projectId,
    componentId,
    applicationSecurityId,
}) => async dispatch => {
    dispatch(getApplicationSecurityLogRequest());

    try {
        const response = await getApi(
            `securityLog/${projectId}/${componentId}/application/logs/${applicationSecurityId}`
        );
        dispatch(getApplicationSecurityLogSuccess(response.data));
    } catch (error) {
        const errorMsg =
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

// Get Application Security Logs in a component
export const getApplicationSecurityLogsRequest = () => ({
    type: types.GET_APPLICATION_SECURITY_LOGS_REQUEST,
});

export const getApplicationSecurityLogsSuccess = payload => ({
    type: types.GET_APPLICATION_SECURITY_LOGS_SUCCESS,
    payload,
});

export const getApplicationSecurityLogsFailure = error => ({
    type: types.GET_APPLICATION_SECURITY_LOGS_FAILURE,
    payload: error,
});

export const getApplicationSecurityLogs = ({
    projectId,
    componentId,
}) => async dispatch => {
    dispatch(getApplicationSecurityLogsRequest());

    try {
        const response = await getApi(
            `securityLog/${projectId}/${componentId}/application/logs`
        );
        dispatch(getApplicationSecurityLogsSuccess(response.data));
    } catch (error) {
        const errorMsg =
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

// Edit application security
export const editApplicationSecurityRequest = () => ({
    type: types.EDIT_APPLICATION_SECURITY_REQUEST,
});

export const editApplicationSecuritySuccess = payload => ({
    type: types.EDIT_APPLICATION_SECURITY_SUCCESS,
    payload,
});

export const editApplicationSecurityFailure = error => ({
    type: types.EDIT_APPLICATION_SECURITY_FAILURE,
    payload: error,
});

export const editApplicationSecurity = ({
    projectId,
    componentId,
    applicationSecurityId,
    data,
}) => async dispatch => {
    dispatch(editApplicationSecurityRequest());

    try {
        const response = await putApi(
            `security/${projectId}/${componentId}/application/${applicationSecurityId}`,
            data
        );
        dispatch(editApplicationSecuritySuccess(response.data));
    } catch (error) {
        const errorMsg =
            error.response && error.response.data
                ? error.response.data
                : error.data
                ? error.data
                : error.message
                ? error.message
                : 'Network Error';
        dispatch(editApplicationSecurityFailure(errorMsg));
    }
};

export const setActiveApplicationSecurity = payload => ({
    type: types.SET_ACTIVE_APPLICATION_SECURITY,
    payload,
});

export const setActiveContainerSecurity = payload => ({
    type: types.SET_ACTIVE_CONTAINER_SECURITY,
    payload,
});
