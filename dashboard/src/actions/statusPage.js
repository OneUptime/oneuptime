import { getApi, putApi, deleteApi, postApi } from '../api';
import * as types from '../constants/statusPage';
import FormData from 'form-data';
import errors from '../errors';

// Create status page

export function createStatusPageRequest() {
    return {
        type: types.CREATE_STATUSPAGE_REQUEST,
    };
}

export function createStatusPageSuccess(statusPage) {
    return {
        type: types.CREATE_STATUSPAGE_SUCCESS,
        payload: statusPage,
    };
}

export function createStatusPageError(error) {
    return {
        type: types.CREATE_STATUSPAGE_FAILURE,
        payload: error,
    };
}

// Calls the API to create statuspage.
export function createStatusPage(projectId, data) {
    return function(dispatch) {
        const promise = postApi(`status-page/${projectId}`, data);
        dispatch(createStatusPageRequest());
        promise.then(
            function(response) {
                const statusPage = response.data;
                dispatch(createStatusPageSuccess(statusPage));
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
                dispatch(createStatusPageError(errors(error)));
            }
        );

        return promise;
    };
}

// handle whether to show domain input field
export function addMoreDomain() {
    return {
        type: types.ADD_MORE_DOMAIN,
    };
}

export function cancelAddMoreDomain() {
    return {
        type: types.CANCEL_ADD_MORE_DOMAIN,
    };
}

// upload cert file
export function uploadCertFileRequest() {
    return {
        type: 'CERT_FILE_REQUEST',
    };
}

export function uploadCertFileSuccess(filename) {
    return {
        type: 'CERT_FILE_SUCCESS',
        payload: filename,
    };
}

export function uploadCertFileFailure(error) {
    return {
        type: 'CERT_FILE_ERROR',
        payload: error,
    };
}

export function removeCertFile() {
    return {
        type: 'REMOVE_CERT_FILE',
    };
}

export function uploadCertFile(projectId, file) {
    return function(dispatch) {
        const data = new FormData();
        if (file) {
            data.append('cert', file);

            const promise = postApi(`status-page/${projectId}/certFile`, data);
            dispatch(uploadCertFileRequest());
            promise.then(
                function(response) {
                    const data = response.data;
                    dispatch(uploadCertFileSuccess(data.cert));
                    return data;
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
                    dispatch(uploadCertFileFailure(error));
                }
            );

            return promise;
        }
    };
}

// upload private key file
export function uploadPrivateKeyRequest() {
    return {
        type: 'PRIVATE_KEY_REQUEST',
    };
}

export function uploadPrivateKeySuccess(filename) {
    return {
        type: 'PRIVATE_KEY_SUCCESS',
        payload: filename,
    };
}

export function uploadPrivateKeyFailure(error) {
    return {
        type: 'PRIVATE_KEY_ERROR',
        payload: error,
    };
}

export function removePrivateKeyFile() {
    return {
        type: 'REMOVE_PRIVATE_KEY',
    };
}

export function uploadPrivateKey(projectId, file) {
    return function(dispatch) {
        const data = new FormData();
        if (file) {
            data.append('privateKey', file);

            const promise = postApi(
                `status-page/${projectId}/privateKeyFile`,
                data
            );
            dispatch(uploadPrivateKeyRequest());
            promise.then(
                function(response) {
                    const data = response.data;
                    dispatch(uploadPrivateKeySuccess(data.privateKey));
                    return data;
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
                    dispatch(uploadPrivateKeyFailure(error));
                }
            );

            return promise;
        }
    };
}

//Update status page setting

export function updateStatusPageSettingRequest() {
    return {
        type: types.UPDATE_STATUSPAGE_SETTING_REQUEST,
    };
}

export function updateStatusPageSettingSuccess(statusPage) {
    return {
        type: types.UPDATE_STATUSPAGE_SETTING_SUCCESS,
        payload: statusPage,
    };
}

export function updateStatusPageSettingError(error) {
    return {
        type: types.UPDATE_STATUSPAGE_SETTING_FAILURE,
        payload: error,
    };
}

// Calls the API to update setting.
export function updateStatusPageSetting(projectId, data) {
    return function(dispatch) {
        const promise = putApi(`status-page/${projectId}`, data);
        dispatch(updateStatusPageSettingRequest());
        promise.then(
            function(response) {
                const statusPage = response.data;
                dispatch(updateStatusPageSettingSuccess(statusPage));
                dispatch(fetchProjectStatusPage(projectId, true));
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
                dispatch(updateStatusPageSettingError(errors(error)));
            }
        );

        return promise;
    };
}

//Update status page monitors

export function updateStatusPageMonitorsRequest() {
    return {
        type: types.UPDATE_STATUSPAGE_MONITORS_REQUEST,
    };
}

export function updateStatusPageMonitorsSuccess(statusPage) {
    return {
        type: types.UPDATE_STATUSPAGE_MONITORS_SUCCESS,
        payload: statusPage,
    };
}

export function updateStatusPageMonitorsError(error) {
    return {
        type: types.UPDATE_STATUSPAGE_MONITORS_FAILURE,
        payload: error,
    };
}

// Calls the API to update monitors.
export function updateStatusPageMonitors(projectId, values) {
    return function(dispatch) {
        const promise = putApi(`status-page/${projectId}`, values);
        dispatch(updateStatusPageMonitorsRequest());

        promise.then(
            function(response) {
                const statusPage = response.data;
                dispatch(updateStatusPageMonitorsSuccess(statusPage));
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
                dispatch(updateStatusPageMonitorsError(errors(error)));
            }
        );
        return promise;
    };
}

//Update private status page Main box

export function updatePrivateStatusPageRequest() {
    return {
        type: types.UPDATE_PRIVATE_STATUSPAGE_REQUEST,
    };
}

export function updatePrivateStatusPageSuccess(statusPage) {
    return {
        type: types.UPDATE_PRIVATE_STATUSPAGE_SUCCESS,
        payload: statusPage,
    };
}

export function updatePrivateStatusPageError(error) {
    return {
        type: types.UPDATE_PRIVATE_STATUSPAGE_FAILURE,
        payload: error,
    };
}

// Calls the API to update private statuspages.
export function updatePrivateStatusPage(projectId, values) {
    return function(dispatch) {
        const promise = putApi(`status-page/${projectId}`, values);
        dispatch(updatePrivateStatusPageRequest());

        promise.then(
            function(response) {
                const statusPage = response.data;
                dispatch(updatePrivateStatusPageSuccess(statusPage));
                dispatch(updateStatusSuccess(statusPage));
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
                dispatch(updatePrivateStatusPageError(errors(error)));
            }
        );
        return promise;
    };
}
// Update status page advanace subscriber options.
export function updateSubscriberOptionRequest() {
    return {
        type: types.UPDATE_SUBSCRIBER_OPTION_REQUEST,
    };
}

export function updateSubscriberOptionSuccess(statusPage) {
    return {
        type: types.UPDATE_SUBSCRIBER_OPTION_SUCCESS,
        payload: statusPage,
    };
}

export function updateSubscriberOptionError(error) {
    return {
        type: types.UPDATE_SUBSCRIBER_OPTION_FAILURE,
        payload: error,
    };
}

// update status page multi language
export function updateStatusPageLanguage(projectId, values) {
    return function(dispatch) {
        const promise = putApi(`status-page/${projectId}`, values);
        dispatch(updateStatusPageLanguageRequest());

        promise.then(
            function(response) {
                const statusPage = response.data;
                dispatch(updateStatusPageLanguageSuccess(statusPage));
                dispatch(updateStatusSuccess(statusPage));
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
                dispatch(updateStatusPageLanguageError(errors(error)));
            }
        );
        return promise;
    };
}
// Update status page advanace subscriber options.
export function updateStatusPageLanguageRequest() {
    return {
        type: types.UPDATE_MULTIPLE_LANGUAGE_REQUEST,
    };
}

export function updateStatusPageLanguageSuccess(statusPage) {
    return {
        type: types.UPDATE_MULTIPLE_LANGUAGE_SUCCESS,
        payload: statusPage,
    };
}

export function updateStatusPageLanguageError(error) {
    return {
        type: types.UPDATE_MULTIPLE_LANGUAGE_FAILURE,
        payload: error,
    };
}

// Calls the API to update private statuspages.
export function updateSubscriberOption(projectId, values) {
    return function(dispatch) {
        const promise = putApi(`status-page/${projectId}`, values);
        dispatch(updateSubscriberOptionRequest());

        promise.then(
            function(response) {
                const statusPage = response.data;
                dispatch(updateSubscriberOptionSuccess(statusPage));
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
                dispatch(updateSubscriberOptionError(errors(error)));
            }
        );
        return promise;
    };
}
// Update status page branding
export function updateStatusSuccess(data) {
    return {
        type: types.UPDATE_STATUSPAGE_SUCCESS,
        payload: data,
    };
}

export function updateStatusPageBrandingRequest() {
    return {
        type: types.UPDATE_STATUSPAGE_BRANDING_REQUEST,
    };
}

export function updateStatusPageBrandingSuccess(statusPage) {
    return {
        type: types.UPDATE_STATUSPAGE_BRANDING_SUCCESS,
        payload: statusPage,
    };
}

export function updateStatusPageBrandingError(error) {
    return {
        type: types.UPDATE_STATUSPAGE_BRANDING_FAILURE,
        payload: error,
    };
}

// Update status page name
export function updateStatusPageNameRequest() {
    return {
        type: types.UPDATE_STATUSPAGE_NAME_REQUEST,
    };
}

export function updateStatusPageNameSuccess(statusPage) {
    return {
        type: types.UPDATE_STATUSPAGE_NAME_SUCCESS,
        payload: statusPage,
    };
}

export function updateStatusPageNameError(error) {
    return {
        type: types.UPDATE_STATUSPAGE_NAME_FAILURE,
        payload: error,
    };
}

// Update status page theme
export function updateStatusPageThemeRequest() {
    return {
        type: types.UPDATE_STATUSPAGE_THEME_REQUEST,
    };
}

export function updateStatusPageThemeSuccess(statusPage) {
    return {
        type: types.UPDATE_STATUSPAGE_THEME_SUCCESS,
        payload: statusPage,
    };
}

export function updateStatusPageThemeError(error) {
    return {
        type: types.UPDATE_STATUSPAGE_THEME_FAILURE,
        payload: error,
    };
}

// Calls the API to update branding.
export function updateStatusPageBranding(projectId, values) {
    return function(dispatch) {
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

        const promise = putApi(`status-page/${projectId}`, data);
        dispatch(updateStatusPageBrandingRequest());

        promise.then(
            function(response) {
                const statusPage = response.data;
                dispatch(updateStatusPageBrandingSuccess(statusPage));
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
                dispatch(updateStatusPageBrandingError(errors(error)));
            }
        );
        return promise;
    };
}

// Calls the API to update the theme
export function updateTheme(projectId, data) {
    return function(dispatch) {
        const promise = putApi(`status-page/${projectId}/theme`, data);
        dispatch(updateStatusPageThemeRequest());

        promise.then(
            function(response) {
                const statusPage = response.data;
                dispatch(updateStatusPageThemeSuccess(statusPage));
                dispatch(updateStatusSuccess(statusPage));
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
                dispatch(updateStatusPageThemeError(errors(error)));
            }
        );
        return promise;
    };
}

// Calls the API to update status page name.
export function updateStatusPageName(projectId, values) {
    return function(dispatch) {
        const promise = putApi(`status-page/${projectId}`, values);
        dispatch(updateStatusPageNameRequest());

        promise.then(
            function(response) {
                const statusPage = response.data;
                dispatch(updateStatusPageNameSuccess(statusPage));
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
                dispatch(updateStatusPageNameError(errors(error)));
            }
        );
        return promise;
    };
}

//Update status page links

export function updateStatusPageLinksRequest() {
    return {
        type: types.UPDATE_STATUSPAGE_LINKS_REQUEST,
    };
}

export function updateStatusPageLinksSuccess(statusPage) {
    return {
        type: types.UPDATE_STATUSPAGE_LINKS_SUCCESS,
        payload: statusPage,
    };
}

export function updateStatusPageLinksError(error) {
    return {
        type: types.UPDATE_STATUSPAGE_LINKS_FAILURE,
        payload: error,
    };
}

// Calls the API to update links.
export function updateStatusPageLinks(projectId, values) {
    return function(dispatch) {
        const promise = putApi(`status-page/${projectId}`, values);
        dispatch(updateStatusPageLinksRequest());

        promise.then(
            function(response) {
                const statusPage = response.data;
                dispatch(updateStatusPageLinksSuccess(statusPage));
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
                dispatch(updateStatusPageLinksError(errors(error)));
            }
        );
        return promise;
    };
}

//Update status page links

export function updateStatusPageCustomHTMLRequest() {
    return {
        type: types.UPDATE_STATUSPAGE_CUSTOM_HTML_REQUEST,
    };
}

export function updateStatusPageCustomHTMLSuccess(statusPage) {
    return {
        type: types.UPDATE_STATUSPAGE_CUSTOM_HTML_SUCCESS,
        payload: statusPage,
    };
}

export function updateStatusPageCustomHTMLError(error) {
    return {
        type: types.UPDATE_STATUSPAGE_CUSTOM_HTML_FAILURE,
        payload: error,
    };
}

// Calls the API to update links.
export function updateStatusPageCustomHTML(projectId, values) {
    return function(dispatch) {
        const promise = putApi(`status-page/${projectId}`, values);
        dispatch(updateStatusPageCustomHTMLRequest());

        promise.then(
            function(response) {
                const statusPage = response.data;
                dispatch(updateStatusPageCustomHTMLSuccess(statusPage));
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
                dispatch(updateStatusPageCustomHTMLError(errors(error)));
            }
        );
        return promise;
    };
}

//fetch project statuspage

export function fetchProjectStatusPageRequest() {
    return {
        type: types.FETCH_PROJECT_STATUSPAGE_REQUEST,
    };
}

export function resetProjectFetchStatusPage() {
    return {
        type: types.FETCH_PROJECT_STATUSPAGE_RESET,
    };
}

export function fetchProjectStatusPageSuccess(statusPage) {
    return {
        type: types.FETCH_PROJECT_STATUSPAGE_SUCCESS,
        payload: statusPage,
    };
}

export function fetchProjectStatusPageError(error) {
    return {
        type: types.FETCH_PROJECT_STATUSPAGE_FAILURE,
        payload: error,
    };
}

// Gets list of statuspages in a project.
export function fetchProjectStatusPage(projectId, refresh, skip, limit) {
    return function(dispatch) {
        const promise = getApi(
            `status-page/${projectId}/statuspage?skip=${skip}&limit=${limit}`
        );
        if (!refresh) dispatch(fetchProjectStatusPageRequest());

        promise.then(
            function(response) {
                const data = response.data;
                data.projectId = projectId;
                dispatch(fetchProjectStatusPageSuccess(data));
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
                dispatch(fetchProjectStatusPageError(errors(error)));
            }
        );
        return promise;
    };
}

//fetch subProject statuspages

export function fetchSubProjectStatusPagesRequest() {
    return {
        type: types.FETCH_SUBPROJECT_STATUSPAGE_REQUEST,
    };
}

export function resetSubProjectFetchStatusPages() {
    return {
        type: types.FETCH_SUBPROJECT_STATUSPAGE_RESET,
    };
}

export function fetchSubProjectStatusPagesSuccess(statusPage) {
    return {
        type: types.FETCH_SUBPROJECT_STATUSPAGE_SUCCESS,
        payload: statusPage,
    };
}

export function fetchSubProjectStatusPagesError(error) {
    return {
        type: types.FETCH_SUBPROJECT_STATUSPAGE_FAILURE,
        payload: error,
    };
}

// Gets status pages by subProjectId.
export function fetchSubProjectStatusPages(projectId, refresh) {
    return function(dispatch) {
        const promise = getApi(`status-page/${projectId}`);
        if (!refresh) dispatch(fetchSubProjectStatusPagesRequest());

        promise.then(
            function(response) {
                const data = response.data;
                dispatch(fetchSubProjectStatusPagesSuccess(data));
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
                dispatch(fetchSubProjectStatusPagesError(errors(error)));
            }
        );
        return promise;
    };
}

//for incident statuspages
export function fetchIncidentStatusPagesRequest() {
    return {
        type: types.FETCH_INCIDENT_STATUSPAGE_REQUEST,
    };
}

export function resetIncidentFetchStatusPages() {
    return {
        type: types.FETCH_INCIDENT_STATUSPAGE_RESET,
    };
}

export function fetchIncidentStatusPagesSuccess(incidentStatusPages) {
    return {
        type: types.FETCH_INCIDENT_STATUSPAGE_SUCCESS,
        payload: incidentStatusPages,
    };
}

export function fetchIncidentStatusPagesError(error) {
    return {
        type: types.FETCH_INCIDENT_STATUSPAGE_FAILURE,
        payload: error,
    };
}

// Gets status pages pointing to the incident
export function fetchIncidentStatusPages(projectId, incidentSlug, skip, limit) {
    return function(dispatch) {
        const promise = getApi(
            `incident/${projectId}/${incidentSlug}/statuspages?skip=${skip}&limit=${limit}`
        );

        promise.then(
            function(response) {
                dispatch(fetchIncidentStatusPagesSuccess(response.data));
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
                dispatch(fetchIncidentStatusPagesError(errors(error)));
            }
        );
        return promise;
    };
}

// Reset status bubble id
export function resetStatusBubbleIdRequest() {
    return {
        type: types.RESET_STATUS_BUBBLE_ID_REQUEST,
    };
}

export function resetStatusBubbleIdSuccess(statusPage) {
    return {
        type: types.RESET_STATUS_BUBBLE_ID_SUCCESS,
        payload: statusPage,
    };
}

export function resetStatusBubbleIdError(error) {
    return {
        type: types.RESET_STATUS_BUBBLE_ID_FAILURE,
        payload: error,
    };
}

// Calls the API to update setting.
export function resetStatusBubbleId(projectId, statusPageId) {
    return function(dispatch) {
        const promise = putApi(
            `status-page/${projectId}/${statusPageId}/resetBubbleId`,
            {}
        );
        dispatch(resetStatusBubbleIdRequest());
        promise.then(
            function(response) {
                const statusPage = response.data;
                dispatch(resetStatusBubbleIdSuccess(statusPage));
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
                dispatch(resetStatusBubbleIdError(errors(error)));
            }
        );

        return promise;
    };
}
//Delete statuspage
export function deleteStatusPageRequest() {
    return {
        type: types.DELETE_STATUSPAGE_REQUEST,
    };
}

export function deleteStatusPageReset() {
    return {
        type: types.DELETE_STATUSPAGE_RESET,
    };
}

export function deleteStatusPageSuccess(statusPage) {
    return {
        type: types.DELETE_STATUSPAGE_SUCCESS,
        payload: statusPage,
    };
}

export function deleteStatusPageError(error) {
    return {
        type: types.DELETE_STATUSPAGE_FAILED,
        payload: error,
    };
}

// Calls the API to get status page.
export function deleteStatusPage(projectId, statusPageSlug) {
    return function(dispatch) {
        const promise = deleteApi(
            `status-page/${projectId}/${statusPageSlug}`,
            null
        );
        dispatch(deleteStatusPageRequest());
        promise.then(
            function(response) {
                const data = response.data;
                dispatch(deleteStatusPageSuccess(data));
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
                dispatch(deleteStatusPageError(errors(error)));
            }
        );
        return promise;
    };
}

//Duplicate statuspage
export function duplicateStatusPageRequest() {
    return {
        type: types.DUPLICATE_STATUSPAGE_REQUEST,
    };
}

export function duplicateStatusPageSuccess(statusPage) {
    return {
        type: types.DUPLICATE_STATUSPAGE_SUCCESS,
        payload: statusPage,
    };
}

export function duplicateStatusPageError(error) {
    return {
        type: types.DUPLICATE_STATUSPAGE_FAILURE,
        payload: error,
    };
}

export function readStatusPage(statusPageSlug, data) {
    return function(dispatch) {
        const promise = getApi(`status-page/${statusPageSlug}`, data);
        dispatch(duplicateStatusPageRequest());
        promise.then(
            function(response) {
                const statusPageData = response.data;
                delete statusPageData._id;
                delete statusPageData.slug;
                statusPageData.name = data.name;
                return response;
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
                dispatch(duplicateStatusPageError(errors(error)));
            }
        );
        return promise;
    };
}

export function createDuplicateStatusPage(
    projectId,
    subProjectId = null,
    statusPageSlug,
    data
) {
    return function(dispatch) {
        const url = subProjectId
            ? `status-page/${projectId}/${statusPageSlug}/duplicateStatusPage?subProjectId=${subProjectId}`
            : `status-page/${projectId}/${statusPageSlug}/duplicateStatusPage`;
        const promise = postApi(url, data);
        promise.then(
            function(response) {
                return response;
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
                dispatch(duplicateStatusPageError(errors(error)));
            }
        );
        return promise;
    };
}

export function fetchStatusPage(statusPageSlug) {
    return function(dispatch) {
        const promise = getApi(`status-page/${statusPageSlug}`);
        promise.then(
            function(response) {
                const statusPageData = response.data;
                dispatch(duplicateStatusPageSuccess(statusPageData));
                dispatch(
                    fetchProjectStatusPage(statusPageData.projectId._id, true)
                );
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
                dispatch(duplicateStatusPageError(errors(error)));
            }
        );
        return promise;
    };
}

export function duplicateStatusPageReset() {
    return {
        type: types.DUPLICATE_STATUSPAGE_RESET,
    };
}

//Update status page embedded css

export function updateStatusPageEmbeddedCssRequest() {
    return {
        type: types.UPDATE_STATUSPAGE_EMBEDDED_CSS_REQUEST,
    };
}

export function updateStatusPageEmbeddedCssSuccess(statusPage) {
    return {
        type: types.UPDATE_STATUSPAGE_EMBEDDED_CSS_SUCCESS,
        payload: statusPage,
    };
}

export function updateStatusPageEmbeddedCssError(error) {
    return {
        type: types.UPDATE_STATUSPAGE_EMBEDDED_CSS_FAILURE,
        payload: error,
    };
}

// Calls the API to update setting.
export function updateStatusPageEmbeddedCss(projectId, data) {
    return function(dispatch) {
        const promise = putApi(`status-page/${projectId}`, data);
        dispatch(updateStatusPageEmbeddedCssRequest());
        promise.then(
            function(response) {
                const statusPage = response.data;
                dispatch(updateStatusPageEmbeddedCssSuccess(statusPage));
                dispatch(fetchProjectStatusPage(projectId, true));
                dispatch(updateStatusSuccess(statusPage));
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
                dispatch(updateStatusPageEmbeddedCssError(errors(error)));
            }
        );

        return promise;
    };
}

//reset branding colors
export function resetBrandingColorsRequest() {
    return {
        type: types.RESET_BRANDING_COLORS_REQUEST,
    };
}

export function resetBrandingColorsSuccess(colors) {
    return {
        type: types.RESET_BRANDING_COLORS_SUCCESS,
        payload: colors,
    };
}

export function resetBrandingColorsError(error) {
    return {
        type: types.RESET_BRANDING_COLORS_FAILURE,
        payload: error,
    };
}

// Calls the API to reset colors.
export function resetBrandingColors(projectId, statusPageId) {
    return function(dispatch) {
        const promise = putApi(
            `status-page/${projectId}/${statusPageId}/resetColors`
        );
        dispatch(resetBrandingColorsRequest());
        promise.then(
            function(response) {
                const colors = response.data;
                dispatch(resetBrandingColorsSuccess(colors));
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
                dispatch(resetBrandingColorsError(errors(error)));
            }
        );

        return promise;
    };
}

//Update status page embedded css

export function resetStatusPageEmbeddedCssRequest() {
    return {
        type: types.RESET_STATUSPAGE_EMBEDDED_CSS_REQUEST,
    };
}

export function resetStatusPageEmbeddedCssSuccess(statusPage) {
    return {
        type: types.RESET_STATUSPAGE_EMBEDDED_CSS_SUCCESS,
        payload: statusPage,
    };
}

export function resetStatusPageEmbeddedCssError(error) {
    return {
        type: types.RESET_STATUSPAGE_EMBEDDED_CSS_FAILURE,
        payload: error,
    };
}

// Calls the API to update setting.
export function resetStatusPageEmbeddedCss(projectId, data) {
    return function(dispatch) {
        const promise = putApi(`status-page/${projectId}`, data);
        dispatch(resetStatusPageEmbeddedCssRequest());
        promise.then(
            function(response) {
                const statusPage = response.data;
                dispatch(resetStatusPageEmbeddedCssSuccess(statusPage));
                dispatch(fetchProjectStatusPage(projectId, true));
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
                dispatch(resetStatusPageEmbeddedCssError(errors(error)));
            }
        );

        return promise;
    };
}
//status page layout
export function updateStatusPageLayoutRequest() {
    return {
        type: types.UPDATE_STATUS_PAGE_LAYOUT_REQUEST,
    };
}

export function updateStatusPageLayoutSuccess(statusPage) {
    return {
        type: types.UPDATE_STATUS_PAGE_LAYOUT_SUCCESS,
        payload: statusPage,
    };
}

export function updateStatusPageLayoutError(error) {
    return {
        type: types.UPDATE_STATUS_PAGE_LAYOUT_FAILURE,
        payload: error,
    };
}

export function updateStatusPageLayout(projectId, data) {
    return function(dispatch) {
        const promise = putApi(`status-page/${projectId}`, data);
        dispatch(updateStatusPageLayoutRequest());
        promise.then(
            function(response) {
                const statusPage = response.data;
                dispatch(updateStatusPageLayoutSuccess(statusPage));
                dispatch(fetchProjectStatusPage(projectId, true));
                dispatch(updateStatusSuccess(statusPage));
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
                dispatch(updateStatusPageLayoutError(errors(error)));
            }
        );

        return promise;
    };
}
// fetch subscribers by monitors in statuspage
export function fetchSubscriberRequest() {
    return {
        type: types.FETCH_SUBSCRIBER_REQUEST,
    };
}

export function fetchSubscriberSuccess(data) {
    return {
        type: types.FETCH_SUBSCRIBER_SUCCESS,
        payload: data,
    };
}

export function fetchSubscriberFailure(error) {
    return {
        type: types.FETCH_SUBSCRIBER_FAILURE,
        payload: error,
    };
}

export function fetchStatusPageSubscribers(
    projectId,
    statusPageId,
    skip,
    limit
) {
    return function(dispatch) {
        const promise = getApi(
            `status-page/${projectId}/monitor/${statusPageId}?skip=${skip}&limit=${limit}`
        );
        dispatch(fetchSubscriberRequest());
        promise.then(
            function(response) {
                dispatch(fetchSubscriberSuccess(response.data));
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
                dispatch(fetchSubscriberFailure(errors(error)));
            }
        );
        return promise;
    };
}

export function createExternalStatusPageRequest() {
    return {
        type: types.CREATE_EXTERNAL_STATUSPAGE_REQUEST,
    };
}

export function createExternalStatusPageSuccess(data) {
    return {
        type: types.CREATE_EXTERNAL_STATUSPAGE_SUCCESS,
        payload: data,
    };
}

export function createExternalStatusPageFailure(error) {
    return {
        type: types.CREATE_EXTERNAL_STATUSPAGE_FAILURE,
        payload: error,
    };
}

export function createExternalStatusPage(projectId, statusPageId, data) {
    return function(dispatch) {
        const promise = postApi(
            `status-page/${projectId}/createExternalstatus-page/${statusPageId}`,
            data
        );
        dispatch(createExternalStatusPageRequest());
        promise.then(
            function(response) {
                dispatch(createExternalStatusPageSuccess(response.data));
                return response.data;
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
                dispatch(createExternalStatusPageFailure(error));
                return error;
            }
        );

        return promise;
    };
}

export function updateExternalStatusPageRequest() {
    return {
        type: types.UPDATE_EXTERNAL_STATUSPAGE_REQUEST,
    };
}

export function updateExternalStatusPageSuccess(data) {
    return {
        type: types.UPDATE_EXTERNAL_STATUSPAGE_SUCCESS,
        payload: data,
    };
}

export function updateExternalStatusPageFailure(error) {
    return {
        type: types.UPDATE_EXTERNAL_STATUSPAGE_FAILURE,
        payload: error,
    };
}

export function updateExternalStatusPage(
    projectId,
    externalStatusPageId,
    data
) {
    return function(dispatch) {
        const promise = postApi(
            `status-page/${projectId}/updateExternalstatus-page/${externalStatusPageId}`,
            data
        );
        dispatch(updateExternalStatusPageRequest());
        promise.then(
            function(response) {
                dispatch(updateExternalStatusPageSuccess(response.data));
                return response.data;
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
                dispatch(updateExternalStatusPageFailure(error));
                return error;
            }
        );

        return promise;
    };
}

export function fetchExternalStatusPagesRequest() {
    return {
        type: types.FETCH_EXTERNAL_STATUSPAGES_REQUEST,
    };
}

export function fetchExternalStatusPagesSuccess(data) {
    return {
        type: types.FETCH_EXTERNAL_STATUSPAGES_SUCCESS,
        payload: data,
    };
}

export function fetchExternalStatusPagesFailure(error) {
    return {
        type: types.FETCH_EXTERNAL_STATUSPAGES_FAILURE,
        payload: error,
    };
}

export function fetchExternalStatusPages(projectId, statusPageId) {
    return function(dispatch) {
        const promise = getApi(
            `status-page/${projectId}/fetchExternalStatusPages/${statusPageId}`
        );
        dispatch(fetchExternalStatusPagesRequest());
        promise.then(
            function(response) {
                dispatch(fetchExternalStatusPagesSuccess(response.data));
                return response.data;
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
                dispatch(fetchExternalStatusPagesFailure(error));
                return error;
            }
        );

        return promise;
    };
}

export function deleteExternalStatusPageRequest() {
    return {
        type: types.DELETE_EXTERNAL_STATUSPAGE_REQUEST,
    };
}

export function deleteExternalStatusPageSuccess(data) {
    return {
        type: types.DELETE_EXTERNAL_STATUSPAGE_SUCCESS,
        payload: data,
    };
}

export function deleteExternalStatusPageFailure(error) {
    return {
        type: types.DELETE_EXTERNAL_STATUSPAGE_FAILURE,
        payload: error,
    };
}

export function deleteExternalStatusPage(projectId, externalStatusPageId) {
    return function(dispatch) {
        const promise = postApi(
            `status-page/${projectId}/deleteExternalstatus-page/${externalStatusPageId}`
        );
        dispatch(deleteExternalStatusPageRequest());
        promise.then(
            function(response) {
                dispatch(deleteExternalStatusPageSuccess(response.data));
                return response.data;
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
                dispatch(deleteExternalStatusPageFailure(error));
                return error;
            }
        );

        return promise;
    };
}

export function createAnnouncementRequest() {
    return {
        type: types.CREATE_ANNOUNCEMEMT_REQUEST,
    };
}

export function createAnnouncementSuccess(data) {
    return {
        type: types.CREATE_ANNOUNCEMEMT_SUCCESS,
        payload: data,
    };
}

export function createAnnouncementFailure(error) {
    return {
        type: types.CREATE_ANNOUNCEMEMT_FAILURE,
        payload: error,
    };
}

export function createAnnouncement(projectId, statusPageId, data) {
    return function(dispatch) {
        const promise = postApi(
            `status-page/${projectId}/announcement/${statusPageId}`,
            data
        );
        dispatch(createAnnouncementRequest());
        promise.then(
            function(response) {
                dispatch(createAnnouncementSuccess(response.data));
                return response.data;
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
                dispatch(createAnnouncementFailure(error));
                return error;
            }
        );

        return promise;
    };
}

export function updateAnnouncement(
    projectId,
    statusPageId,
    announcementId,
    data
) {
    return function(dispatch) {
        const promise = putApi(
            `status-page/${projectId}/announcement/${statusPageId}/${announcementId}`,
            data
        );
        dispatch(createAnnouncementRequest());
        promise.then(
            function(response) {
                dispatch(createAnnouncementSuccess(response.data));
                return response.data;
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
                dispatch(createAnnouncementFailure(error));
                return error;
            }
        );

        return promise;
    };
}

export function fetchAnnouncementRequest() {
    return {
        type: types.FETCH_ANNOUNCEMEMT_REQUEST,
    };
}

export function fetchAnnouncementSuccess(data) {
    return {
        type: types.FETCH_ANNOUNCEMEMT_SUCCESS,
        payload: data,
    };
}

export function fetchAnnouncementFailure(error) {
    return {
        type: types.FETCH_ANNOUNCEMEMT_FAILURE,
        payload: error,
    };
}

export function fetchAnnouncements(projectId, statusPageId, skip = 0, limit) {
    return function(dispatch) {
        const promise = getApi(
            `status-page/${projectId}/announcement/${statusPageId}?skip=${skip}&limit=${limit}`
        );
        dispatch(fetchAnnouncementRequest());
        promise.then(
            function(response) {
                dispatch(fetchAnnouncementSuccess(response.data));
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
                dispatch(fetchAnnouncementFailure(error));
            }
        );
        return promise;
    };
}

export function fetchAnnouncementLogsRequest() {
    return {
        type: types.FETCH_ANNOUNCEMEMTLOGS_REQUEST,
    };
}

export function fetchAnnouncementLogsSuccess(data) {
    return {
        type: types.FETCH_ANNOUNCEMEMTLOGS_SUCCESS,
        payload: data,
    };
}

export function fetchAnnouncementLogsFailure(error) {
    return {
        type: types.FETCH_ANNOUNCEMEMTLOGS_FAILURE,
        payload: error,
    };
}

export function fetchAnnouncementLogs(
    projectId,
    statusPageId,
    skip = 0,
    limit
) {
    return function(dispatch) {
        const promise = getApi(
            `status-page/${projectId}/announcementLogs/${statusPageId}?skip=${skip}&limit=${limit}`
        );
        dispatch(fetchAnnouncementLogsRequest());
        promise.then(
            function(response) {
                dispatch(fetchAnnouncementLogsSuccess(response.data));
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
                dispatch(fetchAnnouncementLogsFailure(error));
            }
        );
        return promise;
    };
}

export function fetchSingleAnnouncementSuccess(data) {
    return {
        type: types.FETCH_SINCLE_ANNOUNCEMENT_SUCCESS,
        payload: data,
    };
}

export function fetchSingleAnnouncementFailure(error) {
    return {
        type: types.FETCH_SINCLE_ANNOUNCEMENT_FAILURE,
        payload: error,
    };
}

export function fetchSingleAnnouncement(
    projectId,
    statusPageSlug,
    announcementSlug
) {
    return function(dispatch) {
        const promise = getApi(
            `status-page/${projectId}/announcement/${statusPageSlug}/single/${announcementSlug}`
        );
        promise.then(
            function(response) {
                dispatch(fetchSingleAnnouncementSuccess(response.data));
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
                dispatch(fetchSingleAnnouncementFailure(error));
            }
        );
        return promise;
    };
}

export function handleAnnouncementSuccess(data) {
    return {
        type: types.HANDLE_ANNOUNCEMENT_SUCCESS,
        payload: data,
    };
}

export function handleAnnouncementFailure(error) {
    return {
        type: types.HANDLE_ANNOUNCEMENT_FAILURE,
        payload: error,
    };
}

export function resetHandleAnnouncement() {
    return {
        type: types.RESET_HANDLE_ANNOUNCEMENT,
    };
}

export function resetDeleteAnnouncement() {
    return {
        type: types.RESET_DELETE_ANNOUNCEMENT,
    };
}

export function deleteAnnouncementRequest() {
    return {
        type: types.DELETE_ANNOUNCEMENT_REQUEST,
    };
}

export function deleteAnnouncementSuccess(data) {
    return {
        type: types.DELETE_ANNOUNCEMENT_SUCCESS,
        payload: data,
    };
}

export function deleteAnnouncementFailure(error) {
    return {
        type: types.DELETE_ANNOUNCEMENT_FAILURE,
        payload: error,
    };
}

export function deleteAnnouncement(projectId, announcementId) {
    return function(dispatch) {
        const promise = deleteApi(
            `status-page/${projectId}/announcement/${announcementId}/delete`
        );
        dispatch(deleteAnnouncementRequest());
        promise.then(
            function(response) {
                dispatch(deleteAnnouncementSuccess(response.data));
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
                dispatch(deleteAnnouncementFailure(error));
            }
        );
        return promise;
    };
}

export function deleteAnnouncementLog(projectId, announcementLogId) {
    return function(dispatch) {
        const promise = deleteApi(
            `status-page/${projectId}/announcementLog/${announcementLogId}/delete`
        );
        dispatch(deleteAnnouncementRequest());
        promise.then(
            function(response) {
                dispatch(deleteAnnouncementSuccess(response.data));
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
                dispatch(deleteAnnouncementFailure(error));
            }
        );
        return promise;
    };
}

// Calls the API to delete StatusPages after deleting the project

export function deleteProjectStatusPages(projectId) {
    return {
        type: types.DELETE_PROJECT_STATUSPAGES,
        payload: projectId,
    };
}

// Logo

export function createLogoCache(imageUrl) {
    return {
        type: types.LOGO_CACHE_INSERT,
        payload: imageUrl,
    };
}

// Banner
export function createBannerCache(imageUrl) {
    return {
        type: types.BANNER_CACHE_INSERT,
        payload: imageUrl,
    };
}

export function resetBannerCache() {
    return {
        type: types.BANNER_CACHE_RESET,
    };
}

export function setStatusPageColors(color) {
    return {
        type: types.SET_STATUS_PAGE_COLORS,
        payload: color,
    };
}

export function createFaviconCache(imageUrl) {
    return {
        type: types.FAVICON_CACHE_INSERT,
        payload: imageUrl,
    };
}

export function resetLogoCache() {
    return {
        type: types.LOGO_CACHE_RESET,
    };
}

export function resetFaviconCache() {
    return {
        type: types.FAVICON_CACHE_RESET,
    };
}

export function paginateNext() {
    return {
        type: types.PAGINATE_NEXT,
    };
}

export function paginatePrev() {
    return {
        type: types.PAGINATE_PREV,
    };
}

export function paginateReset() {
    return {
        type: types.PAGINATE_RESET,
    };
}

export function paginate(type) {
    return function(dispatch) {
        type === 'next' && dispatch(paginateNext());
        type === 'prev' && dispatch(paginatePrev());
        type === 'reset' && dispatch(paginateReset());
    };
}

export function switchStatusPage(statusPage) {
    return {
        type: types.SWITCH_STATUSPAGE_SUCCESS,
        payload: statusPage,
    };
}
