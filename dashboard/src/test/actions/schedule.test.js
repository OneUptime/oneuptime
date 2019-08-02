import axiosMock from '../axios_mock'
import {
    API_URL
} from '../../config'
import * as _actions from '../../actions/schedule'
import * as _types from '../../constants/schedule'

const actions = {..._actions,..._types}

describe('actions', () => {
    it('should create an action of type SCHEDULE_FETCH_RESET', () => {
        const expectedAction = {
            type: actions.SCHEDULE_FETCH_RESET,
        }
        expect(actions.resetSchedule().type).toEqual(expectedAction.type)
    })
})
describe('actions', () => {
    it('should create an action of type SCHEDULE_FETCH_REQUEST', () => {
        let promise = Promise.resolve(true)
        const expectedAction = {
            type: actions.SCHEDULE_FETCH_REQUEST,
        }
        let action = actions.scheduleRequest(promise)
        expect(action.type).toEqual(expectedAction.type)
        return action.payload.then((o) => {
            expect(o).toEqual(true)
        })
    })
})


describe('actions', () => {
    it('should create an action of type SCHEDULE_FETCH_FAILED', () => {
        let error = 'error that will occur'
        const expectedAction = {
            type: actions.SCHEDULE_FETCH_FAILED,
        }
        const action = actions.scheduleError(error)
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual(error)
    })
})

describe('actions', () => {
    it('should create an action of type SCHEDULE_FETCH_SUCCESS', () => {
        const expectedAction = {
            type: actions.SCHEDULE_FETCH_SUCCESS,
        }
        const action = actions.scheduleSuccess({})
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual({})
    })
})



describe('actions', () => {
    it('should despatch SCHEDULE_FETCH_FAILED with 404', () => {

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.SCHEDULE_FETCH_REQUEST:
                    expect(dispatched.type).toEqual(actions.SCHEDULE_FETCH_REQUEST)
                    break;
                case actions.SCHEDULE_FETCH_SUCCESS:
                    expect(dispatched.type).toEqual(actions.SCHEDULE_FETCH_SUCCESS)
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.SCHEDULE_FETCH_FAILED)
                    expect(dispatched.payload).toEqual(Error('Request failed with status code 404'))
            }
        }
        let action = actions.fetchSchedules({})(dispatch)
    })
})
describe('actions', () => {
    it('should despatch SCHEDULE_FETCH_REQUEST and SCHEDULE_FETCH_SUCCESS  actions', () => {

        axiosMock.onGet(`${API_URL}/schedule/projectId/projectSchedules`).reply(200, {
            data: 'success'
        }, {});

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.SCHEDULE_FETCH_SUCCESS:
                    expect(dispatched.type).toEqual(actions.SCHEDULE_FETCH_SUCCESS)
                    expect(dispatched.payload.data).toEqual('success')
                    break;
                case actions.SCHEDULE_FETCH_REQUEST:
                    expect(dispatched.type).toEqual(actions.SCHEDULE_FETCH_REQUEST)

                    break;
                default:
                    expect(dispatched.type).toEqual(actions.SCHEDULE_FETCH_FAILED)
                    expect(dispatched.payload).toEqual('fail test')
            }
        }
        let action = actions.fetchSchedules('projectId')(dispatch)
    })
})


// Create a new schedule

describe('actions', () => {
    it('should create an action of type CREATE_SCHEDULE_REQUEST', () => {
        const expectedAction = {
            type: actions.CREATE_SCHEDULE_REQUEST,
        }
        let action = actions.createScheduleRequest()
        expect(action.type).toEqual(expectedAction.type)
    })
})


describe('actions', () => {
    it('should create an action of type CREATE_SCHEDULE_FAILED', () => {
        let error = 'error that will occur'
        const expectedAction = {
            type: actions.CREATE_SCHEDULE_FAILED,
        }
        const action = actions.createScheduleError(error)
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual(error)
    })
})

describe('actions', () => {
    it('should create an action of type CREATE_SCHEDULE_SUCCESS', () => {
        const expectedAction = {
            type: actions.CREATE_SCHEDULE_SUCCESS,
        }
        const action = actions.createScheduleSuccess({})
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual({})
    })
})



describe('actions', () => {
    it('should despatch CREATE_SCHEDULE_FAILED with 404', () => {

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.CREATE_SCHEDULE_REQUEST:
                    expect(dispatched.type).toEqual(actions.CREATE_SCHEDULE_REQUEST)
                    break;
                case actions.CREATE_SCHEDULE_SUCCESS:
                    expect(dispatched.type).toEqual(actions.CREATE_SCHEDULE_SUCCESS)
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.CREATE_SCHEDULE_FAILED)
                    expect(dispatched.payload).toEqual(Error('Request failed with status code 404'))
            }
        }
        let action = actions.createSchedule({})(dispatch)
    })
})
describe('actions', () => {
    it('should despatch CREATE_SCHEDULE_REQUEST and CREATE_SCHEDULE_SUCCESS  actions', () => {

        axiosMock.onPost(`${API_URL}/schedule/projectId/create`).reply(200, {
            data: 'success'
        }, {});

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.CREATE_SCHEDULE_SUCCESS:
                    expect(dispatched.type).toEqual(actions.CREATE_SCHEDULE_SUCCESS)
                    expect(dispatched.payload.data).toEqual('success')
                    break;
                case actions.CREATE_SCHEDULE_REQUEST:
                    expect(dispatched.type).toEqual(actions.CREATE_SCHEDULE_REQUEST)

                    break;
                default:
                    expect(dispatched.type).toEqual(actions.CREATE_SCHEDULE_FAILED)
                    expect(dispatched.payload).toEqual('fail test')
            }
        }
        let action = actions.createSchedule('projectId', {})(dispatch)
    })
})

//Rename a Schedule
describe('actions', () => {
    it('should create an action of type RENAME_SCHEDULE_RESET', () => {
        const expectedAction = {
            type: actions.RENAME_SCHEDULE_RESET,
        }
        let action = actions.renameScheduleReset()
        expect(action.type).toEqual(expectedAction.type)
    })
})

describe('actions', () => {
    it('should create an action of type RENAME_SCHEDULE_REQUEST', () => {
        const expectedAction = {
            type: actions.RENAME_SCHEDULE_REQUEST,
        }
        let action = actions.renameScheduleRequest()
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual(true)
    })
})


describe('actions', () => {
    it('should create an action of type RENAME_SCHEDULE_FAILED', () => {
        let error = 'error that will occur'
        const expectedAction = {
            type: actions.RENAME_SCHEDULE_FAILED,
        }
        const action = actions.renameScheduleError(error)
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual(error)
    })
})

describe('actions', () => {
    it('should create an action of type RENAME_SCHEDULE_SUCCESS', () => {
        const expectedAction = {
            type: actions.RENAME_SCHEDULE_SUCCESS,
        }
        const action = actions.renameScheduleSuccess({
            data: 'data'
        })
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual('data')
    })
})



describe('actions', () => {
    it('should despatch RENAME_SCHEDULE_FAILED with 404', () => {

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.RENAME_SCHEDULE_REQUEST:
                    expect(dispatched.type).toEqual(actions.RENAME_SCHEDULE_REQUEST)
                    break;
                case actions.RENAME_SCHEDULE_SUCCESS:
                    expect(dispatched.type).toEqual(actions.RENAME_SCHEDULE_SUCCESS)
                    break;
                case actions.RENAME_SCHEDULE_RESET:
                    expect(dispatched.type).toEqual(actions.RENAME_SCHEDULE_RESET)
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.RENAME_SCHEDULE_FAILED)
                    expect(dispatched.payload).toEqual(Error('Request failed with status code 404'))
            }
        }
        let action = actions.renameSchedule({})(dispatch)
    })
})
describe('actions', () => {
    it('should despatch RENAME_SCHEDULE_REQUEST and RENAME_SCHEDULE_SUCCESS  actions', () => {

        axiosMock.onPost(`${API_URL}/schedule/projectId/scheduleId/renameSchedule`).reply(200, {
            data: 'success'
        }, {});

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.RENAME_SCHEDULE_SUCCESS:
                    expect(dispatched.type).toEqual(actions.RENAME_SCHEDULE_SUCCESS)
                    expect(dispatched.payload.data).toEqual('success')
                    break;
                case actions.RENAME_SCHEDULE_RESET:
                    expect(dispatched.type).toEqual(actions.RENAME_SCHEDULE_RESET)
                    break;
                case actions.RENAME_SCHEDULE_REQUEST:
                    expect(dispatched.type).toEqual(actions.RENAME_SCHEDULE_REQUEST)
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.RENAME_SCHEDULE_FAILED)
                    expect(dispatched.payload).toEqual('fail test')
            }
        }
        let action = actions.renameSchedule('projectId', 'scheduleId', 'scheduleName')(dispatch)
    })
})

// Delete a Schedule

describe('actions', () => {
    it('should create an action of type DELETE_SCHEDULE_RESET', () => {
        const expectedAction = {
            type: actions.DELETE_SCHEDULE_RESET,
        }
        let action = actions.deleteScheduleReset()
        expect(action.type).toEqual(expectedAction.type)
    })
})

describe('actions', () => {
    it('should create an action of type DELETE_SCHEDULE_REQUEST', () => {
        const expectedAction = {
            type: actions.DELETE_SCHEDULE_REQUEST,
        }
        let action = actions.deleteScheduleRequest()
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual(true)
    })
})


describe('actions', () => {
    it('should create an action of type DELETE_SCHEDULE_FAILED', () => {
        let error = 'error that will occur'
        const expectedAction = {
            type: actions.DELETE_SCHEDULE_FAILED,
        }
        const action = actions.deleteScheduleError(error)
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual(error)
    })
})

describe('actions', () => {
    it('should create an action of type DELETE_SCHEDULE_SUCCESS', () => {
        const expectedAction = {
            type: actions.DELETE_SCHEDULE_SUCCESS,
        }
        const action = actions.deleteScheduleSuccess({
            data: 'data'
        })
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual('data')
    })
})

describe('actions', () => {
    it('should create an action of type DELETE_PROJECT_SCHEDULES', () => {
        const expectedAction = {
            type: actions.DELETE_PROJECT_SCHEDULES,
        }
        const action = actions.deleteProjectSchedules('projectId')
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual('projectId')
    })
})



describe('actions', () => {
    it('should despatch DELETE_SCHEDULE_FAILED with 404', () => {

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.DELETE_SCHEDULE_REQUEST:
                    expect(dispatched.type).toEqual(actions.DELETE_SCHEDULE_REQUEST)
                    break;
                case actions.DELETE_SCHEDULE_SUCCESS:
                    expect(dispatched.type).toEqual(actions.DELETE_SCHEDULE_SUCCESS)
                    break;
                case actions.DELETE_SCHEDULE_RESET:
                    expect(dispatched.type).toEqual(actions.DELETE_SCHEDULE_RESET)
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.DELETE_SCHEDULE_FAILED)
                    expect(dispatched.payload).toEqual(Error('Request failed with status code 404'))
            }
        }
        let action = actions.deleteSchedule('projectId','scheduleId')(dispatch)
    })
})
describe('actions', () => {
    it('should despatch DELETE_SCHEDULE_REQUEST and DELETE_SCHEDULE_SUCCESS  actions', () => {

        axiosMock.onDelete(`${API_URL}/schedule/projectId/scheduleId/deleteSchedule`).reply(200, {
            data: 'success'
        }, {});

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.DELETE_SCHEDULE_SUCCESS:
                    expect(dispatched.type).toEqual(actions.DELETE_SCHEDULE_SUCCESS)
                    expect(dispatched.payload.data).toEqual('success')
                    break;
                case actions.DELETE_SCHEDULE_RESET:
                    expect(dispatched.type).toEqual(actions.DELETE_SCHEDULE_RESET)
                    break;
                case actions.DELETE_SCHEDULE_REQUEST:
                    expect(dispatched.type).toEqual(actions.DELETE_SCHEDULE_REQUEST)
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.DELETE_SCHEDULE_FAILED)
                    expect(dispatched.payload).toEqual('fail test')
            }
        }
        let action = actions.deleteSchedule('projectId', 'scheduleId')(dispatch)
    })
})

// Add Monitors to Schedule


describe('actions', () => {
    it('should create an action of type ADD_MONITOR_RESET', () => {
        const expectedAction = {
            type: actions.ADD_MONITOR_RESET,
        }
        let action = actions.addMonitorReset()
        expect(action.type).toEqual(expectedAction.type)
    })
})

describe('actions', () => {
    it('should create an action of type ADD_MONITOR_REQUEST', () => {
        const expectedAction = {
            type: actions.ADD_MONITOR_REQUEST,
        }
        let action = actions.addMonitorRequest()
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual(true)
    })
})


describe('actions', () => {
    it('should create an action of type ADD_MONITOR_FAILED', () => {
        let error = 'error that will occur'
        const expectedAction = {
            type: actions.ADD_MONITOR_FAILED,
        }
        const action = actions.addMonitorError(error)
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual(error)
    })
})

describe('actions', () => {
    it('should create an action of type ADD_MONITOR_SUCCESS', () => {
        const expectedAction = {
            type: actions.ADD_MONITOR_SUCCESS,
        }
        const action = actions.addMonitorSuccess({
            data: 'data'
        })
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual('data')
    })
})

describe('actions', () => {
    it('should despatch ADD_MONITOR_FAILED with 404', () => {

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.ADD_MONITOR_REQUEST:
                    expect(dispatched.type).toEqual(actions.ADD_MONITOR_REQUEST)
                    break;
                case actions.ADD_MONITOR_SUCCESS:
                    expect(dispatched.type).toEqual(actions.ADD_MONITOR_SUCCESS)
                    break;
                case actions.ADD_MONITOR_RESET:
                    expect(dispatched.type).toEqual(actions.ADD_MONITOR_RESET)
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.ADD_MONITOR_FAILED)
                    expect(dispatched.payload).toEqual(Error('Request failed with status code 404'))
            }
        }
        let action = actions.addMonitors('projectId','scheduleId',{})(dispatch)
    })
})

describe('actions', () => {
    it('should despatch ADD_MONITOR_REQUEST and ADD_MONITOR_SUCCESS  actions', () => {

        axiosMock.onPost(`${API_URL}/schedule/projectId/scheduleId/addMonitors`).reply(200, {
            data: 'success'
        }, {});

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.ADD_MONITOR_REQUEST:
                    expect(dispatched.type).toEqual(actions.ADD_MONITOR_REQUEST)
                    break;
                case actions.ADD_MONITOR_SUCCESS:
                    expect(dispatched.type).toEqual(actions.ADD_MONITOR_SUCCESS)
                    break;
                case actions.ADD_MONITOR_RESET:
                    expect(dispatched.type).toEqual(actions.ADD_MONITOR_RESET)
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.DELETE_SCHEDULE_FAILED)
                    expect(dispatched.payload).toEqual('fail test')
            }
        }
        let action = actions.addMonitors('projectId','scheduleId',{})(dispatch)
    })
})

// Add Users to Schedule


describe('actions', () => {
    it('should create an action of type ADD_USER_RESET', () => {
        const expectedAction = {
            type: actions.ADD_USER_RESET,
        }
        let action = actions.addUserReset()
        expect(action.type).toEqual(expectedAction.type)
    })
})

describe('actions', () => {
    it('should create an action of type ADD_USER_REQUEST', () => {
        const expectedAction = {
            type: actions.ADD_USER_REQUEST,
        }
        let action = actions.addUserRequest()
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual(true)
    })
})


describe('actions', () => {
    it('should create an action of type ADD_USER_FAILED', () => {
        let error = 'error that will occur'
        const expectedAction = {
            type: actions.ADD_USER_FAILED,
        }
        const action = actions.addUserError(error)
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual(error)
    })
})

describe('actions', () => {
    it('should create an action of type ADD_USER_SUCCESS', () => {
        const expectedAction = {
            type: actions.ADD_USER_SUCCESS,
        }
        const action = actions.addUserSuccess({
            data: 'data'
        })
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual('data')
    })
})

describe('actions', () => {
    it('should despatch ADD_MONITOR_FAILED with 404', () => {

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.ADD_USER_REQUEST:
                    expect(dispatched.type).toEqual(actions.ADD_USER_REQUEST)
                    break;
                case actions.ADD_USER_SUCCESS:
                    expect(dispatched.type).toEqual(actions.ADD_USER_SUCCESS)
                    break;
                case actions.ADD_USER_RESET:
                    expect(dispatched.type).toEqual(actions.ADD_USER_RESET)
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.ADD_USER_FAILED)
                    expect(dispatched.payload).toEqual(Error('Request failed with status code 404'))
            }
        }
        let action = actions.addUsers('projectId','scheduleId',{})(dispatch)
    })
})

describe('actions', () => {
    it('should despatch ADD_USER_REQUEST and ADD_USER_SUCCESS  actions', () => {

        axiosMock.onPost(`${API_URL}/schedule/projectId/scheduleId/addUsers`).reply(200, {
            data: 'success'
        }, {});

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.ADD_USER_REQUEST:
                    expect(dispatched.type).toEqual(actions.ADD_USER_REQUEST)
                    break;
                case actions.ADD_USER_SUCCESS:
                    expect(dispatched.type).toEqual(actions.ADD_USER_SUCCESS)
                    break;
                case actions.ADD_USER_RESET:
                    expect(dispatched.type).toEqual(actions.ADD_USER_RESET)
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.ADD_USER_FAILED)
                    expect(dispatched.payload).toEqual('fail test')
            }
        }
        let action = actions.addUsers('projectId','scheduleId',{})(dispatch)
    })
})

// pagination for Team Members table

describe('actions', () => {
    it('should create an action of type PAGINATE_NEXT', () => {
        const expectedAction = {
            type: actions.PAGINATE_NEXT,
        }
        let action = actions.paginateNext()
        expect(action.type).toEqual(expectedAction.type)
    })
})
describe('actions', () => {
    it('should create an action of type PAGINATE_PREV', () => {
        const expectedAction = {
            type: actions.PAGINATE_PREV,
        }
        let action = actions.paginatePrev()
        expect(action.type).toEqual(expectedAction.type)
    })
})
describe('actions', () => {
    it('should create an action of type PAGINATE_RESET', () => {
        const expectedAction = {
            type: actions.PAGINATE_RESET,
        }
        let action = actions.paginateReset()
        expect(action.type).toEqual(expectedAction.type)
    })
})
describe('actions', () => {
    it('should dispatch action of type PAGINATE_NEXT', () => {
        let dispatch = (dispatched) => {
            expect(dispatched.type).toEqual(actions.PAGINATE_NEXT)
        }
        let action = actions.paginate('next')(dispatch)
    })
})
describe('actions', () => {
    it('should dispatch action of type PAGINATE_PREV', () => {
        let dispatch = (dispatched) => {
            expect(dispatched.type).toEqual(actions.PAGINATE_PREV)
        }
        let action = actions.paginate('prev')(dispatch)
    })
})
describe('actions', () => {
    it('should dispatch action of type PAGINATE_RESET', () => {
        let dispatch = (dispatched) => {
            expect(dispatched.type).toEqual(actions.PAGINATE_RESET)
        }
        let action = actions.paginate('reset')(dispatch)
    })
})