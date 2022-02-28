import { getApi, putApi, postApi, deleteApi } from '../api';
import * as types from '../constants/incidentBasicSettings';
import errors from '../errors';

const fetchBasicIncidentSettingsVariablesRequest = () => ({
    type: types.FETCH_INCIDENT_BASIC_SETTINGS_VARIABLES_REQUEST,
});

const fetchBasicIncidentSettingsVariablesSuccess = (payload: $TSFixMe) => ({
    type: types.FETCH_INCIDENT_BASIC_SETTINGS_VARIABLES_SUCCESS,
    payload,
});

const fetchBasicIncidentSettingsVariablesFailure = (payload: $TSFixMe) => ({
    type: types.FETCH_INCIDENT_BASIC_SETTINGS_VARIABLES_FAILURE,
    payload,
});

export const fetchBasicIncidentSettingsVariables = () => {
    return function(dispatch: $TSFixMe) {
        const promise = getApi(`incidentSettings/variables`);
        dispatch(fetchBasicIncidentSettingsVariablesRequest());
        promise.then(
            function(incidentBasicSettings) {
                dispatch(
                    fetchBasicIncidentSettingsVariablesSuccess(
                        incidentBasicSettings.data
                    )
                );
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(
                    fetchBasicIncidentSettingsVariablesFailure(errors(error))
                );
            }
        );
    };
};

export const setRevealIncidentSettingsVariables = (payload: $TSFixMe) => (
    dispatch: $TSFixMe
) => {
    dispatch({
        type: types.SET_REVEAL_VARIABLES_INCIDENT_BASIC_SETTINGS,
        payload,
    });
};

// FETCH ALL TEMPALTES IN A PROJECT
export const fetchIncidentTemplatesRequest = () => ({
    type: types.FETCH_INCIDENT_TEMPLATES_REQUEST,
});

export const fetchIncidentTemplatesSuccess = (payload: $TSFixMe) => ({
    type: types.FETCH_INCIDENT_TEMPLATES_SUCCESS,
    payload,
});

export const fetchIncidentTemplatesFailure = (error: $TSFixMe) => ({
    type: types.FETCH_INCIDENT_TEMPLATE_FAILURE,
    payload: error,
});

export const fetchIncidentTemplates = ({
    projectId,
    skip,
    limit,
}: $TSFixMe) => (dispatch: $TSFixMe) => {
    const url = `incidentSettings/${projectId}?skip=${skip}&limit=${limit}`;

    const promise = getApi(url);
    dispatch(fetchIncidentTemplatesRequest());
    promise.then(
        function(incidentBasicSettings) {
            dispatch(fetchIncidentTemplatesSuccess(incidentBasicSettings.data));
        },
        function(error) {
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            if (error && error.message) {
                error = error.message;
            } else {
                error = 'Network Error';
            }
            dispatch(fetchIncidentTemplatesFailure(errors(error)));
        }
    );

    return promise;
};

// CREATE TEMPLATE IN A PROJECT
export const createIncidentTemplateRequest = () => ({
    type: types.CREATE_INCIDENT_TEMPLATE_REQUEST,
});

export const createIncidentTemplateSuccess = (payload: $TSFixMe) => ({
    type: types.CREATE_INCIDENT_TEMPLATE_SUCCESS,
    payload,
});

export const createIncidentTemplateFailure = (error: $TSFixMe) => ({
    type: types.CREATE_INCIDENT_TEMPLATE_FAILURE,
    payload: error,
});

export const createIncidentTemplate = ({ projectId, data }: $TSFixMe) => (
    dispatch: $TSFixMe
) => {
    const url = `incidentSettings/${projectId}`;

    const promise = postApi(url, data);
    dispatch(createIncidentTemplateRequest());
    promise.then(
        function(incidentBasicSettings) {
            dispatch(createIncidentTemplateSuccess(incidentBasicSettings.data));
        },
        function(error) {
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            if (error && error.message) {
                error = error.message;
            } else {
                error = 'Network Error';
            }
            dispatch(createIncidentTemplateFailure(errors(error)));
        }
    );

    return promise;
};

// UPDATE A TEMPLATE IN A PROJECT
export const updateIncidentTemplateRequest = () => ({
    type: types.UPDATE_INCIDENT_TEMPLATE_REQUEST,
});

export const updateIncidentTemplateSuccess = (payload: $TSFixMe) => ({
    type: types.UPDATE_INCIDENT_TEMPALTE_SUCCESS,
    payload,
});

export const updateIncidentTemplateFailure = (error: $TSFixMe) => ({
    type: types.UPDATE_INCIDENT_TEMPLATE_FAILURE,
    payload: error,
});

export const updateIncidentTemplate = ({
    projectId,
    templateId,
    data,
}: $TSFixMe) => (dispatch: $TSFixMe) => {
    const url = `incidentSettings/${projectId}/${templateId}`;

    const promise = putApi(url, data);
    dispatch(updateIncidentTemplateRequest());
    promise.then(
        function(incidentBasicSettings) {
            dispatch(updateIncidentTemplateSuccess(incidentBasicSettings.data));
        },
        function(error) {
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            if (error && error.message) {
                error = error.message;
            } else {
                error = 'Network Error';
            }
            dispatch(updateIncidentTemplateFailure(errors(error)));
        }
    );

    return promise;
};

// DELETE A TEMPLATE IN A PROJECT
export const deleteIncidentTemplateRequest = () => ({
    type: types.DELETE_INCIDENT_TEMPLATE_REQUEST,
});

export const deleteIncidentTemplateSuccess = (payload: $TSFixMe) => ({
    type: types.DELETE_INCIDENT_TEMPLATE_SUCCESS,
    payload,
});

export const deleteIncidentTemplateFailure = (error: $TSFixMe) => ({
    type: types.DELETE_INCIDENT_TEMPLATE_FAILURE,
    payload: error,
});

export const deleteIncidentTemplate = ({ projectId, templateId }: $TSFixMe) => (
    dispatch: $TSFixMe
) => {
    const url = `incidentSettings/${projectId}/${templateId}`;

    const promise = deleteApi(url);
    dispatch(deleteIncidentTemplateRequest());
    promise.then(
        function(incidentBasicSettings) {
            dispatch(deleteIncidentTemplateSuccess(incidentBasicSettings.data));
        },
        function(error) {
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            if (error && error.message) {
                error = error.message;
            } else {
                error = 'Network Error';
            }
            dispatch(deleteIncidentTemplateFailure(errors(error)));
        }
    );

    return promise;
};

// SET DEFAULT INCIDENT TEMPLATE
export const setDefaultTemplateRequest = () => ({
    type: types.SET_DEFAULT_INCIDENT_TEMPLATE_REQUEST,
});

export const setDefaultTemplateSuccess = (payload: $TSFixMe) => ({
    type: types.SET_DEFAULT_INCIDENT_TEMPLATE_SUCCESS,
    payload,
});

export const setDefaultTemplateFailure = (error: $TSFixMe) => ({
    type: types.SET_DEFAULT_INCIDENT_TEMPLATE_FAILURE,
    payload: error,
});

export const setDefaultTemplate = ({ projectId, templateId }: $TSFixMe) => (
    dispatch: $TSFixMe
) => {
    const url = `incidentSettings/${projectId}/${templateId}/setDefault`;

    const promise = putApi(url, {});
    dispatch(setDefaultTemplateRequest());
    promise.then(
        function(incidentBasicSettings) {
            dispatch(setDefaultTemplateSuccess(incidentBasicSettings.data));
        },
        function(error) {
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            if (error && error.message) {
                error = error.message;
            } else {
                error = 'Network Error';
            }
            dispatch(setDefaultTemplateFailure(errors(error)));
        }
    );

    return promise;
};

// SET ACTIVE TEMPLATE
export const setActiveTemplate = (id: $TSFixMe) => ({
    type: types.SET_ACTIVE_TEMPLATE,
    payload: id,
});

// FETCH DEFAULT INCIDENT TEMPLATE
export const fetchDefaultTemplateRequest = () => ({
    type: types.FETCH_DEFAULT_TEMPLATE_REQUEST,
});

export const fetchDefaultTemplateSuccess = (payload: $TSFixMe) => ({
    type: types.FETCH_DEFAULT_TEMPLATE_SUCCESS,
    payload,
});

export const fetchDefaultTemplateFailure = (error: $TSFixMe) => ({
    type: types.FETCH_DEFAULT_TEMPLATE_FAILURE,
    payload: error,
});

export const fetchDefaultTemplate = ({ projectId }: $TSFixMe) => (
    dispatch: $TSFixMe
) => {
    const url = `incidentSettings/${projectId}/default`;

    const promise = getApi(url);
    dispatch(fetchDefaultTemplateRequest());
    promise.then(
        function(incidentBasicSettings) {
            dispatch(fetchDefaultTemplateSuccess(incidentBasicSettings.data));
        },
        function(error) {
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            if (error && error.message) {
                error = error.message;
            } else {
                error = 'Network Error';
            }
            dispatch(fetchDefaultTemplateFailure(errors(error)));
        }
    );

    return promise;
};
