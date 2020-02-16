import React from 'react';
import { storiesOf,action } from '@storybook/react';
import { DeleteProjectModal } from '../../../components/project/DeleteProjectModal'
import { withKnobs, boolean } from '@storybook/addon-knobs';

const props  = {
    'match': {
        'path': '/project/:projectId/monitoring',
        'url': '/project/5b1f39482a62c8611d23c953/monitoring',
        'isExact': true,
        'params': {
            'projectId': '5b1f39482a62c8611d23c953'
        }
    },
    'location': {
        'pathname': '/project/5b1f39482a62c8611d23c953/monitoring',
        'search': '',
        'hash': '',
        'key': 'lzsemp'
    },
    'history': {
        'length': 33,
        'action': 'PUSH',
        'location': {
            'pathname': '/project/5b1f39482a62c8611d23c953/monitoring',
            'search': '',
            'hash': '',
            'key': 'lzsemp'
        }
    },
    'projectName': 'Test 1',
    'projectId': '5b1f39482a62c8611d23c953',
    'nextProject': {
        'users': [{
            'userId': '5b1c0c29cb06cc23b132db07',
            'role': 'Administrator',
            '_id': '5b209dcff2fcff4072f64d91'
        }],
        'createdAt': '2018-06-13T04:30:07.519Z',
        '_id': '5b209dcff2fcff4072f64d90',
        'name': 'hello',
        'apiKey': '738050a0-6ec2-11e8-a360-810647aa7e44',
        'stripePlanId': 'plan_CpIatF9qAmeZLP',
        'stripeSubscriptionId': 'sub_D5t5in5vqyxYm3',
        'stripeMeteredSubscriptionId': 'sub_D2VdfvSlUBRgJy',
        '__v': 0
    },
    deleteProject:(details)=>{
        const deleteProject = action('deleteProject');
        deleteProject(details);
        return Promise.resolve(details)
    },
    switchProject: action('switchProject'),
    hideDeleteModal: action('hideDeleteModal'),
}

storiesOf('Project', module)
.addDecorator(withKnobs)
    .addDecorator(story => (
        <div style={{ margin: '30%' }} >
            {story()}</div>
    ))
    .add('DeleteProjectModal', () =>
        <DeleteProjectModal visible={boolean('visible', true)} isRequesting={boolean('isRequesting', false)}  {...props} />
    )
