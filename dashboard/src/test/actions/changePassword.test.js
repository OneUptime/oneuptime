import * as _actions from '../../actions/changePassword'
import * as _types from '../../constants/changePassword'
import axiosMock from '../axios_mock'
import {
    API_URL
  } from '../../config'

/*
  Test for change password actions actions.
*/

const actions = {..._actions,..._types}

describe('actions', async () => {
    it('should create an action of type CHANGEPASSWORD_REQUEST, and Return promise in payload', () => {

        let promise = Promise.resolve('CHANGEPASSWORD_REQUEST response')
        let action = actions.changePasswordRequest(promise)

        expect(action.type).toEqual(actions.CHANGEPASSWORD_REQUEST)
        return action.payload.then(o => {
            expect(o).toEqual('CHANGEPASSWORD_REQUEST response')
        })
    })
})

describe('actions', () => {
    it('should create an action of type CHANGEPASSWORD_FAILED with error in payload', () => {
        const expectedAction = {
            type: actions.CHANGEPASSWORD_FAILED,
            payload: 'change pass error'
        }
        let action = actions.changePasswordError('change pass error')
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual(expectedAction.payload)
    })
})

describe('actions', () => {
    it('should create an action of type CHANGEPASSWORD_SUCCESS, and response values in payload', () => {
        let action = actions.changePasswordSuccess('values')
        expect(action.type).toEqual(actions.CHANGEPASSWORD_SUCCESS)
        expect(action.payload).toEqual('values')
    })
})

describe('actions', () => {
    it('should create an action of type RESET_CHANGEPASSWORD', () => {
      const expectedAction = {
        type: actions.RESET_CHANGEPASSWORD,
      }
      expect(actions.resetChangePassword().type).toEqual(expectedAction.type)
    })
  })

  describe('actions', () => {
    it('should despatch CHANGEPASSWORD_REQUEST and CHANGEPASSWORD_SUCCESS  actions', () => {
  
      axiosMock.onPost(`${API_URL}/user/reset-password`).reply(200, {email:'test',link:'some link',someprops:'value'}, {});
  
      let dispatch = (dispatched) => {
        switch (dispatched.type) {
          case actions.CHANGEPASSWORD_REQUEST:
            expect(dispatched.type).toEqual(actions.CHANGEPASSWORD_REQUEST)
            
            break;
          case actions.CHANGEPASSWORD_SUCCESS:
            expect(dispatched.type).toEqual(actions.CHANGEPASSWORD_SUCCESS)
            expect(dispatched.payload).toEqual( {email:'test',link:'some link',someprops:'value'})
           
            break;
          default:
            expect(dispatched.type).toEqual(actions.CHANGEPASSWORD_FAILED)
            expect(dispatched.payload).toEqual('fail test')
        }
      }
      let action = actions.changePassword('projectId', 5, 10)(dispatch)
    })
  })