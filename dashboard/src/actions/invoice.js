import { postApi } from '../api';
import * as types from '../constants/invoice'

// Array of invoices

export function getInvoiceRequest(promise) {
    return {
        type: types.GET_INVOICE_REQUEST,
        payload: promise
    };
}

export function getInvoiceError(error) {
    return {
        type: types.GET_INVOICE_FAILED,
        payload: error
    };
}

export function getInvoiceSuccess(invoices) {
    return {
        type: types.GET_INVOICE_SUCCESS,
        payload: invoices
    };
}

export function getInvoiceReset() {
    return {
        type: types.GET_INVOICE_RESET
    }
}

// Get invoice from the backend
export function getInvoice(projectId, startingAfter) {

    return function (dispatch) {
        var promise = null;
        if (startingAfter !== undefined) {
            promise = postApi(`invoice/${projectId}?startingAfter=${startingAfter}`, null)
        } else {
            promise = postApi(`invoice/${projectId}`, null)
        }

        dispatch(getInvoiceRequest(promise));

        promise.then(function (invoices) {
            dispatch(getInvoiceSuccess(invoices.data))
        }, function (error) {
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            if(error && error.message){
				error = error.message;
            }
            else{
				error = 'Network Error';
			}
            dispatch(getInvoiceError(error));
        });
    }
}
