import * as types from '../constants/credential';
import { postApi, getApi } from '../api';

// Add Git Credential
export const addGitCredentialRequest = () => ({
    type: types.ADD_GIT_CREDENTIAL_REQUEST,
});

export const addGitCredentialSuccess = payload => ({
    type: types.ADD_GIT_CREDENTIAL_SUCCESS,
    payload,
});

export const addGitCredentialFailure = error => ({
    type: types.ADD_GIT_CREDENTIAL_FAILURE,
    payload: error,
});

export const addGitCredential = ({ projectId, data }) => async dispatch => {
    dispatch(addGitCredentialRequest());

    try {
        const response = await postApi(
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

// Get Git Credential
export const getGitCredentialsRequest = () => ({
    type: types.GET_GIT_CREDENTIALS_REQUEST,
});

export const getGitCredentialsSuccess = payload => ({
    type: types.GET_GIT_CREDENTIALS_SUCCESS,
    payload,
});

export const getGitCredentialsFailure = error => ({
    type: types.GET_GIT_CREDENTIALS_FAILURE,
    payload: error,
});

export const getGitCredentials = ({ projectId }) => async dispatch => {
    dispatch(getGitCredentialsRequest());

    try {
        const response = await getApi(`credential/${projectId}/gitCredential`);
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

// Add Docker Credential
export const addDockerCredentialRequest = () => ({
    type: types.ADD_DOCKER_CREDENTIAL_REQUEST,
});

export const addDockerCredentialSuccess = payload => ({
    type: types.ADD_DOCKER_CREDENTIAL_SUCCESS,
    payload,
});

export const addDockerCredentialFailure = error => ({
    type: types.ADD_DOCKER_CREDENTIAL_FAILURE,
    payload: error,
});

export const addDockerCredential = ({ projectId, data }) => async dispatch => {
    dispatch(addDockerCredentialRequest());

    try {
        const response = await postApi(
            `credential/${projectId}/DockerCredential`,
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

// Get Docker Credential
export const getDockerCredentialsRequest = () => ({
    type: types.GET_DOCKER_CREDENTIALS_REQUEST,
});

export const getDockerCredentialsSuccess = payload => ({
    type: types.GET_DOCKER_CREDENTIALS_SUCCESS,
    payload,
});

export const getDockerCredentialsFailure = error => ({
    type: types.GET_DOCKER_CREDENTIALS_FAILURE,
    payload: error,
});

export const getDockerCredentials = ({ projectId }) => async dispatch => {
    dispatch(getDockerCredentialsRequest());

    try {
        const response = await getApi(
            `credential/${projectId}/DockerCredential`
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
