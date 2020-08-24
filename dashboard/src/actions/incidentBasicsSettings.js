import { getApi, putApi } from '../api';
import * as types from '../constants/incidentBasicSettings';
import errors from '../errors';

const fetchBasicIncidentSettingsRequest = () => ({
    type: types.FETCH_INCIDENT_BASIC_SETTINGS_REQUEST,
});

const fetchBasicIncidentSettingsSuccess = payload => ({
    type: types.FETCH_INCIDENT_BASIC_SETTINGS_SUCCESS,
    payload,
});

const fetchBasicIncidentSettingsFailure = payload => ({
    type: types.FETCH_INCIDENT_BASIC_SETTINGS_FAILURE,
    payload,
});

export const fetchBasicIncidentSettings = projectId => {
    return function(dispatch) {
        const promise = getApi(`incidentSettings/${projectId}`);
        dispatch(fetchBasicIncidentSettingsRequest());
        promise.then(
            function(incidentBasicSettings) {
                dispatch(
                    fetchBasicIncidentSettingsSuccess(
                        incidentBasicSettings.data
                    )
                );
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(fetchBasicIncidentSettingsFailure(errors(error)));
            }
        );
    };
};

const updateBasicIncidentSettingsRequest = () => ({
    type: types.UPDATE_INCIDENT_BASIC_SETTINGS_REQUEST,
});

const updateBasicIncidentSettingsSuccess = payload => ({
    type: types.UPDATE_INCIDENT_BASIC_SETTINGS_SUCCESS,
    payload,
});

const updateBasicIncidentSettingsFailure = payload => ({
    type: types.UPDATE_INCIDENT_BASIC_SETTINGS_FAILURE,
    payload,
});

export const updateBasicIncidentSettings = (projectId, title, description) => {
    return function(dispatch) {
        const promise = putApi(`incidentSettings/${projectId}`, {
            title,
            description,
        });
        dispatch(updateBasicIncidentSettingsRequest());
        promise.then(
            function(incidentBasicSettings) {
                dispatch(
                    updateBasicIncidentSettingsSuccess(
                        incidentBasicSettings.data
                    )
                );
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(updateBasicIncidentSettingsFailure(errors(error)));
            }
        );
    };
};
