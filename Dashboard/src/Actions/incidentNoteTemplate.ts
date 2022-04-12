import * as types from '../constants/incidentNoteTemplate';
import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ErrorPayload from 'CommonUI/src/payload-types/error';
// CREATE INCIDENT NOTE TEMPLATE
export const createIncidentNoteTemplateRequest = () => ({
    type: types.CREATE_INCIDENT_NOTE_TEMPLATE_REQUEST,
});

export const createIncidentNoteTemplateSuccess = (payload: $TSFixMe) => ({
    type: types.CREATE_INCIDENT_NOTE_TEMPLATE_SUCCESS,
    payload,
});

export const createIncidentNoteTemplateFailure = (error: ErrorPayload) => ({
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
            function (response): void {
                dispatch(createIncidentNoteTemplateSuccess(response.data));
            },
            function (error): void {
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
export const fetchIncidentNoteTemplatesRequest = () => ({
    type: types.FETCH_INCIDENT_NOTE_TEMPLATES_REQUEST,
});

export const fetchIncidentNoteTemplatesSuccess = (payload: $TSFixMe) => ({
    type: types.FETCH_INCIDENT_NOTE_TEMPLATES_SUCCESS,
    payload,
});

export const fetchIncidentNoteTemplatesFailure = (error: ErrorPayload) => ({
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
            function (response): void {
                dispatch(fetchIncidentNoteTemplatesSuccess(response.data));
            },
            function (error): void {
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
export const updateIncidentNoteTemplateRequest = () => ({
    type: types.UPDATE_INCIDENT_NOTE_TEMPLATE_REQUEST,
});

export const updateIncidentNoteTemplateSuccess = (payload: $TSFixMe) => ({
    type: types.UPDATE_INCIDENT_NOTE_TEMPLATE_SUCCESS,
    payload,
});

export const updateIncidentNoteTemplateFailure = (error: ErrorPayload) => ({
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
            function (response): void {
                dispatch(updateIncidentNoteTemplateSuccess(response.data));
            },
            function (error): void {
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
export const deleteIncidentNoteTemplateRequest = () => ({
    type: types.DELETE_INCIDENT_NOTE_TEMPLATE_REQUEST,
});

export const deleteIncidentNoteTemplateSuccess = (payload: $TSFixMe) => ({
    type: types.DELETE_INCIDENT_NOTE_TEMPLATE_SUCCESS,
    payload,
});

export const deleteIncidentNoteTemplateFailure = (error: ErrorPayload) => ({
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
            function (response): void {
                dispatch(deleteIncidentNoteTemplateSuccess(response.data));
            },
            function (error): void {
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
