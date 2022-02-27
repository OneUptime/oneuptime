import { getApi, putApi, postApi, deleteApi } from '../api';
import * as types from '../constants/emailTemplates';
import errors from '../errors';

//Array of email templates

export function emailTemplatesRequest(promise: $TSFixMe) {
    return {
        type: types.EMAIL_TEMPLATES_REQUEST,
        payload: promise,
    };
}

export function emailTemplatesError(error: $TSFixMe) {
    return {
        type: types.EMAIL_TEMPLATES_FAILED,
        payload: error,
    };
}

export function emailTemplatesSuccess(incidents: $TSFixMe) {
    return {
        type: types.EMAIL_TEMPLATES_SUCCESS,
        payload: incidents,
    };
}

export const emailTemplatesReset = () => {
    return {
        type: types.EMAIL_TEMPLATES_RESET,
    };
};

// Calls the API to get email templates
export function getEmailTemplates(projectId: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = getApi(`emailTemplate/${projectId}`);
        dispatch(emailTemplatesRequest(promise));

        promise.then(
            function(emails) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(emailTemplatesSuccess(emails.data));
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
                dispatch(emailTemplatesError(errors(error)));
            }
        );
    };
}

// Edit email templates
export function editEmailTemplateReset() {
    return {
        type: types.EDIT_EMAIL_TEMPLATES_RESET,
    };
}

export function editEmailTemplateRequest() {
    return {
        type: types.EDIT_EMAIL_TEMPLATES_REQUEST,
        payload: true,
    };
}

export function editEmailTemplateSuccess(emailTemplates: $TSFixMe) {
    return {
        type: types.EDIT_EMAIL_TEMPLATES_SUCCESS,
        payload: emailTemplates,
    };
}

export function editEmailTemplateError(error: $TSFixMe) {
    return {
        type: types.EDIT_EMAIL_TEMPLATES_FAILED,
        payload: error,
    };
}

export function editEmailTemplates(projectId: $TSFixMe, data: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = putApi(`emailTemplate/${projectId}`, data);
        dispatch(editEmailTemplateRequest());

        promise.then(
            function(emailTemplate) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(editEmailTemplateSuccess(emailTemplate.data));
            },
            error => {
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
                dispatch(editEmailTemplateError(errors(error)));
            }
        );
    };
}

//Array of email templates

export function resetEmailTemplatesRequest(promise: $TSFixMe) {
    return {
        type: types.RESET_EMAIL_TEMPLATES_REQUEST,
        payload: promise,
    };
}

export function resetEmailTemplatesError(error: $TSFixMe) {
    return {
        type: types.RESET_EMAIL_TEMPLATES_FAILED,
        payload: error,
    };
}

export function resetEmailTemplatesSuccess(emailTemplates: $TSFixMe) {
    return {
        type: types.RESET_EMAIL_TEMPLATES_SUCCESS,
        payload: emailTemplates,
    };
}

// Calls the API to reset email templates
export function resetEmailTemplates(projectId: $TSFixMe, templateId: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = getApi(
            `emailTemplate/${projectId}/${templateId}/reset`
        );
        dispatch(resetEmailTemplatesRequest(promise));

        promise.then(
            function(emails) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(resetEmailTemplatesSuccess(emails.data));
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
                dispatch(resetEmailTemplatesError(errors(error)));
            }
        );
    };
}

export function smtpConfigRequest(promise: $TSFixMe) {
    return {
        type: types.SMTP_CONFIG_REQUEST,
        payload: promise,
    };
}

export function smtpConfigError(error: $TSFixMe) {
    return {
        type: types.SMTP_CONFIG_FAILED,
        payload: error,
    };
}

export function smtpConfigSuccess(config: $TSFixMe) {
    return {
        type: types.SMTP_CONFIG_SUCCESS,
        payload: config,
    };
}

// Calls the API to reset email templates
export function getSmtpConfig(projectId: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = getApi(`emailSmtp/${projectId}`);
        dispatch(smtpConfigRequest(promise));

        promise.then(
            function(data) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(smtpConfigSuccess(data.data));
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
                dispatch(smtpConfigError(errors(error)));
            }
        );
    };
}

export function postSmtpConfig(projectId: $TSFixMe, data: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = postApi(`emailSmtp/${projectId}`, data);
        dispatch(smtpConfigRequest(promise));

        promise.then(
            function(data) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(smtpConfigSuccess(data.data));
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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
                dispatch(smtpConfigError(errors(error)));
            }
        );
    };
}

export function deleteSmtpConfigRequest(promise: $TSFixMe) {
    return {
        type: types.DELETE_SMTP_CONFIG_REQUEST,
        payload: promise,
    };
}

export function deleteSmtpConfigError(error: $TSFixMe) {
    return {
        type: types.DELETE_SMTP_CONFIG_FAILED,
        payload: error,
    };
}

export function deleteSmtpConfigSuccess(config: $TSFixMe) {
    return {
        type: types.DELETE_SMTP_CONFIG_SUCCESS,
        payload: config,
    };
}

export function deleteSmtpConfig(
    projectId: $TSFixMe,
    smtpId: $TSFixMe,
    data: $TSFixMe
) {
    return function(dispatch: $TSFixMe) {
        const promise = deleteApi(`emailSmtp/${projectId}/${smtpId}`, data);
        dispatch(deleteSmtpConfigRequest(promise));

        promise.then(
            function(data) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(deleteSmtpConfigSuccess(data.data));
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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
                dispatch(deleteSmtpConfigError(errors(error)));
            }
        );
    };
}

export function updateSmtpConfig(
    projectId: $TSFixMe,
    smtpId: $TSFixMe,
    data: $TSFixMe
) {
    return function(dispatch: $TSFixMe) {
        const promise = putApi(`emailSmtp/${projectId}/${smtpId}`, data);
        dispatch(smtpConfigRequest(promise));

        promise.then(
            function(data) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(smtpConfigSuccess(data.data));
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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
                dispatch(smtpConfigError(errors(error)));
            }
        );
    };
}

export function changeShowingTemplate(emailTemplate: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        dispatch({
            type: types.CHANGE_SHOWING_TEMPLATE,
            payload: emailTemplate,
        });
    };
}

export function setRevealVariable(emailtype: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        dispatch({
            type: types.SET_REVEAL_VARIABLE,
            payload: emailtype,
        });
    };
}

export function setSmtpConfig(val: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        dispatch({
            type: types.SET_SMTP_CONFIG,
            payload: val,
        });
    };
}
