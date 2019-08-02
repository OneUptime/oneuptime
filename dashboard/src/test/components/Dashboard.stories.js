import React from 'react';
import { storiesOf, action } from '@storybook/react';
import {DashboardApp} from '../../components/Dashboard'

import { Provider } from 'react-redux';
import { state, mockStore } from '../redux_mock'

localStorage.setItem('id', '5b1c0c29cb06cc23b132db07')

const props = {
    getProjects:(details)=>{
        const submitAction = action('getProjects');
      submitAction(details);
      return Promise.resolve([
        {
          'users': [
            {
              'userId': '5b1c0c29cb06cc23b132db07',
              'role': 'Administrator',
              '_id': '5b5b3cd6759d8814a7162677'
            }
          ],
          'createdAt': '2018-07-27T15:40:06.071Z',
          '_id': '5b5b3cd6759d8814a7162676',
          'name': 'Test',
          'apiKey': '55e00b80-91b3-11e8-bfeb-a367ac6590d9',
          'stripePlanId': 'plan_CpIZEEfT4YFSvF',
          'stripeSubscriptionId': 'sub_DJANP4LyBQh84J',
          'stripeMeteredSubscriptionId': 'sub_DJANLxwb0jK9An',
          '__v': 0
        }
      ])
    },
    'children': null,
    'match': {
      'path': '/project/:projectId/monitoring',
      'url': '/project/5b5b3cd6759d8814a7162676/monitoring',
      'isExact': true,
      'params': {
        'projectId': '5b5b3cd6759d8814a7162676'
      }
    },
    'location': {
      'pathname': '/project/5b5b3cd6759d8814a7162676/monitoring',
      'search': '',
      'hash': '',
      'key': 'dyidnb'
    },
    'history': {
      'length': 5,
      'action': 'POP',
      'location': {
        'pathname': '/project/5b5b3cd6759d8814a7162676/monitoring',
        'search': '',
        'hash': '',
        'key': 'dyidnb'
      }
    },
    'project': {
      'projects': {
        'requesting': false,
        'error': null,
        'success': false,
        'projects': [
            {
              'users': [
                {
                  'userId': '5b1c0c29cb06cc23b132db07',
                  'role': 'Administrator',
                  '_id': '5b5b3cd6759d8814a7162677'
                }
              ],
              'createdAt': '2018-07-27T15:40:06.071Z',
              '_id': '5b5b3cd6759d8814a7162676',
              'name': 'Test',
              'apiKey': '55e00b80-91b3-11e8-bfeb-a367ac6590d9',
              'stripePlanId': 'plan_CpIZEEfT4YFSvF',
              'stripeSubscriptionId': 'sub_DJANP4LyBQh84J',
              'stripeMeteredSubscriptionId': 'sub_DJANLxwb0jK9An',
              '__v': 0
            }
          ]
      },
      'currentProject': {
          'users': [
            {
              'userId': '5b1c0c29cb06cc23b132db07',
              'role': 'Administrator',
              '_id': '5b5b3cd6759d8814a7162677'
            }
          ],
          'createdAt': '2018-07-27T15:40:06.071Z',
          '_id': '5b5b3cd6759d8814a7162676',
          'name': 'Test',
          'apiKey': '55e00b80-91b3-11e8-bfeb-a367ac6590d9',
          'stripePlanId': 'plan_CpIZEEfT4YFSvF',
          'stripeSubscriptionId': 'sub_DJANP4LyBQh84J',
          'stripeMeteredSubscriptionId': 'sub_DJANLxwb0jK9An',
          '__v': 0
        },
      'newProject': {
        'requesting': false,
        'error': null,
        'success': false,
        'project': {}
      },
      'projectSwitcherVisible': false,
      'resetToken': {
        'success': false,
        'requesting': false,
        'error': null
      },
      'renameProject': {
        'success': false,
        'requesting': false,
        'error': null
      },
      'changePlan': {
        'success': false,
        'requesting': false,
        'error': null
      },
      'deleteProject': {
        'success': false,
        'requesting': false,
        'error': null
      },
      'exitProject': {
        'success': false,
        'requesting': false,
        'error': null
      },
      'showForm': false,
      'showDeleteModal': false
    },
    'profile': {
      'menuVisible': false,
      'profileSetting': {
        'error': null,
        'requesting': false,
        'success': false,
        'data': {}
      },
      'onCallAlertSetting': {
        'error': null,
        'requesting': false,
        'success': false
      },
      'changePasswordSetting': {
        'error': null,
        'requesting': false,
        'success': false
      },
      'file': null
    },
    'notification': {
      'notifications': {
        'error': null,
        'requesting': false,
        'success': false,
        'notifications': []
      },
      'notificationsVisible': false
    }
  }

const current_state = {
    ...state,
    project: {
        ...state.project,
        showForm: true
    }
}

const store = mockStore(current_state)

storiesOf('DashBoard', module)
    .addDecorator(story => <Provider store={store}>{story()}</Provider>)
    .add('New Project', () =>
        <DashboardApp  {...props} />
    )
const current_state_delete = {
    ...state,
    project: {
        ...state.project,
        showDeleteModal: true,
    }
}

const store_delete = mockStore(current_state_delete)

storiesOf('DashBoard', module)
    .addDecorator(story => <Provider store={store_delete}>{story()}</Provider>)
    .add('Delete Project', () =>
        <DashboardApp  {...props} />
    )
const current_state_profileMenu = {
    ...state,
    profileSettings: {
        ...state.profileSettings,
        menuVisible: true,
    },
}

let props_no_state_profile = {
    ...props,
    profile: {
        menuVisible: true 
    }
}


const store_delete_profileMenu = mockStore(current_state_profileMenu)
storiesOf('DashBoard', module)
    .addDecorator(story => <Provider store={store_delete_profileMenu}>{story()}</Provider>)
    .add('Profile Settings', () =>
        <DashboardApp  {...props_no_state_profile} />
    )

const current_state_notification = {
    ...state,
    notifications: {
        ...state.profileSettings,
        notificationsVisible: true,
    }
}

let props_no_state_notification = {
    ...props,
    notification: {
        notificationsVisible: true 
    }
}

const store_delete_notification = mockStore(current_state_notification)

storiesOf('DashBoard', module)
    .addDecorator(story => <Provider store={store_delete_notification}>{story()}</Provider>)
    .add('Notification', () =>
        <DashboardApp  {...props_no_state_notification} />
    )
const current_state_newProject = {
    ...state,
    project: {
        ...state.project,
        projects: {
            projects: []
        }

    }
}

let props_no_project = {
    ...props,
    project: {
        ...props.project,
        projects: {
            projects: []
        }

    }
}

const store_delete_newProject = mockStore(current_state_newProject)
storiesOf('DashBoard', module)
    .addDecorator(story => <Provider store={store_delete_newProject}>{story()}</Provider>)
    .add('No Projects', () =>
        <DashboardApp  {...props_no_project} />
    )

    const current_state_error = {
        ...state,
        project: {
            ...state.project,
            projects: {
                projects: [],
                error:'error that will occur'
            }
    
        }
    }

    let props_no_error = {
        ...props,
        project: {
            ...props.project,
            projects: {
                ...props.project.projects,
                error:'error that will occur'
            }
    
        }
    }
    
    const store_error = mockStore(current_state_error)
    storiesOf('DashBoard', module)
        .addDecorator(story => <Provider store={store_error}>{story()}</Provider>)
        .add('Error', () =>
            <DashboardApp  {...props_no_error} />
        )


    const current_state_requesting = {
        ...state,
        project: {
            ...state.project,
            projects: {
                projects: [],
                requesting:true
            }
    
        }
    }

    let props_no_requesting = {
        ...props,
        project: {
            ...props.project,
            projects: {
                ...props.project.projects,
                requesting: true
            }
    
        }
    }
    
    const store_requesting = mockStore(current_state_requesting)
    storiesOf('DashBoard', module)
        .addDecorator(story => <Provider store={store_requesting}>{story()}</Provider>)
        .add('Requesting', () =>
            <DashboardApp  {...props_no_requesting} />
        )