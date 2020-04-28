import * as types from "../constants/sso"
import errors from '../errors';
import { getApi, deleteApi, postApi } from "../api";

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

export const deleteSsoRequest = () => {
  return {
    type: types.DELETE_SSO_REQUEST,
  };
}

export const deleteSsoSuccess = () => {
  return {
    type: types.DELETE_SSO_SUCCESS,
  };
}

export const deleteSsoError = payload => {
  return {
    type: types.DELETE_SSO_FAILED,
    payload,
  };
}

export const deleteSso = ssoId => async dispatch => {
  dispatch(deleteSsoRequest());
  try {
    await deleteApi(`sso/${ssoId}`)
    dispatch(deleteSsoSuccess())
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

export const addSsoRequest = () => {
  return {
    type: types.ADD_SSO_REQUEST,
  };
}

export const addSsoSuccess = () => {
  return {
    type: types.ADD_SSO_SUCCESS,
  };
}

export const addSsoError = payload => {
  return {
    type: types.ADD_SSO_FAILED,
    payload,
  };
}

export const addSso = (data) => async dispatch => {
  dispatch(addSsoRequest());
  try {
    await postApi(`sso/create`, data)
    dispatch(addSsoSuccess())
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
    dispatch(addSsoError(errorMsg));
  }
}
