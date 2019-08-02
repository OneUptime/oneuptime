import React from 'react';
import { storiesOf, action } from '@storybook/react';
import {FormModal} from '../../../components/modals/inviteTeamMember'
import {reduxForm} from 'redux-form'

let props = {
    'array': {},
    'anyTouched': false,
    'asyncValidating': false,
    'dirty': false,
    'form': 'InviteTeamMember',
    'initialized': false,
    'invalid': false,
    'pristine': true,
    'submitting': false,
    'submitFailed': false,
    'submitSucceeded': false,
    'valid': true,
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
          'lastActive': '2018-06-29T15:19:51.528Z'
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
    teamCreate:(details)=>{
        const teamCreate = action('teamCreate');
        teamCreate(details);
        return Promise.resolve({})
    },
    closeThisDialog:action('closeThisDialog'),
    handleSubmit:action('handleSubmit')
  }

let InviteTeamMemberForm = reduxForm({
	form: 'InviteTeamMember', // a unique identifier for this form
})(FormModal);

storiesOf('Modals', module)
    .addDecorator(story => (
        <div style={{ margin: '10%' }} >
            {story()}</div>
    ))
    .add('InviteTeamMember', () =>
        <InviteTeamMemberForm  {...props} />
    )
