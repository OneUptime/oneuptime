import { putApi, postApi } from '../api';
import * as types from '../constants/domain';

export function verifyDomainRequest() {
    return {
        type: types.VERIFY_DOMAIN_REQUEST,
    };
}

export function verifyDomainSuccess(payload) {
    return {
        type: types.VERIFY_DOMAIN_SUCCESS,
        payload,
    };
}

export function verifyDomainFailure(error) {
    return {
        type: types.VERIFY_DOMAIN_FAILURE,
        payload: error,
    };
}

export function verifyDomain({ projectId, domainId, payload }) {
    return async function(dispatch) {
        dispatch(verifyDomainRequest());

        try {
            const response = await putApi(
                `domain/${projectId}/verify/${domainId}`,
                payload
            );
            dispatch(verifyDomainSuccess(response.data));
        } catch (error) {
            const errorMsg =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(verifyDomainFailure(errorMsg));
        }
    };
}

export function createDomainRequest() {
    return {
        type: types.CREATE_DOMAIN_REQUEST,
    };
}

export function createDomainSuccess(payload) {
    return {
        type: types.CREATE_DOMAIN_SUCCESS,
        payload,
    };
}

export function createDomainFailure(payload) {
    return {
        type: types.CREATE_DOMAIN_FAILURE,
        payload,
    };
}

export function createDomain({ projectId, statusPageId, domain }) {
    return async function(dispatch) {
        dispatch(createDomainRequest());

        try {
            const response = await postApi(
                `statusPage/${projectId}/${statusPageId}`,
                { domain }
            );
            dispatch(createDomainSuccess(response.data));
        } catch (error) {
            const errorMsg =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(createDomainFailure(errorMsg));
        }
    };
}
