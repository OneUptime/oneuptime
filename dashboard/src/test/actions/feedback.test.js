import * as _actions from '../../actions/feedback'
import * as _types from '../../constants/feedback'
import axiosMock from '../axios_mock'
import {
    API_URL
  } from '../../config'


/*
  Test for feedback actions.
*/
const actions = {..._actions,..._types}

describe('actions', () => {
    it('should create an action of type OPEN_FEEDBACK_MODAL', () => {
        const expectedAction = {
            type: actions.OPEN_FEEDBACK_MODAL,
        }
        expect(actions.openFeedbackModal().type).toEqual(expectedAction.type)
    })
})

describe('actions', () => {
    it('should create an action of type CLOSE_FEEDBACK_MODAL', () => {
        const expectedAction = {
            type: actions.CLOSE_FEEDBACK_MODAL,
        }
        expect(actions.closeFeedbackModal().type).toEqual(expectedAction.type)
    })
})

describe('actions', () => {
    it('should create an action of type CREATE_FEEDBACK_REQUEST', () => {
        const expectedAction = {
            type: actions.CREATE_FEEDBACK_REQUEST,
        }
        expect(actions.createFeedbackRequest().type).toEqual(expectedAction.type)
    })
})

describe('actions', () => {
    it('should create an action of type CREATE_FEEDBACK_FAILED and error in payload', () => {
        const expectedAction = {
            type: actions.CREATE_FEEDBACK_FAILED,
            payload:'error'
        }
        expect(actions.createFeedbackError('error')).toEqual(expectedAction)
    })
})

describe('actions', () => {
    it('should create an action of type CREATE_FEEDBACK_SUCCESS and project in payload', () => {
        const expectedAction = {
            type: actions.CREATE_FEEDBACK_SUCCESS,
            payload:'project'
        }
        expect(actions.createFeedbackSuccess('project')).toEqual(expectedAction)
    })
})

describe('actions', () => {
    it('should create an action of type CREATE_FEEDBACK_RESET', () => {
        const expectedAction = {
            type: actions.CREATE_FEEDBACK_RESET,
        }
        expect(actions.resetCreateFeedback().type).toEqual(expectedAction.type)
    })
})


describe('actions', () => {
    it('should despatch CREATE_FEEDBACK_REQUEST and CREATE_FEEDBACK_SUCCESS  actions', () => {
  
      axiosMock.onPost(`${API_URL}/feedback/create`).reply(200, {status:'success'}, {});
  
      let dispatch = (dispatched) => {
        switch (dispatched.type) {
          case actions.CREATE_FEEDBACK_REQUEST:
            expect(dispatched.type).toEqual(actions.CREATE_FEEDBACK_REQUEST)
            break;
          case actions.CREATE_FEEDBACK_SUCCESS:
            expect(dispatched.type).toEqual(actions.CREATE_FEEDBACK_SUCCESS)
            expect(dispatched.payload.data).toEqual( {status:'success'})
           
            break;
          default:
            expect(dispatched.type).toEqual(actions.CREATE_FEEDBACK_FAILED)
            expect(dispatched.payload).toEqual('fail test')
        }
      }
      let action = actions.createFeedback({})(dispatch)
    })
  })