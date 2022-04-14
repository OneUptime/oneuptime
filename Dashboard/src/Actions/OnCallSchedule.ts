import * as types from '../constants/OnCallSchedule';

export const openOnCallScheduleModal: $TSFixMe = function (): void {
    return {
        type: types.OPEN_ONCALLSCHEDULE_MODAL,
    };
};
export const closeOnCallScheduleModal: $TSFixMe = function (): void {
    return {
        type: types.CLOSE_ONCALLSCHEDULE_MODAL,
    };
};
