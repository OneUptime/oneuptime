import { postApi } from '../api';
import * as types from '../constants/invoice';

// Array of invoices

export function getInvoiceRequest(promise) {
    return {
        type: types.GET_INVOICE_REQUEST,
        payload: promise,
    };
}

export function getInvoiceError(error) {
    return {
        type: types.GET_INVOICE_FAILED,
        payload: error,
    };
}

export function getInvoiceSuccess(invoices) {
    return {
        type: types.GET_INVOICE_SUCCESS,
        payload: invoices,
    };
}

export function getInvoiceReset() {
    return {
        type: types.GET_INVOICE_RESET,
    };
}

export function incrementNextCount() {
    return {
        type: types.INCREMENT_NEXT_COUNT,
    };
}

export function decrementNextCount() {
    return {
        type: types.DECREMENT_NEXT_COUNT,
    };
}

// Get invoice from the backend
export function getInvoice(projectId, startingAfter, endingBefore) {
    return function(dispatch) {
        let promise = null;
        const reqFornext = Boolean(startingAfter) && !endingBefore;
        const reqForPrev = Boolean(endingBefore) && Boolean(startingAfter);

        if (reqFornext) {
            promise = postApi(
                `invoice/${projectId}?startingAfter=${startingAfter}`,
                null
            );
        } else if (reqForPrev) {
            promise = postApi(
                `invoice/${projectId}?endingBefore=${endingBefore}`,
                null
            );
        } else {
            promise = postApi(`invoice/${projectId}`, null);
        }

        dispatch(getInvoiceRequest(promise));

        promise.then(
            function(invoices) {
                dispatch(getInvoiceSuccess(invoices.data));
                if (reqFornext) {
                    dispatch(incrementNextCount());
                }
                if (reqForPrev) {
                    dispatch(decrementNextCount());
                }
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
                dispatch(getInvoiceError(error));
            }
        );
    };
}
