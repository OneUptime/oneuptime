import React from 'react';
import { storiesOf } from '@storybook/react';
import {
    OnCallTableBody,
    OnCallTableHeader,
} from '../../../components/onCall/OnCallData';

storiesOf('OnCall', module)
    .addDecorator(story => (
        <div style={{ margin: '20%' }}>
            <table>
                <tbody>
                    <tr>{story()}</tr>
                </tbody>
            </table>
        </div>
    ))
    .add('OnCallTableBody', () => (
        <OnCallTableBody text={'OnCallTableBody Should display this'} />
    ))
    .add('OnCallTableHeader', () => (
        <OnCallTableHeader text={'OnCallTableHeader Should display this'} />
    ));
