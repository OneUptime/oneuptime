import * as types from "../constants/sso"
import errors from '../errors';
import { getApi, deleteApi } from "../api";

export const fetchSsosRequest = () => {
  return {
    type: types.FETCH_SSOS_REQUEST,
  }
}

export const fetchSsosSuccess = (payload) => {
  return {
    type: types.FETCH_SSOS_SUCCESS,
    payload,
  }
}

export const fetchSsosError = payload => {
  return {
    type: types.FETCH_SSOS_FAILURE,
    payload,
  };
};

export const fetchSsos = () => async dispatch => {
  dispatch(fetchSsosRequest);
  try {
    const response = await getApi(`sso/ssos`);
    dispatch(fetchSsosSuccess(response.data))
  } catch (error) {
    let errorMsg;
    if (error && error.response && error.response.data)
      errorMsg = error.response.data;
    if (error && error.data) {
      errorMsg = error.data;
    }
    if (error && error.message) {
      errorMsg = error.message;
    } else {
      errorMsg = 'Network Error';
    }
    dispatch(fetchSsosError(errors(errorMsg)));
  }
}

export const deleteSsoRequest = () => async dispatch => {
  return {
    type: types.DELETE_SSO_REQUEST,
  };
}

export const deleteSsoSuccess = payload => async dispatch => {
  return {
    type: types.DELETE_SSO_SUCCESS,
    payload
  };
}

export const deleteSsoError = payload => async dispatch => {
  return {
    type: types.DELETE_SSO_FAILED,
    payload,
  };
}

export const deleteSso = ssoId => async dispatch => {
  dispatch(deleteSsoRequest());
  try {
    const response = await deleteApi(`sso/${ssoId}`)
    const { data } = response
    dispatch(deleteSsoSuccess(data))
  } catch (error) {
    let errorMsg;
    if (error && error.response && error.response.data)
      errorMsg = error.response.data;
    if (error && error.data) {
      errorMsg = error.data;
    }
    if (error && error.message) {
      errorMsg = error.message;
    } else {
      errorMsg = 'Network Error';
    }
    dispatch(deleteSsoError(errorMsg));
  }
}
