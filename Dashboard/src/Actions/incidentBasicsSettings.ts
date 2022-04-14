import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/incidentBasicSettings';
import ErrorPayload from 'CommonUI/src/payload-types/error';
const fetchBasicIncidentSettingsVariablesRequest: Function = (): void => ({
    type: types.FETCH_INCIDENT_BASIC_SETTINGS_VARIABLES_REQUEST,
});

const fetchBasicIncidentSettingsVariablesSuccess: Function = (
    payload: $TSFixMe
): void => ({
    type: types.FETCH_INCIDENT_BASIC_SETTINGS_VARIABLES_SUCCESS,
    payload,
});

const fetchBasicIncidentSettingsVariablesFailure: Function = (
    payload: $TSFixMe
): void => ({
    type: types.FETCH_INCIDENT_BASIC_SETTINGS_VARIABLES_FAILURE,
    payload,
});

export const fetchBasicIncidentSettingsVariables: Function = (): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(`incidentSettings/variables`);
        dispatch(fetchBasicIncidentSettingsVariablesRequest());
        promise.then(
            (incidentBasicSettings: $TSFixMe): void => {
                dispatch(
                    fetchBasicIncidentSettingsVariablesSuccess(
                        incidentBasicSettings.data
                    )
                );
            },
            (error: $TSFixMe): void => {
                dispatch(fetchBasicIncidentSettingsVariablesFailure(error));
            }
        );
    };
};

export const setRevealIncidentSettingsVariables: $TSFixMe =
    (payload: $TSFixMe) => (dispatch: Dispatch) => {
        dispatch({
            type: types.SET_REVEAL_VARIABLES_INCIDENT_BASIC_SETTINGS,
            payload,
        });
    };

// FETCH ALL TEMPALTES IN A PROJECT
export const fetchIncidentTemplatesRequest: Function = (): void => ({
    type: types.FETCH_INCIDENT_TEMPLATES_REQUEST,
});

export const fetchIncidentTemplatesSuccess: Function = (
    payload: $TSFixMe
): void => ({
    type: types.FETCH_INCIDENT_TEMPLATES_SUCCESS,
    payload,
});

export const fetchIncidentTemplatesFailure: Function = (
    error: ErrorPayload
): void => ({
    type: types.FETCH_INCIDENT_TEMPLATE_FAILURE,
    payload: error,
});

export const fetchIncidentTemplates: $TSFixMe =
    ({ projectId, skip, limit }: $TSFixMe) =>
    (dispatch: Dispatch) => {
        const url: string = `incidentSettings/${projectId}?skip=${skip}&limit=${limit}`;

        const promise: $TSFixMe = BackendAPI.get(url);
        dispatch(fetchIncidentTemplatesRequest());
        promise.then(
            (incidentBasicSettings: $TSFixMe): void => {
                dispatch(
                    fetchIncidentTemplatesSuccess(incidentBasicSettings.data)
                );
            },
            (error: $TSFixMe): void => {
                dispatch(fetchIncidentTemplatesFailure(error));
            }
        );

        return promise;
    };

// CREATE TEMPLATE IN A PROJECT
export const createIncidentTemplateRequest: Function = (): void => ({
    type: types.CREATE_INCIDENT_TEMPLATE_REQUEST,
});

export const createIncidentTemplateSuccess: Function = (
    payload: $TSFixMe
): void => ({
    type: types.CREATE_INCIDENT_TEMPLATE_SUCCESS,
    payload,
});

export const createIncidentTemplateFailure: Function = (
    error: ErrorPayload
): void => ({
    type: types.CREATE_INCIDENT_TEMPLATE_FAILURE,
    payload: error,
});

export const createIncidentTemplate: $TSFixMe =
    ({ projectId, data }: $TSFixMe) =>
    (dispatch: Dispatch) => {
        const url: string = `incidentSettings/${projectId}`;

        const promise: $TSFixMe = BackendAPI.post(url, data);
        dispatch(createIncidentTemplateRequest());
        promise.then(
            (incidentBasicSettings: $TSFixMe): void => {
                dispatch(
                    createIncidentTemplateSuccess(incidentBasicSettings.data)
                );
            },
            (error: $TSFixMe): void => {
                dispatch(createIncidentTemplateFailure(error));
            }
        );

        return promise;
    };

// UPDATE A TEMPLATE IN A PROJECT
export const updateIncidentTemplateRequest: Function = (): void => ({
    type: types.UPDATE_INCIDENT_TEMPLATE_REQUEST,
});

export const updateIncidentTemplateSuccess: Function = (
    payload: $TSFixMe
): void => ({
    type: types.UPDATE_INCIDENT_TEMPALTE_SUCCESS,
    payload,
});

export const updateIncidentTemplateFailure: Function = (
    error: ErrorPayload
): void => ({
    type: types.UPDATE_INCIDENT_TEMPLATE_FAILURE,
    payload: error,
});

export const updateIncidentTemplate: $TSFixMe =
    ({ projectId, templateId, data }: $TSFixMe) =>
    (dispatch: Dispatch) => {
        const url: string = `incidentSettings/${projectId}/${templateId}`;

        const promise: $TSFixMe = BackendAPI.put(url, data);
        dispatch(updateIncidentTemplateRequest());
        promise.then(
            (incidentBasicSettings: $TSFixMe): void => {
                dispatch(
                    updateIncidentTemplateSuccess(incidentBasicSettings.data)
                );
            },
            (error: $TSFixMe): void => {
                dispatch(updateIncidentTemplateFailure(error));
            }
        );

        return promise;
    };

// DELETE A TEMPLATE IN A PROJECT
export const deleteIncidentTemplateRequest: Function = (): void => ({
    type: types.DELETE_INCIDENT_TEMPLATE_REQUEST,
});

export const deleteIncidentTemplateSuccess: Function = (
    payload: $TSFixMe
): void => ({
    type: types.DELETE_INCIDENT_TEMPLATE_SUCCESS,
    payload,
});

export const deleteIncidentTemplateFailure: Function = (
    error: ErrorPayload
): void => ({
    type: types.DELETE_INCIDENT_TEMPLATE_FAILURE,
    payload: error,
});

export const deleteIncidentTemplate: $TSFixMe =
    ({ projectId, templateId }: $TSFixMe) =>
    (dispatch: Dispatch) => {
        const url: string = `incidentSettings/${projectId}/${templateId}`;

        const promise: $TSFixMe = BackendAPI.delete(url);
        dispatch(deleteIncidentTemplateRequest());
        promise.then(
            (incidentBasicSettings: $TSFixMe): void => {
                dispatch(
                    deleteIncidentTemplateSuccess(incidentBasicSettings.data)
                );
            },
            (error: $TSFixMe): void => {
                dispatch(deleteIncidentTemplateFailure(error));
            }
        );

        return promise;
    };

// SET DEFAULT INCIDENT TEMPLATE
export const setDefaultTemplateRequest: Function = (): void => ({
    type: types.SET_DEFAULT_INCIDENT_TEMPLATE_REQUEST,
});

export const setDefaultTemplateSuccess: Function = (
    payload: $TSFixMe
): void => ({
    type: types.SET_DEFAULT_INCIDENT_TEMPLATE_SUCCESS,
    payload,
});

export const setDefaultTemplateFailure: Function = (
    error: ErrorPayload
): void => ({
    type: types.SET_DEFAULT_INCIDENT_TEMPLATE_FAILURE,
    payload: error,
});

export const setDefaultTemplate: $TSFixMe =
    ({ projectId, templateId }: $TSFixMe) =>
    (dispatch: Dispatch) => {
        const url: string = `incidentSettings/${projectId}/${templateId}/setDefault`;

        const promise: $TSFixMe = BackendAPI.put(url, {});
        dispatch(setDefaultTemplateRequest());
        promise.then(
            (incidentBasicSettings: $TSFixMe): void => {
                dispatch(setDefaultTemplateSuccess(incidentBasicSettings.data));
            },
            (error: $TSFixMe): void => {
                dispatch(setDefaultTemplateFailure(error));
            }
        );

        return promise;
    };

// SET ACTIVE TEMPLATE
export const setActiveTemplate: Function = (id: $TSFixMe): void => ({
    type: types.SET_ACTIVE_TEMPLATE,
    payload: id,
});

// FETCH DEFAULT INCIDENT TEMPLATE
export const fetchDefaultTemplateRequest: Function = (): void => ({
    type: types.FETCH_DEFAULT_TEMPLATE_REQUEST,
});

export const fetchDefaultTemplateSuccess: Function = (
    payload: $TSFixMe
): void => ({
    type: types.FETCH_DEFAULT_TEMPLATE_SUCCESS,
    payload,
});

export const fetchDefaultTemplateFailure: Function = (
    error: ErrorPayload
): void => ({
    type: types.FETCH_DEFAULT_TEMPLATE_FAILURE,
    payload: error,
});

export const fetchDefaultTemplate: $TSFixMe =
    ({ projectId }: $TSFixMe) =>
    (dispatch: Dispatch) => {
        const url: string = `incidentSettings/${projectId}/default`;

        const promise: $TSFixMe = BackendAPI.get(url);
        dispatch(fetchDefaultTemplateRequest());
        promise.then(
            (incidentBasicSettings: $TSFixMe): void => {
                dispatch(
                    fetchDefaultTemplateSuccess(incidentBasicSettings.data)
                );
            },
            (error: $TSFixMe): void => {
                dispatch(fetchDefaultTemplateFailure(error));
            }
        );

        return promise;
    };
