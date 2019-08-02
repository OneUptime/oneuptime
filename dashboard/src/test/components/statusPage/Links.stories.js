import React from 'react';
import { storiesOf } from '@storybook/react';
import { Links } from '../../../components/statusPage/Links'
import { action } from '@storybook/addon-actions';
import { reduxForm } from 'redux-form'
import { Validate } from '../../../config';

localStorage.setItem('id', '5b1c0c29cb06cc23b132db07')

const props = {
  fetchStatusPages: action('fetchStatusPages'),
  updateStatusPageLinks: action('updateStatusPageLinks'),
  'array': {},
  'anyTouched': false,
  'asyncValidating': false,
  'dirty': false,
  'form': 'Links',
  'initialized': false,
  'initialValues': {
    'links': [
      {
        'name': 'Test',
        'url': 'https://hackerbay.io'
      }
    ]
  },
  'invalid': false,
  'pristine': true,
  'submitting': false,
  'submitFailed': false,
  'submitSucceeded': false,
  'valid': true,
  'statusPage': {
    'setting': {
      'error': null,
      'requesting': false,
      'success': false
    },
    'monitors': {
      'error': null,
      'requesting': false,
      'success': false
    },
    'branding': {
      'error': null,
      'requesting': false,
      'success': false
    },
    'links': {
      'error': null,
      'requesting': false,
      'success': false
    },
    'logocache': {
      'data': null
    },
    'faviconcache': {
      'data': null
    },
    'error': null,
    'requesting': false,
    'success': false,
    'status': {
      'monitorIds': [],
      'links': [
        {
          'name': 'Test',
          'url': 'https://hackerbay.io'
        }
      ],
      'createdAt': '2018-06-12T03:08:56.656Z',
      '_id': '5b1f39482a62c8611d23c955',
      'projectId': '5b1f39482a62c8611d23c953',
      '__v': 1,
      'copyright': '',
      'description': '',
      'faviconPath': '6f1711295c1c7da54e639b4d92037977.png',
      'logoPath': '5ff52ce39a4ccbe9d564979ecfae416e.png',
      'title': '',
      'domain': 'hackerbay.io'
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
  'pure': true
}

function validate(values) {
  const errors = {};
  if (values.title) {
    if (!Validate.text(values.title)) {
      errors.title = 'Please mention title in text format .'
    }
  }
  if (values.description) {
    if (!Validate.text(values.description)) {
      errors.description = 'Please mention description in text format .'
    }
  }
  if (values.copyright) {
    if (!Validate.text(values.copyright)) {
      errors.copyright = 'Please mention copyright in text format .'
    }
  }

  return errors;
}

let LinksForm = reduxForm({
  form: 'Branding', // a unique identifier for this form
  enableReinitialize: true,
  validate // <--- validation function given to redux-for
})(Links);

let props_nonrequesting = {
  'statusPage': {
    'setting': {
      'error': null,
      'requesting': false,
      'success': false
    },
    'monitors': {
      'error': null,
      'requesting': false,
      'success': false
    },
    'branding': {
      'error': null,
      'requesting': false,
      'success': false
    },
    'links': {
      'error': null,
      'requesting': false,
      'success': false
    },
    'logocache': {
      'data': null
    },
    'faviconcache': {
      'data': null
    },
    'error': null,
    'requesting': false,
    'success': false,
    'status': {
      'monitorIds': [],
      'links': [
        {
          'name': 'Test',
          'url': 'https://hackerbay.io'
        }
      ],
      'createdAt': '2018-06-12T03:08:56.656Z',
      '_id': '5b1f39482a62c8611d23c955',
      'projectId': '5b1f39482a62c8611d23c953',
      '__v': 1,
      'copyright': '',
      'description': '',
      'faviconPath': '6f1711295c1c7da54e639b4d92037977.png',
      'logoPath': '5ff52ce39a4ccbe9d564979ecfae416e.png',
      'title': '',
      'domain': 'hackerbay.io'
    }
  },
}
let props_requesting = {
  'statusPage': {
    'setting': {
      'error': null,
      'requesting': false,
      'success': false
    },
    'monitors': {
      'error': null,
      'requesting': false,
      'success': false
    },
    'branding': {
      'error': null,
      'requesting': false,
      'success': false
    },
    'links': {
      'error': null,
      'requesting': true,
      'success': false
    },
    'logocache': {
      'data': null
    },
    'faviconcache': {
      'data': null
    },
    'error': null,
    'requesting': false,
    'success': false,
    'status': {
      'monitorIds': [],
      'links': [
        {
          'name': 'Test',
          'url': 'https://hackerbay.io'
        }
      ],
      'createdAt': '2018-06-12T03:08:56.656Z',
      '_id': '5b1f39482a62c8611d23c955',
      'projectId': '5b1f39482a62c8611d23c953',
      '__v': 1,
      'copyright': '',
      'description': '',
      'faviconPath': '6f1711295c1c7da54e639b4d92037977.png',
      'logoPath': '5ff52ce39a4ccbe9d564979ecfae416e.png',
      'title': '',
      'domain': 'hackerbay.io'
    }
  }
}
storiesOf('Status Page', module)
  .add('Links', () =>
    <LinksForm {...props_nonrequesting} {...props} />
  )

storiesOf('Status Page', module)
  .add('Link Requeting', () =>
    <LinksForm {...props} {...props_requesting} />
  )