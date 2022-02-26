import {
    OPEN_ONCALLSCHEDULE_MODAL,
    CLOSE_ONCALLSCHEDULE_MODAL,
// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module '../constants/OnCallSchedule' o... Remove this comment to see the full error message
} from '../constants/OnCallSchedule';

const initialState = {
    onCallScheduleModalVisble: false,
};

export default (state = initialState, action: $TSFixMe) => {
    switch (action.type) {
        case OPEN_ONCALLSCHEDULE_MODAL:
            return Object.assign({}, state, {
                onCallScheduleModalVisble: true,
            });

        case CLOSE_ONCALLSCHEDULE_MODAL:
            return Object.assign({}, state, {
                onCallScheduleModalVisble: false,
            });

        default:
            return state;
    }
};
