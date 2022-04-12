import BackendAPI from 'CommonUI/src/utils/api/backend';
import * as types from '../constants/domain';
import { Dispatch } from 'redux';
import ErrorPayload from 'CommonUI/src/payload-types/error';
export const resetDomain = (): void => {
    return {
        type: types.RESET_VERIFY_DOMAIN,
    };
};

export const verifyDomainRequest = (): void => {
    return {
        type: types.VERIFY_DOMAIN_REQUEST,
    };
};

export const verifyDomainSuccess = (payload: $TSFixMe): void => {
    return {
        type: types.VERIFY_DOMAIN_SUCCESS,
        payload,
    };
};

export const verifyDomainFailure = (error: ErrorPayload): void => {
    return {
        type: types.VERIFY_DOMAIN_FAILURE,
        payload: error,
    };
};

export const verifyDomain = ({
    projectId,
    domainId,
    payload,
}: $TSFixMe): void => {
    return async function (dispatch: Dispatch): void {
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

export const createDomainRequest = (): void => {
    return {
        type: types.CREATE_DOMAIN_REQUEST,
    };
};

export const createDomainSuccess = (payload: $TSFixMe): void => {
    return {
        type: types.CREATE_DOMAIN_SUCCESS,
        payload,
    };
};

export const createDomainFailure = (payload: $TSFixMe): void => {
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
    return async function (dispatch: Dispatch): void {
        dispatch(createDomainRequest());

        try {
            const response = await BackendAPI.put(
                `StatusPage/${projectId}/${statusPageId}/domain`,
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

export const deleteDomainRequest = (): void => {
    return {
        type: types.DELETE_DOMAIN_REQUEST,
    };
};

export const deleteDomainSuccess = (payload: $TSFixMe): void => {
    return {
        type: types.DELETE_DOMAIN_SUCCESS,
        payload,
    };
};

export const deleteDomainFailure = (payload: $TSFixMe): void => {
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
    return async function (dispatch: Dispatch): void {
        dispatch(deleteDomainRequest());
        try {
            const response =
                await delete `StatusPage/${projectId}/${statusPageId}/${domainId}`;

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

export const updateDomainRequest = (): void => {
    return {
        type: types.UPDATE_DOMAIN_REQUEST,
    };
};

export const updateDomainSuccess = (payload: $TSFixMe): void => {
    return {
        type: types.UPDATE_DOMAIN_SUCCESS,
        payload,
    };
};

export const updateDomainFailure = (payload: $TSFixMe): void => {
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
    return async function (dispatch: Dispatch): void {
        dispatch(updateDomainRequest());
        try {
            const response = await BackendAPI.put(
                `StatusPage/${projectId}/${statusPageId}/${domainId}`,
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
