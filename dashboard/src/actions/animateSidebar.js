import * as types from '../constants/animateSidebar';

export const animateSidebar = function(obj) {
    return {
        type: types.ANIMATE_SIDEBAR,
        payload: obj,
    };
};
