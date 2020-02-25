import axios from 'axios';
import { API_URL, User } from '../config';
const Q = require('q');

export const STATUSPAGE_REQUEST = 'STATUSPAGE_REQUEST';
export const STATUSPAGE_SUCCESS = 'STATUSPAGE_SUCCESS';
export const STATUSPAGE_FAILURE = 'STATUSPAGE_FAILURE';

export function statusPageSuccess(data) {
  return {
    type: STATUSPAGE_SUCCESS,
    payload: data
  };
}

export function statusPageRequest() {
  return {
    type: STATUSPAGE_REQUEST,
  };
}

export function statusPageFailure(error) {
  return {
    type: STATUSPAGE_FAILURE,
    payload: error
  };
}

// Calls the API to get status
export function getStatusPage(statusPageId, url) {
  return function (dispatch) {
    const promise = getApi(`/statusPage/${statusPageId}?url=${url}`);
    dispatch(statusPageRequest());

    promise.then(function (Data) {
      dispatch(statusPageSuccess(Data.data));
    }, function (error) {
      if (error && error.response && error.response.data)
        error = error.response.data;
      if (error && error.data) {
        error = error.data;
      }
      if (error && error.message) {
        error = error.message;
      }
      else {
        error = 'Network Error';
      }

      dispatch(statusPageFailure(error));
    });
  };
}

export const STATUSPAGE_NOTES_REQUEST = 'STATUSPAGE_NOTES_REQUEST';
export const STATUSPAGE_NOTES_SUCCESS = 'STATUSPAGE_NOTES_SUCCESS';
export const STATUSPAGE_NOTES_FAILURE = 'STATUSPAGE_NOTES_FAILURE';
export const STATUSPAGE_NOTES_RESET = 'STATUSPAGE_NOTES_RESET';
export const INDIVIDUAL_NOTES_ENABLE = 'INDIVIDUAL_NOTES_ENABLE';
export const INDIVIDUAL_NOTES_DISABLE = 'INDIVIDUAL_NOTES_DISABLE';

export function statusPageNoteSuccess(data) {
  return {
    type: STATUSPAGE_NOTES_SUCCESS,
    payload: data
  };
}

export function statusPageNoteRequest() {
  return {
    type: STATUSPAGE_NOTES_REQUEST,
  };
}

export function statusPageNoteFailure(error) {
  return {
    type: STATUSPAGE_NOTES_FAILURE,
    payload: error
  };
}

export function statusPageNoteReset() {
  return {
    type: STATUSPAGE_NOTES_RESET
  };
}

export function individualNoteEnable(message) {
  return {
    type: INDIVIDUAL_NOTES_ENABLE,
    payload: message
  };
}
export function individualNoteDisable() {
  return {
    type: INDIVIDUAL_NOTES_DISABLE
  };
}

// Calls the API to get status
export function getStatusPageNote(projectId, statusPageId, skip) {
  return function (dispatch) {
    const promise = getApi(`/statusPage/${projectId}/${statusPageId}/notes?skip=${skip}`);
    dispatch(statusPageNoteRequest());

    promise.then(function (Data) {
      dispatch(statusPageNoteSuccess(Data.data));
      dispatch(individualNoteDisable());
    }, function (error) {
      if (error && error.response && error.response.data)
        error = error.response.data;
      if (error && error.data) {
        error = error.data;
      }
      if (error && error.message) {
        error = error.message;
      }
      else {
        error = 'Network Error';
      }

      dispatch(statusPageNoteFailure(error));
    });
  };
}

export function getStatusPageIndividualNote(projectId, monitorId, date, name, need) {
  return function (dispatch) {
    const promise = getApi(`/statusPage/${projectId}/${monitorId}/individualnotes?date=${date}&need=${need}`);
    dispatch(statusPageNoteRequest());

    promise.then(function (Data) {
      dispatch(statusPageNoteSuccess(Data.data));
      dispatch(individualNoteEnable({ message: Data.data.message, name: { name, date: date.split('T')[0] } }));
    }, function (error) {
      if (error && error.response && error.response.data)
        error = error.response.data;
      if (error && error.data) {
        error = error.data;
      }
      if (error && error.message) {
        error = error.message;
      }
      else {
        error = 'Network Error';
      }

      dispatch(statusPageNoteFailure(error));
    });
  };
}

export function notmonitoredDays(monitorId, date, name) {
  return function (dispatch) {
    dispatch(statusPageNoteReset());
    dispatch(individualNoteEnable({ message: 'No data available for this date', name: { _id: monitorId, name, date } }));
  };
}

export const MORE_NOTES_REQUEST = 'MORE_NOTES_REQUEST';
export const MORE_NOTES_SUCCESS = 'MORE_NOTES_SUCCESS';
export const MORE_NOTES_FAILURE = 'MORE_NOTES_FAILURE';

export function moreNoteSuccess(data) {
  return {
    type: MORE_NOTES_SUCCESS,
    payload: data
  };
}

export function moreNoteRequest() {
  return {
    type: MORE_NOTES_REQUEST,
  };
}

export function moreNoteFailure(error) {
  return {
    type: MORE_NOTES_FAILURE,
    payload: error
  };
}

export function getMoreNote(projectId, statusPageId, skip) {
  return function (dispatch) {
    const promise = getApi(`/statusPage/${projectId}/${statusPageId}/notes?skip=${skip}`);
    dispatch(moreNoteRequest());
    promise.then(function (Data) {
      dispatch(moreNoteSuccess(Data.data));
    }, function (error) {
      if (error && error.response && error.response.data)
        error = error.response.data;
      if (error && error.data) {
        error = error.data;
      }
      if (error && error.message) {
        error = error.message;
      }
      else {
        error = 'Network Error';
      }

      dispatch(moreNoteFailure(error));
    });
  };
}

function getApi(url) {
  const deffered = Q.defer();
  axios({
    method: 'GET',
    url: `${API_URL}${url}`
  })
    .then(function (response) {
      deffered.resolve(response);
    })
    .catch(function (error) {
      if (error && error.response && error.response.status === 401) {
        User.clear();
      }
      if (error && error.response && error.response.data)
        error = error.response.data;
      if (error && error.data) {
        error = error.data;
      }
      deffered.reject(error);
    });
  return deffered.promise;
}
