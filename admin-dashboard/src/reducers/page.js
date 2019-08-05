import {
    PAGE_LOAD_REQUEST,
    PAGE_LOAD_SUCCESS,
} from '../constants/page';

const initialState = {
    requesting: false
};

export default (state = initialState, action) => {
    switch (action.type) {

        case PAGE_LOAD_REQUEST:
            return Object.assign({}, state, {
                requesting: true
            });

        case PAGE_LOAD_SUCCESS:
            return Object.assign({}, state, {
                requesting: false
            });
        default: return state;
    }
}