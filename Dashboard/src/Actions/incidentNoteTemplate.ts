import * as types from '../constants/incidentNoteTemplate';
import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ErrorPayload from 'CommonUI/src/payload-types/error';
// CREATE INCIDENT NOTE TEMPLATE
export const createIncidentNoteTemplateRequest: Function = (): void => ({
    type: types.CREATE_INCIDENT_NOTE_TEMPLATE_REQUEST,
});

export const createIncidentNoteTemplateSuccess: Function = (
    payload: $TSFixMe
): void => ({
    type: types.CREATE_INCIDENT_NOTE_TEMPLATE_SUCCESS,
    payload,
});

export const createIncidentNoteTemplateFailure: Function = (
    error: ErrorPayload
): void => ({
    type: types.CREATE_INCIDENT_NOTE_TEMPLATE_FAILURE,
    payload: error,
});

export const createIncidentNoteTemplate =
    ({ projectId, data }: $TSFixMe) =>
    (dispatch: Dispatch) => {
        dispatch(createIncidentNoteTemplateRequest());
        const promise = BackendAPI.post(
            `incidentNoteTemplate/${projectId}`,
            data
        );

        promise.then(
            (response): void => {
                dispatch(createIncidentNoteTemplateSuccess(response.data));
            },
            (error): void => {
                const errorMsg =
                    error.response && error.response.data
                        ? error.response.data
                        : error.data
                        ? error.data
                        : error.message
                        ? error.message
                        : 'Network Error';
                dispatch(createIncidentNoteTemplateFailure(errorMsg));
            }
        );

        return promise;
    };

// FETCH INCIDENT NOTE TEMPLATE
export const fetchIncidentNoteTemplatesRequest: Function = (): void => ({
    type: types.FETCH_INCIDENT_NOTE_TEMPLATES_REQUEST,
});

export const fetchIncidentNoteTemplatesSuccess: Function = (
    payload: $TSFixMe
): void => ({
    type: types.FETCH_INCIDENT_NOTE_TEMPLATES_SUCCESS,
    payload,
});

export const fetchIncidentNoteTemplatesFailure: Function = (
    error: ErrorPayload
): void => ({
    type: types.FETCH_INCIDENT_NOTE_TEMPLATES_FAILURE,
    payload: error,
});

export const fetchIncidentNoteTemplates =
    ({ projectId, skip = 0, limit = 0 }: $TSFixMe) =>
    (dispatch: Dispatch) => {
        dispatch(fetchIncidentNoteTemplatesRequest());
        const promise = BackendAPI.get(
            `incidentNoteTemplate/${projectId}?skip=${skip}&limit=${limit}`
        );

        promise.then(
            (response): void => {
                dispatch(fetchIncidentNoteTemplatesSuccess(response.data));
            },
            (error): void => {
                const errorMsg =
                    error.response && error.response.data
                        ? error.response.data
                        : error.data
                        ? error.data
                        : error.message
                        ? error.message
                        : 'Network Error';
                dispatch(fetchIncidentNoteTemplatesFailure(errorMsg));
            }
        );

        return promise;
    };

// UPDATE INCIDENT NOTE TEMPLATE
export const updateIncidentNoteTemplateRequest: Function = (): void => ({
    type: types.UPDATE_INCIDENT_NOTE_TEMPLATE_REQUEST,
});

export const updateIncidentNoteTemplateSuccess: Function = (
    payload: $TSFixMe
): void => ({
    type: types.UPDATE_INCIDENT_NOTE_TEMPLATE_SUCCESS,
    payload,
});

export const updateIncidentNoteTemplateFailure: Function = (
    error: ErrorPayload
): void => ({
    type: types.UPDATE_INCIDENT_NOTE_TEMPLATE_FAILURE,
    payload: error,
});

export const updateIncidentNoteTemplate =
    ({ projectId, templateId, data }: $TSFixMe) =>
    (dispatch: Dispatch) => {
        dispatch(updateIncidentNoteTemplateRequest());
        const promise = BackendAPI.put(
            `incidentNoteTemplate/${projectId}/${templateId}`,
            data
        );

        promise.then(
            (response): void => {
                dispatch(updateIncidentNoteTemplateSuccess(response.data));
            },
            (error): void => {
                const errorMsg =
                    error.response && error.response.data
                        ? error.response.data
                        : error.data
                        ? error.data
                        : error.message
                        ? error.message
                        : 'Network Error';
                dispatch(updateIncidentNoteTemplateFailure(errorMsg));
            }
        );

        return promise;
    };

// DELETE INCIDENT NOTE TEMPLATE
export const deleteIncidentNoteTemplateRequest: Function = (): void => ({
    type: types.DELETE_INCIDENT_NOTE_TEMPLATE_REQUEST,
});

export const deleteIncidentNoteTemplateSuccess: Function = (
    payload: $TSFixMe
): void => ({
    type: types.DELETE_INCIDENT_NOTE_TEMPLATE_SUCCESS,
    payload,
});

export const deleteIncidentNoteTemplateFailure: Function = (
    error: ErrorPayload
): void => ({
    type: types.DELETE_INCIDENT_NOTE_TEMPLATE_FAILURE,
    payload: error,
});

export const deleteIncidentNoteTemplate =
    ({ projectId, templateId }: $TSFixMe) =>
    (dispatch: Dispatch) => {
        dispatch(deleteIncidentNoteTemplateRequest());

        const promise =
            delete `incidentNoteTemplate/${projectId}/${templateId}`;

        promise.then(
            (response): void => {
                dispatch(deleteIncidentNoteTemplateSuccess(response.data));
            },
            (error): void => {
                const errorMsg =
                    error.response && error.response.data
                        ? error.response.data
                        : error.data
                        ? error.data
                        : error.message
                        ? error.message
                        : 'Network Error';
                dispatch(deleteIncidentNoteTemplateFailure(errorMsg));
            }
        );

        return promise;
    };
