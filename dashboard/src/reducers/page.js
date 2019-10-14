import {
    PAGE_LOAD_REQUEST,
    PAGE_LOAD_SUCCESS,
    PAGE_LOAD_RESET
} from '../constants/page';

const initialState = {
    requesting: false,
    title: ''
};

export default (state = initialState, action) => {
    switch (action.type) {

        case PAGE_LOAD_REQUEST:
            return Object.assign({}, state, {
                requesting: true,
                title: action.payload
            });

        case PAGE_LOAD_SUCCESS:
            return Object.assign({}, state, {
                requesting: false,
                title: action.payload
            });
        case PAGE_LOAD_RESET:
            return Object.assign({}, state, {
                requesting: false,
                title: ''
            });
        default: return state;
    }
}