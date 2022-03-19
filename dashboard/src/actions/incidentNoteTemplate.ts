import * as types from '../constants/incidentNoteTemplate';
import { getApi, putApi, postApi, deleteApi } from '../api';

// CREATE INCIDENT NOTE TEMPLATE
export const createIncidentNoteTemplateRequest = () => ({
    type: types.CREATE_INCIDENT_NOTE_TEMPLATE_REQUEST,
});

export const createIncidentNoteTemplateSuccess = (payload: $TSFixMe) => ({
    type: types.CREATE_INCIDENT_NOTE_TEMPLATE_SUCCESS,
    payload,
});

export const createIncidentNoteTemplateFailure = (error: $TSFixMe) => ({
    type: types.CREATE_INCIDENT_NOTE_TEMPLATE_FAILURE,
    payload: error,
});

export const createIncidentNoteTemplate =
    ({ projectId, data }: $TSFixMe) =>
    (dispatch: $TSFixMe) => {
        dispatch(createIncidentNoteTemplateRequest());
        const promise = postApi(`incidentNoteTemplate/${projectId}`, data);

        promise.then(
            function (response) {
                dispatch(createIncidentNoteTemplateSuccess(response.data));
            },
            function (error) {
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

export const fetchIncidentNoteTemplatesFailure = (error: $TSFixMe) => ({
    type: types.FETCH_INCIDENT_NOTE_TEMPLATES_FAILURE,
    payload: error,
});

export const fetchIncidentNoteTemplates =
    ({ projectId, skip = 0, limit = 0 }: $TSFixMe) =>
    (dispatch: $TSFixMe) => {
        dispatch(fetchIncidentNoteTemplatesRequest());
        const promise = getApi(
            `incidentNoteTemplate/${projectId}?skip=${skip}&limit=${limit}`
        );

        promise.then(
            function (response) {
                dispatch(fetchIncidentNoteTemplatesSuccess(response.data));
            },
            function (error) {
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

export const updateIncidentNoteTemplateFailure = (error: $TSFixMe) => ({
    type: types.UPDATE_INCIDENT_NOTE_TEMPLATE_FAILURE,
    payload: error,
});

export const updateIncidentNoteTemplate =
    ({ projectId, templateId, data }: $TSFixMe) =>
    (dispatch: $TSFixMe) => {
        dispatch(updateIncidentNoteTemplateRequest());
        const promise = putApi(
            `incidentNoteTemplate/${projectId}/${templateId}`,
            data
        );

        promise.then(
            function (response) {
                dispatch(updateIncidentNoteTemplateSuccess(response.data));
            },
            function (error) {
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

export const deleteIncidentNoteTemplateFailure = (error: $TSFixMe) => ({
    type: types.DELETE_INCIDENT_NOTE_TEMPLATE_FAILURE,
    payload: error,
});

export const deleteIncidentNoteTemplate =
    ({ projectId, templateId }: $TSFixMe) =>
    (dispatch: $TSFixMe) => {
        dispatch(deleteIncidentNoteTemplateRequest());

        const promise = deleteApi(
            `incidentNoteTemplate/${projectId}/${templateId}`
        );

        promise.then(
            function (response) {
                dispatch(deleteIncidentNoteTemplateSuccess(response.data));
            },
            function (error) {
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
