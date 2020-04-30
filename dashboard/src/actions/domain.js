import { putApi, deleteApi } from '../api';
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
                `domainVerificationToken/${projectId}/verify/${domainId}`,
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
            const response = await putApi(
                `statusPage/${projectId}/${statusPageId}/domain`,
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

export function deleteDomainRequest() {
    return {
        type: types.DELETE_DOMAIN_REQUEST,
    };
}

export function deleteDomainSuccess(payload) {
    return {
        type: types.DELETE_DOMAIN_SUCCESS,
        payload,
    };
}

export function deleteDomainFailure(payload) {
    return {
        type: types.DELETE_DOMAIN_FAILURE,
        payload,
    };
}

export function deleteDomain({projectId, statusPageId, domainId}) {
    return async function(dispatch) {
        dispatch(deleteDomainRequest());
        try {
            const response = await deleteApi(
                `statusPage/${projectId}/${statusPageId}/${domainId}`
            );
            dispatch(deleteDomainSuccess(response.data));
        } catch (error) {
            const errorMsg =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(deleteDomainFailure(errorMsg));
        }
    };
}

export function updateDomainRequest(){
    return {
        type: types.UPDATE_DOMAIN_REQUEST,
    }
}

export function updateDomainSuccess(payload){
    return {
        type: types.UPDATE_DOMAIN_SUCCESS,
        payload,
    }
}

export function updateDomainFailure(payload){
    return {
        type: types.UPDATE_DOMAIN_FAILURE,
        payload,
    }
}

export function updateDomain({projectId, statusPageId, domainId, newDomain}){
    return async function(dispatch) {
        dispatch(updateDomainRequest());
        try {
            const response = await putApi(
                `statusPage/${projectId}/${statusPageId}/${domainId}`,
                {domain: newDomain}
            );
            dispatch(updateDomainSuccess(response.data));
        } catch (error) {
            const errorMsg =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(updateDomainFailure(errorMsg));
        }
    };
}