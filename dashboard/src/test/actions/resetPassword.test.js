import axiosMock from '../axios_mock'
import {
    API_URL
} from '../../config'
import * as _actions from '../../actions/resetPassword'
import * as _types from '../../constants/resetPassword'

const actions = {..._actions,..._types}

describe('actions', () => {
    it('should create an action of type PASSWORDRESET_REQUEST', () => {
        let promies = Promise.resolve(true)
        const expectedAction = {
            type: actions.PASSWORDRESET_REQUEST,
        }
        let action = actions.resetPasswordRequest(promies)
        expect(action.type).toEqual(expectedAction.type)
        return action.payload.then((o) => {
            expect(o).toEqual(true)
        })
    })
})


describe('actions', () => {
    it('should create an action of type PASSWORDRESET_FAILED', () => {
        let error = 'error that will occur'
        const expectedAction = {
            type: actions.PASSWORDRESET_FAILED,
        }
        const action = actions.resetPasswordError(error)
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual(error)
    })
})

describe('actions', () => {
    it('should create an action of type PASSWORDRESET_SUCCESS', () => {
        let notifications = []
        const expectedAction = {
            notifications: [],
            type: actions.PASSWORDRESET_SUCCESS,
        }
        const action = actions.resetPasswordSuccess(notifications)
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual(notifications)
    })
})

describe('actions', () => {
    it('should create an action of type RESET_PASSWORDRESET', () => {
        const expectedAction = {
            type: actions.RESET_PASSWORDRESET,
        }
        expect(actions.resetResetPassword().type).toEqual(expectedAction.type)
    })
})

describe('actions', () => {
    it('should despatch PASSWORDRESET_FAILED with 404', () => {

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.PASSWORDRESET_REQUEST:
                    expect(dispatched.type).toEqual(actions.PASSWORDRESET_REQUEST)
                    break;
                case actions.PASSWORDRESET_SUCCESS:
                    expect(dispatched.type).toEqual(actions.PASSWORDRESET_SUCCESS)
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.PASSWORDRESET_FAILED)
                    expect(dispatched.payload).toEqual(Error('Request failed with status code 404'))
            }
        }
        let action = actions.resetPassword({})(dispatch)
    })
})
  describe('actions', () => {
    it('should despatch PASSWORDRESET_REQUEST and PASSWORDRESET_SUCCESS  actions', () => {

      axiosMock.onPost(`${API_URL}/user/forgot-password`).reply(200, {data:'success'}, {});

      let dispatch = (dispatched) => {
        switch (dispatched.type) {
          case actions.PASSWORDRESET_SUCCESS:
            expect(dispatched.type).toEqual(actions.PASSWORDRESET_SUCCESS)
            expect(dispatched.payload.data).toEqual( {data:'success'})
            break;
          case actions.PASSWORDRESET_REQUEST:
            expect(dispatched.type).toEqual(actions.PASSWORDRESET_REQUEST)

            break;
          default:
            expect(dispatched.type).toEqual(actions.PASSWORDRESET_FAILED)
            expect(dispatched.payload).toEqual('fail test')
        }
      }
      let action = actions.resetPassword({})(dispatch)
    })
  })