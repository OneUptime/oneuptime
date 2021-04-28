import { POPULATE_SEARCH, RESET_SEARCH_FIELDS } from '../constants/search';

const initialState = {
    search: [],
};

export default function search(state = initialState, action) {
    switch (action.type) {
        case POPULATE_SEARCH:
            return Object.assign({}, state, {
                search: state.search
                    .filter(s => s.title !== action.payload.title)
                    .concat(action.payload),
            });
        case RESET_SEARCH_FIELDS:
            return Object.assign({}, state, {
                search: [],
            });
        default:
            return state;
    }
}
