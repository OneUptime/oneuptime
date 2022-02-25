import { postApi, getApi, deleteApi, putApi } from '../api';
import * as types from '../constants/component';
import errors from '../errors';

export function showDeleteModal() {
    return {
        type: types.SHOW_DELETE_MODAL,
    };
}

export function hideDeleteModal() {
    return {
        type: types.HIDE_DELETE_MODAL,
    };
}

// Component list
// props -> {name: '', type, data -> { data.url}}
export function fetchComponents({ projectId, skip = 0, limit = 3 }) {
    return function(dispatch) {
        const promise = getApi(
            `component/${projectId}?skip=${skip}&limit=${limit}`
        );
        dispatch(fetchComponentsRequest());

        promise.then(
            function(components) {
                dispatch(fetchComponentsSuccess(components.data));
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
                dispatch(fetchComponentsFailure(errors(error)));
            }
        );

        return promise;
    };
}

export function fetchComponentsSuccess(components) {
    return {
        type: types.FETCH_COMPONENTS_SUCCESS,
        payload: components,
    };
}

export function fetchComponentsRequest() {
    return {
        type: types.FETCH_COMPONENTS_REQUEST,
    };
}

export function fetchComponentsFailure(error) {
    return {
        type: types.FETCH_COMPONENTS_FAILURE,
        payload: error,
    };
}

export function resetFetchComponents() {
    return {
        type: types.FETCH_COMPONENTS_RESET,
    };
}

// Component list
// props -> {name: '', type, data -> { data.url}}
export function fetchPaginatedComponents({ projectId, skip = 0, limit = 3 }) {
    return function(dispatch) {
        const promise = getApi(
            `component/${projectId}/paginated?skip=${skip}&limit=${limit}`
        );
        dispatch(fetchPaginatedComponentsRequest(projectId));

        promise.then(
            function(response) {
                dispatch(fetchPaginatedComponentsSuccess(response.data));
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
                dispatch(
                    fetchPaginatedComponentsFailure(errors(error), projectId)
                );
            }
        );

        return promise;
    };
}

export function fetchPaginatedComponentsSuccess(payload) {
    return {
        type: types.FETCH_PAGINATED_COMPONENTS_SUCCESS,
        payload,
    };
}

export function fetchPaginatedComponentsRequest(projectId) {
    return {
        type: types.FETCH_PAGINATED_COMPONENTS_REQUEST,
        payload: projectId,
    };
}

export function fetchPaginatedComponentsFailure(error, projectId) {
    return {
        type: types.FETCH_PAGINATED_COMPONENTS_FAILURE,
        payload: { error, projectId },
    };
}

export function createComponent(projectId, values) {
    values.projectId = values.projectId._id || values.projectId;
    return function(dispatch) {
        const promise = postApi(`component/${projectId}`, values);
        dispatch(createComponentRequest());

        promise.then(
            function(component) {
                dispatch(createComponentSuccess(component.data));
            },
            function(error) {
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
                dispatch(createComponentFailure(errors(error)));
            }
        );

        return promise;
    };
}

export function createComponentSuccess(newComponent) {
    return {
        type: types.CREATE_COMPONENT_SUCCESS,
        payload: newComponent,
    };
}

export function createComponentRequest() {
    return {
        type: types.CREATE_COMPONENT_REQUEST,
    };
}

export function createComponentFailure(error) {
    return {
        type: types.CREATE_COMPONENT_FAILURE,
        payload: error,
    };
}

export function resetCreateComponent() {
    return {
        type: types.CREATE_COMPONENT_RESET,
    };
}

export function editComponent(projectId, values) {
    values.projectId = values.projectId._id || values.projectId;

    return function(dispatch) {
        const promise = putApi(`component/${projectId}/${values._id}`, values);
        dispatch(editComponentRequest());

        promise.then(
            function(component) {
                dispatch(editComponentSuccess(component.data));
            },
            function(error) {
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
                dispatch(editComponentFailure(errors(error)));
            }
        );

        return promise;
    };
}

export function editComponentSuccess(newComponent) {
    return {
        type: types.EDIT_COMPONENT_SUCCESS,
        payload: newComponent,
    };
}

export function editComponentRequest() {
    return {
        type: types.EDIT_COMPONENT_REQUEST,
    };
}

export function editComponentFailure(error) {
    return {
        type: types.EDIT_COMPONENT_FAILURE,
        payload: error,
    };
}

export function editComponentSwitch(index) {
    return {
        type: types.EDIT_COMPONENT_SWITCH,
        payload: index,
    };
}

export function resetEditComponent() {
    return {
        type: types.EDIT_COMPONENT_RESET,
    };
}

// Delete a component
// props -> {name: '', type, data -> { data.url}}
export function deleteComponent(componentId, projectId) {
    return function(dispatch) {
        const promise = deleteApi(`component/${projectId}/${componentId}`, {
            componentId,
        });
        dispatch(deleteComponentRequest(componentId));

        promise.then(
            function(component) {
                dispatch(deleteComponentSuccess(component.data._id));
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
                dispatch(
                    deleteComponentFailure({
                        error: errors(error),
                        componentId,
                    })
                );
            }
        );

        return promise;
    };
}

export function deleteComponentSuccess(removedComponentId) {
    return {
        type: types.DELETE_COMPONENT_SUCCESS,
        payload: removedComponentId,
    };
}

export function deleteComponentRequest(componentId) {
    return {
        type: types.DELETE_COMPONENT_REQUEST,
        payload: componentId,
    };
}

export function deleteComponentFailure(error) {
    return {
        type: types.DELETE_COMPONENT_FAILURE,
        payload: error,
    };
}

export function deleteProjectComponents(projectId) {
    return {
        type: types.DELETE_PROJECT_COMPONENTS,
        payload: projectId,
    };
}

export function addSeat(projectId) {
    return function(dispatch) {
        const promise = postApi(`component/${projectId}/addseat`, {});
        dispatch(addSeatRequest());

        promise.then(
            function(component) {
                dispatch(createComponentFailure(component.data));
                dispatch(addSeatSuccess(component.data));
            },
            function(error) {
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
                dispatch(addSeatFailure(errors(error)));
            }
        );

        return promise;
    };
}

export function addSeatSuccess(message) {
    return {
        type: types.ADD_SEAT_SUCCESS,
        payload: message,
    };
}

export function addSeatRequest() {
    return {
        type: types.ADD_SEAT_REQUEST,
    };
}

export function addSeatFailure(error) {
    return {
        type: types.ADD_SEAT_FAILURE,
        payload: error,
    };
}

export function addSeatReset() {
    return {
        type: types.ADD_SEAT_RESET,
    };
}

// Component Resources list
// props -> {name: '', type, data -> { data.url}}
export function fetchComponentResources(projectId, componentId, skip, limit) {
    return function(dispatch) {
        const promise = getApi(
            `component/${projectId}/resources/${componentId}?skip=${skip}&limit=${limit}`
        );
        dispatch(fetchComponentResourcesRequest(componentId));

        promise.then(
            function(components) {
                dispatch(fetchComponentResourcesSuccess(components.data));
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
                dispatch(fetchComponentResourcesFailure(errors(error)));
            }
        );

        return promise;
    };
}

export function fetchComponentResourcesSuccess(resources) {
    return {
        type: types.FETCH_COMPONENT_RESOURCES_SUCCESS,
        payload: resources,
    };
}

export function fetchComponentResourcesRequest(componentId) {
    return {
        type: types.FETCH_COMPONENT_RESOURCES_REQUEST,
        payload: { componentId: componentId },
    };
}

export function fetchComponentResourcesFailure(error) {
    return {
        type: types.FETCH_COMPONENT_RESOURCES_FAILURE,
        payload: error,
    };
}

export function resetFetchComponentResources() {
    return {
        type: types.FETCH_COMPONENT_RESOURCES_RESET,
    };
}

// Component Summary
export function fetchComponentSummary(
    projectId,
    componentId,
    startDate,
    endDate
) {
    return function(dispatch) {
        const promise = postApi(
            `component/${projectId}/summary/${componentId}`,
            { startDate, endDate }
        );
        dispatch(fetchComponentSummaryRequest(componentId));

        promise.then(
            function(components) {
                dispatch(fetchComponentSummarySuccess(components.data));
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
                dispatch(fetchComponentSummaryFailure(errors(error)));
            }
        );

        return promise;
    };
}

export function fetchComponentSummarySuccess(summary) {
    return {
        type: types.FETCH_COMPONENT_SUMMARY_SUCCESS,
        payload: summary,
    };
}

export function fetchComponentSummaryRequest(componentId) {
    return {
        type: types.FETCH_COMPONENT_SUMMARY_REQUEST,
        payload: componentId,
    };
}

export function fetchComponentSummaryFailure(error) {
    return {
        type: types.FETCH_COMPONENT_SUMMARY_FAILURE,
        payload: error,
    };
}

export function resetFetchComponentSummary() {
    return {
        type: types.FETCH_COMPONENT_SUMMARY_RESET,
    };
}

export function addCurrentComponent(currentComponent) {
    return {
        type: types.ADD_CURRENT_COMPONENT,
        payload: currentComponent,
    };
}

export function fetchComponentRequest() {
    return {
        type: types.FETCH_COMPONENT_REQUEST,
    };
}

export function fetchComponentSuccess(payload) {
    return {
        type: types.FETCH_COMPONENT_SUCCESS,
        payload,
    };
}

export function fetchComponentFailure(error) {
    return {
        type: types.FETCH_COMPONENT_FAILURE,
        payload: error,
    };
}

export function fetchComponent(projectId, slug) {
    return function(dispatch) {
        const promise = getApi(`component/${projectId}/slug/${slug}`);
        dispatch(fetchComponentRequest());

        promise.then(
            function(component) {
                dispatch(fetchComponentSuccess(component.data));
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
                dispatch(fetchComponentFailure(errors(error)));
            }
        );

        return promise;
    };
}
