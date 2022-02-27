import { getApi, putApi, postApi, deleteApi } from '../api';
import * as types from '../constants/smstemplates';
import errors from '../errors';

//Array of sms templates

export function smsTemplatesRequest(promise: $TSFixMe) {
    return {
        type: types.SMS_TEMPLATES_REQUEST,
        payload: promise,
    };
}

export function smsTemplatesError(error: $TSFixMe) {
    return {
        type: types.SMS_TEMPLATES_FAILED,
        payload: error,
    };
}

export function smsTemplatesSuccess(incidents: $TSFixMe) {
    return {
        type: types.SMS_TEMPLATES_SUCCESS,
        payload: incidents,
    };
}

export const smsTemplatesReset = () => {
    return {
        type: types.SMS_TEMPLATES_RESET,
    };
};

// Calls the API to get sms templates
export function getSmsTemplates(projectId: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = getApi(`smsTemplate/${projectId}`);
        dispatch(smsTemplatesRequest(promise));

        promise.then(
            function(sms) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(smsTemplatesSuccess(sms.data));
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
                dispatch(smsTemplatesError(errors(error)));
            }
        );
    };
}

// Edit sms templates
export function editSmsTemplateReset() {
    return {
        type: types.EDIT_SMS_TEMPLATES_RESET,
    };
}

export function editSmsTemplateRequest() {
    return {
        type: types.EDIT_SMS_TEMPLATES_REQUEST,
        payload: true,
    };
}

export function editSmsTemplateSuccess(smsTemplates: $TSFixMe) {
    return {
        type: types.EDIT_SMS_TEMPLATES_SUCCESS,
        payload: smsTemplates,
    };
}

export function editSmsTemplateError(error: $TSFixMe) {
    return {
        type: types.EDIT_SMS_TEMPLATES_FAILED,
        payload: error,
    };
}

export function editSmsTemplates(projectId: $TSFixMe, data: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = putApi(`smsTemplate/${projectId}`, data);
        dispatch(editSmsTemplateRequest());

        promise.then(
            function(smsTemplate) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(editSmsTemplateSuccess(smsTemplate.data));
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
                dispatch(editSmsTemplateError(errors(error)));
            }
        );
    };
}

//Array of sms templates

export function resetSmsTemplatesRequest(promise: $TSFixMe) {
    return {
        type: types.RESET_SMS_TEMPLATES_REQUEST,
        payload: promise,
    };
}

export function resetSmsTemplatesError(error: $TSFixMe) {
    return {
        type: types.RESET_SMS_TEMPLATES_FAILED,
        payload: error,
    };
}

export function resetSmsTemplatesSuccess(smsTemplates: $TSFixMe) {
    return {
        type: types.RESET_SMS_TEMPLATES_SUCCESS,
        payload: smsTemplates,
    };
}

// Calls the API to reset sms templates
export function resetSmsTemplates(projectId: $TSFixMe, templateId: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = getApi(`smsTemplate/${projectId}/${templateId}/reset`);
        dispatch(resetSmsTemplatesRequest(promise));

        promise.then(
            function(sms) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(resetSmsTemplatesSuccess(sms.data));
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
                dispatch(resetSmsTemplatesError(errors(error)));
            }
        );
        return promise;
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
        const promise = getApi(`smsSmtp/${projectId}`);
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
        const promise = postApi(`smsSmtp/${projectId}`, data);
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

export function deleteSmtpConfig(projectId: $TSFixMe, smtpId: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
        const promise = deleteApi(`smsSmtp/${projectId}/${smtpId}`);
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
        const promise = putApi(`smsSmtp/${projectId}/${smtpId}`, data);
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

export function changeShowingTemplate(smsTemplate: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        dispatch({
            type: types.CHANGE_SHOWING_TEMPLATE,
            payload: smsTemplate,
        });
    };
}

export function setRevealVariable(smstype: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        dispatch({
            type: types.SET_REVEAL_VARIABLE,
            payload: smstype,
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
