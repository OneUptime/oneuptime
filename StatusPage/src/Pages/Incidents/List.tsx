import React, { FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../PageComponentProps';
import Page from '../../Components/Page/Page';
// import EventHistoryList from 'CommonUI/src/Components/EventHistoryList/EventHistoryList';

const Overview: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    return (
        <Page >
            <p>Overview</p>

            {/* <EventHistoryList/> */}
        </Page>
    );
};

export default Overview;
