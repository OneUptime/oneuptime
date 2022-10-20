import React, { FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../PageComponentProps';
import Page from '../../Components/Page/Page';

const Overview: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    return (
        <Page title={'Overview'}>
            <p>Overview</p>
        </Page>
    );
};

export default Overview;
