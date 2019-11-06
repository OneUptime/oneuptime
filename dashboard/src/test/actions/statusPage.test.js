import * as _actions from '../../actions/statusPage'
import * as _types from '../../constants/statusPage'
import axiosMock from '../axios_mock'
import {
  API_URL
} from '../../config'

const actions = { ..._actions, ..._types }

//Update status page setting

describe('actions', () => {
  it('should create an action of type UPDATE_STATUSPAGE_SETTING_REQUEST', () => {

    let action = actions.updateStatusPageSettingRequest()

    expect(action.type).toEqual(actions.UPDATE_STATUSPAGE_SETTING_REQUEST)
  })
})

describe('actions', () => {
  it('should create an action of type UPDATE_STATUSPAGE_SETTING_SUCCESS', () => {

    let action = actions.updateStatusPageSettingSuccess({})

    expect(action.type).toEqual(actions.UPDATE_STATUSPAGE_SETTING_SUCCESS)
    expect(action.payload).toEqual({})
  })
})

describe('actions', () => {
  it('should create an action of type UPDATE_STATUSPAGE_SETTING_FAILURE', () => {
    const expectedAction = {
      type: actions.UPDATE_STATUSPAGE_SETTING_FAILURE,
      payload: 'error that occurred'
    }
    let action = actions.updateStatusPageSettingError('error that occurred')
    expect(action.type).toEqual(expectedAction.type)
    expect(action.payload).toEqual(expectedAction.payload)
  })
})



describe('actions', () => {
  it('should despatch UPDATE_STATUSPAGE_SETTING_FAILURE with 404', () => {

    let dispatch = (dispatched) => {
      switch (dispatched.type) {
        case actions.UPDATE_STATUSPAGE_SETTING_SUCCESS:
          expect(dispatched.type).toEqual(actions.UPDATE_STATUSPAGE_SETTING_SUCCESS)
          expect(dispatched.payload).toEqual({ data: 'data' })
          break;
        case actions.UPDATE_STATUSPAGE_SETTING_REQUEST:
          expect(dispatched.type).toEqual(actions.UPDATE_STATUSPAGE_SETTING_REQUEST)
          break;
        default:
          expect(dispatched.type).toEqual(actions.UPDATE_STATUSPAGE_SETTING_FAILURE)
          expect(dispatched.payload).toEqual(Error('Request failed with status code 404'))
      }
    }
    let action = actions.updateStatusPageSetting('projectId', {})(dispatch)
  })
})


describe('actions', () => {
  it('should despatch UPDATE_STATUSPAGE_SETTING_SUCCESS and UPDATE_STATUSPAGE_SETTING_SUCCESS  actions', () => {

    axiosMock.onPost(`${API_URL}/statusPage/projectId/statusPage/setting`).reply(200, { data: 'data' }, {});

    let dispatch = (dispatched) => {
      switch (dispatched.type) {
        case actions.UPDATE_STATUSPAGE_SETTING_SUCCESS:
          expect(dispatched.type).toEqual(actions.UPDATE_STATUSPAGE_SETTING_SUCCESS)
          expect(dispatched.payload).toEqual({ data: 'data' })
          break;
        case actions.UPDATE_STATUSPAGE_SETTING_REQUEST:
          expect(dispatched.type).toEqual(actions.UPDATE_STATUSPAGE_SETTING_REQUEST)
          break;
        default:
          expect(dispatched.type).toEqual(actions.UPDATE_STATUSPAGE_SETTING_FAILURE)
          expect(dispatched.payload).toEqual('fail test')
      }
    }
    let action = actions.updateStatusPageSetting('projectId', {})(dispatch)
  })
})

//Update status page monitors

describe('actions', () => {
  it('should create an action of type UPDATE_STATUSPAGE_MONITORS_REQUEST', () => {

    let action = actions.updateStatusPageMonitorsRequest()

    expect(action.type).toEqual(actions.UPDATE_STATUSPAGE_MONITORS_REQUEST)
  })
})

describe('actions', () => {
  it('should create an action of type UPDATE_STATUSPAGE_MONITORS_SUCCESS', () => {

    let action = actions.updateStatusPageMonitorsSuccess({})

    expect(action.type).toEqual(actions.UPDATE_STATUSPAGE_MONITORS_SUCCESS)
    expect(action.payload).toEqual({})
  })
})

describe('actions', () => {
  it('should create an action of type UPDATE_STATUSPAGE_MONITORS_FAILURE', () => {
    const expectedAction = {
      type: actions.UPDATE_STATUSPAGE_MONITORS_FAILURE,
      payload: 'error that occurred'
    }
    let action = actions.updateStatusPageMonitorsError('error that occurred')
    expect(action.type).toEqual(expectedAction.type)
    expect(action.payload).toEqual(expectedAction.payload)
  })
})



describe('actions', () => {
  it('should despatch UPDATE_STATUSPAGE_MONITORS_FAILURE with 404', () => {


    let dispatch = (dispatched) => {
      switch (dispatched.type) {
        case actions.UPDATE_STATUSPAGE_MONITORS_SUCCESS:
          expect(dispatched.type).toEqual(actions.UPDATE_STATUSPAGE_MONITORS_SUCCESS)
          expect(dispatched.payload).toEqual({ data: 'data' })
          break;
        case actions.UPDATE_STATUSPAGE_MONITORS_REQUEST:
          expect(dispatched.type).toEqual(actions.UPDATE_STATUSPAGE_MONITORS_REQUEST)
          break;
        default:
          expect(dispatched.type).toEqual(actions.UPDATE_STATUSPAGE_MONITORS_FAILURE)
          expect(dispatched.payload).toEqual(Error('Request failed with status code 404'))
      }
    }
    let action = actions.updateStatusPageMonitors('projectId', {})(dispatch)
  })
})


describe('actions', () => {
  it('should despatch UPDATE_STATUSPAGE_MONITORS_SUCCESS and UPDATE_STATUSPAGE_MONITORS_REQUEST  actions', () => {

    axiosMock.onPost(`${API_URL}/statusPage/projectId/statusPage/monitors`).reply(200, { data: 'data' }, {});

    let dispatch = (dispatched) => {
      switch (dispatched.type) {
        case actions.UPDATE_STATUSPAGE_MONITORS_SUCCESS:
          expect(dispatched.type).toEqual(actions.UPDATE_STATUSPAGE_MONITORS_SUCCESS)
          expect(dispatched.payload).toEqual({ data: 'data' })
          break;
        case actions.UPDATE_STATUSPAGE_MONITORS_REQUEST:
          expect(dispatched.type).toEqual(actions.UPDATE_STATUSPAGE_MONITORS_REQUEST)
          break;
        default:

          expect(dispatched.type).toEqual(actions.UPDATE_STATUSPAGE_SETTING_FAILURE)
          expect(dispatched.payload).toEqual('fail test')
      }
    }
    actions.updateStatusPageMonitors('projectId', {})(dispatch)
  })
})

//Update status page branding

describe('actions', () => {
  it('should create an action of type UPDATE_STATUSPAGE_BRANDING_REQUEST', () => {

    let action = actions.updateStatusPageBrandingRequest()

    expect(action.type).toEqual(actions.UPDATE_STATUSPAGE_BRANDING_REQUEST)
  })
})

describe('actions', () => {
  it('should create an action of type UPDATE_STATUSPAGE_BRANDING_SUCCESS', () => {

    let action = actions.updateStatusPageBrandingSuccess({})

    expect(action.type).toEqual(actions.UPDATE_STATUSPAGE_BRANDING_SUCCESS)
    expect(action.payload).toEqual({})
  })
})

describe('actions', () => {
  it('should create an action of type UPDATE_STATUSPAGE_BRANDING_FAILURE', () => {
    const expectedAction = {
      type: actions.UPDATE_STATUSPAGE_BRANDING_FAILURE,
      payload: 'error that occurred'
    }
    let action = actions.updateStatusPageBrandingError('error that occurred')
    expect(action.type).toEqual(expectedAction.type)
    expect(action.payload).toEqual(expectedAction.payload)
  })
})

// describe('actions', () => {
//     it('should despatch UPDATE_STATUSPAGE_BRANDING_FAILURE with 404', () => {
//       let dispatch = (dispatched) => {
//         switch (dispatched.type) {
//           case actions.UPDATE_STATUSPAGE_BRANDING_SUCCESS:
//             expect(dispatched.type).toEqual(actions.UPDATE_STATUSPAGE_BRANDING_SUCCESS)
//             expect(dispatched.payload).toEqual({data:'data'})
//             break;
//           case actions.UPDATE_STATUSPAGE_BRANDING_REQUEST:
//             expect(dispatched.type).toEqual(actions.UPDATE_STATUSPAGE_BRANDING_REQUEST)
//             break;
//           default:
//             expect(dispatched.type).toEqual(actions.UPDATE_STATUSPAGE_BRANDING_FAILURE)
//             expect(dispatched.payload).toEqual(Error('Request failed with status code 404'))
//         }
//       }
//       let action = actions.updateStatusPageBranding('projectId',{})(dispatch)
//     })
//   })

// describe('actions', () => {
//     it('should despatch UPDATE_STATUSPAGE_BRANDING_SUCCESS and UPDATE_STATUSPAGE_BRANDING_REQUEST  actions', () => {

//         axiosMock.onPost(`${API_URL}/statusPage/projectId/statusPage/branding`).reply(200, {data:'data'}, {});

//         let dispatch = (dispatched) => {
//           switch (dispatched.type) {
//             case actions.UPDATE_STATUSPAGE_BRANDING_SUCCESS:
//             expect(dispatched.type).toEqual(actions.UPDATE_STATUSPAGE_BRANDING_SUCCESS)
//             expect(dispatched.payload).toEqual({data:'data'})
//             break;
//           case actions.UPDATE_STATUSPAGE_BRANDING_REQUEST:
//             expect(dispatched.type).toEqual(actions.UPDATE_STATUSPAGE_BRANDING_REQUEST)
//             break;
//             default:
//               expect(dispatched.type).toEqual(actions.UPDATE_STATUSPAGE_SETTING_FAILURE)
//               expect(dispatched.payload).toEqual('fail test')
//           }
//         }
//         let action = actions.updateStatusPageBranding('projectId',{})(dispatch)
//     })
//   })

//Update status page links

describe('actions', () => {
  it('should create an action of type UPDATE_STATUSPAGE_LINKS_REQUEST', () => {

    let action = actions.updateStatusPageLinksRequest()

    expect(action.type).toEqual(actions.UPDATE_STATUSPAGE_LINKS_REQUEST)
  })
})

describe('actions', () => {
  it('should create an action of type UPDATE_STATUSPAGE_LINKS_SUCCESS', () => {

    let action = actions.updateStatusPageLinksSuccess({})

    expect(action.type).toEqual(actions.UPDATE_STATUSPAGE_LINKS_SUCCESS)
    expect(action.payload).toEqual({})
  })
})

describe('actions', () => {
  it('should create an action of type UPDATE_STATUSPAGE_LINKS_FAILURE', () => {
    const expectedAction = {
      type: actions.UPDATE_STATUSPAGE_LINKS_FAILURE,
      payload: 'error that occurred'
    }
    let action = actions.updateStatusPageLinksError('error that occurred')
    expect(action.type).toEqual(expectedAction.type)
    expect(action.payload).toEqual(expectedAction.payload)
  })
})



describe('actions', () => {
  it('should despatch UPDATE_STATUSPAGE_LINKS_FAILURE with 404', () => {


    let dispatch = (dispatched) => {
      switch (dispatched.type) {
        case actions.UPDATE_STATUSPAGE_LINKS_SUCCESS:
          expect(dispatched.type).toEqual(actions.UPDATE_STATUSPAGE_LINKS_SUCCESS)
          expect(dispatched.payload).toEqual({ data: 'data' })
          break;
        case actions.UPDATE_STATUSPAGE_LINKS_REQUEST:
          expect(dispatched.type).toEqual(actions.UPDATE_STATUSPAGE_LINKS_REQUEST)
          break;
        default:
          expect(dispatched.type).toEqual(actions.UPDATE_STATUSPAGE_LINKS_FAILURE)
          expect(dispatched.payload).toEqual(Error('Request failed with status code 404'))
      }
    }
    let action = actions.updateStatusPageLinks('projectId', {})(dispatch)
  })
})


describe('actions', () => {
  it('should despatch UPDATE_STATUSPAGE_MONITORS_SUCCESS and UPDATE_STATUSPAGE_MONITORS_REQUEST  actions', () => {

    axiosMock.onPost(`${API_URL}/statusPage/projectId/statusPage/links`).reply(200, { data: 'data' }, {});

    let dispatch = (dispatched) => {
      switch (dispatched.type) {
        case actions.UPDATE_STATUSPAGE_LINKS_SUCCESS:
          expect(dispatched.type).toEqual(actions.UPDATE_STATUSPAGE_LINKS_SUCCESS)
          expect(dispatched.payload).toEqual({ data: 'data' })
          break;
        case actions.UPDATE_STATUSPAGE_LINKS_REQUEST:
          expect(dispatched.type).toEqual(actions.UPDATE_STATUSPAGE_LINKS_REQUEST)
          break;
        default:
        //expect(dispatched.type).toEqual(actions.UPDATE_STATUSPAGE_LINKS_FAILURE)
        //expect(dispatched.payload).toEqual('fail test')
      }
    }
    let action = actions.updateStatusPageLinks('projectId', {})(dispatch)
  })
})

//fetch status page

describe('actions', () => {
  it('should create an action of type FETCH_STATUSPAGE_REQUEST', () => {

    let action = actions.fetchStatusPagesRequest()

    expect(action.type).toEqual(actions.FETCH_STATUSPAGE_REQUEST)
  })
})


describe('actions', () => {
  it('should create an action of type FETCH_STATUSPAGE_RESET', () => {

    let action = actions.resetFetchStatusPages()

    expect(action.type).toEqual(actions.FETCH_STATUSPAGE_RESET)
  })
})

describe('actions', () => {
  it('should create an action of type FETCH_STATUSPAGE_SUCCESS', () => {

    let action = actions.fetchStatusPagesSuccess({})

    expect(action.type).toEqual(actions.FETCH_STATUSPAGE_SUCCESS)
    expect(action.payload).toEqual({})
  })
})

describe('actions', () => {
  it('should create an action of type FETCH_STATUSPAGE_FAILURE', () => {
    const expectedAction = {
      type: actions.FETCH_STATUSPAGE_FAILURE,
      payload: 'error that occurred'
    }
    let action = actions.fetchStatusPagesError('error that occurred')
    expect(action.type).toEqual(expectedAction.type)
    expect(action.payload).toEqual(expectedAction.payload)
  })
})



describe('actions', () => {
  it('should despatch FETCH_STATUSPAGE_FAILURE with 404', () => {


    let dispatch = (dispatched) => {
      switch (dispatched.type) {
        case actions.FETCH_STATUSPAGE_SUCCESS:
          expect(dispatched.type).toEqual(actions.FETCH_STATUSPAGE_SUCCESS)
          expect(dispatched.payload).toEqual({ data: 'data' })
          break;
        case actions.FETCH_STATUSPAGE_REQUEST:
          expect(dispatched.type).toEqual(actions.FETCH_STATUSPAGE_REQUEST)
          break;
        default:
          expect(dispatched.type).toEqual(actions.FETCH_STATUSPAGE_FAILURE)
          expect(dispatched.payload).toEqual(Error('Request failed with status code 404'))
      }
    }
    let action = actions.fetchStatusPages('projectId')(dispatch)
  })
})


describe('actions', () => {
  it('should despatch FETCH_STATUSPAGE_SUCCESS and FETCH_STATUSPAGE_REQUEST  actions', () => {

    axiosMock.onGet(`${API_URL}/statusPage/projectId/statusPages`).reply(200, { data: 'data' }, {});

    let dispatch = (dispatched) => {
      switch (dispatched.type) {
        case actions.FETCH_STATUSPAGE_SUCCESS:
          expect(dispatched.type).toEqual(actions.FETCH_STATUSPAGE_SUCCESS)
          expect(dispatched.payload).toEqual({ data: 'data' })
          break;
        case actions.FETCH_STATUSPAGE_REQUEST:
          expect(dispatched.type).toEqual(actions.FETCH_STATUSPAGE_REQUEST)
          break;
        default:
          expect(dispatched.type).toEqual(actions.FETCH_STATUSPAGE_FAILURE)
          expect(dispatched.payload).toEqual('fail test')
      }
    }
    let action = actions.fetchStatusPages('projectId')(dispatch)
  })
})


describe('actions', () => {
  it('should create an action of type DELETE_PROJECT_STATUSPAGES', () => {

    let action = actions.deleteProjectStatusPages('projectId')

    expect(action.type).toEqual(actions.DELETE_PROJECT_STATUSPAGES)
    expect(action.payload).toEqual('projectId')
  })
})


describe('actions', () => {
  it('should create an action of type LOGO_CACHE_INSERT', () => {

    let action = actions.createLogoCache('imageUrl')

    expect(action.type).toEqual(actions.LOGO_CACHE_INSERT)
    expect(action.payload).toEqual('imageUrl')
  })
})

describe('actions', () => {
  it('should create an action of type FAVICON_CACHE_INSERT', () => {

    let action = actions.createFaviconCache('imageUrl')

    expect(action.type).toEqual(actions.FAVICON_CACHE_INSERT)
    expect(action.payload).toEqual('imageUrl')
  })
})
describe('actions', () => {
  it('should create an action of type LOGO_CACHE_RESET', () => {

    let action = actions.resetLogoCache()

    expect(action.type).toEqual(actions.LOGO_CACHE_RESET)
  })
})
describe('actions', () => {
  it('should create an action of type FAVICON_CACHE_RESET', () => {

    let action = actions.resetFaviconCache()

    expect(action.type).toEqual(actions.FAVICON_CACHE_RESET)
  })
})