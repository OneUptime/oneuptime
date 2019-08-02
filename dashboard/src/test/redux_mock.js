import configureMockStore from 'redux-mock-store';
import thunk from 'redux-thunk';

const middlewares = [thunk];

export const mockStore = configureMockStore(middlewares);

export const state = {
	'routing': {
		'locationBeforeTransitions': null
	},
	'login': {
		'requesting': false,
		'user': {},
		'error': null,
		'success': false
	},
	'register': {
		'requesting': false,
		'step': 1,
		'user': {},
		'card': {},
		'company': {},
		'error': null,
		'success': false,
		'isUserInvited': {
			'requesting': false,
			'isUserInvited': null,
			'error': null,
			'success': false
		}
	},
	'form': {
		'NewMonitor': {
			'registeredFields': {
				'name_1000': {
					'name': 'name_1000',
					'type': 'Field',
					'count': 1
				},
				'url_1000': {
					'name': 'url_1000',
					'type': 'Field',
					'count': 1
				}
			}
		}
	},
	'team': {
		'teamLoading': {
			'error': null,
			'requesting': false,
			'success': false
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
		'teamMembers': [],
		'pages': {
			'counter': 1
		}
	},
	'alert': {
		'alerts': {
			'requesting': false,
			'error': null,
			'success': true,
			'data': [],
			'count': 0,
			'limit': 'undefined',
			'skip': 'undefined'
		},
		'incidentalerts': {
			'requesting': false,
			'error': null,
			'success': false,
			'count': 0,
			'skip': 0,
			'limit': 10,
			'data': []
		}
	},
	'modal': {
		'modals': [],
		'feedbackModalVisble': false
	},
	'project': {
		'projects': {
			'requesting': false,
			'error': null,
			'success': true,
			'projects': [{
				'users': [{
					'userId': '5b1c0c29cb06cc23b132db07',
					'role': 'Administrator',
					'_id': '5b5b3cd6759d8814a7162677'
				}],
				'createdAt': '2018-07-27T15:40:06.071Z',
				'_id': '5b5b3cd6759d8814a7162676',
				'name': 'Test',
				'apiKey': '55e00b80-91b3-11e8-bfeb-a367ac6590d9',
				'stripePlanId': 'plan_CpIZEEfT4YFSvF',
				'stripeSubscriptionId': 'sub_DJANP4LyBQh84J',
				'stripeMeteredSubscriptionId': 'sub_DJANLxwb0jK9An',
				'__v': 0
			}]
		},
		'currentProject': {
			'users': [{
				'userId': '5b1c0c29cb06cc23b132db07',
				'role': 'Administrator',
				'_id': '5b5b3cd6759d8814a7162677'
			}],
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
	'resetPassword': {
		'requesting': false,
		'error': null,
		'success': false
	},
	'changePassword': {
		'requesting': false,
		'error': null,
		'success': false
	},
	'monitor': {
		'monitorsList': {
			'requesting': false,
			'error': null,
			'success': false,
			'monitors': [{
				'createdAt': '2018-07-27T15:40:57.831Z',
				'pollTime': '2018-07-28T12:53:11.679Z',
				'updateTime': '2018-07-27T21:00:00.124Z',
				'_id': '5b5b3d09759d8814a7162679',
				'createdBy': '5b1c0c29cb06cc23b132db07',
				'name': 'Home Page',
				'type': 'url',
				'data': {
					'url': 'https://hackerbay.io'
				},
				'projectId': '5b5b3cd6759d8814a7162676',
				'__v': 0,
				'time': [{
						'date': '2018-07-27T21:00:05.216Z',
						'upTime': 171,
						'downTime': 32,
						'_id': '5b5b87d578da1f14addb56a2',
						'monitorId': '5b5b3d09759d8814a7162679',
						'status': 'offline',
						'__v': 0
					},
					{
						'date': '2018-07-27T21:00:05.216Z',
						'monitorId': '5b5b3d09759d8814a7162679',
						'upTime': 258,
						'downTime': 28,
						'status': 'offline'
					}
				],
				'count': 0,
				'incidents': [],
				'skip': 0,
				'limit': 3,
				'responseTime': 345.13155333333333,
				'uptimePercent': 87.73006134969326,
				'status': 'online',
				'error': null,
				'success': false,
				'requesting': false
			}]
		},
		'newMonitor': {
			'monitor': null,
			'error': null,
			'requesting': false,
			'success': false
		},
		'editMonitor': {
			'error': null,
			'requesting': false,
			'success': false
		},
		'fetchMonitorsIncidentRequest': false
	},
	'schedule': {
		'schedules': {
			'requesting': false,
			'error': null,
			'success': true,
			'data': [{
				'userIds': [{
					'_id': '5b1c0c29cb06cc23b132db07',
					'name': 'Danstan Onyango'
				}],
				'monitorIds': [{
					'_id': '5b5b3d09759d8814a7162679',
					'name': 'Home Page'
				}],
				'createdAt': '2018-07-28T08:18:47.447Z',
				'_id': '5b5c26e7759d8814a7162690',
				'name': 'Test',
				'createdBy': {
					'_id': '5b1c0c29cb06cc23b132db07',
					'name': 'Danstan Onyango'
				},
				'projectId': {
					'_id': '5b5b3cd6759d8814a7162676',
					'name': 'Test'
				},
				'__v': 0
			}]
		},
		'newSchedule': {
			'success': false,
			'requesting': false,
			'error': null
		},
		'renameSchedule': {
			'success': false,
			'requesting': false,
			'error': null
		},
		'deleteSchedule': {
			'success': false,
			'requesting': false,
			'error': null
		},
		'addMonitor': {
			'success': false,
			'requesting': false,
			'error': null
		},
		'addUser': {
			'success': false,
			'requesting': false,
			'error': null
		},
		'pages': {
			'counter': 1
		}
	},
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
			'links': [],
			'createdAt': '2018-07-27T15:40:06.088Z',
			'_id': '5b5b3cd6759d8814a7162678',
			'projectId': '5b5b3cd6759d8814a7162676',
			'__v': 0
		}
	},
	'incident': {
		'incidents': {
			'requesting': false,
			'error': null,
			'success': false,
			'incidents': [],
			'count': null,
			'limit': null,
			'skip': null
		},
		'newIncident': {
			'requesting': false,
			'error': null,
			'success': false
		},
		'incident': {
			'requesting': false,
			'error': null,
			'success': false,
			'incident': null
		},
		'investigationNotes': {
			'requesting': false,
			'error': null,
			'success': false
		},
		'internalNotes': {
			'requesting': false,
			'error': null,
			'success': false
		},
		'unresolvedincidents': {
			'requesting': false,
			'error': null,
			'success': true,
			'incidents': []
		}
	},
	'profileSettings': {
		'menuVisible': false,
		'profileSetting': {
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
				'lastActive': '2018-07-28T12:54:27.815Z',
				'_id': '5b1c0c29cb06cc23b132db07',
				'name': 'Danstan Onyango',
				'email': 'danstan.otieno@gmail.com',
				'password': '$2b$10$4cXm3.a5aXNSrnZ6YlH84.Dhln7PfFdO7lKA.uLskWjDyvceIuxSC',
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
	'feedback': {
		'feedback': {
			'error': null,
			'requesting': false,
			'success': false
		},
		'feedbackModalVisble': false
	},
	'notifications': {
		'notifications': {
			'requesting': false,
			'success': true,
			'error': null,
			'notifications': [{
				'createdAt': '2018-07-27T15:40:57.838Z',
				'read': [],
				'_id': '5b5b3d09759d8814a716267a',
				'projectId': '5b5b3cd6759d8814a7162676',
				'data': 'A New Monitor was Created by name Home Page',
				'__v': 0
			}]
		},
		'notificationsVisible': false
	},
	'slack': {
		'teams': {
			'error': null,
			'requesting': false,
			'success': false,
			'teams': [{
					'_id': '5b9947fd82730b0ed0c48200',
					'projectId': '5b9283e1c5d4132324cd92e2',
					'createdBy': '5b9283dbc5d4132324cd92e1',
					'integrationType': 'slack',
					'data': {
						'teamId': 'T77SZHUHH',
						'channelId': 'CBUSZPNUT',
						'teamName': 'Gueva',
						'accessToken': 'xoxp-245917606595-245991995746-430319582274-1c624bec5306c36ef546768181e66954',
						'botAccessToken': 'xoxb-245917606595-430319585874-r66lbqsdLXE1OHMnpCmKzYZT',
					},
					'__v': 0
				},
				{
					'_id': '5b9947fd82730b0ed0c48204',
					'projectId': '5b9283e1c5d4132324cd92e2',
					'createdBy': '5b9283dbc5d4132324cd92e1',
					'integrationType': 'slack',
					'data': {
						'teamId': 'T77SZHUHH',
						'channelId': 'CBUSZPNUT',
						'teamName': 'Gueva',
						'accessToken': 'xoxp-245917606595-245991995746-430319582274-1c624bec5306c36ef546768181e66954',
						'botAccessToken': 'xoxb-245917606595-430319585874-r66lbqsdLXE1OHMnpCmKzYZT',
					},
					'__v': 0
				},
				{
					'_id': '5b9947fd82730b0ed0c48289',
					'projectId': '5b9283e1c5d4132324cd92e2',
					'createdBy': '5b9283dbc5d4132324cd92e1',
					'integrationType': 'slack',
					'data': {
						'teamId': 'T77SZHUHH',
						'channelId': 'CBUSZPNUT',
						'teamName': 'Gueva',
						'accessToken': 'xoxp-245917606595-245991995746-430319582274-1c624bec5306c36ef546768181e66954',
						'botAccessToken': 'xoxb-245917606595-430319585874-r66lbqsdLXE1OHMnpCmKzYZT',
					},
					'__v': 0
				}
			]
		},
		'deleteTeam': {
			'error': null,
			'requesting': false,
			'success': false,
		}
	},
	'webHooks': {

		'webHook': {
			'requesting': false,
			'success': true,
			'webHooks': [{
					'monitors': [{
							'createdAt': '2018-09-25T07:17:22.109Z',
							'pollTime': '2018-09-25T16:12:21.716Z',
							'updateTime': '2018-09-25T07:17:22.109Z',
							'_id': '5ba9e102135d59258e5537b5',
							'createdBy': '5b9283dbc5d4132324cd92e1',
							'name': 'Unizonn',
							'type': 'url',
							'data': {
								'url': 'http://unizon.co.uk'
							},
							'projectId': '5b9283e1c5d4132324cd92e2',
							'__v': 0
						},
						{
							'createdAt': '2018-09-24T11:05:31.577Z',
							'pollTime': '2018-09-25T16:12:21.716Z',
							'updateTime': '2018-09-24T11:05:31.577Z',
							'_id': '5ba8c4fb70db043291facc8b',
							'createdBy': '5b9283dbc5d4132324cd92e1',
							'name': 'Test 2',
							'type': 'url',
							'data': {
								'url': 'http://sjdshdjhdjshdj.com'
							},
							'projectId': '5b9283e1c5d4132324cd92e2',
							'__v': 0
						}
					],
					'_id': '5baa16d7257dac3486eeab7e',
					'projectId': {
						'users': [{
							'userId': '5b9283dbc5d4132324cd92e1',
							'role': 'Administrator',
							'_id': '5b9283e1c5d4132324cd92e3'
						}],
						'createdAt': '2018-09-07T13:57:53.039Z',
						'_id': '5b9283e1c5d4132324cd92e2',
						'name': 'Demo Project',
						'apiKey': '03a74810-b2a6-11e8-968d-bd7238e8faae',
						'stripePlanId': 'plan_CpIUcLDhD1HKKA',
						'stripeSubscriptionId': 'sub_DYsDt2GNgkhCtg',
						'stripeMeteredSubscriptionId': 'sub_DYsDZuTuf6YnuU',
						'__v': 0
					},
					'createdBy': {
						'onCallAlert': [],
						'createdAt': '2018-09-07T13:57:47.747Z',
						'lastActive': '2018-09-25T16:12:37.921Z',
						'_id': '5b9283dbc5d4132324cd92e1',
						'name': 'Rex Raphael',
						'email': 'juicycleff@gmail.com',
						'password': '$2b$10$HxIjRcTEa441YPZNp3bt.etH7KQkLdo4wlPXjxwruxefetAqV6B/.',
						'companyName': 'Boldsofts',
						'companyRole': 'Boldsofts',
						'referral': 'Google',
						'companyPhoneNumber': '+2348162611815',
						'coupon': null,
						'jwtRefreshToken': '5i9FGzQWkFlXutLsCud0lyoAlOmVVrXJcI8kFtC84ViqXkTBug8IOHWxquhnFy1w9kK323OhUm32lsMyfAW8mIzQisnenD184HhzWqcbBPmeQJ36YX4qpRzBruYesKvMsRNcRNwIC9UdmxwAduP2T9FZKOFB1DChjYttPk5jJkdWzZDsKI9OAToO1tbQDskm3gpxuhhXLRxh40P7qcP4bEQcQetjVq9vtwvouMDbPGZuLYO1Iuq7xgp74H7fCrbJ',
						'stripeCustomerId': 'cus_DYsD7P2LbpMwsb',
						'__v': 0
					},
					'integrationType': 'webhook',
					'data': {
						'userId': '5b9283dbc5d4132324cd92e1',
						'endpoint': 'http://localhost:3002/webhook/test',
						'monitorIds': [
							'5ba9e102135d59258e5537b5'
						]
					},
					'__v': 0
				},
				{
					'monitors': [{
						'createdAt': '2018-09-24T11:05:31.577Z',
						'pollTime': '2018-09-25T16:12:21.716Z',
						'updateTime': '2018-09-24T11:05:31.577Z',
						'_id': '5ba8c4fb70db043291facc8b',
						'createdBy': '5b9283dbc5d4132324cd92e1',
						'name': 'Test 2',
						'type': 'url',
						'data': {
							'url': 'http://sjdshdjhdjshdj.com'
						},
						'projectId': '5b9283e1c5d4132324cd92e2',
						'__v': 0
					}],
					'_id': '5baa5e1cec56371108c647ce',
					'projectId': {
						'users': [{
							'userId': '5b9283dbc5d4132324cd92e1',
							'role': 'Administrator',
							'_id': '5b9283e1c5d4132324cd92e3'
						}],
						'createdAt': '2018-09-07T13:57:53.039Z',
						'_id': '5b9283e1c5d4132324cd92e2',
						'name': 'Demo Project',
						'apiKey': '03a74810-b2a6-11e8-968d-bd7238e8faae',
						'stripePlanId': 'plan_CpIUcLDhD1HKKA',
						'stripeSubscriptionId': 'sub_DYsDt2GNgkhCtg',
						'stripeMeteredSubscriptionId': 'sub_DYsDZuTuf6YnuU',
						'__v': 0
					},
					'createdBy': {
						'onCallAlert': [],
						'createdAt': '2018-09-07T13:57:47.747Z',
						'lastActive': '2018-09-25T16:12:37.921Z',
						'_id': '5b9283dbc5d4132324cd92e1',
						'name': 'Rex Raphael',
						'email': 'juicycleff@gmail.com',
						'password': '$2b$10$HxIjRcTEa441YPZNp3bt.etH7KQkLdo4wlPXjxwruxefetAqV6B/.',
						'companyName': 'Boldsofts',
						'companyRole': 'Boldsofts',
						'referral': 'Google',
						'companyPhoneNumber': '+2348162611815',
						'coupon': null,
						'jwtRefreshToken': '5i9FGzQWkFlXutLsCud0lyoAlOmVVrXJcI8kFtC84ViqXkTBug8IOHWxquhnFy1w9kK323OhUm32lsMyfAW8mIzQisnenD184HhzWqcbBPmeQJ36YX4qpRzBruYesKvMsRNcRNwIC9UdmxwAduP2T9FZKOFB1DChjYttPk5jJkdWzZDsKI9OAToO1tbQDskm3gpxuhhXLRxh40P7qcP4bEQcQetjVq9vtwvouMDbPGZuLYO1Iuq7xgp74H7fCrbJ',
						'stripeCustomerId': 'cus_DYsD7P2LbpMwsb',
						'__v': 0
					},
					'integrationType': 'webhook',
					'data': {
						'userId': '5b9283dbc5d4132324cd92e1',
						'endpoint': 'http://localhost:3000/test/webhook',
						'monitorIds': [
							'5ba8c4fb70db043291facc8b'
						]
					},
					'__v': 0
				},
			],
			'count': 2,
			'limit': 10,
			'skip': 0
		},
		'deleteWebHook': {
			'error': null,
			'requesting': false,
			'success': false,
		},
		'createWebHook': {
			'error': null,
			'requesting': false,
			'success': false,
		},
		'updateWebHook': {
			'error': null,
			'requesting': false,
			'success': false,
		},
		'pages': {
			'counter': 0
		}
	}
}

export const _store = mockStore(state)