import { putApi } from '../api';
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

export function verifyDomain({ projectId, domainId, statusPageId, payload }) {
    return async function(dispatch) {
        dispatch(verifyDomainRequest());

        try {
            const response = await putApi(
                `domain/${projectId}/${statusPageId}/verify/${domainId}`,
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
