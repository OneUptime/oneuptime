import React from 'react';
import { storiesOf } from '@storybook/react';
import {
    HTD1,
    HTD2,
    HTD3,
    HTD4,
    HTD5,
    HTD6,
    HTD7,
    TD1,
    TD2,
    TD3,
    TD4,
    TD5,
    TD6,
    AlertTableHeader,
    AlertTableRows,
} from '../../../components/alert/AlertTable';
import moment from 'moment';

storiesOf('Alert', module)
    .addDecorator(story => (
        <div style={{ margin: '20%' }}>
            <table>
                <tbody>
                    <tr>{story()}</tr>
                </tbody>
            </table>
        </div>
    ))
    .add('HTD1', () => <HTD1 />)
    .add('HTD2', () => <HTD2 />)
    .add('HTD3', () => <HTD3 />)
    .add('HTD4', () => <HTD4 />)
    .add('HTD5', () => <HTD5 />)
    .add('HTD6', () => <HTD6 />)
    .add('HTD7', () => <HTD7 />)

    .add('TD1', () => <TD1 />)

    .add('TD2', () => <TD2 />)

    .add('TD3', () => <TD3 />)

    .add('TD4', () => <TD4 />)

    .add('TD5', () => <TD5 />)
    .add('TD6', () => <TD6 />);

storiesOf('Alert', module)
    .addDecorator(story => (
        <div style={{ margin: '20%' }}>
            <table>
                <tbody>{story()}</tbody>
            </table>
        </div>
    ))
    .add('AlertTableHeader', () => <AlertTableHeader />)
    .add('AlertTableRows', () => (
        <AlertTableRows
            alerts={[
                {
                    userId: {
                        name: 'Test Monitor 1',
                    },
                    monitorId: {
                        name: 'Test Monitor 1',
                    },
                    alertVia: 'Call',
                    createdAt: moment(),
                },
                {
                    userId: {
                        name: 'Test Monitor 2',
                    },
                    monitorId: {
                        name: 'Test Monitor 2',
                    },
                    alertVia: 'SMS',
                    createdAt: moment(),
                },
            ]}
        />
    ));
