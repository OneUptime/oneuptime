import * as types from '../constants/credential';
import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ErrorPayload from 'CommonUI/src/payload-types/error';
// Add Git Credential
export const addGitCredentialRequest: Function = (): void => {
    return {
        type: types.ADD_GIT_CREDENTIAL_REQUEST,
    };
};

export const addGitCredentialSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.ADD_GIT_CREDENTIAL_SUCCESS,
        payload,
    };
};

export const addGitCredentialFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.ADD_GIT_CREDENTIAL_FAILURE,
        payload: error,
    };
};

export const addGitCredential: $TSFixMe = ({ projectId, data }: $TSFixMe) => {
    return async (dispatch: Dispatch) => {
        dispatch(addGitCredentialRequest());

        try {
            const response: $TSFixMe = await BackendAPI.post(
                `credential/${projectId}/gitCredential`,
                data
            );

            dispatch(addGitCredentialSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(addGitCredentialFailure(errorMsg));
        }
    };
};

// Edit and update Git Credential
export const updateGitCredentialRequest: Function = (): void => {
    return {
        type: types.UPDATE_GIT_CREDENTIAL_REQUEST,
    };
};

export const updateGitCredentialSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.UPDATE_GIT_CREDENTIAL_SUCCESS,
        payload,
    };
};

export const updateGitCredentialFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.UPDATE_GIT_CREDENTIAL_FAILURE,
        payload: error,
    };
};

export const updateGitCredential: $TSFixMe = ({
    projectId,
    credentialId,
    data,
}: $TSFixMe) => {
    return async (dispatch: Dispatch) => {
        dispatch(updateGitCredentialRequest());

        try {
            const response: $TSFixMe = await BackendAPI.put(
                `credential/${projectId}/gitCredential/${credentialId}`,
                data
            );

            dispatch(updateGitCredentialSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(updateGitCredentialFailure(errorMsg));
        }
    };
};

// Get Git Credential
export const getGitCredentialsRequest: Function = (): void => {
    return {
        type: types.GET_GIT_CREDENTIALS_REQUEST,
    };
};

export const getGitCredentialsSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.GET_GIT_CREDENTIALS_SUCCESS,
        payload,
    };
};

export const getGitCredentialsFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.GET_GIT_CREDENTIALS_FAILURE,
        payload: error,
    };
};

export const getGitCredentials: $TSFixMe = ({ projectId }: $TSFixMe) => {
    return async (dispatch: Dispatch) => {
        dispatch(getGitCredentialsRequest());

        try {
            const response: $TSFixMe = await BackendAPI.get(
                `credential/${projectId}/gitCredential`
            );

            dispatch(getGitCredentialsSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(getGitCredentialsFailure(errorMsg));
        }
    };
};

// Delete Git Credential
export const deleteGitCredentialRequest: Function = (): void => {
    return {
        type: types.DELETE_GIT_CREDENTIAL_REQUEST,
    };
};

export const deleteGitCredentialSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.DELETE_GIT_CREDENTIAL_SUCCESS,
        payload,
    };
};

export const deleteGitCredentialFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.DELETE_GIT_CREDENTIAL_FAILURE,
        payload: error,
    };
};

export const deleteGitCredential: $TSFixMe = ({
    projectId,
    credentialId,
}: $TSFixMe) => {
    return async (dispatch: Dispatch) => {
        dispatch(deleteGitCredentialRequest());

        try {
            const response: $TSFixMe =
                await delete `credential/${projectId}/gitCredential/${credentialId}`;

            dispatch(deleteGitCredentialSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';

            dispatch(deleteGitCredentialFailure(errorMsg));
        }
    };
};

// Get securities based on git credential
export const getGitSecuritiesRequest: Function = (): void => {
    return {
        type: types.GET_GIT_SECURITIES_REQUEST,
    };
};

export const getGitSecuritiesSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.GET_GIT_SECURITIES_SUCCESS,
        payload,
    };
};

export const getGitSecuritiesFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.GET_GIT_SECURITIES_FAILURE,
        payload: error,
    };
};

export const getGitSecurities: $TSFixMe = ({
    projectId,
    credentialId,
}: $TSFixMe) => {
    return async (dispatch: Dispatch) => {
        dispatch(getGitSecuritiesRequest());

        try {
            const response: $TSFixMe = await BackendAPI.get(
                `security/${projectId}/application/${credentialId}`
            );

            dispatch(getGitSecuritiesSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';

            dispatch(getGitSecuritiesFailure(errorMsg));
        }
    };
};

// Add Docker Credential
export const addDockerCredentialRequest: Function = (): void => {
    return {
        type: types.ADD_DOCKER_CREDENTIAL_REQUEST,
    };
};

export const addDockerCredentialSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.ADD_DOCKER_CREDENTIAL_SUCCESS,
        payload,
    };
};

export const addDockerCredentialFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.ADD_DOCKER_CREDENTIAL_FAILURE,
        payload: error,
    };
};

export const addDockerCredential: $TSFixMe = ({
    projectId,
    data,
}: $TSFixMe) => {
    return async (dispatch: Dispatch) => {
        dispatch(addDockerCredentialRequest());

        try {
            const response: $TSFixMe = await BackendAPI.post(
                `credential/${projectId}/dockerCredential`,
                data
            );

            dispatch(addDockerCredentialSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(addDockerCredentialFailure(errorMsg));
        }
    };
};

// Edit and update Docker Credential
export const updateDockerCredentialRequest: Function = (): void => {
    return {
        type: types.UPDATE_DOCKER_CREDENTIAL_REQUEST,
    };
};

export const updateDockerCredentialSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.UPDATE_DOCKER_CREDENTIAL_SUCCESS,
        payload,
    };
};

export const updateDockerCredentialFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.UPDATE_DOCKER_CREDENTIAL_FAILURE,
        payload: error,
    };
};

export const updateDockerCredential: $TSFixMe = ({
    projectId,
    credentialId,
    data,
}: $TSFixMe) => {
    return async (dispatch: Dispatch) => {
        dispatch(updateDockerCredentialRequest());

        try {
            const response: $TSFixMe = await BackendAPI.put(
                `credential/${projectId}/dockerCredential/${credentialId}`,
                data
            );

            dispatch(updateDockerCredentialSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(updateDockerCredentialFailure(errorMsg));
        }
    };
};

// Get Docker Credential
export const getDockerCredentialsRequest: Function = (): void => {
    return {
        type: types.GET_DOCKER_CREDENTIALS_REQUEST,
    };
};

export const getDockerCredentialsSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.GET_DOCKER_CREDENTIALS_SUCCESS,
        payload,
    };
};

export const getDockerCredentialsFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.GET_DOCKER_CREDENTIALS_FAILURE,
        payload: error,
    };
};

export const getDockerCredentials: $TSFixMe = ({ projectId }: $TSFixMe) => {
    return async (dispatch: Dispatch) => {
        dispatch(getDockerCredentialsRequest());

        try {
            const response: $TSFixMe = await BackendAPI.get(
                `credential/${projectId}/dockerCredential`
            );

            dispatch(getDockerCredentialsSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(getDockerCredentialsFailure(errorMsg));
        }
    };
};

// Delete Docker Credential
export const deleteDockerCredentialRequest: Function = (): void => {
    return {
        type: types.DELETE_DOCKER_CREDENTIAL_REQUEST,
    };
};

export const deleteDockerCredentialSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.DELETE_DOCKER_CREDENTIAL_SUCCESS,
        payload,
    };
};

export const deleteDockerCredentialFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.DELETE_DOCKER_CREDENTIAL_FAILURE,
        payload: error,
    };
};

export const deleteDockerCredential: $TSFixMe = ({
    projectId,
    credentialId,
}: $TSFixMe) => {
    return async (dispatch: Dispatch) => {
        dispatch(deleteDockerCredentialRequest());

        try {
            const response: $TSFixMe =
                await delete `credential/${projectId}/dockerCredential/${credentialId}`;

            dispatch(deleteDockerCredentialSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';

            dispatch(deleteDockerCredentialFailure(errorMsg));
        }
    };
};

// Get securities based on docker credential
export const getDockerSecuritiesRequest: Function = (): void => {
    return {
        type: types.GET_DOCKER_SECURITIES_REQUEST,
    };
};

export const getDockerSecuritiesSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.GET_DOCKER_SECURITIES_SUCCESS,
        payload,
    };
};

export const getDockerSecuritiesFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.GET_DOCKER_SECURITIES_FAILURE,
        payload: error,
    };
};

export const getDockerSecurities: $TSFixMe = ({
    projectId,
    credentialId,
}: $TSFixMe) => {
    return async (dispatch: Dispatch) => {
        dispatch(getDockerSecuritiesRequest());

        try {
            const response: $TSFixMe = await BackendAPI.get(
                `security/${projectId}/container/${credentialId}`
            );

            dispatch(getDockerSecuritiesSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';

            dispatch(getDockerSecuritiesFailure(errorMsg));
        }
    };
};
