import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ObjectID from 'Common/Types/ObjectID';
import * as types from '../constants/invoice';
import ErrorPayload from 'CommonUI/src/payload-types/error';
// Array of invoices

export const getInvoiceRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.GET_INVOICE_REQUEST,
        payload: promise,
    };
};

export const getInvoiceError: Function = (error: ErrorPayload): void => {
    return {
        type: types.GET_INVOICE_FAILED,
        payload: error,
    };
};

export const getInvoiceSuccess: Function = (invoices: $TSFixMe): void => {
    return {
        type: types.GET_INVOICE_SUCCESS,
        payload: invoices,
    };
};

export const getInvoiceReset: Function = (): void => {
    return {
        type: types.GET_INVOICE_RESET,
    };
};

export const incrementNextCount: Function = (): void => {
    return {
        type: types.INCREMENT_NEXT_COUNT,
    };
};

export const decrementNextCount: Function = (): void => {
    return {
        type: types.DECREMENT_NEXT_COUNT,
    };
};

// Get invoice from the backend
export function getInvoice(
    projectId: ObjectID,
    startingAfter: $TSFixMe,
    endingBefore: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        let promise: $TSFixMe = null;
        const reqFornext: $TSFixMe = Boolean(startingAfter) && !endingBefore;
        const reqForPrev: $TSFixMe =
            Boolean(endingBefore) && Boolean(startingAfter);

        if (reqFornext) {
            promise = BackendAPI.post(
                `invoice/${projectId}?startingAfter=${startingAfter}`,
                null
            );
        } else if (reqForPrev) {
            promise = BackendAPI.post(
                `invoice/${projectId}?endingBefore=${endingBefore}`,
                null
            );
        } else {
            promise = BackendAPI.post(`invoice/${projectId}`, null);
        }

        dispatch(getInvoiceRequest(promise));

        promise.then(
            (invoices): void => {
                dispatch(getInvoiceSuccess(invoices.data));
                if (reqFornext) {
                    dispatch(incrementNextCount());
                }
                if (reqForPrev) {
                    dispatch(decrementNextCount());
                }
            },
            (error): void => {
                dispatch(getInvoiceError(error));
            }
        );
    };
}
