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
    return function (dispatch) {
        const promise = postApi(`statusPage/${projectId}`, data);
        dispatch(createStatusPageRequest());
        promise.then(
            function (response) {
                const statusPage = response.data;
                dispatch(createStatusPageSuccess(statusPage));
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
                dispatch(createStatusPageError(errors(error)));
            }
        );

        return promise;
    };
}

// handle whether to show domain input field
export function addMoreDomain() {
    return {
        type: types.ADD_MORE_DOMAIN
    }
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
    return function (dispatch) {
        const promise = putApi(`statusPage/${projectId}`, data);
        dispatch(updateStatusPageSettingRequest());
        promise.then(
            function (response) {
                const statusPage = response.data;
                dispatch(updateStatusPageSettingSuccess(statusPage));
                dispatch(fetchProjectStatusPage(projectId, true));
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
    return function (dispatch) {
        const promise = putApi(`statusPage/${projectId}`, values);
        dispatch(updateStatusPageMonitorsRequest());

        promise.then(
            function (response) {
                const statusPage = response.data;
                dispatch(updateStatusPageMonitorsSuccess(statusPage));
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
    return function (dispatch) {
        const promise = putApi(`statusPage/${projectId}`, values);
        dispatch(updatePrivateStatusPageRequest());

        promise.then(
            function (response) {
                const statusPage = response.data;
                dispatch(updatePrivateStatusPageSuccess(statusPage));
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

// Calls the API to update private statuspages.
export function updateSubscriberOption(projectId, values) {
    return function (dispatch) {
        const promise = putApi(`statusPage/${projectId}`, values);
        dispatch(updateSubscriberOptionRequest());

        promise.then(
            function (response) {
                const statusPage = response.data;
                dispatch(updateSubscriberOptionSuccess(statusPage));
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
                dispatch(updateSubscriberOptionError(errors(error)));
            }
        );
        return promise;
    };
}
// Update status page branding

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

// Calls the API to update branding.
export function updateStatusPageBranding(projectId, values) {
    return function (dispatch) {
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
        if (values.title) data.append('title', values.title);
        if (values.description) data.append('description', values.description);
        if (values.copyright) data.append('copyright', values.copyright);
        if (values.colors) data.append('colors', JSON.stringify(values.colors));

        if (values._id) data.append('_id', values._id);

        const promise = putApi(`statusPage/${projectId}`, data);
        dispatch(updateStatusPageBrandingRequest());

        promise.then(
            function (response) {
                const statusPage = response.data;
                dispatch(updateStatusPageBrandingSuccess(statusPage));
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
                dispatch(updateStatusPageBrandingError(errors(error)));
            }
        );
        return promise;
    };
}

// Calls the API to update status page name.
export function updateStatusPageName(projectId, values) {
    return function (dispatch) {
        const promise = putApi(`statusPage/${projectId}`, values);
        dispatch(updateStatusPageNameRequest());

        promise.then(
            function (response) {
                const statusPage = response.data;
                dispatch(updateStatusPageNameSuccess(statusPage));
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
    return function (dispatch) {
        const promise = putApi(`statusPage/${projectId}`, values);
        dispatch(updateStatusPageLinksRequest());

        promise.then(
            function (response) {
                const statusPage = response.data;
                dispatch(updateStatusPageLinksSuccess(statusPage));
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
                dispatch(updateStatusPageLinksError(errors(error)));
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
    return function (dispatch) {
        const promise = getApi(
            `statusPage/${projectId}/statuspage?skip=${skip}&limit=${limit}`
        );
        if (!refresh) dispatch(fetchProjectStatusPageRequest());

        promise.then(
            function (response) {
                const data = response.data;
                data.projectId = projectId;
                dispatch(fetchProjectStatusPageSuccess(data));
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
    return function (dispatch) {
        const promise = getApi(`statusPage/${projectId}/statuspages`);
        if (!refresh) dispatch(fetchSubProjectStatusPagesRequest());

        promise.then(
            function (response) {
                const data = response.data;
                dispatch(fetchSubProjectStatusPagesSuccess(data));
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
                dispatch(fetchSubProjectStatusPagesError(errors(error)));
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
export function deleteStatusPage(projectId, statusPageId) {
    return function (dispatch) {
        const promise = deleteApi(
            `statusPage/${projectId}/${statusPageId}`,
            null
        );
        dispatch(deleteStatusPageRequest());
        promise.then(
            function (response) {
                const data = response.data;
                dispatch(deleteStatusPageSuccess(data));
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
                dispatch(deleteStatusPageError(errors(error)));
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
    return function (dispatch) {
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
