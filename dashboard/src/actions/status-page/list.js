import * as types from '../constants/statusPage';

export function paginateNext() {
    return {
        type: types.PAGINATE_NEXT,
    };
}

export function paginatePrev() {
    return {
        type: types.PAGINATE_PREV,
    };
}

export function paginateReset() {
    return {
        type: types.PAGINATE_RESET,
    };
}

export function paginate(type) {
    return function(dispatch) {
        type === 'next' && dispatch(paginateNext());
        type === 'prev' && dispatch(paginatePrev());
        type === 'reset' && dispatch(paginateReset());
    };
}