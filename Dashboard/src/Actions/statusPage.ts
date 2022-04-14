import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ObjectID from 'Common/Types/ObjectID';
import * as types from '../constants/statusPage';
import FormData from 'form-data';
import ErrorPayload from 'CommonUI/src/payload-types/error';
import PositiveNumber from 'Common/Types/PositiveNumber';
// handle whether to show domain input field
export const addMoreDomain: Function = (): void => {
    return {
        type: types.ADD_MORE_DOMAIN,
    };
};

export const cancelAddMoreDomain: Function = (): void => {
    return {
        type: types.CANCEL_ADD_MORE_DOMAIN,
    };
};

// upload cert file
export const uploadCertFileRequest: Function = (): void => {
    return {
        type: 'CERT_FILE_REQUEST',
    };
};

export const uploadCertFileSuccess: Function = (filename: $TSFixMe): void => {
    return {
        type: 'CERT_FILE_SUCCESS',
        payload: filename,
    };
};

export const uploadCertFileFailure: Function = (error: ErrorPayload): void => {
    return {
        type: 'CERT_FILE_ERROR',
        payload: error,
    };
};

export const removeCertFile: Function = (): void => {
    return {
        type: 'REMOVE_CERT_FILE',
    };
};

export const uploadCertFile: Function = (
    projectId: ObjectID,
    file: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const data: $TSFixMe = new FormData();
        if (file) {
            data.append('cert', file);

            const promise: $TSFixMe = BackendAPI.post(
                `StatusPage/${projectId}/certFile`,
                data
            );
            dispatch(uploadCertFileRequest());
            promise.then(
                (response): void => {
                    const data: $TSFixMe = response.data;
                    dispatch(uploadCertFileSuccess(data.cert));
                    return data;
                },
                (error): void => {
                    if (error && error.response && error.response.data) {
                        error = error.response.data;
                    }
                    if (error && error.data) {
                        error = error.data;
                    }
                    if (error && error.message) {
                        error = error.message;
                    } else {
                        error = 'Network Error';
                    }
                    dispatch(uploadCertFileFailure(error));
                }
            );

            return promise;
        }
    };
};

// upload private key file
export const uploadPrivateKeyRequest: Function = (): void => {
    return {
        type: 'PRIVATE_KEY_REQUEST',
    };
};

export const uploadPrivateKeySuccess: Function = (filename: $TSFixMe): void => {
    return {
        type: 'PRIVATE_KEY_SUCCESS',
        payload: filename,
    };
};

export const uploadPrivateKeyFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: 'PRIVATE_KEY_ERROR',
        payload: error,
    };
};

export const removePrivateKeyFile: Function = (): void => {
    return {
        type: 'REMOVE_PRIVATE_KEY',
    };
};

export const uploadPrivateKey: Function = (
    projectId: ObjectID,
    file: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const data: $TSFixMe = new FormData();
        if (file) {
            data.append('privateKey', file);

            const promise: $TSFixMe = BackendAPI.post(
                `StatusPage/${projectId}/privateKeyFile`,
                data
            );
            dispatch(uploadPrivateKeyRequest());
            promise.then(
                (response): void => {
                    const data: $TSFixMe = response.data;
                    dispatch(uploadPrivateKeySuccess(data.privateKey));
                    return data;
                },
                (error): void => {
                    if (error && error.response && error.response.data) {
                        error = error.response.data;
                    }
                    if (error && error.data) {
                        error = error.data;
                    }
                    if (error && error.message) {
                        error = error.message;
                    } else {
                        error = 'Network Error';
                    }
                    dispatch(uploadPrivateKeyFailure(error));
                }
            );

            return promise;
        }
    };
};

//Update status page setting

export const updateStatusPageSettingRequest: Function = (): void => {
    return {
        type: types.UPDATE_STATUSPAGE_SETTING_REQUEST,
    };
};

export const updateStatusPageSettingSuccess: Function = (
    statusPage: $TSFixMe
): void => {
    return {
        type: types.UPDATE_STATUSPAGE_SETTING_SUCCESS,
        payload: statusPage,
    };
};

export const updateStatusPageSettingError: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.UPDATE_STATUSPAGE_SETTING_FAILURE,
        payload: error,
    };
};

// Calls the API to update setting.
export const updateStatusPageSetting: Function = (
    projectId: ObjectID,
    data: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.put(
            `StatusPage/${projectId}`,
            data
        );
        dispatch(updateStatusPageSettingRequest());
        promise.then(
            (response): void => {
                const statusPage: $TSFixMe = response.data;
                dispatch(updateStatusPageSettingSuccess(statusPage));

                dispatch(fetchProjectStatusPage(projectId, true));
            },
            (error): void => {
                dispatch(updateStatusPageSettingError(error));
            }
        );

        return promise;
    };
};

//Update status page monitors

export const updateStatusPageMonitorsRequest: Function = (): void => {
    return {
        type: types.UPDATE_STATUSPAGE_MONITORS_REQUEST,
    };
};

export const updateStatusPageMonitorsSuccess: Function = (
    statusPage: $TSFixMe
): void => {
    return {
        type: types.UPDATE_STATUSPAGE_MONITORS_SUCCESS,
        payload: statusPage,
    };
};

export const updateStatusPageMonitorsError: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.UPDATE_STATUSPAGE_MONITORS_FAILURE,
        payload: error,
    };
};

// Calls the API to update monitors.
export function updateStatusPageMonitors(
    projectId: ObjectID,
    values: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.put(
            `StatusPage/${projectId}`,
            values
        );
        dispatch(updateStatusPageMonitorsRequest());

        promise.then(
            (response): void => {
                const statusPage: $TSFixMe = response.data;
                dispatch(updateStatusPageMonitorsSuccess(statusPage));
            },
            (error): void => {
                dispatch(updateStatusPageMonitorsError(error));
            }
        );
        return promise;
    };
}

//Update private status page Main box

export const updatePrivateStatusPageRequest: Function = (): void => {
    return {
        type: types.UPDATE_PRIVATE_STATUSPAGE_REQUEST,
    };
};

export const updatePrivateStatusPageSuccess: Function = (
    statusPage: $TSFixMe
): void => {
    return {
        type: types.UPDATE_PRIVATE_STATUSPAGE_SUCCESS,
        payload: statusPage,
    };
};

export const updatePrivateStatusPageError: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.UPDATE_PRIVATE_STATUSPAGE_FAILURE,
        payload: error,
    };
};

// Calls the API to update private statuspages.
export const updatePrivateStatusPage: Function = (
    projectId: ObjectID,
    values: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.put(
            `StatusPage/${projectId}`,
            values
        );
        dispatch(updatePrivateStatusPageRequest());

        promise.then(
            (response): void => {
                const statusPage: $TSFixMe = response.data;
                dispatch(updatePrivateStatusPageSuccess(statusPage));
                dispatch(updateStatusSuccess(statusPage));
            },
            (error): void => {
                dispatch(updatePrivateStatusPageError(error));
            }
        );
        return promise;
    };
};
// Update status page advanace subscriber options.
export const updateSubscriberOptionRequest: Function = (): void => {
    return {
        type: types.UPDATE_SUBSCRIBER_OPTION_REQUEST,
    };
};

export const updateSubscriberOptionSuccess: Function = (
    statusPage: $TSFixMe
): void => {
    return {
        type: types.UPDATE_SUBSCRIBER_OPTION_SUCCESS,
        payload: statusPage,
    };
};

export const updateSubscriberOptionError: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.UPDATE_SUBSCRIBER_OPTION_FAILURE,
        payload: error,
    };
};

// update status page multi language
export function updateStatusPageLanguage(
    projectId: ObjectID,
    values: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.put(
            `StatusPage/${projectId}`,
            values
        );
        dispatch(updateStatusPageLanguageRequest());

        promise.then(
            (response): void => {
                const statusPage: $TSFixMe = response.data;
                dispatch(updateStatusPageLanguageSuccess(statusPage));
                dispatch(updateStatusSuccess(statusPage));
            },
            (error): void => {
                dispatch(updateStatusPageLanguageError(error));
            }
        );
        return promise;
    };
}
// Update status page advanace subscriber options.
export const updateStatusPageLanguageRequest: Function = (): void => {
    return {
        type: types.UPDATE_MULTIPLE_LANGUAGE_REQUEST,
    };
};

export const updateStatusPageLanguageSuccess: Function = (
    statusPage: $TSFixMe
): void => {
    return {
        type: types.UPDATE_MULTIPLE_LANGUAGE_SUCCESS,
        payload: statusPage,
    };
};

export const updateStatusPageLanguageError: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.UPDATE_MULTIPLE_LANGUAGE_FAILURE,
        payload: error,
    };
};

// Calls the API to update private statuspages.
export const updateSubscriberOption: Function = (
    projectId: ObjectID,
    values: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.put(
            `StatusPage/${projectId}`,
            values
        );
        dispatch(updateSubscriberOptionRequest());

        promise.then(
            (response): void => {
                const statusPage: $TSFixMe = response.data;
                dispatch(updateSubscriberOptionSuccess(statusPage));
            },
            (error): void => {
                dispatch(updateSubscriberOptionError(error));
            }
        );
        return promise;
    };
};
// Update status page branding
export const updateStatusSuccess: Function = (data: $TSFixMe): void => {
    return {
        type: types.UPDATE_STATUSPAGE_SUCCESS,
        payload: data,
    };
};

export const updateStatusPageBrandingRequest: Function = (): void => {
    return {
        type: types.UPDATE_STATUSPAGE_BRANDING_REQUEST,
    };
};

export const updateStatusPageBrandingSuccess: Function = (
    statusPage: $TSFixMe
): void => {
    return {
        type: types.UPDATE_STATUSPAGE_BRANDING_SUCCESS,
        payload: statusPage,
    };
};

export const updateStatusPageBrandingError: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.UPDATE_STATUSPAGE_BRANDING_FAILURE,
        payload: error,
    };
};

// Update status page name
export const updateStatusPageNameRequest: Function = (): void => {
    return {
        type: types.UPDATE_STATUSPAGE_NAME_REQUEST,
    };
};

export const updateStatusPageNameSuccess: Function = (
    statusPage: $TSFixMe
): void => {
    return {
        type: types.UPDATE_STATUSPAGE_NAME_SUCCESS,
        payload: statusPage,
    };
};

export const updateStatusPageNameError: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.UPDATE_STATUSPAGE_NAME_FAILURE,
        payload: error,
    };
};

// Update status page theme
export const updateStatusPageThemeRequest: Function = (): void => {
    return {
        type: types.UPDATE_STATUSPAGE_THEME_REQUEST,
    };
};

export const updateStatusPageThemeSuccess: Function = (
    statusPage: $TSFixMe
): void => {
    return {
        type: types.UPDATE_STATUSPAGE_THEME_SUCCESS,
        payload: statusPage,
    };
};

export const updateStatusPageThemeError: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.UPDATE_STATUSPAGE_THEME_FAILURE,
        payload: error,
    };
};

// Calls the API to update branding.
export function updateStatusPageBranding(
    projectId: ObjectID,
    values: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const data: $TSFixMe = new FormData();
        if (values.favicon && values.favicon[0]) {
            data.append('favicon', values.favicon[0], values.favicon[0].name);
        } else if (values.favicon === '') {
            data.append('favicon', values.favicon);
        }
        if (values.logo && values.logo[0]) {
            data.append('logo', values.logo[0], values.logo[0].name);
        } else if (values.logo === '') {
            data.append('logo', values.logo);
        }
        if (values.banner && values.banner[0]) {
            data.append('banner', values.banner[0], values.banner[0].name);
        } else if (values.banner === '') {
            data.append('banner', values.banner);
        }
        data.append('title', values.title);
        data.append('description', values.description);
        data.append('copyright', values.copyright);
        if (values.colors) {
            data.append('colors', JSON.stringify(values.colors));
        }

        if (values._id) {
            data.append('_id', values._id);
        }

        const promise: $TSFixMe = BackendAPI.put(
            `StatusPage/${projectId}`,
            data
        );
        dispatch(updateStatusPageBrandingRequest());

        promise.then(
            (response): void => {
                const statusPage: $TSFixMe = response.data;
                dispatch(updateStatusPageBrandingSuccess(statusPage));
            },
            (error): void => {
                dispatch(updateStatusPageBrandingError(error));
            }
        );
        return promise;
    };
}

// Calls the API to update the theme
export const updateTheme: Function = (
    projectId: ObjectID,
    data: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.put(
            `StatusPage/${projectId}/theme`,
            data
        );
        dispatch(updateStatusPageThemeRequest());

        promise.then(
            (response): void => {
                const statusPage: $TSFixMe = response.data;
                dispatch(updateStatusPageThemeSuccess(statusPage));
                dispatch(updateStatusSuccess(statusPage));
            },
            (error): void => {
                dispatch(updateStatusPageThemeError(error));
            }
        );
        return promise;
    };
};

// Calls the API to update status page name.
export const updateStatusPageName: Function = (
    projectId: ObjectID,
    values: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.put(
            `StatusPage/${projectId}`,
            values
        );
        dispatch(updateStatusPageNameRequest());

        promise.then(
            (response): void => {
                const statusPage: $TSFixMe = response.data;
                dispatch(updateStatusPageNameSuccess(statusPage));
            },
            (error): void => {
                dispatch(updateStatusPageNameError(error));
            }
        );
        return promise;
    };
};

//Update status page links

export const updateStatusPageLinksRequest: Function = (): void => {
    return {
        type: types.UPDATE_STATUSPAGE_LINKS_REQUEST,
    };
};

export const updateStatusPageLinksSuccess: Function = (
    statusPage: $TSFixMe
): void => {
    return {
        type: types.UPDATE_STATUSPAGE_LINKS_SUCCESS,
        payload: statusPage,
    };
};

export const updateStatusPageLinksError: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.UPDATE_STATUSPAGE_LINKS_FAILURE,
        payload: error,
    };
};

// Calls the API to update links.
export const updateStatusPageLinks: Function = (
    projectId: ObjectID,
    values: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.put(
            `StatusPage/${projectId}`,
            values
        );
        dispatch(updateStatusPageLinksRequest());

        promise.then(
            (response): void => {
                const statusPage: $TSFixMe = response.data;
                dispatch(updateStatusPageLinksSuccess(statusPage));
            },
            (error): void => {
                dispatch(updateStatusPageLinksError(error));
            }
        );
        return promise;
    };
};

//Update status page links

export const updateStatusPageCustomHTMLRequest: Function = (): void => {
    return {
        type: types.UPDATE_STATUSPAGE_CUSTOM_HTML_REQUEST,
    };
};

export const updateStatusPageCustomHTMLSuccess: Function = (
    statusPage: $TSFixMe
): void => {
    return {
        type: types.UPDATE_STATUSPAGE_CUSTOM_HTML_SUCCESS,
        payload: statusPage,
    };
};

export const updateStatusPageCustomHTMLError: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.UPDATE_STATUSPAGE_CUSTOM_HTML_FAILURE,
        payload: error,
    };
};

// Calls the API to update links.
export function updateStatusPageCustomHTML(
    projectId: ObjectID,
    values: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.put(
            `StatusPage/${projectId}`,
            values
        );
        dispatch(updateStatusPageCustomHTMLRequest());

        promise.then(
            (response): void => {
                const statusPage: $TSFixMe = response.data;
                dispatch(updateStatusPageCustomHTMLSuccess(statusPage));
            },
            (error): void => {
                dispatch(updateStatusPageCustomHTMLError(error));
            }
        );
        return promise;
    };
}

//fetch project statuspage

export const fetchProjectStatusPageRequest: Function = (): void => {
    return {
        type: types.FETCH_PROJECT_STATUSPAGE_REQUEST,
    };
};

export const resetProjectFetchStatusPage: Function = (): void => {
    return {
        type: types.FETCH_PROJECT_STATUSPAGE_RESET,
    };
};

export const fetchProjectStatusPageSuccess: Function = (
    statusPage: $TSFixMe
): void => {
    return {
        type: types.FETCH_PROJECT_STATUSPAGE_SUCCESS,
        payload: statusPage,
    };
};

export const fetchProjectStatusPageError: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_PROJECT_STATUSPAGE_FAILURE,
        payload: error,
    };
};

// Gets list of statuspages in a project.
export function fetchProjectStatusPage(
    projectId: ObjectID,
    refresh: $TSFixMe,
    skip: PositiveNumber,
    limit: PositiveNumber
) {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `StatusPage/${projectId}/statuspage?skip=${skip}&limit=${limit}`
        );
        if (!refresh) {
            dispatch(fetchProjectStatusPageRequest());
        }

        promise.then(
            (response): void => {
                const data: $TSFixMe = response.data;
                data.projectId = projectId;
                dispatch(fetchProjectStatusPageSuccess(data));
            },
            (error): void => {
                dispatch(fetchProjectStatusPageError(error));
            }
        );
        return promise;
    };
}

//fetch subProject statuspages

export const fetchSubProjectStatusPagesRequest: Function = (): void => {
    return {
        type: types.FETCH_SUBPROJECT_STATUSPAGE_REQUEST,
    };
};

export const resetSubProjectFetchStatusPages: Function = (): void => {
    return {
        type: types.FETCH_SUBPROJECT_STATUSPAGE_RESET,
    };
};

export const fetchSubProjectStatusPagesSuccess: Function = (
    statusPage: $TSFixMe
): void => {
    return {
        type: types.FETCH_SUBPROJECT_STATUSPAGE_SUCCESS,
        payload: statusPage,
    };
};

export const fetchSubProjectStatusPagesError: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_SUBPROJECT_STATUSPAGE_FAILURE,
        payload: error,
    };
};

// Gets status pages by subProjectId.
export function fetchSubProjectStatusPages(
    projectId: ObjectID,
    refresh: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `StatusPage/${projectId}/StatusPages`
        );
        if (!refresh) {
            dispatch(fetchSubProjectStatusPagesRequest());
        }

        promise.then(
            (response): void => {
                const data: $TSFixMe = response.data;
                dispatch(fetchSubProjectStatusPagesSuccess(data));
            },
            (error): void => {
                dispatch(fetchSubProjectStatusPagesError(error));
            }
        );
        return promise;
    };
}

//for incident statuspages
export const fetchIncidentStatusPagesRequest: Function = (): void => {
    return {
        type: types.FETCH_INCIDENT_STATUSPAGE_REQUEST,
    };
};

export const resetIncidentFetchStatusPages: Function = (): void => {
    return {
        type: types.FETCH_INCIDENT_STATUSPAGE_RESET,
    };
};

export const fetchIncidentStatusPagesSuccess: Function = (
    incidentStatusPages: $TSFixMe
): void => {
    return {
        type: types.FETCH_INCIDENT_STATUSPAGE_SUCCESS,
        payload: incidentStatusPages,
    };
};

export const fetchIncidentStatusPagesError: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_INCIDENT_STATUSPAGE_FAILURE,
        payload: error,
    };
};

// Gets status pages pointing to the incident
export function fetchIncidentStatusPages(
    projectId: ObjectID,
    incidentSlug: $TSFixMe,
    skip: PositiveNumber,
    limit: PositiveNumber
) {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `incident/${projectId}/${incidentSlug}/statuspages?skip=${skip}&limit=${limit}`
        );

        promise.then(
            (response): void => {
                dispatch(fetchIncidentStatusPagesSuccess(response.data));
            },
            (error): void => {
                dispatch(fetchIncidentStatusPagesError(error));
            }
        );
        return promise;
    };
}

// Reset status bubble id
export const resetStatusBubbleIdRequest: Function = (): void => {
    return {
        type: types.RESET_STATUS_BUBBLE_ID_REQUEST,
    };
};

export const resetStatusBubbleIdSuccess: Function = (
    statusPage: $TSFixMe
): void => {
    return {
        type: types.RESET_STATUS_BUBBLE_ID_SUCCESS,
        payload: statusPage,
    };
};

export const resetStatusBubbleIdError: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.RESET_STATUS_BUBBLE_ID_FAILURE,
        payload: error,
    };
};

// Calls the API to update setting.
export function resetStatusBubbleId(
    projectId: ObjectID,
    statusPageId: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.put(
            `StatusPage/${projectId}/${statusPageId}/resetBubbleId`,
            {}
        );
        dispatch(resetStatusBubbleIdRequest());
        promise.then(
            (response): void => {
                const statusPage: $TSFixMe = response.data;
                dispatch(resetStatusBubbleIdSuccess(statusPage));
            },
            (error): void => {
                dispatch(resetStatusBubbleIdError(error));
            }
        );

        return promise;
    };
}
//Delete statuspage
export const deleteStatusPageRequest: Function = (): void => {
    return {
        type: types.DELETE_STATUSPAGE_REQUEST,
    };
};

export const deleteStatusPageReset: Function = (): void => {
    return {
        type: types.DELETE_STATUSPAGE_RESET,
    };
};

export const deleteStatusPageSuccess: Function = (
    statusPage: $TSFixMe
): void => {
    return {
        type: types.DELETE_STATUSPAGE_SUCCESS,
        payload: statusPage,
    };
};

export const deleteStatusPageError: Function = (error: ErrorPayload): void => {
    return {
        type: types.DELETE_STATUSPAGE_FAILED,
        payload: error,
    };
};

// Calls the API to get status page.
export function deleteStatusPage(
    projectId: ObjectID,
    statusPageSlug: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe =
            delete (`StatusPage/${projectId}/${statusPageSlug}`, null);
        dispatch(deleteStatusPageRequest());
        promise.then(
            (response): void => {
                const data: $TSFixMe = response.data;
                dispatch(deleteStatusPageSuccess(data));
            },
            (error): void => {
                dispatch(deleteStatusPageError(error));
            }
        );
        return promise;
    };
}

//Duplicate statuspage
export const duplicateStatusPageRequest: Function = (): void => {
    return {
        type: types.DUPLICATE_STATUSPAGE_REQUEST,
    };
};

export const duplicateStatusPageSuccess: Function = (
    statusPage: $TSFixMe
): void => {
    return {
        type: types.DUPLICATE_STATUSPAGE_SUCCESS,
        payload: statusPage,
    };
};

export const duplicateStatusPageError: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.DUPLICATE_STATUSPAGE_FAILURE,
        payload: error,
    };
};

export const readStatusPage: Function = (
    statusPageSlug: $TSFixMe,
    data: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `StatusPage/${statusPageSlug}`,
            data
        );
        dispatch(duplicateStatusPageRequest());
        promise.then(
            (response): void => {
                const statusPageData: $TSFixMe = response.data;
                delete statusPageData._id;
                delete statusPageData.slug;
                statusPageData.name = data.name;
                return response;
            },
            (error): void => {
                dispatch(duplicateStatusPageError(error));
            }
        );
        return promise;
    };
};

export function createDuplicateStatusPage(
    projectId: ObjectID,
    subProjectId = null,
    statusPageSlug: $TSFixMe,
    data: $TSFixMe
) {
    return function (dispatch: Dispatch): void {
        const url: $TSFixMe = subProjectId
            ? `StatusPage/${projectId}/${statusPageSlug}/duplicateStatusPage?subProjectId=${subProjectId}`
            : `StatusPage/${projectId}/${statusPageSlug}/duplicateStatusPage`;
        const promise: $TSFixMe = BackendAPI.post(url, data);
        promise.then(
            (response): void => {
                return response;
            },
            (error): void => {
                dispatch(duplicateStatusPageError(error));
            }
        );
        return promise;
    };
}

export const fetchStatusPage: Function = (statusPageSlug: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `StatusPage/${statusPageSlug}`
        );
        promise.then(
            (response): void => {
                const statusPageData: $TSFixMe = response.data;
                dispatch(duplicateStatusPageSuccess(statusPageData));
                dispatch(
                    fetchProjectStatusPage(statusPageData.projectId._id, true)
                );
            },
            (error): void => {
                dispatch(duplicateStatusPageError(error));
            }
        );
        return promise;
    };
};

export const duplicateStatusPageReset: Function = (): void => {
    return {
        type: types.DUPLICATE_STATUSPAGE_RESET,
    };
};

//Update status page embedded css

export const updateStatusPageEmbeddedCssRequest: Function = (): void => {
    return {
        type: types.UPDATE_STATUSPAGE_EMBEDDED_CSS_REQUEST,
    };
};

export const updateStatusPageEmbeddedCssSuccess: Function = (
    statusPage: $TSFixMe
): void => {
    return {
        type: types.UPDATE_STATUSPAGE_EMBEDDED_CSS_SUCCESS,
        payload: statusPage,
    };
};

export const updateStatusPageEmbeddedCssError: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.UPDATE_STATUSPAGE_EMBEDDED_CSS_FAILURE,
        payload: error,
    };
};

// Calls the API to update setting.
export function updateStatusPageEmbeddedCss(
    projectId: ObjectID,
    data: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.put(
            `StatusPage/${projectId}`,
            data
        );
        dispatch(updateStatusPageEmbeddedCssRequest());
        promise.then(
            (response): void => {
                const statusPage: $TSFixMe = response.data;
                dispatch(updateStatusPageEmbeddedCssSuccess(statusPage));

                dispatch(fetchProjectStatusPage(projectId, true));
                dispatch(updateStatusSuccess(statusPage));
            },
            (error): void => {
                dispatch(updateStatusPageEmbeddedCssError(error));
            }
        );

        return promise;
    };
}

//reset branding colors
export const resetBrandingColorsRequest: Function = (): void => {
    return {
        type: types.RESET_BRANDING_COLORS_REQUEST,
    };
};

export const resetBrandingColorsSuccess: Function = (
    colors: $TSFixMe
): void => {
    return {
        type: types.RESET_BRANDING_COLORS_SUCCESS,
        payload: colors,
    };
};

export const resetBrandingColorsError: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.RESET_BRANDING_COLORS_FAILURE,
        payload: error,
    };
};

// Calls the API to reset colors.
export function resetBrandingColors(
    projectId: ObjectID,
    statusPageId: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.put(
            `StatusPage/${projectId}/${statusPageId}/resetColors`
        );
        dispatch(resetBrandingColorsRequest());
        promise.then(
            (response): void => {
                const colors: $TSFixMe = response.data;
                dispatch(resetBrandingColorsSuccess(colors));
            },
            (error): void => {
                dispatch(resetBrandingColorsError(error));
            }
        );

        return promise;
    };
}

//Update status page embedded css

export const resetStatusPageEmbeddedCssRequest: Function = (): void => {
    return {
        type: types.RESET_STATUSPAGE_EMBEDDED_CSS_REQUEST,
    };
};

export const resetStatusPageEmbeddedCssSuccess: Function = (
    statusPage: $TSFixMe
): void => {
    return {
        type: types.RESET_STATUSPAGE_EMBEDDED_CSS_SUCCESS,
        payload: statusPage,
    };
};

export const resetStatusPageEmbeddedCssError: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.RESET_STATUSPAGE_EMBEDDED_CSS_FAILURE,
        payload: error,
    };
};

// Calls the API to update setting.
export function resetStatusPageEmbeddedCss(
    projectId: ObjectID,
    data: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.put(
            `StatusPage/${projectId}`,
            data
        );
        dispatch(resetStatusPageEmbeddedCssRequest());
        promise.then(
            (response): void => {
                const statusPage: $TSFixMe = response.data;
                dispatch(resetStatusPageEmbeddedCssSuccess(statusPage));

                dispatch(fetchProjectStatusPage(projectId, true));
            },
            (error): void => {
                dispatch(resetStatusPageEmbeddedCssError(error));
            }
        );

        return promise;
    };
}
//status page layout
export const updateStatusPageLayoutRequest: Function = (): void => {
    return {
        type: types.UPDATE_STATUS_PAGE_LAYOUT_REQUEST,
    };
};

export const updateStatusPageLayoutSuccess: Function = (
    statusPage: $TSFixMe
): void => {
    return {
        type: types.UPDATE_STATUS_PAGE_LAYOUT_SUCCESS,
        payload: statusPage,
    };
};

export const updateStatusPageLayoutError: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.UPDATE_STATUS_PAGE_LAYOUT_FAILURE,
        payload: error,
    };
};

export const updateStatusPageLayout: Function = (
    projectId: ObjectID,
    data: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.put(
            `StatusPage/${projectId}`,
            data
        );
        dispatch(updateStatusPageLayoutRequest());
        promise.then(
            (response): void => {
                const statusPage: $TSFixMe = response.data;
                dispatch(updateStatusPageLayoutSuccess(statusPage));

                dispatch(fetchProjectStatusPage(projectId, true));
                dispatch(updateStatusSuccess(statusPage));
            },
            (error): void => {
                dispatch(updateStatusPageLayoutError(error));
            }
        );

        return promise;
    };
};
// fetch subscribers by monitors in statuspage
export const fetchSubscriberRequest: Function = (): void => {
    return {
        type: types.FETCH_SUBSCRIBER_REQUEST,
    };
};

export const fetchSubscriberSuccess: Function = (data: $TSFixMe): void => {
    return {
        type: types.FETCH_SUBSCRIBER_SUCCESS,
        payload: data,
    };
};

export const fetchSubscriberFailure: Function = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_SUBSCRIBER_FAILURE,
        payload: error,
    };
};

export function fetchStatusPageSubscribers(
    projectId: ObjectID,
    statusPageId: $TSFixMe,
    skip: PositiveNumber,
    limit: PositiveNumber
) {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `StatusPage/${projectId}/monitor/${statusPageId}?skip=${skip}&limit=${limit}`
        );
        dispatch(fetchSubscriberRequest());
        promise.then(
            (response): void => {
                dispatch(fetchSubscriberSuccess(response.data));
            },
            (error): void => {
                dispatch(fetchSubscriberFailure(error));
            }
        );
        return promise;
    };
}

export const createExternalStatusPageRequest: Function = (): void => {
    return {
        type: types.CREATE_EXTERNAL_STATUSPAGE_REQUEST,
    };
};

export const createExternalStatusPageSuccess: Function = (
    data: $TSFixMe
): void => {
    return {
        type: types.CREATE_EXTERNAL_STATUSPAGE_SUCCESS,
        payload: data,
    };
};

export const createExternalStatusPageFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.CREATE_EXTERNAL_STATUSPAGE_FAILURE,
        payload: error,
    };
};

export function createExternalStatusPage(
    projectId: ObjectID,
    statusPageId: $TSFixMe,
    data: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            `StatusPage/${projectId}/createExternalStatusPage/${statusPageId}`,
            data
        );
        dispatch(createExternalStatusPageRequest());
        promise.then(
            (response): void => {
                dispatch(createExternalStatusPageSuccess(response.data));

                return response.data;
            },
            (error): void => {
                dispatch(createExternalStatusPageFailure(error));
                return error;
            }
        );

        return promise;
    };
}

export const updateExternalStatusPageRequest: Function = (): void => {
    return {
        type: types.UPDATE_EXTERNAL_STATUSPAGE_REQUEST,
    };
};

export const updateExternalStatusPageSuccess: Function = (
    data: $TSFixMe
): void => {
    return {
        type: types.UPDATE_EXTERNAL_STATUSPAGE_SUCCESS,
        payload: data,
    };
};

export const updateExternalStatusPageFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.UPDATE_EXTERNAL_STATUSPAGE_FAILURE,
        payload: error,
    };
};

export function updateExternalStatusPage(
    projectId: ObjectID,
    externalStatusPageId: $TSFixMe,
    data: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            `StatusPage/${projectId}/updateExternalStatusPage/${externalStatusPageId}`,
            data
        );
        dispatch(updateExternalStatusPageRequest());
        promise.then(
            (response): void => {
                dispatch(updateExternalStatusPageSuccess(response.data));

                return response.data;
            },
            (error): void => {
                dispatch(updateExternalStatusPageFailure(error));
                return error;
            }
        );

        return promise;
    };
}

export const fetchExternalStatusPagesRequest: Function = (): void => {
    return {
        type: types.FETCH_EXTERNAL_STATUSPAGES_REQUEST,
    };
};

export const fetchExternalStatusPagesSuccess: Function = (
    data: $TSFixMe
): void => {
    return {
        type: types.FETCH_EXTERNAL_STATUSPAGES_SUCCESS,
        payload: data,
    };
};

export const fetchExternalStatusPagesFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_EXTERNAL_STATUSPAGES_FAILURE,
        payload: error,
    };
};

export function fetchExternalStatusPages(
    projectId: ObjectID,
    statusPageId: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `StatusPage/${projectId}/fetchExternalStatusPages/${statusPageId}`
        );
        dispatch(fetchExternalStatusPagesRequest());
        promise.then(
            (response): void => {
                dispatch(fetchExternalStatusPagesSuccess(response.data));

                return response.data;
            },
            (error): void => {
                dispatch(fetchExternalStatusPagesFailure(error));
                return error;
            }
        );

        return promise;
    };
}

export const deleteExternalStatusPageRequest: Function = (): void => {
    return {
        type: types.DELETE_EXTERNAL_STATUSPAGE_REQUEST,
    };
};

export const deleteExternalStatusPageSuccess: Function = (
    data: $TSFixMe
): void => {
    return {
        type: types.DELETE_EXTERNAL_STATUSPAGE_SUCCESS,
        payload: data,
    };
};

export const deleteExternalStatusPageFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.DELETE_EXTERNAL_STATUSPAGE_FAILURE,
        payload: error,
    };
};

export function deleteExternalStatusPage(
    projectId: ObjectID,
    externalStatusPageId: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            `StatusPage/${projectId}/deleteExternalStatusPage/${externalStatusPageId}`
        );
        dispatch(deleteExternalStatusPageRequest());
        promise.then(
            (response): void => {
                dispatch(deleteExternalStatusPageSuccess(response.data));

                return response.data;
            },
            (error): void => {
                dispatch(deleteExternalStatusPageFailure(error));
                return error;
            }
        );

        return promise;
    };
}

export const createAnnouncementRequest: Function = (): void => {
    return {
        type: types.CREATE_ANNOUNCEMEMT_REQUEST,
    };
};

export const createAnnouncementSuccess: Function = (data: $TSFixMe): void => {
    return {
        type: types.CREATE_ANNOUNCEMEMT_SUCCESS,
        payload: data,
    };
};

export const createAnnouncementFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.CREATE_ANNOUNCEMEMT_FAILURE,
        payload: error,
    };
};

export function createAnnouncement(
    projectId: ObjectID,
    statusPageId: $TSFixMe,
    data: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            `StatusPage/${projectId}/announcement/${statusPageId}`,
            data
        );
        dispatch(createAnnouncementRequest());
        promise.then(
            (response): void => {
                dispatch(createAnnouncementSuccess(response.data));

                return response.data;
            },
            (error): void => {
                dispatch(createAnnouncementFailure(error));
                return error;
            }
        );

        return promise;
    };
}

export function updateAnnouncement(
    projectId: ObjectID,
    statusPageId: $TSFixMe,
    announcementId: $TSFixMe,
    data: $TSFixMe
) {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.put(
            `StatusPage/${projectId}/announcement/${statusPageId}/${announcementId}`,
            data
        );
        dispatch(createAnnouncementRequest());
        promise.then(
            (response): void => {
                dispatch(createAnnouncementSuccess(response.data));

                return response.data;
            },
            (error): void => {
                dispatch(createAnnouncementFailure(error));
                return error;
            }
        );

        return promise;
    };
}

export const fetchAnnouncementRequest: Function = (): void => {
    return {
        type: types.FETCH_ANNOUNCEMEMT_REQUEST,
    };
};

export const fetchAnnouncementSuccess: Function = (data: $TSFixMe): void => {
    return {
        type: types.FETCH_ANNOUNCEMEMT_SUCCESS,
        payload: data,
    };
};

export const fetchAnnouncementFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_ANNOUNCEMEMT_FAILURE,
        payload: error,
    };
};

export function fetchAnnouncements(
    projectId: ObjectID,
    statusPageId: $TSFixMe,
    skip = 0,
    limit: PositiveNumber
) {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `StatusPage/${projectId}/announcement/${statusPageId}?skip=${skip}&limit=${limit}`
        );
        dispatch(fetchAnnouncementRequest());
        promise.then(
            (response): void => {
                dispatch(fetchAnnouncementSuccess(response.data));
            },
            (error): void => {
                dispatch(fetchAnnouncementFailure(error));
            }
        );
        return promise;
    };
}

export const fetchAnnouncementLogsRequest: Function = (): void => {
    return {
        type: types.FETCH_ANNOUNCEMEMTLOGS_REQUEST,
    };
};

export const fetchAnnouncementLogsSuccess: Function = (
    data: $TSFixMe
): void => {
    return {
        type: types.FETCH_ANNOUNCEMEMTLOGS_SUCCESS,
        payload: data,
    };
};

export const fetchAnnouncementLogsFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_ANNOUNCEMEMTLOGS_FAILURE,
        payload: error,
    };
};

export function fetchAnnouncementLogs(
    projectId: ObjectID,
    statusPageId: $TSFixMe,
    skip = 0,
    limit: PositiveNumber
) {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `StatusPage/${projectId}/announcementLogs/${statusPageId}?skip=${skip}&limit=${limit}`
        );
        dispatch(fetchAnnouncementLogsRequest());
        promise.then(
            (response): void => {
                dispatch(fetchAnnouncementLogsSuccess(response.data));
            },
            (error): void => {
                dispatch(fetchAnnouncementLogsFailure(error));
            }
        );
        return promise;
    };
}

export const fetchSingleAnnouncementSuccess: Function = (
    data: $TSFixMe
): void => {
    return {
        type: types.FETCH_SINCLE_ANNOUNCEMENT_SUCCESS,
        payload: data,
    };
};

export const fetchSingleAnnouncementFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_SINCLE_ANNOUNCEMENT_FAILURE,
        payload: error,
    };
};

export function fetchSingleAnnouncement(
    projectId: ObjectID,
    statusPageSlug: $TSFixMe,
    announcementSlug: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `StatusPage/${projectId}/announcement/${statusPageSlug}/single/${announcementSlug}`
        );
        promise.then(
            (response): void => {
                dispatch(fetchSingleAnnouncementSuccess(response.data));
            },
            (error): void => {
                dispatch(fetchSingleAnnouncementFailure(error));
            }
        );
        return promise;
    };
}

export const handleAnnouncementSuccess: Function = (data: $TSFixMe): void => {
    return {
        type: types.HANDLE_ANNOUNCEMENT_SUCCESS,
        payload: data,
    };
};

export const handleAnnouncementFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.HANDLE_ANNOUNCEMENT_FAILURE,
        payload: error,
    };
};

export const resetHandleAnnouncement: Function = (): void => {
    return {
        type: types.RESET_HANDLE_ANNOUNCEMENT,
    };
};

export const resetDeleteAnnouncement: Function = (): void => {
    return {
        type: types.RESET_DELETE_ANNOUNCEMENT,
    };
};

export const deleteAnnouncementRequest: Function = (): void => {
    return {
        type: types.DELETE_ANNOUNCEMENT_REQUEST,
    };
};

export const deleteAnnouncementSuccess: Function = (data: $TSFixMe): void => {
    return {
        type: types.DELETE_ANNOUNCEMENT_SUCCESS,
        payload: data,
    };
};

export const deleteAnnouncementFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.DELETE_ANNOUNCEMENT_FAILURE,
        payload: error,
    };
};

export function deleteAnnouncement(
    projectId: ObjectID,
    announcementId: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe =
            delete `StatusPage/${projectId}/announcement/${announcementId}/delete`;
        dispatch(deleteAnnouncementRequest());
        promise.then(
            (response): void => {
                dispatch(deleteAnnouncementSuccess(response.data));
            },
            (error): void => {
                dispatch(deleteAnnouncementFailure(error));
            }
        );
        return promise;
    };
}

export function deleteAnnouncementLog(
    projectId: ObjectID,
    announcementLogId: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe =
            delete `StatusPage/${projectId}/announcementLog/${announcementLogId}/delete`;
        dispatch(deleteAnnouncementRequest());
        promise.then(
            (response): void => {
                dispatch(deleteAnnouncementSuccess(response.data));
            },
            (error): void => {
                dispatch(deleteAnnouncementFailure(error));
            }
        );
        return promise;
    };
}

// Calls the API to delete StatusPages after deleting the project

export const deleteProjectStatusPages: Function = (
    projectId: ObjectID
): void => {
    return {
        type: types.DELETE_PROJECT_STATUSPAGES,
        payload: projectId,
    };
};

// Logo

export const createLogoCache: Function = (imageUrl: URL): void => {
    return {
        type: types.LOGO_CACHE_INSERT,
        payload: imageUrl,
    };
};

// Banner
export const createBannerCache: Function = (imageUrl: URL): void => {
    return {
        type: types.BANNER_CACHE_INSERT,
        payload: imageUrl,
    };
};

export const resetBannerCache: Function = (): void => {
    return {
        type: types.BANNER_CACHE_RESET,
    };
};

export const setStatusPageColors: Function = (color: $TSFixMe): void => {
    return {
        type: types.SET_STATUS_PAGE_COLORS,
        payload: color,
    };
};

export const createFaviconCache: Function = (imageUrl: URL): void => {
    return {
        type: types.FAVICON_CACHE_INSERT,
        payload: imageUrl,
    };
};

export const resetLogoCache: Function = (): void => {
    return {
        type: types.LOGO_CACHE_RESET,
    };
};

export const resetFaviconCache: Function = (): void => {
    return {
        type: types.FAVICON_CACHE_RESET,
    };
};

export const switchStatusPage: Function = (statusPage: $TSFixMe): void => {
    return {
        type: types.SWITCH_STATUSPAGE_SUCCESS,
        payload: statusPage,
    };
};
