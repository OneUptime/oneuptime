import { postApi, getApi, deleteApi, putApi } from '../api';
import * as types from '../constants/component';
import errors from '../errors';

// Component list
// props -> {name: '', type, data -> { data.url}}
export function fetchComponents(projectId) {
    return function(dispatch) {
        const promise = getApi(`component/${projectId}`);
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
