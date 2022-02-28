import { putApi, deleteApi } from '../api';
import * as types from '../constants/domain';

export function resetDomain() {
    return {
        type: types.RESET_VERIFY_DOMAIN,
    };
}

export function verifyDomainRequest() {
    return {
        type: types.VERIFY_DOMAIN_REQUEST,
    };
}

export function verifyDomainSuccess(payload: $TSFixMe) {
    return {
        type: types.VERIFY_DOMAIN_SUCCESS,
        payload,
    };
}

export function verifyDomainFailure(error: $TSFixMe) {
    return {
        type: types.VERIFY_DOMAIN_FAILURE,
        payload: error,
    };
}

export function verifyDomain({ projectId, domainId, payload }: $TSFixMe) {
    return async function(dispatch: $TSFixMe) {
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

export function createDomainSuccess(payload: $TSFixMe) {
    return {
        type: types.CREATE_DOMAIN_SUCCESS,
        payload,
    };
}

export function createDomainFailure(payload: $TSFixMe) {
    return {
        type: types.CREATE_DOMAIN_FAILURE,
        payload,
    };
}

export function createDomain({
    projectId,
    statusPageId,
    domain,
    cert,
    privateKey,
    autoProvisioning,
    enableHttps,
}: $TSFixMe) {
    return async function(dispatch: $TSFixMe) {
        dispatch(createDomainRequest());

        try {
            const response = await putApi(
                `status-page/${projectId}/${statusPageId}/domain`,
                { domain, cert, privateKey, enableHttps, autoProvisioning }
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

export function deleteDomainSuccess(payload: $TSFixMe) {
    return {
        type: types.DELETE_DOMAIN_SUCCESS,
        payload,
    };
}

export function deleteDomainFailure(payload: $TSFixMe) {
    return {
        type: types.DELETE_DOMAIN_FAILURE,
        payload,
    };
}

export function deleteDomain({ projectId, statusPageId, domainId }: $TSFixMe) {
    return async function(dispatch: $TSFixMe) {
        dispatch(deleteDomainRequest());
        try {
            const response = await deleteApi(
                `status-page/${projectId}/${statusPageId}/${domainId}`
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

export function updateDomainRequest() {
    return {
        type: types.UPDATE_DOMAIN_REQUEST,
    };
}

export function updateDomainSuccess(payload: $TSFixMe) {
    return {
        type: types.UPDATE_DOMAIN_SUCCESS,
        payload,
    };
}

export function updateDomainFailure(payload: $TSFixMe) {
    return {
        type: types.UPDATE_DOMAIN_FAILURE,
        payload,
    };
}

export function updateDomain({
    projectId,
    statusPageId,
    domainId,
    domain,
    cert,
    privateKey,
    enableHttps,
    autoProvisioning,
}: $TSFixMe) {
    return async function(dispatch: $TSFixMe) {
        dispatch(updateDomainRequest());
        try {
            const response = await putApi(
                `status-page/${projectId}/${statusPageId}/${domainId}`,
                { domain, cert, privateKey, enableHttps, autoProvisioning }
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
