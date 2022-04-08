import {
    OPEN_ONCALLSCHEDULE_MODAL,
    CLOSE_ONCALLSCHEDULE_MODAL,
} from '../constants/OnCallSchedule';

import Action from 'common-ui/src/types/action';

const initialState = {
    onCallScheduleModalVisble: false,
};

export default (state = initialState, action: Action) => {
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
