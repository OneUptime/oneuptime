import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ObjectID from 'Common/Types/ObjectID';
import * as types from '../constants/emailTemplates';
import ErrorPayload from 'CommonUI/src/PayloadTypes/error';
//Array of email templates

export const emailTemplatesRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.EMAIL_TEMPLATES_REQUEST,
        payload: promise,
    };
};

export const emailTemplatesError: Function = (error: ErrorPayload): void => {
    return {
        type: types.EMAIL_TEMPLATES_FAILED,
        payload: error,
    };
};

export const emailTemplatesSuccess: Function = (incidents: $TSFixMe): void => {
    return {
        type: types.EMAIL_TEMPLATES_SUCCESS,
        payload: incidents,
    };
};

export const emailTemplatesReset: Function = (): void => {
    return {
        type: types.EMAIL_TEMPLATES_RESET,
    };
};

// Calls the API to get email templates
export const getEmailTemplates: Function = (projectId: ObjectID): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(`emailTemplate/${projectId}`);
        dispatch(emailTemplatesRequest(promise));

        promise.then(
            (emails: $TSFixMe): void => {
                dispatch(emailTemplatesSuccess(emails.data));
            },
            (error: $TSFixMe): void => {
                dispatch(emailTemplatesError(error));
            }
        );
    };
};

// Edit email templates
export const editEmailTemplateReset: Function = (): void => {
    return {
        type: types.EDIT_EMAIL_TEMPLATES_RESET,
    };
};

export const editEmailTemplateRequest: Function = (): void => {
    return {
        type: types.EDIT_EMAIL_TEMPLATES_REQUEST,
        payload: true,
    };
};

export const editEmailTemplateSuccess: Function = (
    emailTemplates: $TSFixMe
): void => {
    return {
        type: types.EDIT_EMAIL_TEMPLATES_SUCCESS,
        payload: emailTemplates,
    };
};

export const editEmailTemplateError: Function = (error: ErrorPayload): void => {
    return {
        type: types.EDIT_EMAIL_TEMPLATES_FAILED,
        payload: error,
    };
};

export const editEmailTemplates: Function = (
    projectId: ObjectID,
    data: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.put(
            `emailTemplate/${projectId}`,
            data
        );
        dispatch(editEmailTemplateRequest());

        promise.then(
            (emailTemplate: $TSFixMe): void => {
                dispatch(editEmailTemplateSuccess(emailTemplate.data));
            },
            (error: Error) => {
                dispatch(editEmailTemplateError(error));
            }
        );
    };
};

//Array of email templates

export const resetEmailTemplatesRequest: Function = (
    promise: $TSFixMe
): void => {
    return {
        type: types.RESET_EMAIL_TEMPLATES_REQUEST,
        payload: promise,
    };
};

export const resetEmailTemplatesError: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.RESET_EMAIL_TEMPLATES_FAILED,
        payload: error,
    };
};

export const resetEmailTemplatesSuccess: Function = (
    emailTemplates: $TSFixMe
): void => {
    return {
        type: types.RESET_EMAIL_TEMPLATES_SUCCESS,
        payload: emailTemplates,
    };
};

// Calls the API to reset email templates
export const resetEmailTemplates: Function = (
    projectId: ObjectID,
    templateId: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `emailTemplate/${projectId}/${templateId}/reset`
        );
        dispatch(resetEmailTemplatesRequest(promise));

        promise.then(
            (emails: $TSFixMe): void => {
                dispatch(resetEmailTemplatesSuccess(emails.data));
            },
            (error: $TSFixMe): void => {
                dispatch(resetEmailTemplatesError(error));
            }
        );
    };
};

export const smtpConfigRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.SMTP_CONFIG_REQUEST,
        payload: promise,
    };
};

export const smtpConfigError: Function = (error: ErrorPayload): void => {
    return {
        type: types.SMTP_CONFIG_FAILED,
        payload: error,
    };
};

export const smtpConfigSuccess: Function = (config: $TSFixMe): void => {
    return {
        type: types.SMTP_CONFIG_SUCCESS,
        payload: config,
    };
};

// Calls the API to reset email templates
export const getSmtpConfig: Function = (projectId: ObjectID): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(`emailSmtp/${projectId}`);
        dispatch(smtpConfigRequest(promise));

        promise.then(
            (data: $TSFixMe): void => {
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
            (error: $TSFixMe): void => {
                dispatch(smtpConfigError(error));
            }
        );
    };
};

export const postSmtpConfig: Function = (
    projectId: ObjectID,
    data: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            `emailSmtp/${projectId}`,
            data
        );
        dispatch(smtpConfigRequest(promise));

        promise.then(
            (data: $TSFixMe): void => {
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
            (error: $TSFixMe): void => {
                dispatch(smtpConfigError(error));
            }
        );
    };
};

export const deleteSmtpConfigRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.DELETE_SMTP_CONFIG_REQUEST,
        payload: promise,
    };
};

export const deleteSmtpConfigError: Function = (error: ErrorPayload): void => {
    return {
        type: types.DELETE_SMTP_CONFIG_FAILED,
        payload: error,
    };
};

export const deleteSmtpConfigSuccess: Function = (config: $TSFixMe): void => {
    return {
        type: types.DELETE_SMTP_CONFIG_SUCCESS,
        payload: config,
    };
};

export function deleteSmtpConfig(
    projectId: ObjectID,
    smtpId: $TSFixMe,
    data: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = delete (`emailSmtp/${projectId}/${smtpId}`,
        data);
        dispatch(deleteSmtpConfigRequest(promise));

        promise.then(
            (data: $TSFixMe): void => {
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
            (error: $TSFixMe): void => {
                dispatch(deleteSmtpConfigError(error));
            }
        );
    };
}

export function updateSmtpConfig(
    projectId: ObjectID,
    smtpId: $TSFixMe,
    data: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.put(
            `emailSmtp/${projectId}/${smtpId}`,
            data
        );
        dispatch(smtpConfigRequest(promise));

        promise.then(
            (data: $TSFixMe): void => {
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
            (error: $TSFixMe): void => {
                dispatch(smtpConfigError(error));
            }
        );
    };
}

export const changeShowingTemplate: Function = (
    emailTemplate: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: types.CHANGE_SHOWING_TEMPLATE,
            payload: emailTemplate,
        });
    };
};

export const setRevealVariable: Function = (emailtype: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: types.SET_REVEAL_VARIABLE,
            payload: emailtype,
        });
    };
};

export const setSmtpConfig: Function = (val: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: types.SET_SMTP_CONFIG,
            payload: val,
        });
    };
};
