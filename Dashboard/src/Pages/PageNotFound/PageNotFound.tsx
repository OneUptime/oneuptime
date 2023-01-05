// Tailwind

import React, { FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../PageComponentProps';
import Page from 'CommonUI/src/Components/Page/Page';
import NotFound from "CommonUI/src/Components/404"
import Route from 'Common/Types/API/Route';
import Email from 'Common/Types/Email';

const PageNotFound: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    return (
        <Page title={'Page Not Found'} breadcrumbLinks={[]}>
            <NotFound homeRoute={new Route("/dashboard")} supportEmail={new Email("support@oneuptime.com")} />
        </Page>
    );
};

export default PageNotFound;
