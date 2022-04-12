import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/incidentBasicSettings';
import ErrorPayload from 'CommonUI/src/payload-types/error';
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

export const fetchBasicIncidentSettingsVariables = (): void => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(`incidentSettings/variables`);
        dispatch(fetchBasicIncidentSettingsVariablesRequest());
        promise.then(
            function (incidentBasicSettings) {
                dispatch(
                    fetchBasicIncidentSettingsVariablesSuccess(
                        incidentBasicSettings.data
                    )
                );
            },
            function (error) {
                dispatch(fetchBasicIncidentSettingsVariablesFailure(error));
            }
        );
    };
};

export const setRevealIncidentSettingsVariables =
    (payload: $TSFixMe) => (dispatch: Dispatch) => {
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

export const fetchIncidentTemplatesFailure = (error: ErrorPayload) => ({
    type: types.FETCH_INCIDENT_TEMPLATE_FAILURE,
    payload: error,
});

export const fetchIncidentTemplates =
    ({ projectId, skip, limit }: $TSFixMe) =>
    (dispatch: Dispatch) => {
        const url = `incidentSettings/${projectId}?skip=${skip}&limit=${limit}`;

        const promise = BackendAPI.get(url);
        dispatch(fetchIncidentTemplatesRequest());
        promise.then(
            function (incidentBasicSettings) {
                dispatch(
                    fetchIncidentTemplatesSuccess(incidentBasicSettings.data)
                );
            },
            function (error) {
                dispatch(fetchIncidentTemplatesFailure(error));
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

export const createIncidentTemplateFailure = (error: ErrorPayload) => ({
    type: types.CREATE_INCIDENT_TEMPLATE_FAILURE,
    payload: error,
});

export const createIncidentTemplate =
    ({ projectId, data }: $TSFixMe) =>
    (dispatch: Dispatch) => {
        const url = `incidentSettings/${projectId}`;

        const promise = BackendAPI.post(url, data);
        dispatch(createIncidentTemplateRequest());
        promise.then(
            function (incidentBasicSettings) {
                dispatch(
                    createIncidentTemplateSuccess(incidentBasicSettings.data)
                );
            },
            function (error) {
                dispatch(createIncidentTemplateFailure(error));
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

export const updateIncidentTemplateFailure = (error: ErrorPayload) => ({
    type: types.UPDATE_INCIDENT_TEMPLATE_FAILURE,
    payload: error,
});

export const updateIncidentTemplate =
    ({ projectId, templateId, data }: $TSFixMe) =>
    (dispatch: Dispatch) => {
        const url = `incidentSettings/${projectId}/${templateId}`;

        const promise = BackendAPI.put(url, data);
        dispatch(updateIncidentTemplateRequest());
        promise.then(
            function (incidentBasicSettings) {
                dispatch(
                    updateIncidentTemplateSuccess(incidentBasicSettings.data)
                );
            },
            function (error) {
                dispatch(updateIncidentTemplateFailure(error));
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

export const deleteIncidentTemplateFailure = (error: ErrorPayload) => ({
    type: types.DELETE_INCIDENT_TEMPLATE_FAILURE,
    payload: error,
});

export const deleteIncidentTemplate =
    ({ projectId, templateId }: $TSFixMe) =>
    (dispatch: Dispatch) => {
        const url = `incidentSettings/${projectId}/${templateId}`;

        const promise = BackendAPI.delete(url);
        dispatch(deleteIncidentTemplateRequest());
        promise.then(
            function (incidentBasicSettings) {
                dispatch(
                    deleteIncidentTemplateSuccess(incidentBasicSettings.data)
                );
            },
            function (error) {
                dispatch(deleteIncidentTemplateFailure(error));
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

export const setDefaultTemplateFailure = (error: ErrorPayload) => ({
    type: types.SET_DEFAULT_INCIDENT_TEMPLATE_FAILURE,
    payload: error,
});

export const setDefaultTemplate =
    ({ projectId, templateId }: $TSFixMe) =>
    (dispatch: Dispatch) => {
        const url = `incidentSettings/${projectId}/${templateId}/setDefault`;

        const promise = BackendAPI.put(url, {});
        dispatch(setDefaultTemplateRequest());
        promise.then(
            function (incidentBasicSettings) {
                dispatch(setDefaultTemplateSuccess(incidentBasicSettings.data));
            },
            function (error) {
                dispatch(setDefaultTemplateFailure(error));
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

export const fetchDefaultTemplateFailure = (error: ErrorPayload) => ({
    type: types.FETCH_DEFAULT_TEMPLATE_FAILURE,
    payload: error,
});

export const fetchDefaultTemplate =
    ({ projectId }: $TSFixMe) =>
    (dispatch: Dispatch) => {
        const url = `incidentSettings/${projectId}/default`;

        const promise = BackendAPI.get(url);
        dispatch(fetchDefaultTemplateRequest());
        promise.then(
            function (incidentBasicSettings) {
                dispatch(
                    fetchDefaultTemplateSuccess(incidentBasicSettings.data)
                );
            },
            function (error) {
                dispatch(fetchDefaultTemplateFailure(error));
            }
        );

        return promise;
    };
