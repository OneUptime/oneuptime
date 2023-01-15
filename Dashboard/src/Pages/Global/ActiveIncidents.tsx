import React, { FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../PageComponentProps';
import Page from 'CommonUI/src/Components/Page/Page';
import Route from 'Common/Types/API/Route';
import RouteMap from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';

const Home: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    return (
        <Page
            title={'User Profile'}
            breadcrumbLinks={[
                {
                    title: 'Home',
                    to: RouteMap[PageMap.HOME] as Route,
                },
                {
                    title: 'Project Invitations',
                    to: RouteMap[PageMap.ACTIVE_INCIDENTS] as Route,
                },
            ]}
        >
           
        </Page>
    );
};

export default Home;
