import React from 'react';
import { storiesOf } from '@storybook/react';
import BlockChart from '../../../components/blockchart/BlockChart'

const props = {
    'time':
        { 'date': '2018-07-02T18:30:04.452Z', 'upTime': 228, 'downTime': 6, '_id': '5b3a6f2c6a2043182826411a', 'monitorId': '5b1f41a02a62c8611d23c96e', 'status': 'offline', '__v': 0 },
    'id': 0
}

const props_empty =  { 'time': false, 'emptytime': 1530423352078, 'id': 2 }

storiesOf('BlockChart', module)
    .addDecorator(story => (
        <div style={{ margin: '20%' }} >
            <div className='block-chart'>
                {story()}
            </div>
        </div>
    ))
    .add('BlockChart Time', () =>
        <BlockChart  {...props} />
    )
    .add('BlockChart Empty', () =>
    <BlockChart  {...props_empty} />
)
