import * as types from '../constants/page'

export const pageLoadRequest = function() {
  return {
    type: types.PAGE_LOAD_REQUEST
  };
}
export const pageLoadSuccess = function() {
  return {
    type: types.PAGE_LOAD_SUCCESS
  };
}