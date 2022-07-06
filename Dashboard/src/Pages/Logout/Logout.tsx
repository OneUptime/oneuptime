import React, { FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../PageComponentProps';
import Page from 'CommonUI/src/Components/Page/Page';
import Route from 'Common/Types/API/Route';
import RouteMap from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import PageLoader from 'CommonUI/src/Components/Loader/PageLoader';

const Logout: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    return (
        <Page
            title={'Logout'}
            breadcrumbLinks={[
                {
                    title: 'Logout',
                    to: RouteMap[PageMap.LOGOUT] as Route,
                },
            ]}
        >
            <PageLoader isVisible={true} />
        </Page>
    );
};

export default Logout;
