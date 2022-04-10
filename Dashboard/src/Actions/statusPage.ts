import BackendAPI from 'Common-ui/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/statusPage';
import FormData from 'form-data';
import ErrorPayload from 'Common-ui/src/payload-types/error';
import PositiveNumber from 'Common/Types/PositiveNumber';
// handle whether to show domain input field
export const addMoreDomain = () => {
    return {
        type: types.ADD_MORE_DOMAIN,
    };
};

export const cancelAddMoreDomain = () => {
    return {
        type: types.CANCEL_ADD_MORE_DOMAIN,
    };
};

// upload cert file
export const uploadCertFileRequest = () => {
    return {
        type: 'CERT_FILE_REQUEST',
    };
};

export const uploadCertFileSuccess = (filename: $TSFixMe) => {
    return {
        type: 'CERT_FILE_SUCCESS',
        payload: filename,
    };
};

export const uploadCertFileFailure = (error: ErrorPayload) => {
    return {
        type: 'CERT_FILE_ERROR',
        payload: error,
    };
};

export const removeCertFile = () => {
    return {
        type: 'REMOVE_CERT_FILE',
    };
};

export const uploadCertFile = (projectId: string, file: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const data = new FormData();
        if (file) {
            data.append('cert', file);

            const promise = BackendAPI.post(
                `status-page/${projectId}/certFile`,
                data
            );
            dispatch(uploadCertFileRequest());
            promise.then(
                function (response) {
                    const data = response.data;
                    dispatch(uploadCertFileSuccess(data.cert));
                    return data;
                },
                function (error) {
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
                    dispatch(uploadCertFileFailure(error));
                }
            );

            return promise;
        }
    };
};

// upload private key file
export const uploadPrivateKeyRequest = () => {
    return {
        type: 'PRIVATE_KEY_REQUEST',
    };
};

export const uploadPrivateKeySuccess = (filename: $TSFixMe) => {
    return {
        type: 'PRIVATE_KEY_SUCCESS',
        payload: filename,
    };
};

export const uploadPrivateKeyFailure = (error: ErrorPayload) => {
    return {
        type: 'PRIVATE_KEY_ERROR',
        payload: error,
    };
};

export const removePrivateKeyFile = () => {
    return {
        type: 'REMOVE_PRIVATE_KEY',
    };
};

export const uploadPrivateKey = (projectId: string, file: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const data = new FormData();
        if (file) {
            data.append('privateKey', file);

            const promise = BackendAPI.post(
                `status-page/${projectId}/privateKeyFile`,
                data
            );
            dispatch(uploadPrivateKeyRequest());
            promise.then(
                function (response) {
                    const data = response.data;
                    dispatch(uploadPrivateKeySuccess(data.privateKey));
                    return data;
                },
                function (error) {
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
                    dispatch(uploadPrivateKeyFailure(error));
                }
            );

            return promise;
        }
    };
};

//Update status page setting

export const updateStatusPageSettingRequest = () => {
    return {
        type: types.UPDATE_STATUSPAGE_SETTING_REQUEST,
    };
};

export const updateStatusPageSettingSuccess = (statusPage: $TSFixMe) => {
    return {
        type: types.UPDATE_STATUSPAGE_SETTING_SUCCESS,
        payload: statusPage,
    };
};

export const updateStatusPageSettingError = (error: ErrorPayload) => {
    return {
        type: types.UPDATE_STATUSPAGE_SETTING_FAILURE,
        payload: error,
    };
};

// Calls the API to update setting.
export const updateStatusPageSetting = (projectId: string, data: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.put(`status-page/${projectId}`, data);
        dispatch(updateStatusPageSettingRequest());
        promise.then(
            function (response) {
                const statusPage = response.data;
                dispatch(updateStatusPageSettingSuccess(statusPage));

                dispatch(fetchProjectStatusPage(projectId, true));
            },
            function (error) {
                dispatch(updateStatusPageSettingError(error));
            }
        );

        return promise;
    };
};

//Update status page monitors

export const updateStatusPageMonitorsRequest = () => {
    return {
        type: types.UPDATE_STATUSPAGE_MONITORS_REQUEST,
    };
};

export const updateStatusPageMonitorsSuccess = (statusPage: $TSFixMe) => {
    return {
        type: types.UPDATE_STATUSPAGE_MONITORS_SUCCESS,
        payload: statusPage,
    };
};

export const updateStatusPageMonitorsError = (error: ErrorPayload) => {
    return {
        type: types.UPDATE_STATUSPAGE_MONITORS_FAILURE,
        payload: error,
    };
};

// Calls the API to update monitors.
export function updateStatusPageMonitors(projectId: string, values: $TSFixMe) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.put(`status-page/${projectId}`, values);
        dispatch(updateStatusPageMonitorsRequest());

        promise.then(
            function (response) {
                const statusPage = response.data;
                dispatch(updateStatusPageMonitorsSuccess(statusPage));
            },
            function (error) {
                dispatch(updateStatusPageMonitorsError(error));
            }
        );
        return promise;
    };
}

//Update private status page Main box

export const updatePrivateStatusPageRequest = () => {
    return {
        type: types.UPDATE_PRIVATE_STATUSPAGE_REQUEST,
    };
};

export const updatePrivateStatusPageSuccess = (statusPage: $TSFixMe) => {
    return {
        type: types.UPDATE_PRIVATE_STATUSPAGE_SUCCESS,
        payload: statusPage,
    };
};

export const updatePrivateStatusPageError = (error: ErrorPayload) => {
    return {
        type: types.UPDATE_PRIVATE_STATUSPAGE_FAILURE,
        payload: error,
    };
};

// Calls the API to update private statuspages.
export const updatePrivateStatusPage = (
    projectId: string,
    values: $TSFixMe
) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.put(`status-page/${projectId}`, values);
        dispatch(updatePrivateStatusPageRequest());

        promise.then(
            function (response) {
                const statusPage = response.data;
                dispatch(updatePrivateStatusPageSuccess(statusPage));
                dispatch(updateStatusSuccess(statusPage));
            },
            function (error) {
                dispatch(updatePrivateStatusPageError(error));
            }
        );
        return promise;
    };
};
// Update status page advanace subscriber options.
export const updateSubscriberOptionRequest = () => {
    return {
        type: types.UPDATE_SUBSCRIBER_OPTION_REQUEST,
    };
};

export const updateSubscriberOptionSuccess = (statusPage: $TSFixMe) => {
    return {
        type: types.UPDATE_SUBSCRIBER_OPTION_SUCCESS,
        payload: statusPage,
    };
};

export const updateSubscriberOptionError = (error: ErrorPayload) => {
    return {
        type: types.UPDATE_SUBSCRIBER_OPTION_FAILURE,
        payload: error,
    };
};

// update status page multi language
export function updateStatusPageLanguage(projectId: string, values: $TSFixMe) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.put(`status-page/${projectId}`, values);
        dispatch(updateStatusPageLanguageRequest());

        promise.then(
            function (response) {
                const statusPage = response.data;
                dispatch(updateStatusPageLanguageSuccess(statusPage));
                dispatch(updateStatusSuccess(statusPage));
            },
            function (error) {
                dispatch(updateStatusPageLanguageError(error));
            }
        );
        return promise;
    };
}
// Update status page advanace subscriber options.
export const updateStatusPageLanguageRequest = () => {
    return {
        type: types.UPDATE_MULTIPLE_LANGUAGE_REQUEST,
    };
};

export const updateStatusPageLanguageSuccess = (statusPage: $TSFixMe) => {
    return {
        type: types.UPDATE_MULTIPLE_LANGUAGE_SUCCESS,
        payload: statusPage,
    };
};

export const updateStatusPageLanguageError = (error: ErrorPayload) => {
    return {
        type: types.UPDATE_MULTIPLE_LANGUAGE_FAILURE,
        payload: error,
    };
};

// Calls the API to update private statuspages.
export const updateSubscriberOption = (projectId: string, values: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.put(`status-page/${projectId}`, values);
        dispatch(updateSubscriberOptionRequest());

        promise.then(
            function (response) {
                const statusPage = response.data;
                dispatch(updateSubscriberOptionSuccess(statusPage));
            },
            function (error) {
                dispatch(updateSubscriberOptionError(error));
            }
        );
        return promise;
    };
};
// Update status page branding
export const updateStatusSuccess = (data: $TSFixMe) => {
    return {
        type: types.UPDATE_STATUSPAGE_SUCCESS,
        payload: data,
    };
};

export const updateStatusPageBrandingRequest = () => {
    return {
        type: types.UPDATE_STATUSPAGE_BRANDING_REQUEST,
    };
};

export const updateStatusPageBrandingSuccess = (statusPage: $TSFixMe) => {
    return {
        type: types.UPDATE_STATUSPAGE_BRANDING_SUCCESS,
        payload: statusPage,
    };
};

export const updateStatusPageBrandingError = (error: ErrorPayload) => {
    return {
        type: types.UPDATE_STATUSPAGE_BRANDING_FAILURE,
        payload: error,
    };
};

// Update status page name
export const updateStatusPageNameRequest = () => {
    return {
        type: types.UPDATE_STATUSPAGE_NAME_REQUEST,
    };
};

export const updateStatusPageNameSuccess = (statusPage: $TSFixMe) => {
    return {
        type: types.UPDATE_STATUSPAGE_NAME_SUCCESS,
        payload: statusPage,
    };
};

export const updateStatusPageNameError = (error: ErrorPayload) => {
    return {
        type: types.UPDATE_STATUSPAGE_NAME_FAILURE,
        payload: error,
    };
};

// Update status page theme
export const updateStatusPageThemeRequest = () => {
    return {
        type: types.UPDATE_STATUSPAGE_THEME_REQUEST,
    };
};

export const updateStatusPageThemeSuccess = (statusPage: $TSFixMe) => {
    return {
        type: types.UPDATE_STATUSPAGE_THEME_SUCCESS,
        payload: statusPage,
    };
};

export const updateStatusPageThemeError = (error: ErrorPayload) => {
    return {
        type: types.UPDATE_STATUSPAGE_THEME_FAILURE,
        payload: error,
    };
};

// Calls the API to update branding.
export function updateStatusPageBranding(projectId: string, values: $TSFixMe) {
    return function (dispatch: Dispatch) {
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
        if (values.colors) data.append('colors', JSON.stringify(values.colors));

        if (values._id) data.append('_id', values._id);

        const promise = BackendAPI.put(`status-page/${projectId}`, data);
        dispatch(updateStatusPageBrandingRequest());

        promise.then(
            function (response) {
                const statusPage = response.data;
                dispatch(updateStatusPageBrandingSuccess(statusPage));
            },
            function (error) {
                dispatch(updateStatusPageBrandingError(error));
            }
        );
        return promise;
    };
}

// Calls the API to update the theme
export const updateTheme = (projectId: string, data: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.put(`status-page/${projectId}/theme`, data);
        dispatch(updateStatusPageThemeRequest());

        promise.then(
            function (response) {
                const statusPage = response.data;
                dispatch(updateStatusPageThemeSuccess(statusPage));
                dispatch(updateStatusSuccess(statusPage));
            },
            function (error) {
                dispatch(updateStatusPageThemeError(error));
            }
        );
        return promise;
    };
};

// Calls the API to update status page name.
export const updateStatusPageName = (projectId: string, values: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.put(`status-page/${projectId}`, values);
        dispatch(updateStatusPageNameRequest());

        promise.then(
            function (response) {
                const statusPage = response.data;
                dispatch(updateStatusPageNameSuccess(statusPage));
            },
            function (error) {
                dispatch(updateStatusPageNameError(error));
            }
        );
        return promise;
    };
};

//Update status page links

export const updateStatusPageLinksRequest = () => {
    return {
        type: types.UPDATE_STATUSPAGE_LINKS_REQUEST,
    };
};

export const updateStatusPageLinksSuccess = (statusPage: $TSFixMe) => {
    return {
        type: types.UPDATE_STATUSPAGE_LINKS_SUCCESS,
        payload: statusPage,
    };
};

export const updateStatusPageLinksError = (error: ErrorPayload) => {
    return {
        type: types.UPDATE_STATUSPAGE_LINKS_FAILURE,
        payload: error,
    };
};

// Calls the API to update links.
export const updateStatusPageLinks = (projectId: string, values: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.put(`status-page/${projectId}`, values);
        dispatch(updateStatusPageLinksRequest());

        promise.then(
            function (response) {
                const statusPage = response.data;
                dispatch(updateStatusPageLinksSuccess(statusPage));
            },
            function (error) {
                dispatch(updateStatusPageLinksError(error));
            }
        );
        return promise;
    };
};

//Update status page links

export const updateStatusPageCustomHTMLRequest = () => {
    return {
        type: types.UPDATE_STATUSPAGE_CUSTOM_HTML_REQUEST,
    };
};

export const updateStatusPageCustomHTMLSuccess = (statusPage: $TSFixMe) => {
    return {
        type: types.UPDATE_STATUSPAGE_CUSTOM_HTML_SUCCESS,
        payload: statusPage,
    };
};

export const updateStatusPageCustomHTMLError = (error: ErrorPayload) => {
    return {
        type: types.UPDATE_STATUSPAGE_CUSTOM_HTML_FAILURE,
        payload: error,
    };
};

// Calls the API to update links.
export function updateStatusPageCustomHTML(
    projectId: string,
    values: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.put(`status-page/${projectId}`, values);
        dispatch(updateStatusPageCustomHTMLRequest());

        promise.then(
            function (response) {
                const statusPage = response.data;
                dispatch(updateStatusPageCustomHTMLSuccess(statusPage));
            },
            function (error) {
                dispatch(updateStatusPageCustomHTMLError(error));
            }
        );
        return promise;
    };
}

//fetch project statuspage

export const fetchProjectStatusPageRequest = () => {
    return {
        type: types.FETCH_PROJECT_STATUSPAGE_REQUEST,
    };
};

export const resetProjectFetchStatusPage = () => {
    return {
        type: types.FETCH_PROJECT_STATUSPAGE_RESET,
    };
};

export const fetchProjectStatusPageSuccess = (statusPage: $TSFixMe) => {
    return {
        type: types.FETCH_PROJECT_STATUSPAGE_SUCCESS,
        payload: statusPage,
    };
};

export const fetchProjectStatusPageError = (error: ErrorPayload) => {
    return {
        type: types.FETCH_PROJECT_STATUSPAGE_FAILURE,
        payload: error,
    };
};

// Gets list of statuspages in a project.
export function fetchProjectStatusPage(
    projectId: string,
    refresh: $TSFixMe,
    skip: PositiveNumber,
    limit: PositiveNumber
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(
            `status-page/${projectId}/statuspage?skip=${skip}&limit=${limit}`
        );
        if (!refresh) dispatch(fetchProjectStatusPageRequest());

        promise.then(
            function (response) {
                const data = response.data;
                data.projectId = projectId;
                dispatch(fetchProjectStatusPageSuccess(data));
            },
            function (error) {
                dispatch(fetchProjectStatusPageError(error));
            }
        );
        return promise;
    };
}

//fetch subProject statuspages

export const fetchSubProjectStatusPagesRequest = () => {
    return {
        type: types.FETCH_SUBPROJECT_STATUSPAGE_REQUEST,
    };
};

export const resetSubProjectFetchStatusPages = () => {
    return {
        type: types.FETCH_SUBPROJECT_STATUSPAGE_RESET,
    };
};

export const fetchSubProjectStatusPagesSuccess = (statusPage: $TSFixMe) => {
    return {
        type: types.FETCH_SUBPROJECT_STATUSPAGE_SUCCESS,
        payload: statusPage,
    };
};

export const fetchSubProjectStatusPagesError = (error: ErrorPayload) => {
    return {
        type: types.FETCH_SUBPROJECT_STATUSPAGE_FAILURE,
        payload: error,
    };
};

// Gets status pages by subProjectId.
export function fetchSubProjectStatusPages(
    projectId: string,
    refresh: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(`status-page/${projectId}/status-pages`);
        if (!refresh) dispatch(fetchSubProjectStatusPagesRequest());

        promise.then(
            function (response) {
                const data = response.data;
                dispatch(fetchSubProjectStatusPagesSuccess(data));
            },
            function (error) {
                dispatch(fetchSubProjectStatusPagesError(error));
            }
        );
        return promise;
    };
}

//for incident statuspages
export const fetchIncidentStatusPagesRequest = () => {
    return {
        type: types.FETCH_INCIDENT_STATUSPAGE_REQUEST,
    };
};

export const resetIncidentFetchStatusPages = () => {
    return {
        type: types.FETCH_INCIDENT_STATUSPAGE_RESET,
    };
};

export const fetchIncidentStatusPagesSuccess = (
    incidentStatusPages: $TSFixMe
) => {
    return {
        type: types.FETCH_INCIDENT_STATUSPAGE_SUCCESS,
        payload: incidentStatusPages,
    };
};

export const fetchIncidentStatusPagesError = (error: ErrorPayload) => {
    return {
        type: types.FETCH_INCIDENT_STATUSPAGE_FAILURE,
        payload: error,
    };
};

// Gets status pages pointing to the incident
export function fetchIncidentStatusPages(
    projectId: string,
    incidentSlug: $TSFixMe,
    skip: PositiveNumber,
    limit: PositiveNumber
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(
            `incident/${projectId}/${incidentSlug}/statuspages?skip=${skip}&limit=${limit}`
        );

        promise.then(
            function (response) {
                dispatch(fetchIncidentStatusPagesSuccess(response.data));
            },
            function (error) {
                dispatch(fetchIncidentStatusPagesError(error));
            }
        );
        return promise;
    };
}

// Reset status bubble id
export const resetStatusBubbleIdRequest = () => {
    return {
        type: types.RESET_STATUS_BUBBLE_ID_REQUEST,
    };
};

export const resetStatusBubbleIdSuccess = (statusPage: $TSFixMe) => {
    return {
        type: types.RESET_STATUS_BUBBLE_ID_SUCCESS,
        payload: statusPage,
    };
};

export const resetStatusBubbleIdError = (error: ErrorPayload) => {
    return {
        type: types.RESET_STATUS_BUBBLE_ID_FAILURE,
        payload: error,
    };
};

// Calls the API to update setting.
export function resetStatusBubbleId(projectId: string, statusPageId: $TSFixMe) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.put(
            `status-page/${projectId}/${statusPageId}/resetBubbleId`,
            {}
        );
        dispatch(resetStatusBubbleIdRequest());
        promise.then(
            function (response) {
                const statusPage = response.data;
                dispatch(resetStatusBubbleIdSuccess(statusPage));
            },
            function (error) {
                dispatch(resetStatusBubbleIdError(error));
            }
        );

        return promise;
    };
}
//Delete statuspage
export const deleteStatusPageRequest = () => {
    return {
        type: types.DELETE_STATUSPAGE_REQUEST,
    };
};

export const deleteStatusPageReset = () => {
    return {
        type: types.DELETE_STATUSPAGE_RESET,
    };
};

export const deleteStatusPageSuccess = (statusPage: $TSFixMe) => {
    return {
        type: types.DELETE_STATUSPAGE_SUCCESS,
        payload: statusPage,
    };
};

export const deleteStatusPageError = (error: ErrorPayload) => {
    return {
        type: types.DELETE_STATUSPAGE_FAILED,
        payload: error,
    };
};

// Calls the API to get status page.
export function deleteStatusPage(projectId: string, statusPageSlug: $TSFixMe) {
    return function (dispatch: Dispatch) {
        const promise = delete (`status-page/${projectId}/${statusPageSlug}`,
        null);
        dispatch(deleteStatusPageRequest());
        promise.then(
            function (response) {
                const data = response.data;
                dispatch(deleteStatusPageSuccess(data));
            },
            function (error) {
                dispatch(deleteStatusPageError(error));
            }
        );
        return promise;
    };
}

//Duplicate statuspage
export const duplicateStatusPageRequest = () => {
    return {
        type: types.DUPLICATE_STATUSPAGE_REQUEST,
    };
};

export const duplicateStatusPageSuccess = (statusPage: $TSFixMe) => {
    return {
        type: types.DUPLICATE_STATUSPAGE_SUCCESS,
        payload: statusPage,
    };
};

export const duplicateStatusPageError = (error: ErrorPayload) => {
    return {
        type: types.DUPLICATE_STATUSPAGE_FAILURE,
        payload: error,
    };
};

export const readStatusPage = (statusPageSlug: $TSFixMe, data: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(`status-page/${statusPageSlug}`, data);
        dispatch(duplicateStatusPageRequest());
        promise.then(
            function (response) {
                const statusPageData = response.data;
                delete statusPageData._id;
                delete statusPageData.slug;
                statusPageData.name = data.name;
                return response;
            },
            function (error) {
                dispatch(duplicateStatusPageError(error));
            }
        );
        return promise;
    };
};

export function createDuplicateStatusPage(
    projectId: string,
    subProjectId = null,
    statusPageSlug: $TSFixMe,
    data: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const url = subProjectId
            ? `status-page/${projectId}/${statusPageSlug}/duplicateStatusPage?subProjectId=${subProjectId}`
            : `status-page/${projectId}/${statusPageSlug}/duplicateStatusPage`;
        const promise = BackendAPI.post(url, data);
        promise.then(
            function (response) {
                return response;
            },
            function (error) {
                dispatch(duplicateStatusPageError(error));
            }
        );
        return promise;
    };
}

export const fetchStatusPage = (statusPageSlug: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(`status-page/${statusPageSlug}`);
        promise.then(
            function (response) {
                const statusPageData = response.data;
                dispatch(duplicateStatusPageSuccess(statusPageData));
                dispatch(
                    fetchProjectStatusPage(statusPageData.projectId._id, true)
                );
            },
            function (error) {
                dispatch(duplicateStatusPageError(error));
            }
        );
        return promise;
    };
};

export const duplicateStatusPageReset = () => {
    return {
        type: types.DUPLICATE_STATUSPAGE_RESET,
    };
};

//Update status page embedded css

export const updateStatusPageEmbeddedCssRequest = () => {
    return {
        type: types.UPDATE_STATUSPAGE_EMBEDDED_CSS_REQUEST,
    };
};

export const updateStatusPageEmbeddedCssSuccess = (statusPage: $TSFixMe) => {
    return {
        type: types.UPDATE_STATUSPAGE_EMBEDDED_CSS_SUCCESS,
        payload: statusPage,
    };
};

export const updateStatusPageEmbeddedCssError = (error: ErrorPayload) => {
    return {
        type: types.UPDATE_STATUSPAGE_EMBEDDED_CSS_FAILURE,
        payload: error,
    };
};

// Calls the API to update setting.
export function updateStatusPageEmbeddedCss(projectId: string, data: $TSFixMe) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.put(`status-page/${projectId}`, data);
        dispatch(updateStatusPageEmbeddedCssRequest());
        promise.then(
            function (response) {
                const statusPage = response.data;
                dispatch(updateStatusPageEmbeddedCssSuccess(statusPage));

                dispatch(fetchProjectStatusPage(projectId, true));
                dispatch(updateStatusSuccess(statusPage));
            },
            function (error) {
                dispatch(updateStatusPageEmbeddedCssError(error));
            }
        );

        return promise;
    };
}

//reset branding colors
export const resetBrandingColorsRequest = () => {
    return {
        type: types.RESET_BRANDING_COLORS_REQUEST,
    };
};

export const resetBrandingColorsSuccess = (colors: $TSFixMe) => {
    return {
        type: types.RESET_BRANDING_COLORS_SUCCESS,
        payload: colors,
    };
};

export const resetBrandingColorsError = (error: ErrorPayload) => {
    return {
        type: types.RESET_BRANDING_COLORS_FAILURE,
        payload: error,
    };
};

// Calls the API to reset colors.
export function resetBrandingColors(projectId: string, statusPageId: $TSFixMe) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.put(
            `status-page/${projectId}/${statusPageId}/resetColors`
        );
        dispatch(resetBrandingColorsRequest());
        promise.then(
            function (response) {
                const colors = response.data;
                dispatch(resetBrandingColorsSuccess(colors));
            },
            function (error) {
                dispatch(resetBrandingColorsError(error));
            }
        );

        return promise;
    };
}

//Update status page embedded css

export const resetStatusPageEmbeddedCssRequest = () => {
    return {
        type: types.RESET_STATUSPAGE_EMBEDDED_CSS_REQUEST,
    };
};

export const resetStatusPageEmbeddedCssSuccess = (statusPage: $TSFixMe) => {
    return {
        type: types.RESET_STATUSPAGE_EMBEDDED_CSS_SUCCESS,
        payload: statusPage,
    };
};

export const resetStatusPageEmbeddedCssError = (error: ErrorPayload) => {
    return {
        type: types.RESET_STATUSPAGE_EMBEDDED_CSS_FAILURE,
        payload: error,
    };
};

// Calls the API to update setting.
export function resetStatusPageEmbeddedCss(projectId: string, data: $TSFixMe) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.put(`status-page/${projectId}`, data);
        dispatch(resetStatusPageEmbeddedCssRequest());
        promise.then(
            function (response) {
                const statusPage = response.data;
                dispatch(resetStatusPageEmbeddedCssSuccess(statusPage));

                dispatch(fetchProjectStatusPage(projectId, true));
            },
            function (error) {
                dispatch(resetStatusPageEmbeddedCssError(error));
            }
        );

        return promise;
    };
}
//status page layout
export const updateStatusPageLayoutRequest = () => {
    return {
        type: types.UPDATE_STATUS_PAGE_LAYOUT_REQUEST,
    };
};

export const updateStatusPageLayoutSuccess = (statusPage: $TSFixMe) => {
    return {
        type: types.UPDATE_STATUS_PAGE_LAYOUT_SUCCESS,
        payload: statusPage,
    };
};

export const updateStatusPageLayoutError = (error: ErrorPayload) => {
    return {
        type: types.UPDATE_STATUS_PAGE_LAYOUT_FAILURE,
        payload: error,
    };
};

export const updateStatusPageLayout = (projectId: string, data: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.put(`status-page/${projectId}`, data);
        dispatch(updateStatusPageLayoutRequest());
        promise.then(
            function (response) {
                const statusPage = response.data;
                dispatch(updateStatusPageLayoutSuccess(statusPage));

                dispatch(fetchProjectStatusPage(projectId, true));
                dispatch(updateStatusSuccess(statusPage));
            },
            function (error) {
                dispatch(updateStatusPageLayoutError(error));
            }
        );

        return promise;
    };
};
// fetch subscribers by monitors in statuspage
export const fetchSubscriberRequest = () => {
    return {
        type: types.FETCH_SUBSCRIBER_REQUEST,
    };
};

export const fetchSubscriberSuccess = (data: $TSFixMe) => {
    return {
        type: types.FETCH_SUBSCRIBER_SUCCESS,
        payload: data,
    };
};

export const fetchSubscriberFailure = (error: ErrorPayload) => {
    return {
        type: types.FETCH_SUBSCRIBER_FAILURE,
        payload: error,
    };
};

export function fetchStatusPageSubscribers(
    projectId: string,
    statusPageId: $TSFixMe,
    skip: PositiveNumber,
    limit: PositiveNumber
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(
            `status-page/${projectId}/monitor/${statusPageId}?skip=${skip}&limit=${limit}`
        );
        dispatch(fetchSubscriberRequest());
        promise.then(
            function (response) {
                dispatch(fetchSubscriberSuccess(response.data));
            },
            function (error) {
                dispatch(fetchSubscriberFailure(error));
            }
        );
        return promise;
    };
}

export const createExternalStatusPageRequest = () => {
    return {
        type: types.CREATE_EXTERNAL_STATUSPAGE_REQUEST,
    };
};

export const createExternalStatusPageSuccess = (data: $TSFixMe) => {
    return {
        type: types.CREATE_EXTERNAL_STATUSPAGE_SUCCESS,
        payload: data,
    };
};

export const createExternalStatusPageFailure = (error: ErrorPayload) => {
    return {
        type: types.CREATE_EXTERNAL_STATUSPAGE_FAILURE,
        payload: error,
    };
};

export function createExternalStatusPage(
    projectId: string,
    statusPageId: $TSFixMe,
    data: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.post(
            `status-page/${projectId}/createExternalstatus-page/${statusPageId}`,
            data
        );
        dispatch(createExternalStatusPageRequest());
        promise.then(
            function (response) {
                dispatch(createExternalStatusPageSuccess(response.data));

                return response.data;
            },
            function (error) {
                dispatch(createExternalStatusPageFailure(error));
                return error;
            }
        );

        return promise;
    };
}

export const updateExternalStatusPageRequest = () => {
    return {
        type: types.UPDATE_EXTERNAL_STATUSPAGE_REQUEST,
    };
};

export const updateExternalStatusPageSuccess = (data: $TSFixMe) => {
    return {
        type: types.UPDATE_EXTERNAL_STATUSPAGE_SUCCESS,
        payload: data,
    };
};

export const updateExternalStatusPageFailure = (error: ErrorPayload) => {
    return {
        type: types.UPDATE_EXTERNAL_STATUSPAGE_FAILURE,
        payload: error,
    };
};

export function updateExternalStatusPage(
    projectId: string,
    externalStatusPageId: $TSFixMe,
    data: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.post(
            `status-page/${projectId}/updateExternalstatus-page/${externalStatusPageId}`,
            data
        );
        dispatch(updateExternalStatusPageRequest());
        promise.then(
            function (response) {
                dispatch(updateExternalStatusPageSuccess(response.data));

                return response.data;
            },
            function (error) {
                dispatch(updateExternalStatusPageFailure(error));
                return error;
            }
        );

        return promise;
    };
}

export const fetchExternalStatusPagesRequest = () => {
    return {
        type: types.FETCH_EXTERNAL_STATUSPAGES_REQUEST,
    };
};

export const fetchExternalStatusPagesSuccess = (data: $TSFixMe) => {
    return {
        type: types.FETCH_EXTERNAL_STATUSPAGES_SUCCESS,
        payload: data,
    };
};

export const fetchExternalStatusPagesFailure = (error: ErrorPayload) => {
    return {
        type: types.FETCH_EXTERNAL_STATUSPAGES_FAILURE,
        payload: error,
    };
};

export function fetchExternalStatusPages(
    projectId: string,
    statusPageId: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(
            `status-page/${projectId}/fetchExternalStatusPages/${statusPageId}`
        );
        dispatch(fetchExternalStatusPagesRequest());
        promise.then(
            function (response) {
                dispatch(fetchExternalStatusPagesSuccess(response.data));

                return response.data;
            },
            function (error) {
                dispatch(fetchExternalStatusPagesFailure(error));
                return error;
            }
        );

        return promise;
    };
}

export const deleteExternalStatusPageRequest = () => {
    return {
        type: types.DELETE_EXTERNAL_STATUSPAGE_REQUEST,
    };
};

export const deleteExternalStatusPageSuccess = (data: $TSFixMe) => {
    return {
        type: types.DELETE_EXTERNAL_STATUSPAGE_SUCCESS,
        payload: data,
    };
};

export const deleteExternalStatusPageFailure = (error: ErrorPayload) => {
    return {
        type: types.DELETE_EXTERNAL_STATUSPAGE_FAILURE,
        payload: error,
    };
};

export function deleteExternalStatusPage(
    projectId: string,
    externalStatusPageId: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.post(
            `status-page/${projectId}/deleteExternalstatus-page/${externalStatusPageId}`
        );
        dispatch(deleteExternalStatusPageRequest());
        promise.then(
            function (response) {
                dispatch(deleteExternalStatusPageSuccess(response.data));

                return response.data;
            },
            function (error) {
                dispatch(deleteExternalStatusPageFailure(error));
                return error;
            }
        );

        return promise;
    };
}

export const createAnnouncementRequest = () => {
    return {
        type: types.CREATE_ANNOUNCEMEMT_REQUEST,
    };
};

export const createAnnouncementSuccess = (data: $TSFixMe) => {
    return {
        type: types.CREATE_ANNOUNCEMEMT_SUCCESS,
        payload: data,
    };
};

export const createAnnouncementFailure = (error: ErrorPayload) => {
    return {
        type: types.CREATE_ANNOUNCEMEMT_FAILURE,
        payload: error,
    };
};

export function createAnnouncement(
    projectId: string,
    statusPageId: $TSFixMe,
    data: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.post(
            `status-page/${projectId}/announcement/${statusPageId}`,
            data
        );
        dispatch(createAnnouncementRequest());
        promise.then(
            function (response) {
                dispatch(createAnnouncementSuccess(response.data));

                return response.data;
            },
            function (error) {
                dispatch(createAnnouncementFailure(error));
                return error;
            }
        );

        return promise;
    };
}

export function updateAnnouncement(
    projectId: string,
    statusPageId: $TSFixMe,
    announcementId: $TSFixMe,
    data: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.put(
            `status-page/${projectId}/announcement/${statusPageId}/${announcementId}`,
            data
        );
        dispatch(createAnnouncementRequest());
        promise.then(
            function (response) {
                dispatch(createAnnouncementSuccess(response.data));

                return response.data;
            },
            function (error) {
                dispatch(createAnnouncementFailure(error));
                return error;
            }
        );

        return promise;
    };
}

export const fetchAnnouncementRequest = () => {
    return {
        type: types.FETCH_ANNOUNCEMEMT_REQUEST,
    };
};

export const fetchAnnouncementSuccess = (data: $TSFixMe) => {
    return {
        type: types.FETCH_ANNOUNCEMEMT_SUCCESS,
        payload: data,
    };
};

export const fetchAnnouncementFailure = (error: ErrorPayload) => {
    return {
        type: types.FETCH_ANNOUNCEMEMT_FAILURE,
        payload: error,
    };
};

export function fetchAnnouncements(
    projectId: string,
    statusPageId: $TSFixMe,
    skip = 0,
    limit: PositiveNumber
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(
            `status-page/${projectId}/announcement/${statusPageId}?skip=${skip}&limit=${limit}`
        );
        dispatch(fetchAnnouncementRequest());
        promise.then(
            function (response) {
                dispatch(fetchAnnouncementSuccess(response.data));
            },
            function (error) {
                dispatch(fetchAnnouncementFailure(error));
            }
        );
        return promise;
    };
}

export const fetchAnnouncementLogsRequest = () => {
    return {
        type: types.FETCH_ANNOUNCEMEMTLOGS_REQUEST,
    };
};

export const fetchAnnouncementLogsSuccess = (data: $TSFixMe) => {
    return {
        type: types.FETCH_ANNOUNCEMEMTLOGS_SUCCESS,
        payload: data,
    };
};

export const fetchAnnouncementLogsFailure = (error: ErrorPayload) => {
    return {
        type: types.FETCH_ANNOUNCEMEMTLOGS_FAILURE,
        payload: error,
    };
};

export function fetchAnnouncementLogs(
    projectId: string,
    statusPageId: $TSFixMe,
    skip = 0,
    limit: PositiveNumber
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(
            `status-page/${projectId}/announcementLogs/${statusPageId}?skip=${skip}&limit=${limit}`
        );
        dispatch(fetchAnnouncementLogsRequest());
        promise.then(
            function (response) {
                dispatch(fetchAnnouncementLogsSuccess(response.data));
            },
            function (error) {
                dispatch(fetchAnnouncementLogsFailure(error));
            }
        );
        return promise;
    };
}

export const fetchSingleAnnouncementSuccess = (data: $TSFixMe) => {
    return {
        type: types.FETCH_SINCLE_ANNOUNCEMENT_SUCCESS,
        payload: data,
    };
};

export const fetchSingleAnnouncementFailure = (error: ErrorPayload) => {
    return {
        type: types.FETCH_SINCLE_ANNOUNCEMENT_FAILURE,
        payload: error,
    };
};

export function fetchSingleAnnouncement(
    projectId: string,
    statusPageSlug: $TSFixMe,
    announcementSlug: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(
            `status-page/${projectId}/announcement/${statusPageSlug}/single/${announcementSlug}`
        );
        promise.then(
            function (response) {
                dispatch(fetchSingleAnnouncementSuccess(response.data));
            },
            function (error) {
                dispatch(fetchSingleAnnouncementFailure(error));
            }
        );
        return promise;
    };
}

export const handleAnnouncementSuccess = (data: $TSFixMe) => {
    return {
        type: types.HANDLE_ANNOUNCEMENT_SUCCESS,
        payload: data,
    };
};

export const handleAnnouncementFailure = (error: ErrorPayload) => {
    return {
        type: types.HANDLE_ANNOUNCEMENT_FAILURE,
        payload: error,
    };
};

export const resetHandleAnnouncement = () => {
    return {
        type: types.RESET_HANDLE_ANNOUNCEMENT,
    };
};

export const resetDeleteAnnouncement = () => {
    return {
        type: types.RESET_DELETE_ANNOUNCEMENT,
    };
};

export const deleteAnnouncementRequest = () => {
    return {
        type: types.DELETE_ANNOUNCEMENT_REQUEST,
    };
};

export const deleteAnnouncementSuccess = (data: $TSFixMe) => {
    return {
        type: types.DELETE_ANNOUNCEMENT_SUCCESS,
        payload: data,
    };
};

export const deleteAnnouncementFailure = (error: ErrorPayload) => {
    return {
        type: types.DELETE_ANNOUNCEMENT_FAILURE,
        payload: error,
    };
};

export function deleteAnnouncement(
    projectId: string,
    announcementId: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise =
            delete `status-page/${projectId}/announcement/${announcementId}/delete`;
        dispatch(deleteAnnouncementRequest());
        promise.then(
            function (response) {
                dispatch(deleteAnnouncementSuccess(response.data));
            },
            function (error) {
                dispatch(deleteAnnouncementFailure(error));
            }
        );
        return promise;
    };
}

export function deleteAnnouncementLog(
    projectId: string,
    announcementLogId: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise =
            delete `status-page/${projectId}/announcementLog/${announcementLogId}/delete`;
        dispatch(deleteAnnouncementRequest());
        promise.then(
            function (response) {
                dispatch(deleteAnnouncementSuccess(response.data));
            },
            function (error) {
                dispatch(deleteAnnouncementFailure(error));
            }
        );
        return promise;
    };
}

// Calls the API to delete StatusPages after deleting the project

export const deleteProjectStatusPages = (projectId: string) => {
    return {
        type: types.DELETE_PROJECT_STATUSPAGES,
        payload: projectId,
    };
};

// Logo

export const createLogoCache = (imageUrl: URL) => {
    return {
        type: types.LOGO_CACHE_INSERT,
        payload: imageUrl,
    };
};

// Banner
export const createBannerCache = (imageUrl: URL) => {
    return {
        type: types.BANNER_CACHE_INSERT,
        payload: imageUrl,
    };
};

export const resetBannerCache = () => {
    return {
        type: types.BANNER_CACHE_RESET,
    };
};

export const setStatusPageColors = (color: $TSFixMe) => {
    return {
        type: types.SET_STATUS_PAGE_COLORS,
        payload: color,
    };
};

export const createFaviconCache = (imageUrl: URL) => {
    return {
        type: types.FAVICON_CACHE_INSERT,
        payload: imageUrl,
    };
};

export const resetLogoCache = () => {
    return {
        type: types.LOGO_CACHE_RESET,
    };
};

export const resetFaviconCache = () => {
    return {
        type: types.FAVICON_CACHE_RESET,
    };
};

export const switchStatusPage = (statusPage: $TSFixMe) => {
    return {
        type: types.SWITCH_STATUSPAGE_SUCCESS,
        payload: statusPage,
    };
};
