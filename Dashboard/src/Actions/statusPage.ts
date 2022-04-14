import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ObjectID from 'Common/Types/ObjectID';
import * as types from '../constants/statusPage';
import FormData from 'form-data';
import ErrorPayload from 'CommonUI/src/payload-types/error';
import PositiveNumber from 'Common/Types/PositiveNumber';
// handle whether to show domain input field
export const addMoreDomain = (): void => {
    return {
        type: types.ADD_MORE_DOMAIN,
    };
};

export const cancelAddMoreDomain = (): void => {
    return {
        type: types.CANCEL_ADD_MORE_DOMAIN,
    };
};

// upload cert file
export const uploadCertFileRequest = (): void => {
    return {
        type: 'CERT_FILE_REQUEST',
    };
};

export const uploadCertFileSuccess = (filename: $TSFixMe): void => {
    return {
        type: 'CERT_FILE_SUCCESS',
        payload: filename,
    };
};

export const uploadCertFileFailure = (error: ErrorPayload): void => {
    return {
        type: 'CERT_FILE_ERROR',
        payload: error,
    };
};

export const removeCertFile = (): void => {
    return {
        type: 'REMOVE_CERT_FILE',
    };
};

export const uploadCertFile = (projectId: ObjectID, file: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        const data = new FormData();
        if (file) {
            data.append('cert', file);

            const promise = BackendAPI.post(
                `StatusPage/${projectId}/certFile`,
                data
            );
            dispatch(uploadCertFileRequest());
            promise.then(
                (response): void => {
                    const data = response.data;
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
export const uploadPrivateKeyRequest = (): void => {
    return {
        type: 'PRIVATE_KEY_REQUEST',
    };
};

export const uploadPrivateKeySuccess = (filename: $TSFixMe): void => {
    return {
        type: 'PRIVATE_KEY_SUCCESS',
        payload: filename,
    };
};

export const uploadPrivateKeyFailure = (error: ErrorPayload): void => {
    return {
        type: 'PRIVATE_KEY_ERROR',
        payload: error,
    };
};

export const removePrivateKeyFile = (): void => {
    return {
        type: 'REMOVE_PRIVATE_KEY',
    };
};

export const uploadPrivateKey = (projectId: ObjectID, file: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        const data = new FormData();
        if (file) {
            data.append('privateKey', file);

            const promise = BackendAPI.post(
                `StatusPage/${projectId}/privateKeyFile`,
                data
            );
            dispatch(uploadPrivateKeyRequest());
            promise.then(
                (response): void => {
                    const data = response.data;
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

export const updateStatusPageSettingRequest = (): void => {
    return {
        type: types.UPDATE_STATUSPAGE_SETTING_REQUEST,
    };
};

export const updateStatusPageSettingSuccess = (statusPage: $TSFixMe): void => {
    return {
        type: types.UPDATE_STATUSPAGE_SETTING_SUCCESS,
        payload: statusPage,
    };
};

export const updateStatusPageSettingError = (error: ErrorPayload): void => {
    return {
        type: types.UPDATE_STATUSPAGE_SETTING_FAILURE,
        payload: error,
    };
};

// Calls the API to update setting.
export const updateStatusPageSetting = (
    projectId: ObjectID,
    data: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.put(`StatusPage/${projectId}`, data);
        dispatch(updateStatusPageSettingRequest());
        promise.then(
            (response): void => {
                const statusPage = response.data;
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

export const updateStatusPageMonitorsRequest = (): void => {
    return {
        type: types.UPDATE_STATUSPAGE_MONITORS_REQUEST,
    };
};

export const updateStatusPageMonitorsSuccess = (statusPage: $TSFixMe): void => {
    return {
        type: types.UPDATE_STATUSPAGE_MONITORS_SUCCESS,
        payload: statusPage,
    };
};

export const updateStatusPageMonitorsError = (error: ErrorPayload): void => {
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
        const promise = BackendAPI.put(`StatusPage/${projectId}`, values);
        dispatch(updateStatusPageMonitorsRequest());

        promise.then(
            (response): void => {
                const statusPage = response.data;
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

export const updatePrivateStatusPageRequest = (): void => {
    return {
        type: types.UPDATE_PRIVATE_STATUSPAGE_REQUEST,
    };
};

export const updatePrivateStatusPageSuccess = (statusPage: $TSFixMe): void => {
    return {
        type: types.UPDATE_PRIVATE_STATUSPAGE_SUCCESS,
        payload: statusPage,
    };
};

export const updatePrivateStatusPageError = (error: ErrorPayload): void => {
    return {
        type: types.UPDATE_PRIVATE_STATUSPAGE_FAILURE,
        payload: error,
    };
};

// Calls the API to update private statuspages.
export const updatePrivateStatusPage = (
    projectId: ObjectID,
    values: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.put(`StatusPage/${projectId}`, values);
        dispatch(updatePrivateStatusPageRequest());

        promise.then(
            (response): void => {
                const statusPage = response.data;
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
export const updateSubscriberOptionRequest = (): void => {
    return {
        type: types.UPDATE_SUBSCRIBER_OPTION_REQUEST,
    };
};

export const updateSubscriberOptionSuccess = (statusPage: $TSFixMe): void => {
    return {
        type: types.UPDATE_SUBSCRIBER_OPTION_SUCCESS,
        payload: statusPage,
    };
};

export const updateSubscriberOptionError = (error: ErrorPayload): void => {
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
        const promise = BackendAPI.put(`StatusPage/${projectId}`, values);
        dispatch(updateStatusPageLanguageRequest());

        promise.then(
            (response): void => {
                const statusPage = response.data;
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
export const updateStatusPageLanguageRequest = (): void => {
    return {
        type: types.UPDATE_MULTIPLE_LANGUAGE_REQUEST,
    };
};

export const updateStatusPageLanguageSuccess = (statusPage: $TSFixMe): void => {
    return {
        type: types.UPDATE_MULTIPLE_LANGUAGE_SUCCESS,
        payload: statusPage,
    };
};

export const updateStatusPageLanguageError = (error: ErrorPayload): void => {
    return {
        type: types.UPDATE_MULTIPLE_LANGUAGE_FAILURE,
        payload: error,
    };
};

// Calls the API to update private statuspages.
export const updateSubscriberOption = (
    projectId: ObjectID,
    values: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.put(`StatusPage/${projectId}`, values);
        dispatch(updateSubscriberOptionRequest());

        promise.then(
            (response): void => {
                const statusPage = response.data;
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
export const updateStatusSuccess = (data: $TSFixMe): void => {
    return {
        type: types.UPDATE_STATUSPAGE_SUCCESS,
        payload: data,
    };
};

export const updateStatusPageBrandingRequest = (): void => {
    return {
        type: types.UPDATE_STATUSPAGE_BRANDING_REQUEST,
    };
};

export const updateStatusPageBrandingSuccess = (statusPage: $TSFixMe): void => {
    return {
        type: types.UPDATE_STATUSPAGE_BRANDING_SUCCESS,
        payload: statusPage,
    };
};

export const updateStatusPageBrandingError = (error: ErrorPayload): void => {
    return {
        type: types.UPDATE_STATUSPAGE_BRANDING_FAILURE,
        payload: error,
    };
};

// Update status page name
export const updateStatusPageNameRequest = (): void => {
    return {
        type: types.UPDATE_STATUSPAGE_NAME_REQUEST,
    };
};

export const updateStatusPageNameSuccess = (statusPage: $TSFixMe): void => {
    return {
        type: types.UPDATE_STATUSPAGE_NAME_SUCCESS,
        payload: statusPage,
    };
};

export const updateStatusPageNameError = (error: ErrorPayload): void => {
    return {
        type: types.UPDATE_STATUSPAGE_NAME_FAILURE,
        payload: error,
    };
};

// Update status page theme
export const updateStatusPageThemeRequest = (): void => {
    return {
        type: types.UPDATE_STATUSPAGE_THEME_REQUEST,
    };
};

export const updateStatusPageThemeSuccess = (statusPage: $TSFixMe): void => {
    return {
        type: types.UPDATE_STATUSPAGE_THEME_SUCCESS,
        payload: statusPage,
    };
};

export const updateStatusPageThemeError = (error: ErrorPayload): void => {
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
        const data = new FormData();
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

        const promise = BackendAPI.put(`StatusPage/${projectId}`, data);
        dispatch(updateStatusPageBrandingRequest());

        promise.then(
            (response): void => {
                const statusPage = response.data;
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
export const updateTheme = (projectId: ObjectID, data: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.put(`StatusPage/${projectId}/theme`, data);
        dispatch(updateStatusPageThemeRequest());

        promise.then(
            (response): void => {
                const statusPage = response.data;
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
export const updateStatusPageName = (
    projectId: ObjectID,
    values: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.put(`StatusPage/${projectId}`, values);
        dispatch(updateStatusPageNameRequest());

        promise.then(
            (response): void => {
                const statusPage = response.data;
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

export const updateStatusPageLinksRequest = (): void => {
    return {
        type: types.UPDATE_STATUSPAGE_LINKS_REQUEST,
    };
};

export const updateStatusPageLinksSuccess = (statusPage: $TSFixMe): void => {
    return {
        type: types.UPDATE_STATUSPAGE_LINKS_SUCCESS,
        payload: statusPage,
    };
};

export const updateStatusPageLinksError = (error: ErrorPayload): void => {
    return {
        type: types.UPDATE_STATUSPAGE_LINKS_FAILURE,
        payload: error,
    };
};

// Calls the API to update links.
export const updateStatusPageLinks = (
    projectId: ObjectID,
    values: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.put(`StatusPage/${projectId}`, values);
        dispatch(updateStatusPageLinksRequest());

        promise.then(
            (response): void => {
                const statusPage = response.data;
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

export const updateStatusPageCustomHTMLRequest = (): void => {
    return {
        type: types.UPDATE_STATUSPAGE_CUSTOM_HTML_REQUEST,
    };
};

export const updateStatusPageCustomHTMLSuccess = (
    statusPage: $TSFixMe
): void => {
    return {
        type: types.UPDATE_STATUSPAGE_CUSTOM_HTML_SUCCESS,
        payload: statusPage,
    };
};

export const updateStatusPageCustomHTMLError = (error: ErrorPayload): void => {
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
        const promise = BackendAPI.put(`StatusPage/${projectId}`, values);
        dispatch(updateStatusPageCustomHTMLRequest());

        promise.then(
            (response): void => {
                const statusPage = response.data;
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

export const fetchProjectStatusPageRequest = (): void => {
    return {
        type: types.FETCH_PROJECT_STATUSPAGE_REQUEST,
    };
};

export const resetProjectFetchStatusPage = (): void => {
    return {
        type: types.FETCH_PROJECT_STATUSPAGE_RESET,
    };
};

export const fetchProjectStatusPageSuccess = (statusPage: $TSFixMe): void => {
    return {
        type: types.FETCH_PROJECT_STATUSPAGE_SUCCESS,
        payload: statusPage,
    };
};

export const fetchProjectStatusPageError = (error: ErrorPayload): void => {
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
        const promise = BackendAPI.get(
            `StatusPage/${projectId}/statuspage?skip=${skip}&limit=${limit}`
        );
        if (!refresh) {
            dispatch(fetchProjectStatusPageRequest());
        }

        promise.then(
            (response): void => {
                const data = response.data;
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

export const fetchSubProjectStatusPagesRequest = (): void => {
    return {
        type: types.FETCH_SUBPROJECT_STATUSPAGE_REQUEST,
    };
};

export const resetSubProjectFetchStatusPages = (): void => {
    return {
        type: types.FETCH_SUBPROJECT_STATUSPAGE_RESET,
    };
};

export const fetchSubProjectStatusPagesSuccess = (
    statusPage: $TSFixMe
): void => {
    return {
        type: types.FETCH_SUBPROJECT_STATUSPAGE_SUCCESS,
        payload: statusPage,
    };
};

export const fetchSubProjectStatusPagesError = (error: ErrorPayload): void => {
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
        const promise = BackendAPI.get(`StatusPage/${projectId}/StatusPages`);
        if (!refresh) {
            dispatch(fetchSubProjectStatusPagesRequest());
        }

        promise.then(
            (response): void => {
                const data = response.data;
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
export const fetchIncidentStatusPagesRequest = (): void => {
    return {
        type: types.FETCH_INCIDENT_STATUSPAGE_REQUEST,
    };
};

export const resetIncidentFetchStatusPages = (): void => {
    return {
        type: types.FETCH_INCIDENT_STATUSPAGE_RESET,
    };
};

export const fetchIncidentStatusPagesSuccess = (
    incidentStatusPages: $TSFixMe
): void => {
    return {
        type: types.FETCH_INCIDENT_STATUSPAGE_SUCCESS,
        payload: incidentStatusPages,
    };
};

export const fetchIncidentStatusPagesError = (error: ErrorPayload): void => {
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
        const promise = BackendAPI.get(
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
export const resetStatusBubbleIdRequest = (): void => {
    return {
        type: types.RESET_STATUS_BUBBLE_ID_REQUEST,
    };
};

export const resetStatusBubbleIdSuccess = (statusPage: $TSFixMe): void => {
    return {
        type: types.RESET_STATUS_BUBBLE_ID_SUCCESS,
        payload: statusPage,
    };
};

export const resetStatusBubbleIdError = (error: ErrorPayload): void => {
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
        const promise = BackendAPI.put(
            `StatusPage/${projectId}/${statusPageId}/resetBubbleId`,
            {}
        );
        dispatch(resetStatusBubbleIdRequest());
        promise.then(
            (response): void => {
                const statusPage = response.data;
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
export const deleteStatusPageRequest = (): void => {
    return {
        type: types.DELETE_STATUSPAGE_REQUEST,
    };
};

export const deleteStatusPageReset = (): void => {
    return {
        type: types.DELETE_STATUSPAGE_RESET,
    };
};

export const deleteStatusPageSuccess = (statusPage: $TSFixMe): void => {
    return {
        type: types.DELETE_STATUSPAGE_SUCCESS,
        payload: statusPage,
    };
};

export const deleteStatusPageError = (error: ErrorPayload): void => {
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
        const promise = delete (`StatusPage/${projectId}/${statusPageSlug}`,
        null);
        dispatch(deleteStatusPageRequest());
        promise.then(
            (response): void => {
                const data = response.data;
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
export const duplicateStatusPageRequest = (): void => {
    return {
        type: types.DUPLICATE_STATUSPAGE_REQUEST,
    };
};

export const duplicateStatusPageSuccess = (statusPage: $TSFixMe): void => {
    return {
        type: types.DUPLICATE_STATUSPAGE_SUCCESS,
        payload: statusPage,
    };
};

export const duplicateStatusPageError = (error: ErrorPayload): void => {
    return {
        type: types.DUPLICATE_STATUSPAGE_FAILURE,
        payload: error,
    };
};

export const readStatusPage = (
    statusPageSlug: $TSFixMe,
    data: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(`StatusPage/${statusPageSlug}`, data);
        dispatch(duplicateStatusPageRequest());
        promise.then(
            (response): void => {
                const statusPageData = response.data;
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
        const url = subProjectId
            ? `StatusPage/${projectId}/${statusPageSlug}/duplicateStatusPage?subProjectId=${subProjectId}`
            : `StatusPage/${projectId}/${statusPageSlug}/duplicateStatusPage`;
        const promise = BackendAPI.post(url, data);
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

export const fetchStatusPage = (statusPageSlug: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(`StatusPage/${statusPageSlug}`);
        promise.then(
            (response): void => {
                const statusPageData = response.data;
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

export const duplicateStatusPageReset = (): void => {
    return {
        type: types.DUPLICATE_STATUSPAGE_RESET,
    };
};

//Update status page embedded css

export const updateStatusPageEmbeddedCssRequest = (): void => {
    return {
        type: types.UPDATE_STATUSPAGE_EMBEDDED_CSS_REQUEST,
    };
};

export const updateStatusPageEmbeddedCssSuccess = (
    statusPage: $TSFixMe
): void => {
    return {
        type: types.UPDATE_STATUSPAGE_EMBEDDED_CSS_SUCCESS,
        payload: statusPage,
    };
};

export const updateStatusPageEmbeddedCssError = (error: ErrorPayload): void => {
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
        const promise = BackendAPI.put(`StatusPage/${projectId}`, data);
        dispatch(updateStatusPageEmbeddedCssRequest());
        promise.then(
            (response): void => {
                const statusPage = response.data;
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
export const resetBrandingColorsRequest = (): void => {
    return {
        type: types.RESET_BRANDING_COLORS_REQUEST,
    };
};

export const resetBrandingColorsSuccess = (colors: $TSFixMe): void => {
    return {
        type: types.RESET_BRANDING_COLORS_SUCCESS,
        payload: colors,
    };
};

export const resetBrandingColorsError = (error: ErrorPayload): void => {
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
        const promise = BackendAPI.put(
            `StatusPage/${projectId}/${statusPageId}/resetColors`
        );
        dispatch(resetBrandingColorsRequest());
        promise.then(
            (response): void => {
                const colors = response.data;
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

export const resetStatusPageEmbeddedCssRequest = (): void => {
    return {
        type: types.RESET_STATUSPAGE_EMBEDDED_CSS_REQUEST,
    };
};

export const resetStatusPageEmbeddedCssSuccess = (
    statusPage: $TSFixMe
): void => {
    return {
        type: types.RESET_STATUSPAGE_EMBEDDED_CSS_SUCCESS,
        payload: statusPage,
    };
};

export const resetStatusPageEmbeddedCssError = (error: ErrorPayload): void => {
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
        const promise = BackendAPI.put(`StatusPage/${projectId}`, data);
        dispatch(resetStatusPageEmbeddedCssRequest());
        promise.then(
            (response): void => {
                const statusPage = response.data;
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
export const updateStatusPageLayoutRequest = (): void => {
    return {
        type: types.UPDATE_STATUS_PAGE_LAYOUT_REQUEST,
    };
};

export const updateStatusPageLayoutSuccess = (statusPage: $TSFixMe): void => {
    return {
        type: types.UPDATE_STATUS_PAGE_LAYOUT_SUCCESS,
        payload: statusPage,
    };
};

export const updateStatusPageLayoutError = (error: ErrorPayload): void => {
    return {
        type: types.UPDATE_STATUS_PAGE_LAYOUT_FAILURE,
        payload: error,
    };
};

export const updateStatusPageLayout = (
    projectId: ObjectID,
    data: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.put(`StatusPage/${projectId}`, data);
        dispatch(updateStatusPageLayoutRequest());
        promise.then(
            (response): void => {
                const statusPage = response.data;
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
export const fetchSubscriberRequest = (): void => {
    return {
        type: types.FETCH_SUBSCRIBER_REQUEST,
    };
};

export const fetchSubscriberSuccess = (data: $TSFixMe): void => {
    return {
        type: types.FETCH_SUBSCRIBER_SUCCESS,
        payload: data,
    };
};

export const fetchSubscriberFailure = (error: ErrorPayload): void => {
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
        const promise = BackendAPI.get(
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

export const createExternalStatusPageRequest = (): void => {
    return {
        type: types.CREATE_EXTERNAL_STATUSPAGE_REQUEST,
    };
};

export const createExternalStatusPageSuccess = (data: $TSFixMe): void => {
    return {
        type: types.CREATE_EXTERNAL_STATUSPAGE_SUCCESS,
        payload: data,
    };
};

export const createExternalStatusPageFailure = (error: ErrorPayload): void => {
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
        const promise = BackendAPI.post(
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

export const updateExternalStatusPageRequest = (): void => {
    return {
        type: types.UPDATE_EXTERNAL_STATUSPAGE_REQUEST,
    };
};

export const updateExternalStatusPageSuccess = (data: $TSFixMe): void => {
    return {
        type: types.UPDATE_EXTERNAL_STATUSPAGE_SUCCESS,
        payload: data,
    };
};

export const updateExternalStatusPageFailure = (error: ErrorPayload): void => {
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
        const promise = BackendAPI.post(
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

export const fetchExternalStatusPagesRequest = (): void => {
    return {
        type: types.FETCH_EXTERNAL_STATUSPAGES_REQUEST,
    };
};

export const fetchExternalStatusPagesSuccess = (data: $TSFixMe): void => {
    return {
        type: types.FETCH_EXTERNAL_STATUSPAGES_SUCCESS,
        payload: data,
    };
};

export const fetchExternalStatusPagesFailure = (error: ErrorPayload): void => {
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
        const promise = BackendAPI.get(
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

export const deleteExternalStatusPageRequest = (): void => {
    return {
        type: types.DELETE_EXTERNAL_STATUSPAGE_REQUEST,
    };
};

export const deleteExternalStatusPageSuccess = (data: $TSFixMe): void => {
    return {
        type: types.DELETE_EXTERNAL_STATUSPAGE_SUCCESS,
        payload: data,
    };
};

export const deleteExternalStatusPageFailure = (error: ErrorPayload): void => {
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
        const promise = BackendAPI.post(
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

export const createAnnouncementRequest = (): void => {
    return {
        type: types.CREATE_ANNOUNCEMEMT_REQUEST,
    };
};

export const createAnnouncementSuccess = (data: $TSFixMe): void => {
    return {
        type: types.CREATE_ANNOUNCEMEMT_SUCCESS,
        payload: data,
    };
};

export const createAnnouncementFailure = (error: ErrorPayload): void => {
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
        const promise = BackendAPI.post(
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
        const promise = BackendAPI.put(
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

export const fetchAnnouncementRequest = (): void => {
    return {
        type: types.FETCH_ANNOUNCEMEMT_REQUEST,
    };
};

export const fetchAnnouncementSuccess = (data: $TSFixMe): void => {
    return {
        type: types.FETCH_ANNOUNCEMEMT_SUCCESS,
        payload: data,
    };
};

export const fetchAnnouncementFailure = (error: ErrorPayload): void => {
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
        const promise = BackendAPI.get(
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

export const fetchAnnouncementLogsRequest = (): void => {
    return {
        type: types.FETCH_ANNOUNCEMEMTLOGS_REQUEST,
    };
};

export const fetchAnnouncementLogsSuccess = (data: $TSFixMe): void => {
    return {
        type: types.FETCH_ANNOUNCEMEMTLOGS_SUCCESS,
        payload: data,
    };
};

export const fetchAnnouncementLogsFailure = (error: ErrorPayload): void => {
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
        const promise = BackendAPI.get(
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

export const fetchSingleAnnouncementSuccess = (data: $TSFixMe): void => {
    return {
        type: types.FETCH_SINCLE_ANNOUNCEMENT_SUCCESS,
        payload: data,
    };
};

export const fetchSingleAnnouncementFailure = (error: ErrorPayload): void => {
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
        const promise = BackendAPI.get(
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

export const handleAnnouncementSuccess = (data: $TSFixMe): void => {
    return {
        type: types.HANDLE_ANNOUNCEMENT_SUCCESS,
        payload: data,
    };
};

export const handleAnnouncementFailure = (error: ErrorPayload): void => {
    return {
        type: types.HANDLE_ANNOUNCEMENT_FAILURE,
        payload: error,
    };
};

export const resetHandleAnnouncement = (): void => {
    return {
        type: types.RESET_HANDLE_ANNOUNCEMENT,
    };
};

export const resetDeleteAnnouncement = (): void => {
    return {
        type: types.RESET_DELETE_ANNOUNCEMENT,
    };
};

export const deleteAnnouncementRequest = (): void => {
    return {
        type: types.DELETE_ANNOUNCEMENT_REQUEST,
    };
};

export const deleteAnnouncementSuccess = (data: $TSFixMe): void => {
    return {
        type: types.DELETE_ANNOUNCEMENT_SUCCESS,
        payload: data,
    };
};

export const deleteAnnouncementFailure = (error: ErrorPayload): void => {
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
        const promise =
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
        const promise =
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

export const deleteProjectStatusPages = (projectId: ObjectID): void => {
    return {
        type: types.DELETE_PROJECT_STATUSPAGES,
        payload: projectId,
    };
};

// Logo

export const createLogoCache = (imageUrl: URL): void => {
    return {
        type: types.LOGO_CACHE_INSERT,
        payload: imageUrl,
    };
};

// Banner
export const createBannerCache = (imageUrl: URL): void => {
    return {
        type: types.BANNER_CACHE_INSERT,
        payload: imageUrl,
    };
};

export const resetBannerCache = (): void => {
    return {
        type: types.BANNER_CACHE_RESET,
    };
};

export const setStatusPageColors = (color: $TSFixMe): void => {
    return {
        type: types.SET_STATUS_PAGE_COLORS,
        payload: color,
    };
};

export const createFaviconCache = (imageUrl: URL): void => {
    return {
        type: types.FAVICON_CACHE_INSERT,
        payload: imageUrl,
    };
};

export const resetLogoCache = (): void => {
    return {
        type: types.LOGO_CACHE_RESET,
    };
};

export const resetFaviconCache = (): void => {
    return {
        type: types.FAVICON_CACHE_RESET,
    };
};

export const switchStatusPage = (statusPage: $TSFixMe): void => {
    return {
        type: types.SWITCH_STATUSPAGE_SUCCESS,
        payload: statusPage,
    };
};
