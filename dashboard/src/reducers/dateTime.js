import moment from 'moment';

const initialState = {
    dates: {
        startDate: moment().subtract(1, 'd'),
        endDate: moment()
    }
}

export default function dateTime(state = initialState, action) {
    switch (action.type) {

        case 'SET_START_DATE':
            return Object.assign({}, state, {
                dates: {
                    ...state.dates,
                    startDate: action.payload
                }
            });

        case 'SET_END_DATE':
            return Object.assign({}, state, {
                dates: {
                    ...state.dates,
                    endDate: action.payload
                }
            });

        default: return state;
    }
}