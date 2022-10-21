import React, { FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../PageComponentProps';
import Page from '../../Components/Page/Page';
import EventItem from 'CommonUI/src/Components/EventItem/EventItem';

const Overview: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    return (
        <Page >
            <EventItem/>
        </Page>
    );
};

export default Overview;
