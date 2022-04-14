import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ObjectID from 'Common/Types/ObjectID';
import ErrorPayload from 'CommonUI/src/payload-types/error';
export const  OPEN_SUBSCRIBE_MENU: string = 'OPEN_SUBSCRIBE_MENU';
export const  SELECTED_MENU: string = 'SELECTED_MENU';
export const  USER_DATA: string = 'USER_DATA';
export const  USER_DATA_RESET: string = 'USER_DATA_RESET';
export const  SUBSCRIBE_SUCCESS: string = 'SUBSCRIBE_SUCCESS';
export const  SUBSCRIBE_REQUEST: string = 'SUBSCRIBE_REQUEST';
export const  SUBSCRIBE_FAILURE: string = 'SUBSCRIBE_FAILURE';
export const  VALIDATION_ERROR: string = 'VALIDATION_ERROR';
export const  OPEN_LANGUAGE_MENU: string = 'OPEN_LANGUAGE_MENU';

export const openSubscribeMenu = (): void => {
    return {
        type: OPEN_SUBSCRIBE_MENU,
    };
};

export const openLanguageMenu = (): void => {
    return {
        type: OPEN_LANGUAGE_MENU,
    };
};

export const selectedMenu = (data: $TSFixMe): void => {
    return {
        type: SELECTED_MENU,
        payload: data,
    };
};

export const userData = (data: $TSFixMe): void => {
    return {
        type: USER_DATA,
        payload: data,
    };
};

export const userDataReset = (): void => {
    return {
        type: USER_DATA_RESET,
    };
};

export const subscribeRequest = (): void => {
    return {
        type: SUBSCRIBE_REQUEST,
    };
};

export const subscribeSuccess = (): void => {
    return {
        type: SUBSCRIBE_SUCCESS,
    };
};

export const subscribeFailure = (data: $TSFixMe): void => {
    return {
        type: SUBSCRIBE_FAILURE,
        payload: data,
    };
};

export const validationError = (error: ErrorPayload): void => {
    return {
        type: VALIDATION_ERROR,
        payload: error,
    };
};
// Calls the API to get status
export const subscribeUser = (
    userDetails: $TSFixMe,
    monitors: $TSFixMe,
    projectId: ObjectID,
    statusPageId: $TSFixMe,
    notificationType: $TSFixMe
) => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(
            `subscriber/${projectId}/${statusPageId}`,
            {
                userDetails,
                monitors,
                notificationType,
            }
        );

        dispatch(subscribeRequest());

        promise.then(
            () => {
                dispatch(subscribeSuccess());
            },
            error => {
                if (error && error.response && error.response.data) {
                    error = error.response.data;
                }
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                }
                if (error.length > 100) {
                    error = 'Network Error';
                }

                dispatch(subscribeFailure(error));
            }
        );
    };
};
