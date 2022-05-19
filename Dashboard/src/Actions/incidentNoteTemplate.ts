import * as types from '../constants/incidentNoteTemplate';
import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ErrorPayload from 'CommonUI/src/PayloadTypes/error';
// CREATE INCIDENT NOTE TEMPLATE
export const createIncidentNoteTemplateRequest: Function = (): void => {
    return {
        type: types.CREATE_INCIDENT_NOTE_TEMPLATE_REQUEST,
    };
};

export const createIncidentNoteTemplateSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.CREATE_INCIDENT_NOTE_TEMPLATE_SUCCESS,
        payload,
    };
};

export const createIncidentNoteTemplateFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.CREATE_INCIDENT_NOTE_TEMPLATE_FAILURE,
        payload: error,
    };
};

export const createIncidentNoteTemplate: $TSFixMe = ({
    projectId,
    data,
}: $TSFixMe) => {
    return (dispatch: Dispatch) => {
        dispatch(createIncidentNoteTemplateRequest());
        const promise: $TSFixMe = BackendAPI.post(
            `incidentNoteTemplate/${projectId}`,
            data
        );

        promise.then(
            (response: $TSFixMe): void => {
                dispatch(createIncidentNoteTemplateSuccess(response.data));
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
                dispatch(createIncidentNoteTemplateFailure(errorMsg));
            }
        );

        return promise;
    };
};

// FETCH INCIDENT NOTE TEMPLATE
export const fetchIncidentNoteTemplatesRequest: Function = (): void => {
    return {
        type: types.FETCH_INCIDENT_NOTE_TEMPLATES_REQUEST,
    };
};

export const fetchIncidentNoteTemplatesSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.FETCH_INCIDENT_NOTE_TEMPLATES_SUCCESS,
        payload,
    };
};

export const fetchIncidentNoteTemplatesFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_INCIDENT_NOTE_TEMPLATES_FAILURE,
        payload: error,
    };
};

export const fetchIncidentNoteTemplates: $TSFixMe = ({
    projectId,
    skip = 0,
    limit = 0,
}: $TSFixMe) => {
    return (dispatch: Dispatch) => {
        dispatch(fetchIncidentNoteTemplatesRequest());
        const promise: $TSFixMe = BackendAPI.get(
            `incidentNoteTemplate/${projectId}?skip=${skip}&limit=${limit}`
        );

        promise.then(
            (response: $TSFixMe): void => {
                dispatch(fetchIncidentNoteTemplatesSuccess(response.data));
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
                dispatch(fetchIncidentNoteTemplatesFailure(errorMsg));
            }
        );

        return promise;
    };
};

// UPDATE INCIDENT NOTE TEMPLATE
export const updateIncidentNoteTemplateRequest: Function = (): void => {
    return {
        type: types.UPDATE_INCIDENT_NOTE_TEMPLATE_REQUEST,
    };
};

export const updateIncidentNoteTemplateSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.UPDATE_INCIDENT_NOTE_TEMPLATE_SUCCESS,
        payload,
    };
};

export const updateIncidentNoteTemplateFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.UPDATE_INCIDENT_NOTE_TEMPLATE_FAILURE,
        payload: error,
    };
};

export const updateIncidentNoteTemplate: $TSFixMe = ({
    projectId,
    templateId,
    data,
}: $TSFixMe) => {
    return (dispatch: Dispatch) => {
        dispatch(updateIncidentNoteTemplateRequest());
        const promise: $TSFixMe = BackendAPI.put(
            `incidentNoteTemplate/${projectId}/${templateId}`,
            data
        );

        promise.then(
            (response: $TSFixMe): void => {
                dispatch(updateIncidentNoteTemplateSuccess(response.data));
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
                dispatch(updateIncidentNoteTemplateFailure(errorMsg));
            }
        );

        return promise;
    };
};

// DELETE INCIDENT NOTE TEMPLATE
export const deleteIncidentNoteTemplateRequest: Function = (): void => {
    return {
        type: types.DELETE_INCIDENT_NOTE_TEMPLATE_REQUEST,
    };
};

export const deleteIncidentNoteTemplateSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.DELETE_INCIDENT_NOTE_TEMPLATE_SUCCESS,
        payload,
    };
};

export const deleteIncidentNoteTemplateFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.DELETE_INCIDENT_NOTE_TEMPLATE_FAILURE,
        payload: error,
    };
};

export const deleteIncidentNoteTemplate: $TSFixMe = ({
    projectId,
    templateId,
}: $TSFixMe) => {
    return (dispatch: Dispatch) => {
        dispatch(deleteIncidentNoteTemplateRequest());

        const promise: $TSFixMe =
            delete `incidentNoteTemplate/${projectId}/${templateId}`;

        promise.then(
            (response: $TSFixMe): void => {
                dispatch(deleteIncidentNoteTemplateSuccess(response.data));
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
                dispatch(deleteIncidentNoteTemplateFailure(errorMsg));
            }
        );

        return promise;
    };
};
