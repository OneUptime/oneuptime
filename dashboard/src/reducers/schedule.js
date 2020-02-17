import {
    SCHEDULE_FETCH_SUCCESS,
    SCHEDULE_FETCH_FAILED,
    SCHEDULE_FETCH_REQUEST,
    SCHEDULE_FETCH_RESET
} from '../constants/schedule';

import {
    SUBPROJECT_SCHEDULE_FETCH_SUCCESS,
    SUBPROJECT_SCHEDULE_FETCH_FAILED,
    SUBPROJECT_SCHEDULE_FETCH_REQUEST,
    SUBPROJECT_SCHEDULE_FETCH_RESET
} from '../constants/schedule';

import {
    PROJECT_SCHEDULE_FETCH_SUCCESS,
    PROJECT_SCHEDULE_FETCH_FAILED,
    PROJECT_SCHEDULE_FETCH_REQUEST,
    PROJECT_SCHEDULE_FETCH_RESET
} from '../constants/schedule';


import {
    CREATE_SCHEDULE_SUCCESS,
    CREATE_SCHEDULE_FAILED,
    CREATE_SCHEDULE_REQUEST,
    CREATE_SCHEDULE_RESET
} from '../constants/schedule';


import {
    RENAME_SCHEDULE_REQUEST,
    RENAME_SCHEDULE_SUCCESS,
    RENAME_SCHEDULE_FAILED,
    RENAME_SCHEDULE_RESET
} from '../constants/schedule';


import {
    DELETE_SCHEDULE_REQUEST,
    DELETE_SCHEDULE_SUCCESS,
    DELETE_SCHEDULE_FAILED,
    DELETE_SCHEDULE_RESET,
    DELETE_PROJECT_SCHEDULES
} from '../constants/schedule';


import {
    ADD_MONITOR_REQUEST,
    ADD_MONITOR_SUCCESS,
    ADD_MONITOR_FAILED,
    ADD_MONITOR_RESET
} from '../constants/schedule';


import {
    ADD_USER_REQUEST,
    ADD_USER_SUCCESS,
    ADD_USER_FAILED,
    ADD_USER_RESET
} from '../constants/schedule';

import {
    ESCALATION_REQUEST,
    ESCALATION_SUCCESS,
    ESCALATION_FAILED,
    ESCALATION_RESET
} from '../constants/schedule';

import {
    PAGINATE_NEXT,
	PAGINATE_PREV,
	PAGINATE_RESET
} from '../constants/schedule';


const initialState = {
    schedules: {
        requesting: false,
        error: null,
        success: false,
        data: [],
        count: null,
        limit: null,
        skip: null
    },
    subProjectSchedules: [],
    newSchedule: {
        success: false,
        requesting: false,
        error: null
    },
    renameSchedule: {
        success: false,
        requesting: false,
        error: null
    },
    deleteSchedule: {
        success: false,
        requesting: false,
        error: null
    },
    addMonitor: {
        success: false,
        requesting: false,
        error: null
    },
    addUser: {
        success: false,
        requesting: false,
        error: null
    },
    escalation: {
        success: false,
        requesting: false,
        error: null
    },
    escalations:[],
    pages: {
		counter: 1
	}
};


export default function schedule(state = initialState, action) {
    let data, index, isExistingSchedule;
    switch (action.type) {

        case SCHEDULE_FETCH_SUCCESS:
            return Object.assign({}, state, {
                schedules: {
                    requesting: false,
                    error: null,
                    success: true,
                    data: action.payload.data,
                    count: action.payload.count,
                    limit: action.payload.limit,
                    skip: action.payload.skip
                },
            });

        case SCHEDULE_FETCH_REQUEST:
            return Object.assign({}, state, {
                schedules: {
                    ...state.schedules,
                    requesting: true,
                    success: false,
                    error: null,
                }
            });

        case SCHEDULE_FETCH_FAILED:
            return Object.assign({}, state, {
                schedules: {
                    ...state.schedules,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case SCHEDULE_FETCH_RESET:
            return Object.assign({}, state, {
                schedules: {
                    requesting: false,
                    error: null,
                    success: false,
                    data: [],
                    count: null,
                    limit: null,
                    skip: null
                },
            });

        // fetch subproject schedules
        case SUBPROJECT_SCHEDULE_FETCH_SUCCESS:
            return Object.assign({}, state, {
                schedules: {
                    requesting: false,
                    error: null,
                    success: true,
                },
                subProjectSchedules: action.payload
            });

        case SUBPROJECT_SCHEDULE_FETCH_REQUEST:
            return Object.assign({}, state, {
                schedules: {
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case SUBPROJECT_SCHEDULE_FETCH_FAILED:
            return Object.assign({}, state, {
                schedules: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
        });

        case SUBPROJECT_SCHEDULE_FETCH_RESET:
            return Object.assign({}, state, {
                subProjectSchedules: []
            });

        // fetch list of schedules in a project
        case PROJECT_SCHEDULE_FETCH_SUCCESS:
            return Object.assign({}, state, {
                schedules: {
                    requesting: false,
                    error: null,
                    success: true,
                },
                subProjectSchedules: state.subProjectSchedules.map((schedule)=>{
                    return schedule._id === action.payload.projectId ?
                    {
                        _id: action.payload.projectId,
                        schedules: [...action.payload.data],
                        count: action.payload.count,
                        skip: action.payload.skip,
                        limit: action.payload.limit
                    }
                    : schedule
                })
            });

        case PROJECT_SCHEDULE_FETCH_REQUEST:
            return Object.assign({}, state, {
                schedules: {
                    requesting: true,
                    error: null,
                    success: false,
                }
            });

        case PROJECT_SCHEDULE_FETCH_FAILED:
            return Object.assign({}, state, {
                schedules: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                }
        });

        case PROJECT_SCHEDULE_FETCH_RESET:
            return Object.assign({}, state, {
                subProjectSchedules: []
            });

        case CREATE_SCHEDULE_SUCCESS:
            isExistingSchedule = state.subProjectSchedules.find(schedule => schedule._id === action.payload.projectId);
            return Object.assign({}, state, {
                newSchedule: {
                    success: false,
                    requesting: false,
                    error: null
                },
                subProjectSchedules: isExistingSchedule ? state.subProjectSchedules.length > 0 ? state.subProjectSchedules.map((schedule)=>{
                    return schedule._id === action.payload.projectId ?
                    {
                        _id: action.payload.projectId,
                        schedules: [action.payload, ...schedule.schedules.filter((status, index) => index < 9)],
                        count: schedule.count + 1,
                        skip: schedule.skip,
                        limit: schedule.limit
                    }
                    : schedule
                }) : [{_id: action.payload.projectId, schedules: [action.payload], count: 1, skip: 0, limit: 0 }]
                : state.subProjectSchedules.concat([{_id: action.payload.projectId, schedules: [action.payload], count: 1, skip: 0, limit: 0 }])
            });

        case CREATE_SCHEDULE_REQUEST:
            return Object.assign({}, state, {
                newSchedule: {
                    requesting: true,
                    success: false,
                    error: null
                }
            });

        case CREATE_SCHEDULE_FAILED:
            return Object.assign({}, state, {
                newSchedule: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case CREATE_SCHEDULE_RESET:
            return Object.assign({}, state, {
                newSchedule: {
                    requesting: false,
                    success: false,
                    error: null
                },
            });

        case RENAME_SCHEDULE_SUCCESS:
            return Object.assign({}, state, {
                renameSchedule: {
                    requesting: false,
                    success: true,
                    error: null
                },
                subProjectSchedules: state.subProjectSchedules.map((schedule)=>{
                    return schedule._id === action.payload[0].projectId._id ?
                    {
                        _id: action.payload[0].projectId._id,
                        schedules: schedule.schedules.map(schedule => schedule._id === action.payload[0]._id ? action.payload[0] : schedule),
                        count: schedule.count,
                        skip: schedule.skip,
                        limit: schedule.limit
                    }
                    : schedule
                })
            });

        case RENAME_SCHEDULE_REQUEST:
            return Object.assign({}, state, {
                renameSchedule: {
                    requesting: true,
                    success: false,
                    error: null
                }
            });

        case RENAME_SCHEDULE_FAILED:
            return Object.assign({}, state, {
                renameSchedule: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                }
            });

        case RENAME_SCHEDULE_RESET:
            return Object.assign({}, state, {
                renameSchedule: {
                    requesting: false,
                    success: false,
                    error: null,
                }
            });

        case DELETE_SCHEDULE_SUCCESS:
            data = Object.assign([], state.schedules.data);
            index = data.findIndex(schedule => schedule._id === action.payload.scheduleId);
            action.payload.n === 1 && action.payload.ok === 1 && data.splice(index, 1);

            return Object.assign({}, state, {
                deleteSchedule: {
                    requesting: false,
                    success: true,
                    error: null
                },
                schedules: {
                    requesting: false,
                    error: null,
                    success: true,
                    data
                },
            });

        case DELETE_PROJECT_SCHEDULES:
            data = Object.assign([], state.schedules.data);
            data = data.filter(schedule => action.payload !== schedule.projectId);

            return Object.assign({}, state, {
                schedules: {
                    requesting: false,
                    error: null,
                    success: true,
                    data
                }
            });

        case DELETE_SCHEDULE_REQUEST:
            return Object.assign({}, state, {
                deleteSchedule: {
                    requesting: true,
                    success: false,
                    error: null
                }
            });

        case DELETE_SCHEDULE_FAILED:
            return Object.assign({}, state, {
                deleteSchedule: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                }
            });

        case DELETE_SCHEDULE_RESET:
            return Object.assign({}, state, {
                deleteSchedule: {
                    requesting: false,
                    success: false,
                    error: null,
                }
            });

        case ADD_MONITOR_SUCCESS:
            data = Object.assign([], state.schedules.data);
            data = data.map((schedule) => {
                return schedule._id === action.payload[0]._id ? action.payload[0] : schedule
            });

            return Object.assign({}, state, {
                addMonitor: {
                    requesting: false,
                    success: true,
                    error: null
                },
                schedules: {
                    requesting: false,
                    error: null,
                    success: false,
                    data
                },
                subProjectSchedules: state.subProjectSchedules.map((schedule)=>{
                    return schedule._id === action.payload[0].projectId._id ?
                    {
                        _id: action.payload[0].projectId._id,
                        schedules: schedule.schedules.map(schedule => schedule._id === action.payload[0]._id ? action.payload[0] : schedule),
                        count: schedule.count,
                        skip: schedule.skip,
                        limit: schedule.limit
                    }
                    : schedule
                })
            });

        case ADD_MONITOR_REQUEST:
            return Object.assign({}, state, {
                addMonitor: {
                    requesting: true,
                    success: false,
                    error: null
                }
            });

        case ADD_MONITOR_FAILED:
            return Object.assign({}, state, {
                addMonitor: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                }
            });

        case ADD_MONITOR_RESET:
            return Object.assign({}, state, {
                addMonitor: {
                    requesting: false,
                    success: false,
                    error: null,
                }
            });

        case ADD_USER_SUCCESS:
            data = Object.assign([], state.schedules.data);
            index = data.findIndex(schedule => schedule._id === action.payload._id);
            data[index] = action.payload;

            return Object.assign({}, state, {
                addUser: {
                    requesting: false,
                    success: true,
                    error: null
                },
                schedules: {
                    requesting: false,
                    error: null,
                    success: false,
                    data
                },
            });

        case ADD_USER_REQUEST:
            return Object.assign({}, state, {
                addUser: {
                    requesting: true,
                    success: false,
                    error: null
                }
            });

        case ADD_USER_FAILED:
            return Object.assign({}, state, {
                addUser: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                }
            });

        case ADD_USER_RESET:
            return Object.assign({}, state, {
                addUser: {
                    requesting: false,
                    success: false,
                    error: null,
                }
            });

        case ESCALATION_SUCCESS:
            return Object.assign({}, state, {
                escalation: {
                    requesting: false,
                    success: true,
                    error: null
                },
                escalations:action.payload.data,
            });

        case ESCALATION_REQUEST:
            return Object.assign({}, state, {
                escalation: {
                    requesting: true,
                    success: false,
                    error: null
                }
            });

        case ESCALATION_FAILED:
            return Object.assign({}, state, {
                escalation: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                }
            });

        case ESCALATION_RESET:
            return Object.assign({}, state, {
                escalation: {
                    requesting: false,
                    success: false,
                    error: null,
                }
            });

        case PAGINATE_NEXT:
			return {
				...state,
				pages: {
					counter: state.pages.counter + 1
				}
			}

		case PAGINATE_PREV:
			return {
				...state,
				pages: {
					counter: state.pages.counter - 1
				}
			}

		case PAGINATE_RESET:
			return {
				...state,
				pages: {
					counter: 1
				}
			}

        default: return state;
    }
}
