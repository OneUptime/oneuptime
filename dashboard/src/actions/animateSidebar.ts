import * as types from '../constants/animateSidebar';

export const animateSidebar = function(obj: $TSFixMe) {
    return {
        type: types.ANIMATE_SIDEBAR,
        payload: obj,
    };
};
