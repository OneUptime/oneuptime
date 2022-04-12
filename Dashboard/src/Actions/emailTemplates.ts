import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/emailTemplates';
import ErrorPayload from 'CommonUI/src/payload-types/error';
//Array of email templates

export const emailTemplatesRequest = (promise: $TSFixMe): void => {
    return {
        type: types.EMAIL_TEMPLATES_REQUEST,
        payload: promise,
    };
};

export const emailTemplatesError = (error: ErrorPayload): void => {
    return {
        type: types.EMAIL_TEMPLATES_FAILED,
        payload: error,
    };
};

export const emailTemplatesSuccess = (incidents: $TSFixMe): void => {
    return {
        type: types.EMAIL_TEMPLATES_SUCCESS,
        payload: incidents,
    };
};

export const emailTemplatesReset = (): void => {
    return {
        type: types.EMAIL_TEMPLATES_RESET,
    };
};

// Calls the API to get email templates
export const getEmailTemplates = (projectId: string): void => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(`emailTemplate/${projectId}`);
        dispatch(emailTemplatesRequest(promise));

        promise.then(
            function (emails) {
                dispatch(emailTemplatesSuccess(emails.data));
            },
            function (error) {
                dispatch(emailTemplatesError(error));
            }
        );
    };
};

// Edit email templates
export const editEmailTemplateReset = (): void => {
    return {
        type: types.EDIT_EMAIL_TEMPLATES_RESET,
    };
};

export const editEmailTemplateRequest = (): void => {
    return {
        type: types.EDIT_EMAIL_TEMPLATES_REQUEST,
        payload: true,
    };
};

export const editEmailTemplateSuccess = (emailTemplates: $TSFixMe): void => {
    return {
        type: types.EDIT_EMAIL_TEMPLATES_SUCCESS,
        payload: emailTemplates,
    };
};

export const editEmailTemplateError = (error: ErrorPayload): void => {
    return {
        type: types.EDIT_EMAIL_TEMPLATES_FAILED,
        payload: error,
    };
};

export const editEmailTemplates = (projectId: string, data: $TSFixMe): void => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.put(`emailTemplate/${projectId}`, data);
        dispatch(editEmailTemplateRequest());

        promise.then(
            function (emailTemplate) {
                dispatch(editEmailTemplateSuccess(emailTemplate.data));
            },
            error => {
                dispatch(editEmailTemplateError(error));
            }
        );
    };
};

//Array of email templates

export const resetEmailTemplatesRequest = (promise: $TSFixMe): void => {
    return {
        type: types.RESET_EMAIL_TEMPLATES_REQUEST,
        payload: promise,
    };
};

export const resetEmailTemplatesError = (error: ErrorPayload): void => {
    return {
        type: types.RESET_EMAIL_TEMPLATES_FAILED,
        payload: error,
    };
};

export const resetEmailTemplatesSuccess = (emailTemplates: $TSFixMe): void => {
    return {
        type: types.RESET_EMAIL_TEMPLATES_SUCCESS,
        payload: emailTemplates,
    };
};

// Calls the API to reset email templates
export const resetEmailTemplates = (
    projectId: string,
    templateId: $TSFixMe
) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(
            `emailTemplate/${projectId}/${templateId}/reset`
        );
        dispatch(resetEmailTemplatesRequest(promise));

        promise.then(
            function (emails) {
                dispatch(resetEmailTemplatesSuccess(emails.data));
            },
            function (error) {
                dispatch(resetEmailTemplatesError(error));
            }
        );
    };
};

export const smtpConfigRequest = (promise: $TSFixMe): void => {
    return {
        type: types.SMTP_CONFIG_REQUEST,
        payload: promise,
    };
};

export const smtpConfigError = (error: ErrorPayload): void => {
    return {
        type: types.SMTP_CONFIG_FAILED,
        payload: error,
    };
};

export const smtpConfigSuccess = (config: $TSFixMe): void => {
    return {
        type: types.SMTP_CONFIG_SUCCESS,
        payload: config,
    };
};

// Calls the API to reset email templates
export const getSmtpConfig = (projectId: string): void => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(`emailSmtp/${projectId}`);
        dispatch(smtpConfigRequest(promise));

        promise.then(
            function (data) {
                if (data.data && data.data.enabled) {
                    dispatch({
                        type: types.SET_SMTP_CONFIG,
                        payload: true,
                    });
                } else {
                    dispatch({
                        type: types.SET_SMTP_CONFIG,
                        payload: false,
                    });
                }

                dispatch(smtpConfigSuccess(data.data));
            },
            function (error) {
                dispatch(smtpConfigError(error));
            }
        );
    };
};

export const postSmtpConfig = (projectId: string, data: $TSFixMe): void => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.post(`emailSmtp/${projectId}`, data);
        dispatch(smtpConfigRequest(promise));

        promise.then(
            function (data) {
                dispatch(smtpConfigSuccess(data.data));

                if (data.data && data.data.enabled) {
                    dispatch({
                        type: types.SET_SMTP_CONFIG,
                        payload: true,
                    });
                } else {
                    dispatch({
                        type: types.SET_SMTP_CONFIG,
                        payload: false,
                    });
                }
            },
            function (error) {
                dispatch(smtpConfigError(error));
            }
        );
    };
};

export const deleteSmtpConfigRequest = (promise: $TSFixMe): void => {
    return {
        type: types.DELETE_SMTP_CONFIG_REQUEST,
        payload: promise,
    };
};

export const deleteSmtpConfigError = (error: ErrorPayload): void => {
    return {
        type: types.DELETE_SMTP_CONFIG_FAILED,
        payload: error,
    };
};

export const deleteSmtpConfigSuccess = (config: $TSFixMe): void => {
    return {
        type: types.DELETE_SMTP_CONFIG_SUCCESS,
        payload: config,
    };
};

export function deleteSmtpConfig(
    projectId: string,
    smtpId: $TSFixMe,
    data: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise = delete (`emailSmtp/${projectId}/${smtpId}`, data);
        dispatch(deleteSmtpConfigRequest(promise));

        promise.then(
            function (data) {
                dispatch(deleteSmtpConfigSuccess(data.data));

                if (data.data && data.data.enabled) {
                    dispatch({
                        type: types.SET_SMTP_CONFIG,
                        payload: true,
                    });
                } else {
                    dispatch({
                        type: types.SET_SMTP_CONFIG,
                        payload: false,
                    });
                }
            },
            function (error) {
                dispatch(deleteSmtpConfigError(error));
            }
        );
    };
}

export function updateSmtpConfig(
    projectId: string,
    smtpId: $TSFixMe,
    data: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.put(
            `emailSmtp/${projectId}/${smtpId}`,
            data
        );
        dispatch(smtpConfigRequest(promise));

        promise.then(
            function (data) {
                dispatch(smtpConfigSuccess(data.data));

                if (data.data && data.data.enabled) {
                    dispatch({
                        type: types.SET_SMTP_CONFIG,
                        payload: true,
                    });
                } else {
                    dispatch({
                        type: types.SET_SMTP_CONFIG,
                        payload: false,
                    });
                }
            },
            function (error) {
                dispatch(smtpConfigError(error));
            }
        );
    };
}

export const changeShowingTemplate = (emailTemplate: $TSFixMe): void => {
    return function (dispatch: Dispatch) {
        dispatch({
            type: types.CHANGE_SHOWING_TEMPLATE,
            payload: emailTemplate,
        });
    };
};

export const setRevealVariable = (emailtype: $TSFixMe): void => {
    return function (dispatch: Dispatch) {
        dispatch({
            type: types.SET_REVEAL_VARIABLE,
            payload: emailtype,
        });
    };
};

export const setSmtpConfig = (val: $TSFixMe): void => {
    return function (dispatch: Dispatch) {
        dispatch({
            type: types.SET_SMTP_CONFIG,
            payload: val,
        });
    };
};
