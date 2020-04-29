import * as types from "../constants/sso"
import errors from '../errors';
import { getApi, deleteApi, postApi, putApi } from "../api";

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

export const fetchSsos = (skip, limit) => async dispatch => {
  skip = skip ? parseInt(skip) : 0;
  limit = limit ? parseInt(limit) : 10;
  dispatch(fetchSsosRequest());
  try {
    const response = await getApi(`sso/?skip=${skip}&limit=${limit}`);
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

export const fetchSsoRequest = () => {
  return {
    type: types.FETCH_SSO_REQUEST,
  }
}

export const fetchSsoSuccess = (payload) => {
  return {
    type: types.FETCH_SSO_SUCCESS,
    payload,
  }
}

export const fetchSsoError = payload => {
  return {
    type: types.FETCH_SSO_FAILURE,
    payload,
  };
};

export const fetchSso = (ssoId) => async dispatch => {
  dispatch(fetchSsoRequest());
  try {
    const response = await getApi(`sso/${ssoId}`);
    dispatch(fetchSsoSuccess(response.data))
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
    dispatch(fetchSsoError(errors(errorMsg)));
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
    await postApi(`sso/`, data)
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

export const updateSsoRequest = () => {
  return {
    type: types.UPDATE_SSO_REQUEST,
  };
}

export const updateSsoSuccess = () => {
  return {
    type: types.UPDATE_SSO_SUCCESS,
  };
}

export const updateSsoError = payload => {
  return {
    type: types.UPDATE_SSO_FAILURE,
    payload,
  };
}

export const updateSso = (data) => async dispatch => {
  dispatch(updateSsoRequest());
  try {
    await putApi(`sso/update`, data)
    dispatch(updateSsoSuccess())
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
    dispatch(updateSsoError(errorMsg));
  }
}
