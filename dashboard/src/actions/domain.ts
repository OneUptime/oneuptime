import BackendAPI from '../api';
import * as types from '../constants/domain';
import { Dispatch } from 'redux';
export const resetDomain = () => {
    return {
        type: types.RESET_VERIFY_DOMAIN,
    };
};

export const verifyDomainRequest = () => {
    return {
        type: types.VERIFY_DOMAIN_REQUEST,
    };
};

export const verifyDomainSuccess = (payload: $TSFixMe) => {
    return {
        type: types.VERIFY_DOMAIN_SUCCESS,
        payload,
    };
};

export const verifyDomainFailure = (error: $TSFixMe) => {
    return {
        type: types.VERIFY_DOMAIN_FAILURE,
        payload: error,
    };
};

export const verifyDomain = ({ projectId, domainId, payload }: $TSFixMe) => {
    return async function (dispatch: Dispatch) {
        dispatch(verifyDomainRequest());

        try {
            const response = await BackendAPI.put(
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
};

export const createDomainRequest = () => {
    return {
        type: types.CREATE_DOMAIN_REQUEST,
    };
};

export const createDomainSuccess = (payload: $TSFixMe) => {
    return {
        type: types.CREATE_DOMAIN_SUCCESS,
        payload,
    };
};

export const createDomainFailure = (payload: $TSFixMe) => {
    return {
        type: types.CREATE_DOMAIN_FAILURE,
        payload,
    };
};

export function createDomain({
    projectId,
    statusPageId,
    domain,
    cert,
    privateKey,
    autoProvisioning,
    enableHttps,
}: $TSFixMe) {
    return async function (dispatch: Dispatch) {
        dispatch(createDomainRequest());

        try {
            const response = await BackendAPI.put(
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

export const deleteDomainRequest = () => {
    return {
        type: types.DELETE_DOMAIN_REQUEST,
    };
};

export const deleteDomainSuccess = (payload: $TSFixMe) => {
    return {
        type: types.DELETE_DOMAIN_SUCCESS,
        payload,
    };
};

export const deleteDomainFailure = (payload: $TSFixMe) => {
    return {
        type: types.DELETE_DOMAIN_FAILURE,
        payload,
    };
};

export const deleteDomain = ({
    projectId,
    statusPageId,
    domainId,
}: $TSFixMe) => {
    return async function (dispatch: Dispatch) {
        dispatch(deleteDomainRequest());
        try {
            const response =
                await delete `status-page/${projectId}/${statusPageId}/${domainId}`;

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
};

export const updateDomainRequest = () => {
    return {
        type: types.UPDATE_DOMAIN_REQUEST,
    };
};

export const updateDomainSuccess = (payload: $TSFixMe) => {
    return {
        type: types.UPDATE_DOMAIN_SUCCESS,
        payload,
    };
};

export const updateDomainFailure = (payload: $TSFixMe) => {
    return {
        type: types.UPDATE_DOMAIN_FAILURE,
        payload,
    };
};

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
    return async function (dispatch: Dispatch) {
        dispatch(updateDomainRequest());
        try {
            const response = await BackendAPI.put(
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
