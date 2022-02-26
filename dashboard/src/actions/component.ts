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
export function fetchComponents({
    projectId,
    skip = 0,
    limit = 3
}: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = getApi(
            `component/${projectId}?skip=${skip}&limit=${limit}`
        );
        dispatch(fetchComponentsRequest());

        promise.then(
            function(components) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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

export function fetchComponentsSuccess(components: $TSFixMe) {
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

export function fetchComponentsFailure(error: $TSFixMe) {
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
export function fetchPaginatedComponents({
    projectId,
    skip = 0,
    limit = 3
}: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = getApi(
            `component/${projectId}/paginated?skip=${skip}&limit=${limit}`
        );
        dispatch(fetchPaginatedComponentsRequest(projectId));

        promise.then(
            function(response) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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

export function fetchPaginatedComponentsSuccess(payload: $TSFixMe) {
    return {
        type: types.FETCH_PAGINATED_COMPONENTS_SUCCESS,
        payload,
    };
}

export function fetchPaginatedComponentsRequest(projectId: $TSFixMe) {
    return {
        type: types.FETCH_PAGINATED_COMPONENTS_REQUEST,
        payload: projectId,
    };
}

export function fetchPaginatedComponentsFailure(error: $TSFixMe, projectId: $TSFixMe) {
    return {
        type: types.FETCH_PAGINATED_COMPONENTS_FAILURE,
        payload: { error, projectId },
    };
}

export function createComponent(projectId: $TSFixMe, values: $TSFixMe) {
    values.projectId = values.projectId._id || values.projectId;
    return function(dispatch: $TSFixMe) {
        const promise = postApi(`component/${projectId}`, values);
        dispatch(createComponentRequest());

        promise.then(
            function(component) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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

export function createComponentSuccess(newComponent: $TSFixMe) {
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

export function createComponentFailure(error: $TSFixMe) {
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

export function editComponent(projectId: $TSFixMe, values: $TSFixMe) {
    values.projectId = values.projectId._id || values.projectId;

    return function(dispatch: $TSFixMe) {
        const promise = putApi(`component/${projectId}/${values._id}`, values);
        dispatch(editComponentRequest());

        promise.then(
            function(component) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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

export function editComponentSuccess(newComponent: $TSFixMe) {
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

export function editComponentFailure(error: $TSFixMe) {
    return {
        type: types.EDIT_COMPONENT_FAILURE,
        payload: error,
    };
}

export function editComponentSwitch(index: $TSFixMe) {
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
export function deleteComponent(componentId: $TSFixMe, projectId: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = deleteApi(`component/${projectId}/${componentId}`, {
            componentId,
        });
        dispatch(deleteComponentRequest(componentId));

        promise.then(
            function(component) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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

export function deleteComponentSuccess(removedComponentId: $TSFixMe) {
    return {
        type: types.DELETE_COMPONENT_SUCCESS,
        payload: removedComponentId,
    };
}

export function deleteComponentRequest(componentId: $TSFixMe) {
    return {
        type: types.DELETE_COMPONENT_REQUEST,
        payload: componentId,
    };
}

export function deleteComponentFailure(error: $TSFixMe) {
    return {
        type: types.DELETE_COMPONENT_FAILURE,
        payload: error,
    };
}

export function deleteProjectComponents(projectId: $TSFixMe) {
    return {
        type: types.DELETE_PROJECT_COMPONENTS,
        payload: projectId,
    };
}

export function addSeat(projectId: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = postApi(`component/${projectId}/addseat`, {});
        dispatch(addSeatRequest());

        promise.then(
            function(component) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(createComponentFailure(component.data));
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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

export function addSeatSuccess(message: $TSFixMe) {
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

export function addSeatFailure(error: $TSFixMe) {
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
export function fetchComponentResources(projectId: $TSFixMe, componentId: $TSFixMe, skip: $TSFixMe, limit: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = getApi(
            `component/${projectId}/resources/${componentId}?skip=${skip}&limit=${limit}`
        );
        dispatch(fetchComponentResourcesRequest(componentId));

        promise.then(
            function(components) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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

export function fetchComponentResourcesSuccess(resources: $TSFixMe) {
    return {
        type: types.FETCH_COMPONENT_RESOURCES_SUCCESS,
        payload: resources,
    };
}

export function fetchComponentResourcesRequest(componentId: $TSFixMe) {
    return {
        type: types.FETCH_COMPONENT_RESOURCES_REQUEST,
        payload: { componentId: componentId },
    };
}

export function fetchComponentResourcesFailure(error: $TSFixMe) {
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
    projectId: $TSFixMe,
    componentId: $TSFixMe,
    startDate: $TSFixMe,
    endDate: $TSFixMe
) {
    return function(dispatch: $TSFixMe) {
        const promise = postApi(
            `component/${projectId}/summary/${componentId}`,
            { startDate, endDate }
        );
        dispatch(fetchComponentSummaryRequest(componentId));

        promise.then(
            function(components) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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

export function fetchComponentSummarySuccess(summary: $TSFixMe) {
    return {
        type: types.FETCH_COMPONENT_SUMMARY_SUCCESS,
        payload: summary,
    };
}

export function fetchComponentSummaryRequest(componentId: $TSFixMe) {
    return {
        type: types.FETCH_COMPONENT_SUMMARY_REQUEST,
        payload: componentId,
    };
}

export function fetchComponentSummaryFailure(error: $TSFixMe) {
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

export function addCurrentComponent(currentComponent: $TSFixMe) {
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

export function fetchComponentSuccess(payload: $TSFixMe) {
    return {
        type: types.FETCH_COMPONENT_SUCCESS,
        payload,
    };
}

export function fetchComponentFailure(error: $TSFixMe) {
    return {
        type: types.FETCH_COMPONENT_FAILURE,
        payload: error,
    };
}

export function fetchComponent(projectId: $TSFixMe, slug: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = getApi(`component/${projectId}/slug/${slug}`);
        dispatch(fetchComponentRequest());

        promise.then(
            function(component) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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
