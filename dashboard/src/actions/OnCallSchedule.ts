// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module '../constants/OnCallSchedule' o... Remove this comment to see the full error message
import * as types from '../constants/OnCallSchedule';

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
