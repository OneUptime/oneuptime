import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ObjectID from 'Common/Types/ObjectID';
import * as types from '../constants/component';
import ErrorPayload from 'CommonUI/src/payload-types/error';
import PositiveNumber from 'Common/Types/PositiveNumber';
export const showDeleteModal: Function = (): void => {
    return {
        type: types.SHOW_DELETE_MODAL,
    };
};

export const hideDeleteModal: Function = (): void => {
    return {
        type: types.HIDE_DELETE_MODAL,
    };
};

/*
 * Component list
 * Props -> {name: '', type, data -> { data.url}}
 */
export const fetchComponents: Function = ({
    projectId,
    skip = 0,
    limit = 3,
}: $TSFixMe) => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `component/${projectId}?skip=${skip}&limit=${limit}`
        );
        dispatch(fetchComponentsRequest());

        promise.then(
            (components: $TSFixMe): void => {
                dispatch(fetchComponentsSuccess(components.data));
            },
            (error: $TSFixMe): void => {
                dispatch(fetchComponentsFailure(error));
            }
        );

        return promise;
    };
};

export const fetchComponentsSuccess: Function = (
    components: $TSFixMe
): void => {
    return {
        type: types.FETCH_COMPONENTS_SUCCESS,
        payload: components,
    };
};

export const fetchComponentsRequest: Function = (): void => {
    return {
        type: types.FETCH_COMPONENTS_REQUEST,
    };
};

export const fetchComponentsFailure: Function = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_COMPONENTS_FAILURE,
        payload: error,
    };
};

export const resetFetchComponents: Function = (): void => {
    return {
        type: types.FETCH_COMPONENTS_RESET,
    };
};

/*
 * Component list
 * Props -> {name: '', type, data -> { data.url}}
 */
export function fetchPaginatedComponents({
    projectId,
    skip = 0,
    limit = 3,
}: $TSFixMe) {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `component/${projectId}/paginated?skip=${skip}&limit=${limit}`
        );
        dispatch(fetchPaginatedComponentsRequest(projectId));

        promise.then(
            (response: $TSFixMe): void => {
                dispatch(fetchPaginatedComponentsSuccess(response.data));
            },
            (error: $TSFixMe): void => {
                dispatch(fetchPaginatedComponentsFailure(error, projectId));
            }
        );

        return promise;
    };
}

export const fetchPaginatedComponentsSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.FETCH_PAGINATED_COMPONENTS_SUCCESS,
        payload,
    };
};

export const fetchPaginatedComponentsRequest: Function = (
    projectId: ObjectID
): void => {
    return {
        type: types.FETCH_PAGINATED_COMPONENTS_REQUEST,
        payload: projectId,
    };
};

export function fetchPaginatedComponentsFailure(
    error: ErrorPayload,
    projectId: ObjectID
): void {
    return {
        type: types.FETCH_PAGINATED_COMPONENTS_FAILURE,
        payload: { error, projectId },
    };
}

export const createComponent: Function = (
    projectId: ObjectID,
    values: $TSFixMe
): void => {
    values.projectId = values.projectId._id || values.projectId;
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            `component/${projectId}`,
            values
        );
        dispatch(createComponentRequest());

        promise.then(
            (component: $TSFixMe): void => {
                dispatch(createComponentSuccess(component.data));
            },
            (error: $TSFixMe): void => {
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
                dispatch(createComponentFailure(error));
            }
        );

        return promise;
    };
};

export const createComponentSuccess: Function = (
    newComponent: $TSFixMe
): void => {
    return {
        type: types.CREATE_COMPONENT_SUCCESS,
        payload: newComponent,
    };
};

export const createComponentRequest: Function = (): void => {
    return {
        type: types.CREATE_COMPONENT_REQUEST,
    };
};

export const createComponentFailure: Function = (error: ErrorPayload): void => {
    return {
        type: types.CREATE_COMPONENT_FAILURE,
        payload: error,
    };
};

export const resetCreateComponent: Function = (): void => {
    return {
        type: types.CREATE_COMPONENT_RESET,
    };
};

export const editComponent: Function = (
    projectId: ObjectID,
    values: $TSFixMe
): void => {
    values.projectId = values.projectId._id || values.projectId;

    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.put(
            `component/${projectId}/${values._id}`,
            values
        );
        dispatch(editComponentRequest());

        promise.then(
            (component: $TSFixMe): void => {
                dispatch(editComponentSuccess(component.data));
            },
            (error: $TSFixMe): void => {
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
                dispatch(editComponentFailure(error));
            }
        );

        return promise;
    };
};

export const editComponentSuccess: Function = (
    newComponent: $TSFixMe
): void => {
    return {
        type: types.EDIT_COMPONENT_SUCCESS,
        payload: newComponent,
    };
};

export const editComponentRequest: Function = (): void => {
    return {
        type: types.EDIT_COMPONENT_REQUEST,
    };
};

export const editComponentFailure: Function = (error: ErrorPayload): void => {
    return {
        type: types.EDIT_COMPONENT_FAILURE,
        payload: error,
    };
};

export const editComponentSwitch: Function = (index: $TSFixMe): void => {
    return {
        type: types.EDIT_COMPONENT_SWITCH,
        payload: index,
    };
};

export const resetEditComponent: Function = (): void => {
    return {
        type: types.EDIT_COMPONENT_RESET,
    };
};

/*
 * Delete a component
 * Props -> {name: '', type, data -> { data.url}}
 */
export const deleteComponent: Function = (
    componentId: $TSFixMe,
    projectId: ObjectID
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe =
            delete (`component/${projectId}/${componentId}`,
            {
                componentId,
            });
        dispatch(deleteComponentRequest(componentId));

        promise.then(
            (component: $TSFixMe): void => {
                dispatch(deleteComponentSuccess(component.data._id));
            },
            (error: $TSFixMe): void => {
                dispatch(
                    deleteComponentFailure({
                        error: error,
                        componentId,
                    })
                );
            }
        );

        return promise;
    };
};

export const deleteComponentSuccess: Function = (
    removedComponentId: $TSFixMe
): void => {
    return {
        type: types.DELETE_COMPONENT_SUCCESS,
        payload: removedComponentId,
    };
};

export const deleteComponentRequest: Function = (
    componentId: $TSFixMe
): void => {
    return {
        type: types.DELETE_COMPONENT_REQUEST,
        payload: componentId,
    };
};

export const deleteComponentFailure: Function = (error: ErrorPayload): void => {
    return {
        type: types.DELETE_COMPONENT_FAILURE,
        payload: error,
    };
};

export const deleteProjectComponents: Function = (
    projectId: ObjectID
): void => {
    return {
        type: types.DELETE_PROJECT_COMPONENTS,
        payload: projectId,
    };
};

export const addSeat: Function = (projectId: ObjectID): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            `component/${projectId}/addseat`,
            {}
        );
        dispatch(addSeatRequest());

        promise.then(
            (component: $TSFixMe): void => {
                dispatch(createComponentFailure(component.data));

                dispatch(addSeatSuccess(component.data));
            },
            (error: $TSFixMe): void => {
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
                dispatch(addSeatFailure(error));
            }
        );

        return promise;
    };
};

export const addSeatSuccess: Function = (message: $TSFixMe): void => {
    return {
        type: types.ADD_SEAT_SUCCESS,
        payload: message,
    };
};

export const addSeatRequest: Function = (): void => {
    return {
        type: types.ADD_SEAT_REQUEST,
    };
};

export const addSeatFailure: Function = (error: ErrorPayload): void => {
    return {
        type: types.ADD_SEAT_FAILURE,
        payload: error,
    };
};

export const addSeatReset: Function = (): void => {
    return {
        type: types.ADD_SEAT_RESET,
    };
};

/*
 * Component Resources list
 * Props -> {name: '', type, data -> { data.url}}
 */
export function fetchComponentResources(
    projectId: ObjectID,
    componentId: $TSFixMe,
    skip: PositiveNumber,
    limit: PositiveNumber
) {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `component/${projectId}/resources/${componentId}?skip=${skip}&limit=${limit}`
        );
        dispatch(fetchComponentResourcesRequest(componentId));

        promise.then(
            (components: $TSFixMe): void => {
                dispatch(fetchComponentResourcesSuccess(components.data));
            },
            (error: $TSFixMe): void => {
                dispatch(fetchComponentResourcesFailure(error));
            }
        );

        return promise;
    };
}

export const fetchComponentResourcesSuccess: Function = (
    resources: $TSFixMe
): void => {
    return {
        type: types.FETCH_COMPONENT_RESOURCES_SUCCESS,
        payload: resources,
    };
};

export const fetchComponentResourcesRequest: Function = (
    componentId: $TSFixMe
): void => {
    return {
        type: types.FETCH_COMPONENT_RESOURCES_REQUEST,
        payload: { componentId: componentId },
    };
};

export const fetchComponentResourcesFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_COMPONENT_RESOURCES_FAILURE,
        payload: error,
    };
};

export const resetFetchComponentResources: Function = (): void => {
    return {
        type: types.FETCH_COMPONENT_RESOURCES_RESET,
    };
};

// Component Summary
export function fetchComponentSummary(
    projectId: ObjectID,
    componentId: $TSFixMe,
    startDate: $TSFixMe,
    endDate: $TSFixMe
) {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            `component/${projectId}/summary/${componentId}`,
            { startDate, endDate }
        );
        dispatch(fetchComponentSummaryRequest(componentId));

        promise.then(
            (components: $TSFixMe): void => {
                dispatch(fetchComponentSummarySuccess(components.data));
            },
            (error: $TSFixMe): void => {
                dispatch(fetchComponentSummaryFailure(error));
            }
        );

        return promise;
    };
}

export const fetchComponentSummarySuccess: Function = (
    summary: $TSFixMe
): void => {
    return {
        type: types.FETCH_COMPONENT_SUMMARY_SUCCESS,
        payload: summary,
    };
};

export const fetchComponentSummaryRequest: Function = (
    componentId: $TSFixMe
): void => {
    return {
        type: types.FETCH_COMPONENT_SUMMARY_REQUEST,
        payload: componentId,
    };
};

export const fetchComponentSummaryFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_COMPONENT_SUMMARY_FAILURE,
        payload: error,
    };
};

export const resetFetchComponentSummary: Function = (): void => {
    return {
        type: types.FETCH_COMPONENT_SUMMARY_RESET,
    };
};

export const addCurrentComponent: Function = (
    currentComponent: $TSFixMe
): void => {
    return {
        type: types.ADD_CURRENT_COMPONENT,
        payload: currentComponent,
    };
};

export const fetchComponentRequest: Function = (): void => {
    return {
        type: types.FETCH_COMPONENT_REQUEST,
    };
};

export const fetchComponentSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.FETCH_COMPONENT_SUCCESS,
        payload,
    };
};

export const fetchComponentFailure: Function = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_COMPONENT_FAILURE,
        payload: error,
    };
};

export const fetchComponent: Function = (
    projectId: ObjectID,
    slug: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `component/${projectId}/slug/${slug}`
        );
        dispatch(fetchComponentRequest());

        promise.then(
            (component: $TSFixMe): void => {
                dispatch(fetchComponentSuccess(component.data));
            },
            (error: $TSFixMe): void => {
                dispatch(fetchComponentFailure(error));
            }
        );

        return promise;
    };
};
