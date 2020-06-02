import * as types from '../constants/credential';
import { postApi, getApi, deleteApi } from '../api';

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

// Delete Git Credential
export const deleteGitCredentialRequest = () => ({
    type: types.DELETE_GIT_CREDENTIAL_REQUEST,
});

export const deleteGitCredentialSuccess = payload => ({
    type: types.DELETE_GIT_CREDENTIAL_SUCCESS,
    payload,
});

export const deleteGitCredentialFailure = error => ({
    type: types.DELETE_GIT_CREDENTIAL_FAILURE,
    payload: error,
});

export const deleteGitCredential = ({
    projectId,
    credentialId,
}) => async dispatch => {
    dispatch(deleteGitCredentialRequest());

    try {
        const response = await deleteApi(
            `credential/${projectId}/gitCredential/${credentialId}`
        );

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

export const getGitSecuritiesSuccess = payload => ({
    type: types.GET_GIT_SECURITIES_SUCCESS,
    payload,
});

export const getGitSecuritiesFailure = error => ({
    type: types.GET_GIT_SECURITIES_FAILURE,
    payload: error,
});

export const getGitSecurities = ({
    projectId,
    credentialId,
}) => async dispatch => {
    dispatch(getGitSecuritiesRequest());

    try {
        const response = await getApi(
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

export const deleteDockerCredentialSuccess = payload => ({
    type: types.DELETE_DOCKER_CREDENTIAL_SUCCESS,
    payload,
});

export const deleteDockerCredentialFailure = error => ({
    type: types.DELETE_DOCKER_CREDENTIAL_FAILURE,
    payload: error,
});

export const deleteDockerCredential = ({
    projectId,
    credentialId,
}) => async dispatch => {
    dispatch(deleteDockerCredentialRequest());

    try {
        const response = await deleteApi(
            `credential/${projectId}/dockerCredential/${credentialId}`
        );

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

export const getDockerSecuritiesSuccess = payload => ({
    type: types.GET_DOCKER_SECURITIES_SUCCESS,
    payload,
});

export const getDockerSecuritiesFailure = error => ({
    type: types.GET_DOCKER_SECURITIES_FAILURE,
    payload: error,
});

export const getDockerSecurities = ({
    projectId,
    credentialId,
}) => async dispatch => {
    dispatch(getDockerSecuritiesRequest());

    try {
        const response = await getApi(
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