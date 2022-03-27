import * as types from '../constants/credential';
import BackendAPI from '../api';
import { Dispatch } from 'redux';

// Add Git Credential
export const addGitCredentialRequest = () => ({
    type: types.ADD_GIT_CREDENTIAL_REQUEST,
});

export const addGitCredentialSuccess = (payload: $TSFixMe) => ({
    type: types.ADD_GIT_CREDENTIAL_SUCCESS,
    payload,
});

export const addGitCredentialFailure = (error: $TSFixMe) => ({
    type: types.ADD_GIT_CREDENTIAL_FAILURE,
    payload: error,
});

export const addGitCredential =
    ({ projectId, data }: $TSFixMe) =>
    async (dispatch: Dispatch) => {
        dispatch(addGitCredentialRequest());

        try {
            const response = await BackendAPI.post(
                `credential/${projectId}/gitCredential`,
                data
            );

            dispatch(addGitCredentialSuccess(response.data));
        } catch (error) {
            const errorMsg =
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

// Edit and update Git Credential
export const updateGitCredentialRequest = () => ({
    type: types.UPDATE_GIT_CREDENTIAL_REQUEST,
});

export const updateGitCredentialSuccess = (payload: $TSFixMe) => ({
    type: types.UPDATE_GIT_CREDENTIAL_SUCCESS,
    payload,
});

export const updateGitCredentialFailure = (error: $TSFixMe) => ({
    type: types.UPDATE_GIT_CREDENTIAL_FAILURE,
    payload: error,
});

export const updateGitCredential =
    ({ projectId, credentialId, data }: $TSFixMe) =>
    async (dispatch: Dispatch) => {
        dispatch(updateGitCredentialRequest());

        try {
            const response = await BackendAPI.put(
                `credential/${projectId}/gitCredential/${credentialId}`,
                data
            );

            dispatch(updateGitCredentialSuccess(response.data));
        } catch (error) {
            const errorMsg =
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

// Get Git Credential
export const getGitCredentialsRequest = () => ({
    type: types.GET_GIT_CREDENTIALS_REQUEST,
});

export const getGitCredentialsSuccess = (payload: $TSFixMe) => ({
    type: types.GET_GIT_CREDENTIALS_SUCCESS,
    payload,
});

export const getGitCredentialsFailure = (error: $TSFixMe) => ({
    type: types.GET_GIT_CREDENTIALS_FAILURE,
    payload: error,
});

export const getGitCredentials =
    ({ projectId }: $TSFixMe) =>
    async (dispatch: Dispatch) => {
        dispatch(getGitCredentialsRequest());

        try {
            const response = await BackendAPI.get(
                `credential/${projectId}/gitCredential`
            );

            dispatch(getGitCredentialsSuccess(response.data));
        } catch (error) {
            const errorMsg =
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

// Delete Git Credential
export const deleteGitCredentialRequest = () => ({
    type: types.DELETE_GIT_CREDENTIAL_REQUEST,
});

export const deleteGitCredentialSuccess = (payload: $TSFixMe) => ({
    type: types.DELETE_GIT_CREDENTIAL_SUCCESS,
    payload,
});

export const deleteGitCredentialFailure = (error: $TSFixMe) => ({
    type: types.DELETE_GIT_CREDENTIAL_FAILURE,
    payload: error,
});

export const deleteGitCredential =
    ({ projectId, credentialId }: $TSFixMe) =>
    async (dispatch: Dispatch) => {
        dispatch(deleteGitCredentialRequest());

        try {
            const response =
                await delete `credential/${projectId}/gitCredential/${credentialId}`;

            dispatch(deleteGitCredentialSuccess(response.data));
        } catch (error) {
            const errorMsg =
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

// Get securities based on git credential
export const getGitSecuritiesRequest = () => ({
    type: types.GET_GIT_SECURITIES_REQUEST,
});

export const getGitSecuritiesSuccess = (payload: $TSFixMe) => ({
    type: types.GET_GIT_SECURITIES_SUCCESS,
    payload,
});

export const getGitSecuritiesFailure = (error: $TSFixMe) => ({
    type: types.GET_GIT_SECURITIES_FAILURE,
    payload: error,
});

export const getGitSecurities =
    ({ projectId, credentialId }: $TSFixMe) =>
    async (dispatch: Dispatch) => {
        dispatch(getGitSecuritiesRequest());

        try {
            const response = await BackendAPI.get(
                `security/${projectId}/application/${credentialId}`
            );

            dispatch(getGitSecuritiesSuccess(response.data));
        } catch (error) {
            const errorMsg =
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

// Add Docker Credential
export const addDockerCredentialRequest = () => ({
    type: types.ADD_DOCKER_CREDENTIAL_REQUEST,
});

export const addDockerCredentialSuccess = (payload: $TSFixMe) => ({
    type: types.ADD_DOCKER_CREDENTIAL_SUCCESS,
    payload,
});

export const addDockerCredentialFailure = (error: $TSFixMe) => ({
    type: types.ADD_DOCKER_CREDENTIAL_FAILURE,
    payload: error,
});

export const addDockerCredential =
    ({ projectId, data }: $TSFixMe) =>
    async (dispatch: Dispatch) => {
        dispatch(addDockerCredentialRequest());

        try {
            const response = await BackendAPI.post(
                `credential/${projectId}/dockerCredential`,
                data
            );

            dispatch(addDockerCredentialSuccess(response.data));
        } catch (error) {
            const errorMsg =
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

// Edit and update Docker Credential
export const updateDockerCredentialRequest = () => ({
    type: types.UPDATE_DOCKER_CREDENTIAL_REQUEST,
});

export const updateDockerCredentialSuccess = (payload: $TSFixMe) => ({
    type: types.UPDATE_DOCKER_CREDENTIAL_SUCCESS,
    payload,
});

export const updateDockerCredentialFailure = (error: $TSFixMe) => ({
    type: types.UPDATE_DOCKER_CREDENTIAL_FAILURE,
    payload: error,
});

export const updateDockerCredential =
    ({ projectId, credentialId, data }: $TSFixMe) =>
    async (dispatch: Dispatch) => {
        dispatch(updateDockerCredentialRequest());

        try {
            const response = await BackendAPI.put(
                `credential/${projectId}/dockerCredential/${credentialId}`,
                data
            );

            dispatch(updateDockerCredentialSuccess(response.data));
        } catch (error) {
            const errorMsg =
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

// Get Docker Credential
export const getDockerCredentialsRequest = () => ({
    type: types.GET_DOCKER_CREDENTIALS_REQUEST,
});

export const getDockerCredentialsSuccess = (payload: $TSFixMe) => ({
    type: types.GET_DOCKER_CREDENTIALS_SUCCESS,
    payload,
});

export const getDockerCredentialsFailure = (error: $TSFixMe) => ({
    type: types.GET_DOCKER_CREDENTIALS_FAILURE,
    payload: error,
});

export const getDockerCredentials =
    ({ projectId }: $TSFixMe) =>
    async (dispatch: Dispatch) => {
        dispatch(getDockerCredentialsRequest());

        try {
            const response = await BackendAPI.get(
                `credential/${projectId}/dockerCredential`
            );

            dispatch(getDockerCredentialsSuccess(response.data));
        } catch (error) {
            const errorMsg =
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

// Delete Docker Credential
export const deleteDockerCredentialRequest = () => ({
    type: types.DELETE_DOCKER_CREDENTIAL_REQUEST,
});

export const deleteDockerCredentialSuccess = (payload: $TSFixMe) => ({
    type: types.DELETE_DOCKER_CREDENTIAL_SUCCESS,
    payload,
});

export const deleteDockerCredentialFailure = (error: $TSFixMe) => ({
    type: types.DELETE_DOCKER_CREDENTIAL_FAILURE,
    payload: error,
});

export const deleteDockerCredential =
    ({ projectId, credentialId }: $TSFixMe) =>
    async (dispatch: Dispatch) => {
        dispatch(deleteDockerCredentialRequest());

        try {
            const response =
                await delete `credential/${projectId}/dockerCredential/${credentialId}`;

            dispatch(deleteDockerCredentialSuccess(response.data));
        } catch (error) {
            const errorMsg =
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

// Get securities based on docker credential
export const getDockerSecuritiesRequest = () => ({
    type: types.GET_DOCKER_SECURITIES_REQUEST,
});

export const getDockerSecuritiesSuccess = (payload: $TSFixMe) => ({
    type: types.GET_DOCKER_SECURITIES_SUCCESS,
    payload,
});

export const getDockerSecuritiesFailure = (error: $TSFixMe) => ({
    type: types.GET_DOCKER_SECURITIES_FAILURE,
    payload: error,
});

export const getDockerSecurities =
    ({ projectId, credentialId }: $TSFixMe) =>
    async (dispatch: Dispatch) => {
        dispatch(getDockerSecuritiesRequest());

        try {
            const response = await BackendAPI.get(
                `security/${projectId}/container/${credentialId}`
            );

            dispatch(getDockerSecuritiesSuccess(response.data));
        } catch (error) {
            const errorMsg =
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
