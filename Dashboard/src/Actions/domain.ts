import BackendAPI from 'CommonUI/src/utils/api/backend';
import * as types from '../constants/domain';
import { Dispatch } from 'redux';
import ErrorPayload from 'CommonUI/src/payload-types/error';
export const resetDomain: Function = (): void => {
    return {
        type: types.RESET_VERIFY_DOMAIN,
    };
};

export const verifyDomainRequest: Function = (): void => {
    return {
        type: types.VERIFY_DOMAIN_REQUEST,
    };
};

export const verifyDomainSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.VERIFY_DOMAIN_SUCCESS,
        payload,
    };
};

export const verifyDomainFailure: Function = (error: ErrorPayload): void => {
    return {
        type: types.VERIFY_DOMAIN_FAILURE,
        payload: error,
    };
};

export const verifyDomain: Function = ({
    projectId,
    domainId,
    payload,
}: $TSFixMe): void => {
    return async function (dispatch: Dispatch): void {
        dispatch(verifyDomainRequest());

        try {
            const response: $TSFixMe = await BackendAPI.put(
                `domainVerificationToken/${projectId}/verify/${domainId}`,
                payload
            );

            dispatch(verifyDomainSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
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

export const createDomainRequest: Function = (): void => {
    return {
        type: types.CREATE_DOMAIN_REQUEST,
    };
};

export const createDomainSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.CREATE_DOMAIN_SUCCESS,
        payload,
    };
};

export const createDomainFailure: Function = (payload: $TSFixMe): void => {
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
            const response: $TSFixMe = await BackendAPI.put(
                `StatusPage/${projectId}/${statusPageId}/domain`,
                { domain, cert, privateKey, enableHttps, autoProvisioning }
            );

            dispatch(createDomainSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
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

export const deleteDomainRequest: Function = (): void => {
    return {
        type: types.DELETE_DOMAIN_REQUEST,
    };
};

export const deleteDomainSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.DELETE_DOMAIN_SUCCESS,
        payload,
    };
};

export const deleteDomainFailure: Function = (payload: $TSFixMe): void => {
    return {
        type: types.DELETE_DOMAIN_FAILURE,
        payload,
    };
};

export const deleteDomain: Function = ({
    projectId,
    statusPageId,
    domainId,
}: $TSFixMe) => {
    return async function (dispatch: Dispatch): void {
        dispatch(deleteDomainRequest());
        try {
            const response: $TSFixMe =
                await delete `StatusPage/${projectId}/${statusPageId}/${domainId}`;

            dispatch(deleteDomainSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
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

export const updateDomainRequest: Function = (): void => {
    return {
        type: types.UPDATE_DOMAIN_REQUEST,
    };
};

export const updateDomainSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.UPDATE_DOMAIN_SUCCESS,
        payload,
    };
};

export const updateDomainFailure: Function = (payload: $TSFixMe): void => {
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
            const response: $TSFixMe = await BackendAPI.put(
                `StatusPage/${projectId}/${statusPageId}/${domainId}`,
                { domain, cert, privateKey, enableHttps, autoProvisioning }
            );

            dispatch(updateDomainSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
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
