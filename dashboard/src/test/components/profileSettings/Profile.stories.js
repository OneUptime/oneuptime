import React from 'react';
import { storiesOf, action } from '@storybook/react';
import { reduxForm } from 'redux-form'
import { ProfileSetting } from '../../../components/profileSettings/Profile'

let ProfileSetting_Decorated = new reduxForm({
    form: 'Profile',
    enableReinitialize: true
})(ProfileSetting);


let props = {
    'array': {},
    'anyTouched': false,
    'asyncValidating': false,
    'dirty': false,
    'form': 'Profile',
    'initialized': false,
    'initialValues': {
      'onCallAlert': [
        'sms',
        'call',
        'email'
      ],
      'createdAt': '2018-06-09T17:19:37.071Z',
      'lastActive': '2018-06-27T15:03:01.113Z',
      '_id': '5b1c0c29cb06cc23b132db07',
      'name': 'Danstan Onyango',
      'email': 'danstan.otieno@gmail.com',
      'password': '$2b$10$fmiv2VC7T/91T9SGsQ1Gc.iAI3El70k/na5eDvE31qNGVVrEY1V4K',
      'companyName': 'Zemuldo',
      'companyRole': 'Geek',
      'referral': 'Am with u',
      'companyPhoneNumber': '+254728554638',
      'coupon': null,
      'jwtRefreshToken': 'va564HNikaSBrDOgPofqWRe5sKzK5LwPRsnwptVh7NeIq4mXr9QrNJh8aU1AP9hTvpdDRsbN2mrfnJJQWrAQxaojN9KncLXtM9L4TPG6eg4q2J5LoQCpnQDG6MfQcRe9bV0SwXQ6y9YaL8l0ZrslVG3m6ikmcFoC6Nxx69Pr6aNvFltn4dLlk4PS0Px3kQNRDThvpGgybs3NfpyXzoGUiQTeRdHmNNnYdd4Uvd1B2ZUUr2vmJGSnrmgb51bbL6Nk',
      'stripeCustomerId': 'cus_D1D9mLILlq66ev',
      '__v': 0,
      'timezone': 'Alaska (GMT -09:00)',
      'resetPasswordExpires': '1529658748197',
      'resetPasswordToken': '3809e41fea639b365f81542cabb88495c9586087'
    },
    'invalid': false,
    'pristine': true,
    'submitting': false,
    'submitFailed': false,
    'submitSucceeded': false,
    'valid': true,
    'fileUrl': null,
    'profileSettings': {
      'error': null,
      'requesting': false,
      'success': false,
      'data': {
        'onCallAlert': [
          'sms',
          'call',
          'email'
        ],
        'createdAt': '2018-06-09T17:19:37.071Z',
        'lastActive': '2018-06-27T15:03:01.113Z',
        '_id': '5b1c0c29cb06cc23b132db07',
        'name': 'Danstan Onyango',
        'email': 'danstan.otieno@gmail.com',
        'password': '$2b$10$fmiv2VC7T/91T9SGsQ1Gc.iAI3El70k/na5eDvE31qNGVVrEY1V4K',
        'companyName': 'Zemuldo',
        'companyRole': 'Geek',
        'referral': 'Am with u',
        'companyPhoneNumber': '+254728554638',
        'coupon': null,
        'jwtRefreshToken': 'va564HNikaSBrDOgPofqWRe5sKzK5LwPRsnwptVh7NeIq4mXr9QrNJh8aU1AP9hTvpdDRsbN2mrfnJJQWrAQxaojN9KncLXtM9L4TPG6eg4q2J5LoQCpnQDG6MfQcRe9bV0SwXQ6y9YaL8l0ZrslVG3m6ikmcFoC6Nxx69Pr6aNvFltn4dLlk4PS0Px3kQNRDThvpGgybs3NfpyXzoGUiQTeRdHmNNnYdd4Uvd1B2ZUUr2vmJGSnrmgb51bbL6Nk',
        'stripeCustomerId': 'cus_D1D9mLILlq66ev',
        '__v': 0,
        'timezone': 'Alaska (GMT -09:00)',
        'resetPasswordExpires': '1529658748197',
        'resetPasswordToken': '3809e41fea639b365f81542cabb88495c9586087'
      }
    },
    'pure': true,
    handleSubmit:action('handleSubmit'),
    userSettings:action('userSettings'),
    updateProfileSetting:action('updateProfileSetting'),
    logFile:action('logFile'),
    resetFile:action('resetFile')
  }

  let props_error = {
    ...props,
    profileSettings:{
      ...props.profileSettings,
      error:'error that will occur'
    }
  }

storiesOf('Profile Settings', module)
    .addDecorator(story => (
        <div style={{ margin: '5%' }} >
            {story()}</div>
    ))
    .add('Profile Settings', () =>
        <ProfileSetting_Decorated  {...props} />
    )
    .add('Profile Error', () =>
        <ProfileSetting_Decorated  {...props_error} />
    )


