import { RESET_SEARCH_FIELDS } from '../constants/search';
export const resetSearch = () => async dispatch =>
    dispatch({
        type: RESET_SEARCH_FIELDS,
    });
