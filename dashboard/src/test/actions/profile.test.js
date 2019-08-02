import axiosMock from '../axios_mock'
import {
    API_URL
} from '../../config'
import * as _actions from '../../actions/profile'
import * as _types from '../../constants/profile'

const actions = {..._actions, ..._types}

//Update profile setting

describe('actions', () => {
    it('should create an action of type UPDATE_PROFILE_SETTING_REQUEST', () => {
        const expectedAction = {
            type: actions.UPDATE_PROFILE_SETTING_REQUEST,
        }
        expect(actions.updateProfileSettingRequest().type).toEqual(expectedAction.type)
    })
})
describe('actions', () => {
    it('should create an action of type UPDATE_PROFILE_SETTING_SUCCESS, payload profile settings', () => {
        const expectedAction = {
            type: actions.UPDATE_PROFILE_SETTING_SUCCESS,
            payload: {}
        }
        let action = actions.updateProfileSettingSuccess({})
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual(expectedAction.payload)
    })
})

describe('actions', () => {
    it('should create an action of type UPDATE_PROFILE_SETTING_FAILURE, payload error', () => {
        const expectedAction = {
            type: actions.UPDATE_PROFILE_SETTING_FAILURE,
            payload: 'error that occurred'
        }
        let action = actions.updateProfileSettingError('error that occurred')
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual(expectedAction.payload)
    })
})

describe('actions', () => {
    it('should despatch UPDATE_PROFILE_SETTING_FAILURE', () => {

        let values = {
            name: 'Test Name',
            email: 'email here',
            companyPhoneNumber: 'companyPhoneNumber',
            timezone: 'timezone'
        }
        axiosMock.onPost(`${API_URL}/settings/prfile`).reply(200, {
            data: 'data'
        }, {});

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.UPDATE_PROFILE_SETTING_SUCCESS:
                    expect(dispatched.type).toEqual(actions.UPDATE_PROFILE_SETTING_SUCCESS)
                    expect(dispatched.payload).toEqual({
                        data: 'data'
                    })
                    break;
                case actions.UPDATE_PROFILE_SETTING_REQUEST:
                    expect(dispatched.type).toEqual(actions.UPDATE_PROFILE_SETTING_REQUEST)

                    break;
                default:
                    expect(dispatched.type).toEqual(actions.UPDATE_PROFILE_SETTING_FAILURE)
                    expect(dispatched.payload).toEqual(Error('Request failed with status code 404'))
            }
        }
        let action = actions.updateProfileSetting(values)(dispatch)
    })
})

describe('actions', () => {
    it('should despatch UPDATE_PROFILE_SETTING_REQUEST and UPDATE_PROFILE_SETTING_SUCCESS  actions', () => {

        let values = {
            name: 'Test Name',
            email: 'email here',
            companyPhoneNumber: 'companyPhoneNumber',
            timezone: 'timezone'
        }
        axiosMock.onPost(`${API_URL}/settings/profile`).reply(200, {
            data: 'data'
        }, {});

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.UPDATE_PROFILE_SETTING_SUCCESS:
                    expect(dispatched.type).toEqual(actions.UPDATE_PROFILE_SETTING_SUCCESS)
                    expect(dispatched.payload).toEqual({
                        data: 'data'
                    })
                    break;
                case actions.UPDATE_PROFILE_SETTING_REQUEST:
                    expect(dispatched.type).toEqual(actions.UPDATE_PROFILE_SETTING_REQUEST)

                    break;
                default:
                    expect(dispatched.type).toEqual(actions.UPDATE_PROFILE_SETTING_FAILURE)
                    expect(dispatched.payload).toEqual('fail test')
            }
        }
        let action = actions.updateProfileSetting(values)(dispatch)
    })
})


//Update change password setting.

describe('actions', () => {
    it('should create an action of type UPDATE_CHANGE_PASSWORD_SETTING_REQUEST', () => {
        const expectedAction = {
            type: actions.UPDATE_CHANGE_PASSWORD_SETTING_REQUEST,
        }
        expect(actions.updateChangePasswordSettingRequest().type).toEqual(expectedAction.type)
    })
})
describe('actions', () => {
    it('should create an action of type UPDATE_CHANGE_PASSWORD_SETTING_SUCCESS', () => {

        let action = actions.updateChangePasswordSettingSuccess({
            data: 'OnCallAlertSetting'
        })

        expect(action.type).toEqual(actions.UPDATE_CHANGE_PASSWORD_SETTING_SUCCESS)
    })
})

describe('actions', () => {
    it('should create an action of type UPDATE_CHANGE_PASSWORD_SETTING_FAILURE, payload error', () => {
        const expectedAction = {
            type: actions.UPDATE_CHANGE_PASSWORD_SETTING_FAILURE,
            payload: 'error that occurred'
        }
        let action = actions.updateChangePasswordSettingError('error that occurred')
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual(expectedAction.payload)
    })
})

describe('actions', () => {
    it('should despatch UPDATE_CHANGE_PASSWORD_SETTING_FAILURE', () => {

        let data = {
            values: 'values'
        }
        axiosMock.onPost(`${API_URL}/settings/changePssword`).reply(200, {
            data: 'data'
        }, {});

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.UPDATE_CHANGE_PASSWORD_SETTING_SUCCESS:
                    expect(dispatched.type).toEqual(actions.UPDATE_CHANGE_PASSWORD_SETTING_SUCCESS)
                    break;
                case actions.UPDATE_CHANGE_PASSWORD_SETTING_REQUEST:
                    expect(dispatched.type).toEqual(actions.UPDATE_CHANGE_PASSWORD_SETTING_REQUEST)
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.UPDATE_CHANGE_PASSWORD_SETTING_FAILURE)
                    expect(dispatched.payload).toEqual(Error('Request failed with status code 404'))
            }
        }
        let action = actions.updateChangePasswordSetting(data)(dispatch)
    })
})


describe('actions', () => {
    it('should despatch UPDATE_PROFILE_SETTING_REQUEST and UPDATE_PROFILE_SETTING_SUCCESS  actions', () => {

        let data = {
            values: 'values'
        }
        axiosMock.onPost(`${API_URL}/settings/changePassword`).reply(200, {
            data: 'data'
        }, {});

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.UPDATE_CHANGE_PASSWORD_SETTING_SUCCESS:
                    expect(dispatched.type).toEqual(actions.UPDATE_CHANGE_PASSWORD_SETTING_SUCCESS)
                    break;
                case actions.UPDATE_CHANGE_PASSWORD_SETTING_REQUEST:
                    expect(dispatched.type).toEqual(actions.UPDATE_CHANGE_PASSWORD_SETTING_REQUEST)
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.UPDATE_CHANGE_PASSWORD_SETTING_FAILURE)
                    expect(dispatched.payload).toEqual('fail test')
            }
        }
        let action = actions.updateChangePasswordSetting(data)(dispatch)
    })
})


describe('actions', () => {
    it('should create an action of type SHOW_PROFILE_MENU', () => {

        let action = actions.showProfileMenu()

        expect(action.type).toEqual(actions.SHOW_PROFILE_MENU)
    })
})

describe('actions', () => {
    it('should create an action of type HIDE_PROFILE_MENU, payload error', () => {
        const expectedAction = {
            type: actions.HIDE_PROFILE_MENU,
            payload: 'error that occurred'
        }
        let action = actions.hideProfileMenu('error that occurred')
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual(expectedAction.payload)
    })
})

// Get Previous User Settings.

describe('actions', () => {
    it('should create an action of type USER_SETTINGS_REQUEST', () => {
        const expectedAction = {
            type: actions.USER_SETTINGS_REQUEST,
        }
        expect(actions.userSettingsRequest().type).toEqual(expectedAction.type)
    })
})
describe('actions', () => {
    it('should create an action of type USER_SETTINGS_SUCCESS', () => {

        let action = actions.userSettingsSuccess({data:'user settings'})

        expect(action.type).toEqual(actions.USER_SETTINGS_SUCCESS)
        expect(action.payload).toEqual({data:'user settings'})
    })
})

describe('actions', () => {
    it('should create an action of type USER_SETTINGS_FAILURE, payload error', () => {
        const expectedAction = {
            type: actions.USER_SETTINGS_FAILURE,
            payload:'error that occurred'
        }
        let action = actions.userSettingsError('error that occurred')
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual(expectedAction.payload)
    })
})

describe('actions', () => {
    it('should despatch UPDATE_CHANGE_PASSWORD_SETTING_FAILURE', () => {
    
      axiosMock.onGet(`${API_URL}/settings/prfile`).reply(200, {data:'data'}, {});
  
      let dispatch = (dispatched) => {
        switch (dispatched.type) {
          case actions.USER_SETTINGS_SUCCESS:
            expect(dispatched.type).toEqual(actions.USER_SETTINGS_SUCCESS)
            expect(dispatched.payload).toEqual({data:'data'})
            break;
          case actions.USER_SETTINGS_REQUEST:
            expect(dispatched.type).toEqual(actions.USER_SETTINGS_REQUEST)
            break;
          default:
            expect(dispatched.type).toEqual(actions.USER_SETTINGS_FAILURE)
            expect(dispatched.payload).toEqual(Error('Request failed with status code 404'))
        }
      }
      let action = actions.userSettings()(dispatch)
    })
  })


describe('actions', () => {
    it('should despatch UPDATE_PROFILE_SETTING_REQUEST and UPDATE_PROFILE_SETTING_SUCCESS  actions', () => {
    
        axiosMock.onGet(`${API_URL}/settings/profile`).reply(200, {data:'data'}, {});
  
        let dispatch = (dispatched) => {
          switch (dispatched.type) {
            case actions.USER_SETTINGS_SUCCESS:
              expect(dispatched.type).toEqual(actions.USER_SETTINGS_SUCCESS)
              expect(dispatched.payload).toEqual({data:'data'})
              break;
            case actions.USER_SETTINGS_REQUEST:
              expect(dispatched.type).toEqual(actions.USER_SETTINGS_REQUEST)
              break;
            default:
              expect(dispatched.type).toEqual(actions.USER_SETTINGS_FAILURE)
              expect(dispatched.payload).toEqual('fail test')
          }
        }
        let action = actions.userSettings()(dispatch)
    })
  })

  describe('actions', () => {
    it('should despatch action of type LOG_FILE', () => {

        let dispatch = (dispatched) => {
            expect(dispatched.type).toEqual('LOG_FILE')
          }
        let action = actions.logFile('file')((dispatch))
    })
})

describe('actions', () => {
    it('should despatch action of type RESET_FILE', () => {

        let dispatch = (dispatched) => {
            expect(dispatched.type).toEqual('RESET_FILE')
          }
        let action = actions.resetFile()((dispatch))
    })
})
