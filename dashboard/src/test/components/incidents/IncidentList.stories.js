
import React from 'react';
import { storiesOf, action } from '@storybook/react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { incidentsRequest, incidentsError, incidentsSuccess, resetIncidents } from '../../../actions/incident';
import PropTypes from 'prop-types';

import { IncidentList } from '../../../components/incident/IncidentList'

let props = {
    'incidents': {
        'createdAt': '2018-06-12T03:44:32.892Z',
        'pollTime': '2018-06-12T03:44:32.892Z',
        '_id': '5b1f41a02a62c8611d23c96e',
        'createdBy': '5b1c0c29cb06cc23b132db07',
        'name': 'Home Page',
        'type': 'url',
        'data': {
            'url': 'https://hackerbay.io'
        },
        'projectId': '5b1f39482a62c8611d23c953',
        '__v': 0,
        'time': [{
            'date': 'Tue Jun 26 2018 02:24:10 GMT+0530 (India Standard Time)',
            'monitorId': '5b1f41a02a62c8611d23c96e',
            'upTime': 0,
            'downTime': 0,
            'status': ''
        }],
        'count': 14,
        'incidents': [{
            'acknowledged': false,
            'resolved': false,
            'internalNote': '',
            'investigationNote': '',
            'createdAt': '2018-06-22T16:57:54.908Z',
            '_id': '5b2d2a92f5e4115b698b2cff',
            'monitorId': '5b1f41a02a62c8611d23c96e',
            'createdBy': '5b1c0c29cb06cc23b132db07',
            '__v': 0
        }, {
            'acknowledged': false,
            'resolved': false,
            'internalNote': '',
            'investigationNote': '',
            'createdAt': '2018-06-22T16:57:54.190Z',
            '_id': '5b2d2a92f5e4115b698b2cfe',
            'monitorId': '5b1f41a02a62c8611d23c96e',
            'createdBy': '5b1c0c29cb06cc23b132db07',
            '__v': 0
        }, {
            'acknowledged': false,
            'resolved': false,
            'internalNote': '',
            'investigationNote': '',
            'createdAt': '2018-06-22T16:57:53.522Z',
            '_id': '5b2d2a91f5e4115b698b2cfd',
            'monitorId': '5b1f41a02a62c8611d23c96e',
            'createdBy': '5b1c0c29cb06cc23b132db07',
            '__v': 0
        }],
        'skip': 0,
        'limit': 3,
        'responseTime': null,
        'uptimePercent': 100,
        'status': 'offline',
        'error': null,
        'success': false,
        'requesting': false
    },
    'monitorState': {
        'monitorsList': {
            'requesting': false,
            'error': null,
            'success': false,
            'monitors': [{
                'createdAt': '2018-06-12T03:44:32.892Z',
                'pollTime': '2018-06-12T03:44:32.892Z',
                '_id': '5b1f41a02a62c8611d23c96e',
                'createdBy': '5b1c0c29cb06cc23b132db07',
                'name': 'Home Page',
                'type': 'url',
                'data': {
                    'url': 'https://hackerbay.io'
                },
                'projectId': '5b1f39482a62c8611d23c953',
                '__v': 0,
                'time': [{
                    'date': 'Tue Jun 26 2018 02:24:10 GMT+0530 (India Standard Time)',
                    'monitorId': '5b1f41a02a62c8611d23c96e',
                    'upTime': 0,
                    'downTime': 0,
                    'status': ''
                }],
                'count': 14,
                'incidents': [{
                    'acknowledged': false,
                    'resolved': false,
                    'internalNote': '',
                    'investigationNote': '',
                    'createdAt': '2018-06-22T16:57:54.908Z',
                    '_id': '5b2d2a92f5e4115b698b2cff',
                    'monitorId': '5b1f41a02a62c8611d23c96e',
                    'createdBy': '5b1c0c29cb06cc23b132db07',
                    '__v': 0
                }, {
                    'acknowledged': false,
                    'resolved': false,
                    'internalNote': '',
                    'investigationNote': '',
                    'createdAt': '2018-06-22T16:57:54.190Z',
                    '_id': '5b2d2a92f5e4115b698b2cfe',
                    'monitorId': '5b1f41a02a62c8611d23c96e',
                    'createdBy': '5b1c0c29cb06cc23b132db07',
                    '__v': 0
                }, {
                    'acknowledged': false,
                    'resolved': false,
                    'internalNote': '',
                    'investigationNote': '',
                    'createdAt': '2018-06-22T16:57:53.522Z',
                    '_id': '5b2d2a91f5e4115b698b2cfd',
                    'monitorId': '5b1f41a02a62c8611d23c96e',
                    'createdBy': '5b1c0c29cb06cc23b132db07',
                    '__v': 0
                }],
                'skip': 0,
                'limit': 3,
                'responseTime': null,
                'uptimePercent': 100,
                'status': 'offline',
                'error': null,
                'success': false,
                'requesting': false
            }, {
                'createdAt': '2018-06-23T03:45:45.843Z',
                'pollTime': '2018-06-23T03:45:45.843Z',
                '_id': '5b2dc269f5e4115b698b2d73',
                'createdBy': '5b1c0c29cb06cc23b132db07',
                'name': 'Test Page',
                'type': 'url',
                'data': {
                    'url': 'https://hackerbay.ios'
                },
                'projectId': '5b1f39482a62c8611d23c953',
                '__v': 0,
                'time': [{
                    'date': 'Tue Jun 26 2018 02:24:10 GMT+0530 (India Standard Time)',
                    'monitorId': '5b2dc269f5e4115b698b2d73',
                    'upTime': 0,
                    'downTime': 0,
                    'status': ''
                }],
                'count': 0,
                'incidents': [],
                'skip': 0,
                'limit': 3,
                'responseTime': null,
                'uptimePercent': 100,
                'status': 'offline'
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
    'currentProject': {
        'users': [{
            'userId': '5b1c0c29cb06cc23b132db07',
            'role': 'Administrator',
            '_id': '5b1f39482a62c8611d23c954'
        }, {
            'userId': '5b1d20232352d77c91b2dae1',
            'role': 'Administrator',
            '_id': '5b2c77fa728c4b2bc286eca4'
        }],
        'createdAt': '2018-06-12T03:08:56.638Z',
        '_id': '5b1f39482a62c8611d23c953',
        'name': 'Test 1',
        'apiKey': '403e2e10-75d9-11e8-9272-bf0bb40d80f7',
        'stripePlanId': 'plan_CpIUcLDhD1HKKA',
        'stripeSubscriptionId': 'sub_D276mFZNBg3iMK',
        'stripeMeteredSubscriptionId': 'sub_D276LWAbjABjIZ',
        '__v': 0
    },
    nextClicked: action('nextClicked'),
    prevClicked: action('prevClicked')
}

class Mock_Incident_Pagination extends React.Component {

    prevClicked = () => {
        this.props.getIncidents(this.props.currentProject._id, ((this.props.incidents.skip || 0) > (this.props.incidents.limit || 10)) ? this.props.incidents.skip - this.props.incidents.limit : 0, 10);
    }

    nextClicked = () => {
        this.props.getIncidents(this.props.currentProject._id, this.props.incidents.skip + this.props.incidents.limit, 10);
    }
    constructor(props) {
        super(props)
    }

    render() {
        return <IncidentList incidents={this.props.incidents} prevClicked={this.prevClicked} nextClicked={this.nextClicked} {...props}/>
    }
}

Mock_Incident_Pagination.displayName = 'Mock_Incident_Pagination'

const mapDispatchToProps = dispatch => {
    return bindActionCreators({ incidentsRequest, incidentsError, incidentsSuccess, resetIncidents }, dispatch);
}

Mock_Incident_Pagination.propTypes = {
    currentProject: PropTypes.object.isRequired,
    getIncidents: PropTypes.func,
    incidents: PropTypes.object,
    limit: PropTypes.number,
}


let Mock_Incident_Pagination_Dcorated = connect(null, mapDispatchToProps)(Mock_Incident_Pagination);

let mock_getIncidents = (details)=>{
    const submitAction = action('getNext/getPrev');
  submitAction(details);
}


storiesOf('Incidents', module)
    .addDecorator(story => (
        <div style={{ margin: '3%' }} >
            {story()}</div>
    ))
    .add('IncidentList', () =>
        <Mock_Incident_Pagination_Dcorated getIncidents ={mock_getIncidents} {...props}/>
    )