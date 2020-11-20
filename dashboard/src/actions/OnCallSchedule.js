import * as types from '../constants/onCallSchedule';

export const openOnCallScheduleModal = function() {
    return {
        type: types.OPEN_ONCALLSCHEDULE_MODAL,
    };
};
export const closeOnCallScheduleModal = function() {
    return {
        type: types.CLOSE_ONCALLSCHEDULE_MODAL,
    };
};