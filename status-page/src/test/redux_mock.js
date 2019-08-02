import configureMockStore from 'redux-mock-store';
import thunk from 'redux-thunk';

const middlewares = [thunk];

export const mockStore = configureMockStore(middlewares);

export const state ={
    'status': {
        'error': null,
        'statusPage': {
          'monitorIds': [
            {
              'monitor': {
                'createdAt': '2018-10-14T11:48:51.875Z',
                'pollTime': '2018-10-24T07:15:16.677Z',
                'updateTime': '2018-10-23T21:00:01.804Z',
                '_id': '5bc32d23d3e9063a1701ec72',
                'createdBy': '5bb356f2e08e6637448de71d',
                'name': 'Hackerbay Website',
                'type': 'url',
                'data': {
                  'url': 'https://hackerbay.io'
                },
                'projectId': '5bb356f7e08e6637448de71e',
                '__v': 0
              },
              'time': [
                {
                  'date': '2018-10-24T07:17:07.251Z',
                  'monitorId': '5bc32d23d3e9063a1701ec72',
                  'upTime': 107,
                  'downTime': 9
                },
                {
                  'date': '2018-10-23T20:59:00.796Z',
                  'upTime': 621,
                  'downTime': 53,
                  '_id': '5bcf8bd1a733947b4e30b792',
                  'monitorId': '5bc32d23d3e9063a1701ec72',
                  'status': 'online',
                  '__v': 0
                },
                {
                  'date': '2018-10-22T20:59:00.369Z',
                  'upTime': 509,
                  'downTime': 437,
                  '_id': '5bce3a61782dbd6505113bbd',
                  'monitorId': '5bc32d23d3e9063a1701ec72',
                  'status': 'online',
                  '__v': 0
                },
                {
                  'date': '2018-10-19T20:59:00.317Z',
                  'upTime': 309,
                  'downTime': 144,
                  '_id': '5bca45d13e713c424e3517ba',
                  'monitorId': '5bc32d23d3e9063a1701ec72',
                  'status': 'online',
                  '__v': 0
                },
                {
                  'date': '2018-10-18T20:59:00.622Z',
                  'upTime': 157,
                  'downTime': 377,
                  '_id': '5bc8f4607d223d0ef835b7fb',
                  'monitorId': '5bc32d23d3e9063a1701ec72',
                  'status': 'online',
                  '__v': 0
                },
                {
                  'date': '2018-10-17T20:59:00.079Z',
                  'upTime': 438,
                  'downTime': 55,
                  '_id': '5bc7a2d6073a0f3cd9c15fb9',
                  'monitorId': '5bc32d23d3e9063a1701ec72',
                  'status': 'online',
                  '__v': 0
                },
                {
                  'date': '2018-10-16T20:59:00.357Z',
                  'upTime': 182,
                  'downTime': 148,
                  '_id': '5bc65166db6be32885a58977',
                  'monitorId': '5bc32d23d3e9063a1701ec72',
                  'status': 'online',
                  '__v': 0
                },
                {
                  'date': '2018-10-14T20:59:00.270Z',
                  'upTime': 337,
                  'downTime': 10,
                  '_id': '5bc3ae51bf93117c2942952e',
                  'monitorId': '5bc32d23d3e9063a1701ec72',
                  'status': 'online',
                  '__v': 0
                }
              ],
              'stat': 'online',
              'totalUptimePercent': 68.32776778833805
            },
            {
              'monitor': {
                'createdAt': '2018-10-02T11:34:53.880Z',
                'pollTime': '2018-10-24T07:15:16.677Z',
                'updateTime': '2018-10-23T21:00:01.804Z',
                '_id': '5bb357dde08e6637448de721',
                'createdBy': '5bb356f2e08e6637448de71d',
                'name': 'Home Page',
                'type': 'url',
                'data': {
                  'url': 'https://hackerbay.ioss'
                },
                'projectId': '5bb356f7e08e6637448de71e',
                '__v': 0
              },
              'time': [
                {
                  'date': '2018-10-24T07:17:07.253Z',
                  'monitorId': '5bb357dde08e6637448de721',
                  'upTime': 0,
                  'downTime': 116
                },
                {
                  'date': '2018-10-23T20:59:00.796Z',
                  'upTime': 0,
                  'downTime': 674,
                  '_id': '5bcf8bd1a733947b4e30b795',
                  'monitorId': '5bb357dde08e6637448de721',
                  'status': 'offline',
                  '__v': 0
                },
                {
                  'date': '2018-10-22T20:59:00.369Z',
                  'upTime': 0,
                  'downTime': 947,
                  '_id': '5bce3a61782dbd6505113bc0',
                  'monitorId': '5bb357dde08e6637448de721',
                  'status': 'offline',
                  '__v': 0
                },
                {
                  'date': '2018-10-19T20:59:00.317Z',
                  'upTime': 0,
                  'downTime': 453,
                  '_id': '5bca45d13e713c424e3517bb',
                  'monitorId': '5bb357dde08e6637448de721',
                  'status': 'offline',
                  '__v': 0
                },
                {
                  'date': '2018-10-18T20:59:00.622Z',
                  'upTime': 0,
                  'downTime': 534,
                  '_id': '5bc8f4607d223d0ef835b7fa',
                  'monitorId': '5bb357dde08e6637448de721',
                  'status': 'offline',
                  '__v': 0
                },
                {
                  'date': '2018-10-17T20:59:00.079Z',
                  'upTime': 0,
                  'downTime': 493,
                  '_id': '5bc7a2d6073a0f3cd9c15fba',
                  'monitorId': '5bb357dde08e6637448de721',
                  'status': 'offline',
                  '__v': 0
                },
                {
                  'date': '2018-10-16T20:59:00.357Z',
                  'upTime': 0,
                  'downTime': 332,
                  '_id': '5bc65166db6be32885a58976',
                  'monitorId': '5bb357dde08e6637448de721',
                  'status': 'offline',
                  '__v': 0
                },
                {
                  'date': '2018-10-14T20:59:00.270Z',
                  'upTime': 0,
                  'downTime': 945,
                  '_id': '5bc3ae51bf93117c2942952d',
                  'monitorId': '5bb357dde08e6637448de721',
                  'status': 'offline',
                  '__v': 0
                },
                {
                  'date': '2018-10-11T20:59:00.316Z',
                  'upTime': 0,
                  'downTime': 496,
                  '_id': '5bbfb9d3df63b662220fed35',
                  'monitorId': '5bb357dde08e6637448de721',
                  'status': 'offline',
                  '__v': 0
                },
                {
                  'date': '2018-10-10T20:59:00.041Z',
                  'upTime': 0,
                  'downTime': 339,
                  '_id': '5bbe686c51353834ff31bffc',
                  'monitorId': '5bb357dde08e6637448de721',
                  'status': 'offline',
                  '__v': 0
                },
                {
                  'date': '2018-10-09T20:59:00.791Z',
                  'upTime': 0,
                  'downTime': 305,
                  '_id': '5bbd16de09912e340e80765c',
                  'monitorId': '5bb357dde08e6637448de721',
                  'status': 'offline',
                  '__v': 0
                },
                {
                  'date': '2018-10-08T20:59:00.561Z',
                  'upTime': 0,
                  'downTime': 1423,
                  '_id': '5bbbc5548fef6f79c741c6a7',
                  'monitorId': '5bb357dde08e6637448de721',
                  'status': 'offline',
                  '__v': 0
                }
              ],
              'stat': 'offline',
              'totalUptimePercent': 0
            }
          ],
          'links': [
            {
              'name': 'Test',
              'url': 'https://hackerbay.io'
            }
          ],
          'createdAt': '2018-10-17T07:42:53.071Z',
          '_id': '5bc6e7fd71016d6db72065ae',
          'projectId': {
            'users': [
              {
                'userId': '5bb356f2e08e6637448de71d',
                'role': 'Administrator',
                '_id': '5bb356f7e08e6637448de71f'
              }
            ],
            'createdAt': '2018-10-02T11:31:03.025Z',
            'deleted': false,
            '_id': '5bb356f7e08e6637448de71e',
            'name': 'Test Project',
            'apiKey': 'a4cde250-c636-11e8-af16-f96c599f4dff',
            'stripePlanId': 'plan_CpIUcLDhD1HKKA',
            'stripeSubscriptionId': 'sub_DiCUM2z9cRiYh8',
            'stripeMeteredSubscriptionId': 'sub_DiCUz3lXsgSqle',
            '__v': 0
          },
          '__v': 1,
          'domain': 'zemuldo.com',
          'copyright': '',
          'description': 'A short description goes here for this status page',
          'faviconPath': 'c0fa672a5e79f860b787f3e54900fe62.png',
          'logoPath': 'a55f658ba7c71dc7588ea23543ec967b.png',
          'title': 'Fyipe Status Page',
          'isPrivate': false
        },
        'requesting': false,
        'notes': {
          'error': null,
          'notes': [
            {
              'resolved': true,
              'investigationNote': '',
              'createdAt': '2018-10-24T07:10:11.898Z',
              '_id': '5bd01ad38c8eff2ef6c3b847',
              'monitorId': {
                '_id': '5bc32d23d3e9063a1701ec72',
                'name': 'Hackerbay Website'
              }
            },
            {
              'resolved': true,
              'investigationNote': '',
              'createdAt': '2018-10-24T07:00:39.684Z',
              '_id': '5bd018978c8eff2ef6c3b7e9',
              'monitorId': {
                '_id': '5bc32d23d3e9063a1701ec72',
                'name': 'Hackerbay Website'
              }
            },
            {
              'resolved': true,
              'investigationNote': '',
              'createdAt': '2018-10-24T06:56:12.307Z',
              '_id': '5bd0178c8c8eff2ef6c3b7ca',
              'monitorId': {
                '_id': '5bc32d23d3e9063a1701ec72',
                'name': 'Hackerbay Website'
              }
            },
            {
              'resolved': true,
              'investigationNote': '',
              'createdAt': '2018-10-24T06:52:07.304Z',
              '_id': '5bd016978c8eff2ef6c3b798',
              'monitorId': {
                '_id': '5bc32d23d3e9063a1701ec72',
                'name': 'Hackerbay Website'
              }
            },
            {
              'resolved': true,
              'investigationNote': '',
              'createdAt': '2018-10-24T06:27:29.509Z',
              '_id': '5bd010d18c8eff2ef6c3b6eb',
              'monitorId': {
                '_id': '5bc32d23d3e9063a1701ec72',
                'name': 'Hackerbay Website'
              }
            }
          ],
          'requesting': false,
          'count': 331,
          'skip': 0
        },
        'requestingmore': false,
        'individualnote': null,
        'notesmessage': null
      },
      'login':{'requesting':false,'user':{},'error':null,'success':false}
}

export const _store = mockStore(state)