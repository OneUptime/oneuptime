import React from 'react';
import { storiesOf, action } from '@storybook/react';
import { withKnobs, boolean } from '@storybook/addon-knobs';
import { reduxForm } from 'redux-form'
import { TeamMember } from '../../../components/team/TeamMember'

let TeamMemberDecorated = new reduxForm({
    form: 'TeamMember',
    enableReinitialize: true
})(TeamMember);


let props = {
  'array': {},
  'anyTouched': false,
  'asyncValidating': false,
  'dirty': false,
  'form': 'TeamMember',
  'initialized': false,
  'invalid': false,
  'pristine': true,
  'submitting': false,
  'submitFailed': false,
  'submitSucceeded': false,
  'valid': true,
  'userId': '5b1d20232352d77c91b2dae1',
  'index': '5b1d20232352d77c91b2dae1',
  'name': 'Danstan Onyango',
  'email': 'otis.eng.555@gmail.com',
  'role': 'Administrator',
  'lastActive': 'a few seconds',
  'team': {
    'teamLoading': {
      'error': null,
      'requesting': false,
      'success': true
    },
    'teamCreate': {
      'error': null,
      'requesting': false,
      'success': false
    },
    'teamUpdateRole': {
      'error': null,
      'requesting': false,
      'success': false,
      'updating': []
    },
    'teamdelete': {
      'error': null,
      'requesting': false,
      'success': false,
      'deleting': []
    },
    'teamMembers': [
      {
        'userId': '5b1c0c29cb06cc23b132db07',
        'email': 'danstan.otieno@gmail.com',
        'name': 'Danstan Onyango',
        'role': 'Administrator',
        'lastActive': '2018-06-27T20:58:47.561Z'
      },
      {
        'userId': '5b1d20232352d77c91b2dae1',
        'email': 'otis.eng.555@gmail.com',
        'name': 'Danstan Onyango',
        'role': 'Administrator',
        'lastActive': '2018-06-12T04:43:13.356Z'
      }
    ],
    'pages': {
      'counter': 1
    }
  },
  'deleting': false,
  'currentProject': {
    'users': [
      {
        'userId': '5b1c0c29cb06cc23b132db07',
        'role': 'Administrator',
        '_id': '5b1f39482a62c8611d23c954'
      },
      {
        'userId': '5b1d20232352d77c91b2dae1',
        'role': 'Administrator',
        '_id': '5b2c77fa728c4b2bc286eca4'
      }
    ],
    'createdAt': '2018-06-12T03:08:56.638Z',
    '_id': '5b1f39482a62c8611d23c953',
    'name': 'Test 1',
    'apiKey': '403e2e10-75d9-11e8-9272-bf0bb40d80f7',
    'stripePlanId': 'plan_CpIUcLDhD1HKKA',
    'stripeSubscriptionId': 'sub_D276mFZNBg3iMK',
    'stripeMeteredSubscriptionId': 'sub_D276LWAbjABjIZ',
    '__v': 0
  },
  'pure': true,
  teamDelete: action('teamDelete'),
  changeProjectRoles:action('changeProjectRoles'),
  teamUpdateRole:(details)=>{
    return new Promise((resolve,reject)=>{
      const teamUpdateRole = action('teamUpdateRole');
      if(!details)reject({error:'not normal'})
      teamUpdateRole(details)
      resolve({data:props.team})
    })
    
  }
}

storiesOf('Team', module)
.addDecorator(withKnobs)
    .addDecorator(story => (
        <div style={{ margin: '5%' }} >
            {story()}</div>
    ))
    .add('OnCallAlertSetting', () =>
        <TeamMemberDecorated updating={boolean('updating', false)}  {...props} />
    )

