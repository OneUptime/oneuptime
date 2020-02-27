import React from 'react';
import { storiesOf, action } from '@storybook/react';
import { withKnobs, boolean } from '@storybook/addon-knobs';
import { IncidentAlert } from '../../../components/incident/IncidentAlert';

const mock_nav = details => {
    const submitAction = action('getNext/getPrev');
    submitAction(details);
};

const props = {
    match: {
        path: '/project/:projectId/incidents/:incidentId',
        url:
            '/project/5b1f39482a62c8611d23c953/incidents/5b2d2a92f5e4115b698b2cff',
        isExact: true,
        params: {
            projectId: '5b1f39482a62c8611d23c953',
            incidentId: '5b2d2a92f5e4115b698b2cff',
        },
    },
    location: {
        pathname:
            '/project/5b1f39482a62c8611d23c953/incidents/5b2d2a92f5e4115b698b2cff',
        search: '',
        hash: '',
        key: 'xlbzaz',
    },
    history: {
        length: 50,
        action: 'PUSH',
        location: {
            pathname:
                '/project/5b1f39482a62c8611d23c953/incidents/5b2d2a92f5e4115b698b2cff',
            search: '',
            hash: '',
            key: 'xlbzaz',
        },
    },
    alerts: [
        {
            projectId: '5b1f39482a62c8611d23c953',
            userId: {
                userId: '5b1c0c29cb06cc23b132db07',
                name: 'Danstan Onyango',
            },
            alertVia: 'Call',
            monitorId: {
                monitorid: '5b1f41a02a62c8611d23c96e',
                name: 'Home Page',
            },
            createdAt: new Date(108, 6, 1),
            incidentId: '5b1f41a02a62c8611d23c96e',
        },
        {
            projectId: '5b1f39482a62c8611d23c953',
            userId: {
                userId: '5b1c0c29cb06cc23b132db07',
                name: 'Danstan Onyango',
            },
            alertVia: 'Call',
            monitorId: {
                monitorid: '5b1f41a02a62c8611d23c96e',
                name: 'Home Page',
            },
            createdAt: new Date(108, 6, 1),
            incidentId: '5b1f41a02a62c8611d23c96e',
        },
        {
            projectId: '5b1f39482a62c8611d23c953',
            userId: {
                userId: '5b1c0c29cb06cc23b132db07',
                name: 'Danstan Onyango',
            },
            alertVia: 'Call',
            monitorId: {
                monitorid: '5b1f41a02a62c8611d23c96e',
                name: 'Home Page',
            },
            createdAt: new Date(108, 6, 1),
            incidentId: '5b1f41a02a62c8611d23c96e',
        },
    ],
    count: 20,
    skip: 0,
    limit: 10,
    error: null,
    next: mock_nav,
    previous: mock_nav,
};
const stories = storiesOf('Incidents', module);
stories.addDecorator(withKnobs);
stories.addDecorator(story => <div style={{ margin: '3%' }}>{story()}</div>);
stories.add('IncidentAlart', () => (
    <IncidentAlert isRequesting={boolean('isRequesting', false)} {...props} />
));
