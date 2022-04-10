import BackendAPI from 'Common-ui/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/invoice';
import ErrorPayload from 'Common-ui/src/payload-types/error';
// Array of invoices

export const getInvoiceRequest = (promise: $TSFixMe) => {
    return {
        type: types.GET_INVOICE_REQUEST,
        payload: promise,
    };
};

export const getInvoiceError = (error: ErrorPayload) => {
    return {
        type: types.GET_INVOICE_FAILED,
        payload: error,
    };
};

export const getInvoiceSuccess = (invoices: $TSFixMe) => {
    return {
        type: types.GET_INVOICE_SUCCESS,
        payload: invoices,
    };
};

export const getInvoiceReset = () => {
    return {
        type: types.GET_INVOICE_RESET,
    };
};

export const incrementNextCount = () => {
    return {
        type: types.INCREMENT_NEXT_COUNT,
    };
};

export const decrementNextCount = () => {
    return {
        type: types.DECREMENT_NEXT_COUNT,
    };
};

// Get invoice from the backend
export function getInvoice(
    projectId: string,
    startingAfter: $TSFixMe,
    endingBefore: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        let promise = null;
        const reqFornext = Boolean(startingAfter) && !endingBefore;
        const reqForPrev = Boolean(endingBefore) && Boolean(startingAfter);

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
            function (invoices) {
                dispatch(getInvoiceSuccess(invoices.data));
                if (reqFornext) {
                    dispatch(incrementNextCount());
                }
                if (reqForPrev) {
                    dispatch(decrementNextCount());
                }
            },
            function (error) {
                dispatch(getInvoiceError(error));
            }
        );
    };
}
